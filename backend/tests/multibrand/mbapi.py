"""
HTTP helpers: logged-in API sessions, OpenAPI route discovery, marker scan.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

import httpx

import mbconfig as cfg


class Resp:
    """Normalized response (never raises): status=None means transport error."""

    def __init__(self, status: Optional[int], text: str, ms: int, error: Optional[str] = None,
                 headers: Optional[dict] = None):
        self.status = status
        self.text = text or ""
        self.ms = ms
        self.error = error
        self.headers = headers or {}

    def json(self) -> Any:
        try:
            return json.loads(self.text)
        except ValueError:
            return None

    @property
    def ok(self) -> bool:
        return self.status is not None and 200 <= self.status < 300

    def short(self, n: int = 160) -> str:
        t = self.error or self.text
        t = re.sub(r"\s+", " ", t)
        return t[:n]

    def __repr__(self) -> str:
        return f"<Resp {self.status} {self.short(80)!r}>"


class Api:
    """One identity against the API (token may be None = anonymous)."""

    def __init__(self, name: str, token: Optional[str] = None, base: str = cfg.API,
                 extra_headers: Optional[dict] = None):
        self.name = name
        self.token = token
        self.base = base
        self.extra = dict(extra_headers or {})
        self.client = httpx.Client(base_url=base, timeout=cfg.TIMEOUT, follow_redirects=False)
        self.user: Optional[dict] = None

    def headers(self, extra: Optional[dict] = None) -> dict:
        h = dict(self.extra)
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        h.update(extra or {})
        return h

    def call(self, method: str, path: str, *, params: Optional[dict] = None, json_body: Any = None,
             headers: Optional[dict] = None, stream_seconds: Optional[float] = None,
             send_body: bool = True) -> Resp:
        t0 = time.monotonic()
        try:
            if stream_seconds is not None:
                return self._stream(method, path, params, headers, stream_seconds, t0)
            kwargs: Dict[str, Any] = {"params": params, "headers": self.headers(headers)}
            if send_body and json_body is not None:
                kwargs["json"] = json_body
            r = self.client.request(method, path, **kwargs)
            return Resp(r.status_code, r.text, int((time.monotonic() - t0) * 1000), headers=dict(r.headers))
        except Exception as e:  # timeouts, connection errors...
            return Resp(None, "", int((time.monotonic() - t0) * 1000), error=f"{type(e).__name__}: {e}")

    def _stream(self, method, path, params, headers, seconds, t0) -> Resp:
        chunks: List[str] = []
        status = None
        try:
            with self.client.stream(method, path, params=params, headers=self.headers(headers),
                                    timeout=httpx.Timeout(cfg.TIMEOUT, read=seconds)) as r:
                status = r.status_code
                deadline = time.monotonic() + seconds
                for chunk in r.iter_text():
                    chunks.append(chunk)
                    if time.monotonic() > deadline or sum(map(len, chunks)) > 64_000:
                        break
        except httpx.ReadTimeout:
            pass  # expected for a quiet event stream
        except Exception as e:
            return Resp(status, "".join(chunks), int((time.monotonic() - t0) * 1000),
                        error=f"{type(e).__name__}: {e}")
        return Resp(status, "".join(chunks), int((time.monotonic() - t0) * 1000))

    def close(self) -> None:
        self.client.close()


def login(email: str, password: str, brand: Optional[str] = None, headers: Optional[dict] = None) -> Tuple[Resp, Optional[dict]]:
    anon = Api("anon")
    body = {"email": email, "password": password}
    if brand:
        body["brand"] = brand
    r = anon.call("POST", "/api/auth/login", json_body=body, headers=headers)
    anon.close()
    return r, (r.json() if r.ok else None)


def session(name: str, email: str, password: str = cfg.PASSWORD, brand: Optional[str] = None) -> Api:
    r, data = login(email, password, brand)
    if not data or "access_token" not in data:
        raise RuntimeError(f"login failed for {name} ({email}): {r.status} {r.short(300)}")
    api = Api(name, data["access_token"])
    api.user = data.get("user") or {}
    return api


# ---------------------------------------------------------------------------
# OpenAPI
# ---------------------------------------------------------------------------

class Route:
    def __init__(self, method: str, path: str, op: dict):
        self.method = method.upper()
        self.path = path
        self.op = op or {}
        params = self.op.get("parameters") or []
        self.path_params = [p["name"] for p in params if p.get("in") == "path"]
        self.query_params = [p for p in params if p.get("in") == "query"]
        self.header_params = [p["name"].lower() for p in params if p.get("in") == "header"]
        rb = self.op.get("requestBody") or {}
        self.body_required = bool(rb.get("required"))
        self.has_body = bool(rb)

    @property
    def key(self) -> str:
        return f"{self.method} {self.path}"

    @property
    def declares_auth_header(self) -> bool:
        """get_current_user takes `authorization: Header`, so an authenticated
        route shows an 'authorization' header parameter in its OpenAPI entry."""
        return "authorization" in self.header_params

    def fill(self, values: Dict[str, str]) -> str:
        out = self.path
        for name in self.path_params:
            out = out.replace("{" + name + "}", quote(str(values.get(name, uuid.uuid4())), safe=""))
        return out

    def __repr__(self) -> str:
        return f"<Route {self.key}>"


def fetch_openapi() -> Tuple[Optional[dict], str]:
    """The API's OpenAPI document (tries /api/openapi.json, then /openapi.json,
    then importing the app in-process as a last resort)."""
    anon = Api("anon")
    tried = []
    for path in ("/api/openapi.json", "/openapi.json"):
        r = anon.call("GET", path)
        tried.append(f"{path}={r.status}")
        if r.ok and isinstance(r.json(), dict) and "paths" in (r.json() or {}):
            anon.close()
            return r.json(), path
    anon.close()
    try:
        from api.main import app  # imports routers only; no DB work at import time
        return app.openapi(), "in-process api.main.app.openapi()"
    except Exception as e:
        tried.append(f"in-process import failed: {type(e).__name__}: {e}")
    return None, "; ".join(tried)


def routes_from(doc: dict) -> List[Route]:
    out = []
    for path, ops in sorted((doc or {}).get("paths", {}).items()):
        for method, op in ops.items():
            if method.lower() in ("get", "post", "put", "patch", "delete"):
                out.append(Route(method, path, op))
    return out


# ---------------------------------------------------------------------------
# Marker scanning
# ---------------------------------------------------------------------------

def _variants(text: str) -> List[str]:
    out = [text]
    try:
        parsed = json.loads(text)
        out.append(json.dumps(parsed, ensure_ascii=False))
    except (ValueError, TypeError):
        pass
    return out


def scan(text: str, markers: Iterable[str], scrub: Sequence[str] = ()) -> List[Tuple[str, str]]:
    """Markers found in `text` (case-insensitive) after removing every value we
    sent ourselves (`scrub`), as [(marker, context snippet)]."""
    found: Dict[str, str] = {}
    for body in _variants(text or ""):
        low = body.lower()
        for s in sorted({str(x).lower() for x in scrub if x and len(str(x)) >= 4}, key=len, reverse=True):
            low = low.replace(s, " ")
        for m in markers:
            ml = str(m).lower()
            if not ml or ml in found:
                continue
            i = low.find(ml)
            if i >= 0:
                found[ml] = low[max(0, i - 60): i + len(ml) + 60].replace("\n", " ")
    return sorted(found.items())
