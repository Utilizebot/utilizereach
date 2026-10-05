"""pytest glue for the multi-brand isolation suite (see README.md)."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from isolation_checks import Ctx  # noqa: E402
from mbreport import REPORT  # noqa: E402


@pytest.fixture(scope="session")
def ctx():
    c = Ctx()
    try:
        c.setup()
    except Exception as e:
        REPORT.add("setup", "FAIL", "fixture setup / login", detail=f"{type(e).__name__}: {e}")
        c.teardown()
        pytest.fail(f"multi-brand fixture setup failed: {type(e).__name__}: {e}", pytrace=False)
    yield c
    c.teardown()


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    if REPORT.rows:
        for line in REPORT.summary_lines():
            terminalreporter.write_line(line)
