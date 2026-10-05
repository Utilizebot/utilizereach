"""
Result collection + the human-readable summary table + JSON report.

Verdicts:
    PASS     the check held
    LEAK     another brand's data was visible / modified  (always a failure)
    FAIL     a security expectation failed (unauthenticated access, missing
             RBAC, wrong brand after a switch, RLS hole...)  (failure)
    WEAK     isolation held (no data seen / nothing changed) but the status
             code was not the expected one (e.g. 200 on a cross-brand delete
             that deleted nothing). Failure only with MB_STRICT=1.
    ERROR    the endpoint errored for an unrelated reason (5xx, timeout,
             422 from our probe body) - investigate, but not a leak
    SKIP     not exercised (with the reason)
    INFO     informational observation
"""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

import mbconfig as cfg

FAILING = {"LEAK", "FAIL"}


class Report:
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.meta: Dict[str, Any] = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "api": cfg.API,
                                     "strict": cfg.STRICT}

    def add(self, section: str, verdict: str, what: str, **extra: Any) -> Dict[str, Any]:
        row = {"section": section, "verdict": verdict, "what": what, **extra}
        self.rows.append(row)
        return row

    def section(self, name: str) -> List[Dict[str, Any]]:
        return [r for r in self.rows if r["section"] == name]

    def failures(self, section: Optional[str] = None) -> List[Dict[str, Any]]:
        bad = set(FAILING) | ({"WEAK"} if cfg.STRICT else set())
        return [r for r in self.rows if r["verdict"] in bad and (section is None or r["section"] == section)]

    # ------------------------------------------------------------------
    def summary_lines(self) -> List[str]:
        lines: List[str] = []
        by_sec: Dict[str, Counter] = defaultdict(Counter)
        for r in self.rows:
            by_sec[r["section"]][r["verdict"]] += 1
        cols = ["PASS", "LEAK", "FAIL", "WEAK", "ERROR", "SKIP", "INFO"]
        lines.append("")
        lines.append("=" * 100)
        lines.append(f"MULTI-BRAND ISOLATION SUMMARY   api={cfg.API}   strict={cfg.STRICT}")
        lines.append("=" * 100)
        lines.append(f"{'section':<14}" + "".join(f"{c:>8}" for c in cols))
        for sec in sorted(by_sec):
            lines.append(f"{sec:<14}" + "".join(f"{by_sec[sec].get(c, 0):>8}" for c in cols))
        tot = Counter()
        for c in by_sec.values():
            tot.update(c)
        lines.append(f"{'TOTAL':<14}" + "".join(f"{tot.get(c, 0):>8}" for c in cols))

        def block(title: str, verdicts: set, limit: int = 200) -> None:
            rows = [r for r in self.rows if r["verdict"] in verdicts]
            if not rows:
                return
            lines.append("")
            lines.append(f"--- {title} ({len(rows)}) " + "-" * max(0, 80 - len(title)))
            for r in rows[:limit]:
                lines.append(f"[{r['verdict']}] {r['section']}: {r['what']}")
                for k in ("user", "status", "markers", "diffs", "detail", "expected"):
                    if r.get(k) not in (None, "", [], {}):
                        v = r[k]
                        if k == "markers":
                            v = "; ".join(f"{m!r} …{ctx[:110]}…" for m, ctx in v[:4])
                        lines.append(f"        {k}: {v if isinstance(v, str) else json.dumps(v, default=str)[:400]}")
            if len(rows) > limit:
                lines.append(f"        ... {len(rows) - limit} more in the JSON report")

        block("LEAKS (cross-brand data visible or modified)", {"LEAK"})
        block("FAILURES", {"FAIL"})
        block("WEAK (isolation held, unexpected status)", {"WEAK"})
        block("ERRORS (endpoint errored - not a leak, investigate)", {"ERROR"}, limit=80)
        block("INFO", {"INFO"}, limit=60)
        skips = [r for r in self.rows if r["verdict"] == "SKIP"]
        if skips:
            lines.append("")
            lines.append(f"--- SKIPPED ({len(skips)}) " + "-" * 70)
            reasons = Counter(r.get("detail") or "" for r in skips)
            for reason, n in reasons.most_common():
                examples = [r["what"] for r in skips if (r.get("detail") or "") == reason][:4]
                lines.append(f"  {n:>4} x {reason}  e.g. {', '.join(examples)}")
        swept = sorted({r["what"].split(" [")[0] for r in self.section("sweep") if r["verdict"] != "SKIP"})
        if swept:
            lines.append("")
            lines.append(f"--- GET routes exercised by the leak sweep ({len(swept)}) " + "-" * 40)
            for i in range(0, len(swept), 3):
                lines.append("  " + " | ".join(swept[i:i + 3]))
        lines.append("")
        lines.append(f"report: {cfg.REPORT_PATH}")
        lines.append("=" * 100)
        return lines

    def save(self) -> None:
        try:
            cfg.REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.meta["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
            cfg.REPORT_PATH.write_text(json.dumps({"meta": self.meta, "rows": self.rows}, indent=1, default=str))
        except OSError as e:
            print(f"[mb] could not write report {cfg.REPORT_PATH}: {e}")


REPORT = Report()
