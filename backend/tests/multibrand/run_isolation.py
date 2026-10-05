#!/usr/bin/env python3
"""
Standalone runner (no pytest needed - the backend image does not ship it).

    python tests/multibrand/run_isolation.py                 # every check, keep going
    python tests/multibrand/run_isolation.py -x              # stop at the first failing check
    python tests/multibrand/run_isolation.py --only sweep,byid
    python tests/multibrand/run_isolation.py --seed          # only create/refresh fixtures
    python tests/multibrand/run_isolation.py --cleanup       # remove brand-1 victims + probe rows
    python tests/multibrand/run_isolation.py --cleanup-all   # ...and brand acme + test users

Exit code: 0 all clean, 1 leaks/failures (or a check crashed), 2 setup failed.
"""

from __future__ import annotations

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mbfixtures  # noqa: E402
from isolation_checks import ALL_CHECKS, Ctx  # noqa: E402
from mbreport import REPORT  # noqa: E402


def main(argv: list) -> int:
    if "--seed" in argv:
        print(mbfixtures.seed())
        return 0
    if "--cleanup" in argv or "--cleanup-all" in argv:
        for line in mbfixtures.cleanup(full="--cleanup-all" in argv):
            print(" -", line)
        return 0
    only = set()
    if "--only" in argv:
        only = {x.strip() for x in argv[argv.index("--only") + 1].split(",") if x.strip()}
    stop = "-x" in argv

    ctx = Ctx()
    try:
        ctx.setup()
    except Exception as e:
        REPORT.add("setup", "FAIL", "fixture setup / login", detail=f"{type(e).__name__}: {e}")
        traceback.print_exc()
        ctx.teardown()
        print("\n".join(REPORT.summary_lines()))
        return 2

    failed = []
    try:
        for name, fn in ALL_CHECKS:
            if only and name not in only:
                continue
            print(f"== {name} ...", flush=True)
            try:
                fn(ctx)
                print(f"   {name}: ok", flush=True)
            except AssertionError as e:
                failed.append(name)
                print(f"   {name}: FAILED\n{str(e)[:3000]}", flush=True)
                if stop:
                    break
            except Exception as e:
                failed.append(name)
                REPORT.add(name, "ERROR", "check crashed", detail=f"{type(e).__name__}: {e}")
                traceback.print_exc()
                if stop:
                    break
    finally:
        ctx.teardown()
    print("\n".join(REPORT.summary_lines()))
    print(f"checks failed: {failed or 'none'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
