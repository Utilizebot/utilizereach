"""
Postgres client with a supabase-py compatible query-builder interface.

Drop-in replacement for the previous Supabase client: code that did
    supabase.table("leads").select("*").eq("id", x).execute().data
works unchanged against a local/self-hosted PostgreSQL database.

Supported surface:
  table(name) / from_(name)
    .select(columns, count="exact")
    .insert(dict | [dict])
    .upsert(dict | [dict], on_conflict="col")
    .update(dict)
    .delete()
    .eq / .neq / .gt / .gte / .lt / .lte / .like / .ilike / .is_ / .in_
    .or_("a.eq.1,b.is.null")
    .contains (jsonb/array @>)
    .order(col, desc=False) / .limit(n) / .offset(n) / .range(a, b)
    .single() / .maybe_single()
    .execute() -> APIResponse(data=[...], count=int|None)
  rpc(fn, params) -> executes SELECT * FROM fn(...)

Rows are JSON-safe: datetime/date -> ISO strings, UUID -> str,
Decimal -> float, matching what PostgREST/Supabase used to return.
"""

import os
import re
import json
import threading
from datetime import datetime, date, time as dt_time
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import UUID

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

# Load environment the same way the old client did (Docker config volume first)
_config_env = Path("/app/config/.env")
if _config_env.exists():
    load_dotenv(_config_env, override=True)
else:
    load_dotenv(override=True)

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

_pool: Optional[ConnectionPool] = None
_pool_lock = threading.Lock()


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        user = os.getenv("POSTGRES_USER", "marketing")
        password = os.getenv("POSTGRES_PASSWORD", "")
        db = os.getenv("POSTGRES_DB", "marketing_ai")
        url = f"postgresql://{user}:{password}@{host}:{port}/{db}"
    return url


def is_database_configured() -> bool:
    return bool(os.getenv("DATABASE_URL") or os.getenv("POSTGRES_HOST"))


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    get_database_url(),
                    min_size=1,
                    max_size=int(os.getenv("PG_POOL_MAX", "10")),
                    kwargs={"row_factory": dict_row},
                    open=True,
                )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _ident(name: str) -> str:
    """Quote/validate a SQL identifier (table or column name)."""
    name = name.strip()
    if not _IDENT_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return f'"{name}"'


def _jsonify(value: Any) -> Any:
    """Convert DB values to the JSON-safe shapes supabase-py used to return."""
    if isinstance(value, (datetime, date, dt_time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_jsonify(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    return value


def _adapt_param(value: Any) -> Any:
    """Adapt python values for psycopg parameters (dicts/list-of-dicts -> jsonb)."""
    if isinstance(value, dict):
        return Jsonb(value)
    if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
        return Jsonb(value)
    return value


class APIResponse:
    """Mimics supabase-py's APIResponse (.data / .count)."""

    def __init__(self, data: Any, count: Optional[int] = None):
        self.data = data
        self.count = count

    def __repr__(self) -> str:
        return f"APIResponse(data={self.data!r}, count={self.count!r})"


class QueryBuilder:
    def __init__(self, table: str):
        self._table = table
        self._op = "select"
        self._columns = "*"
        self._count: Optional[str] = None
        self._filters: List[Tuple[str, str, Any]] = []  # (sql fragment, param marker mode, value)
        self._or_groups: List[str] = []
        self._order: List[str] = []
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None
        self._payload: Optional[Union[dict, List[dict]]] = None
        self._on_conflict: Optional[str] = None
        self._single = False
        self._maybe_single = False

    # ---------- verbs ----------

    def select(self, columns: str = "*", count: Optional[str] = None, **_):
        if self._op in ("insert", "update", "upsert", "delete"):
            # supabase allows .insert(...).select() — we always return rows anyway
            return self
        self._op = "select"
        self._columns = columns or "*"
        self._count = count
        return self

    def insert(self, payload: Union[dict, List[dict]], **_):
        self._op = "insert"
        self._payload = payload
        return self

    def upsert(self, payload: Union[dict, List[dict]], on_conflict: Optional[str] = None, **_):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, payload: dict, **_):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self, **_):
        self._op = "delete"
        return self

    # ---------- filters ----------

    def _add(self, col: str, op: str, value: Any):
        self._filters.append((col, op, value))
        return self

    def eq(self, col, value):
        return self._add(col, "=", value)

    def neq(self, col, value):
        return self._add(col, "!=", value)

    def gt(self, col, value):
        return self._add(col, ">", value)

    def gte(self, col, value):
        return self._add(col, ">=", value)

    def lt(self, col, value):
        return self._add(col, "<", value)

    def lte(self, col, value):
        return self._add(col, "<=", value)

    def like(self, col, pattern):
        return self._add(col, "LIKE", pattern)

    def ilike(self, col, pattern):
        return self._add(col, "ILIKE", pattern)

    def is_(self, col, value):
        # supabase: .is_("col", "null") / .is_("col", None) / booleans
        if value is None or (isinstance(value, str) and value.lower() == "null"):
            return self._add(col, "IS NULL", None)
        if isinstance(value, str) and value.lower() in ("true", "false"):
            value = value.lower() == "true"
        return self._add(col, "IS", value)

    def in_(self, col, values):
        return self._add(col, "IN", list(values))

    def contains(self, col, value):
        return self._add(col, "@>", value)

    def or_(self, expr: str):
        """PostgREST-style: 'status.eq.active,name.ilike.*foo*'"""
        self._or_groups.append(expr)
        return self

    def order(self, col: str, desc: bool = False, **kwargs):
        # supabase-py v1 used order("col", desc=True); v2 also .order("col.desc")
        if "." in col and col.rsplit(".", 1)[-1] in ("asc", "desc"):
            col, direction = col.rsplit(".", 1)
            desc = direction == "desc"
        nulls = ""
        if kwargs.get("nullsfirst"):
            nulls = " NULLS FIRST"
        self._order.append(f"{_ident(col)} {'DESC' if desc else 'ASC'}{nulls}")
        return self

    def limit(self, n: int):
        self._limit = int(n)
        return self

    def offset(self, n: int):
        self._offset = int(n)
        return self

    def range(self, start: int, end: int):
        self._offset = int(start)
        self._limit = int(end) - int(start) + 1
        return self

    def single(self):
        self._single = True
        self._limit = 1
        return self

    def maybe_single(self):
        self._maybe_single = True
        self._limit = 1
        return self

    # ---------- SQL building ----------

    def _columns_sql(self) -> str:
        cols = self._columns.strip()
        if cols == "*" or cols == "":
            return "*"
        parts = []
        for c in cols.split(","):
            c = c.strip()
            if not c:
                continue
            if "(" in c:
                # embedded resource selects (foreign table joins) are not supported;
                # callers needing joins should use rpc()/views
                raise ValueError(
                    f"Embedded select {c!r} not supported by pg shim — use a view or rpc()"
                )
            if c == "*":
                parts.append("*")
            else:
                parts.append(_ident(c))
        return ", ".join(parts) or "*"

    _PGRST_OPS = {
        "eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
        "like": "LIKE", "ilike": "ILIKE", "is": "IS",
    }

    def _or_group_sql(self, expr: str, params: List[Any]) -> str:
        clauses = []
        for cond in expr.split(","):
            cond = cond.strip()
            if not cond:
                continue
            bits = cond.split(".", 2)
            if len(bits) != 3:
                raise ValueError(f"Unsupported or_() condition: {cond!r}")
            col, op, raw = bits
            if op == "is":
                if raw.lower() == "null":
                    clauses.append(f"{_ident(col)} IS NULL")
                else:
                    clauses.append(f"{_ident(col)} IS {'TRUE' if raw.lower() == 'true' else 'FALSE'}")
                continue
            if op not in self._PGRST_OPS:
                raise ValueError(f"Unsupported or_() operator: {op!r}")
            value: Any = raw
            if op in ("like", "ilike"):
                value = raw.replace("*", "%")
            clauses.append(f"{_ident(col)} {self._PGRST_OPS[op]} %s")
            params.append(value)
        return "(" + " OR ".join(clauses) + ")"

    def _where_sql(self, params: List[Any]) -> str:
        clauses = []
        for col, op, value in self._filters:
            if op == "IS NULL":
                clauses.append(f"{_ident(col)} IS NULL")
            elif op == "IS":
                clauses.append(f"{_ident(col)} IS {'TRUE' if value else 'FALSE'}")
            elif op == "IN":
                if not value:
                    clauses.append("FALSE")
                else:
                    placeholders = ", ".join(["%s"] * len(value))
                    clauses.append(f"{_ident(col)} IN ({placeholders})")
                    params.extend(_adapt_param(v) for v in value)
            else:
                clauses.append(f"{_ident(col)} {op} %s")
                params.append(_adapt_param(value))
        for expr in self._or_groups:
            clauses.append(self._or_group_sql(expr, params))
        return (" WHERE " + " AND ".join(clauses)) if clauses else ""

    def _tail_sql(self) -> str:
        sql = ""
        if self._order:
            sql += " ORDER BY " + ", ".join(self._order)
        if self._limit is not None:
            sql += f" LIMIT {self._limit}"
        if self._offset is not None:
            sql += f" OFFSET {self._offset}"
        return sql

    def _build(self) -> Tuple[str, List[Any], Optional[Tuple[str, List[Any]]]]:
        table = _ident(self._table)
        params: List[Any] = []
        count_query: Optional[Tuple[str, List[Any]]] = None

        if self._op == "select":
            sql = f"SELECT {self._columns_sql()} FROM {table}{self._where_sql(params)}{self._tail_sql()}"
            if self._count:
                cparams: List[Any] = []
                count_query = (f"SELECT COUNT(*) AS n FROM {table}{self._where_sql(cparams)}", cparams)
            return sql, params, count_query

        if self._op in ("insert", "upsert"):
            rows = self._payload if isinstance(self._payload, list) else [self._payload]
            if not rows:
                raise ValueError("insert/upsert with empty payload")
            cols = list(rows[0].keys())
            col_sql = ", ".join(_ident(c) for c in cols)
            row_ph = "(" + ", ".join(["%s"] * len(cols)) + ")"
            values_sql = ", ".join([row_ph] * len(rows))
            for r in rows:
                for c in cols:
                    params.append(_adapt_param(r.get(c)))
            sql = f"INSERT INTO {table} ({col_sql}) VALUES {values_sql}"
            if self._op == "upsert":
                conflict_cols = self._on_conflict or "id"
                conflict_sql = ", ".join(_ident(c.strip()) for c in conflict_cols.split(","))
                updates = ", ".join(f"{_ident(c)} = EXCLUDED.{_ident(c)}" for c in cols)
                sql += f" ON CONFLICT ({conflict_sql}) DO UPDATE SET {updates}"
            sql += " RETURNING *"
            return sql, params, None

        if self._op == "update":
            if not isinstance(self._payload, dict) or not self._payload:
                raise ValueError("update requires a non-empty dict")
            sets = []
            for k, v in self._payload.items():
                sets.append(f"{_ident(k)} = %s")
                params.append(_adapt_param(v))
            where = self._where_sql(params)
            sql = f"UPDATE {table} SET {', '.join(sets)}{where} RETURNING *"
            return sql, params, None

        if self._op == "delete":
            where = self._where_sql(params)
            if not where:
                raise ValueError("Refusing to DELETE without filters")
            sql = f"DELETE FROM {table}{where} RETURNING *"
            return sql, params, None

        raise ValueError(f"Unknown operation {self._op!r}")

    # ---------- execution ----------

    def execute(self) -> APIResponse:
        sql, params, count_query = self._build()
        pool = get_pool()
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall() if cur.description else []
                count = None
                if count_query is not None:
                    cur.execute(count_query[0], count_query[1])
                    count = cur.fetchone()["n"]
        data = [_jsonify(dict(r)) for r in rows]
        if self._single:
            if not data:
                raise ValueError(f"single() returned no rows for {self._table}")
            return APIResponse(data[0], count)
        if self._maybe_single:
            return APIResponse(data[0] if data else None, count)
        return APIResponse(data, count)

    # allow awaiting/then-style .execute() results in sync code paths only


class RpcBuilder:
    """Executes a Postgres function: SELECT * FROM fn(args...)."""

    def __init__(self, fn: str, params: Optional[dict] = None):
        self._fn = fn
        self._params = params or {}
        self._single = False
        self._maybe_single = False

    def single(self):
        self._single = True
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def execute(self) -> APIResponse:
        fn = _ident(self._fn)
        keys = list(self._params.keys())
        args_sql = ", ".join(f"{_ident(k)} := %s" for k in keys)
        values = [_adapt_param(self._params[k]) for k in keys]
        sql = f"SELECT * FROM {fn}({args_sql})"
        pool = get_pool()
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                rows = cur.fetchall() if cur.description else []
        data = [_jsonify(dict(r)) for r in rows]
        # scalar-returning functions come back as [{fn_name: value}]
        if data and len(data[0]) == 1 and self._fn in data[0]:
            data = [r[self._fn] for r in data]
        if self._single or self._maybe_single:
            return APIResponse(data[0] if data else None, None)
        return APIResponse(data, None)


class PostgresClient:
    """supabase-py compatible facade over the local Postgres pool."""

    def table(self, name: str) -> QueryBuilder:
        return QueryBuilder(name)

    # supabase-py v2 alias
    def from_(self, name: str) -> QueryBuilder:
        return QueryBuilder(name)

    def rpc(self, fn: str, params: Optional[dict] = None) -> RpcBuilder:
        return RpcBuilder(fn, params)


_client = PostgresClient()


def get_client() -> PostgresClient:
    return _client


def execute_sql(sql: str, params: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
    """Escape hatch for raw SQL (used by auth, analytics endpoints, migrations)."""
    pool = get_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or [])
            rows = cur.fetchall() if cur.description else []
    return [_jsonify(dict(r)) for r in rows]
