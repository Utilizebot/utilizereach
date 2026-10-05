"""
Direct database helpers for the isolation suite (owner DSN for fixtures and
before/after snapshots, app_rw DSN for the RLS checks).

Snapshots are what turn "the API said 404" into "the row really did not
change": every cross-brand attack snapshots the victim rows first, compares
afterwards, and RESTORES them when an attack got through (so a leak found on
the test database is not left with damaged brand-1 data).
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import mbconfig as cfg


@contextmanager
def owner_conn(autocommit: bool = False):
    """Owner connection with the tenancy bypass switched on for the session."""
    conn = psycopg.connect(cfg.OWNER_DSN, row_factory=dict_row, autocommit=autocommit)
    try:
        conn.execute("SELECT set_config('app.tenancy_bypass', 'on', false)")
        if not autocommit:
            conn.commit()
        yield conn
    finally:
        conn.close()


@contextmanager
def app_conn():
    """app_rw connection (subject to RLS). Never committed by the suite."""
    conn = psycopg.connect(cfg.APP_DSN, row_factory=dict_row, autocommit=False)
    try:
        yield conn
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


def q(sql: str, params: Optional[Sequence[Any]] = None) -> List[dict]:
    """One read-only owner query (own short transaction)."""
    with owner_conn(autocommit=True) as conn:
        cur = conn.execute(sql, params or [])
        return cur.fetchall() if cur.description else []


def adapt(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return Jsonb(v)
    return v


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

class Snap:
    """Rows of `table` matching `where`, keyed by the `key` SQL expression.

    `exclude` columns are left out of the comparison (e.g. sales_reps.last_login
    changes on every login).
    """

    def __init__(self, table: str, where: str, params: Sequence[Any], key: str = "id",
                 exclude: Iterable[str] = (), label: Optional[str] = None):
        self.table = table
        self.where = where
        self.params = list(params)
        self.key = key
        self.exclude = list(exclude)
        self.label = label or f"{table}[{where} {self.params}]"
        self.before: Dict[str, dict] = {}
        self.after: Dict[str, dict] = {}

    def _read(self, conn) -> Dict[str, dict]:
        rows = conn.execute(
            f"SELECT ({self.key})::text AS k, (to_jsonb(t) - %s::text[]) AS j "
            f"FROM {self.table} t WHERE {self.where}",
            [self.exclude] + self.params,
        ).fetchall()
        return {r["k"]: r["j"] for r in rows}

    def take(self, conn) -> "Snap":
        self.before = self._read(conn)
        return self

    def compare(self, conn) -> List[str]:
        """Human-readable differences (empty list = unchanged)."""
        self.after = self._read(conn)
        diffs = []
        for k, j in self.before.items():
            if k not in self.after:
                diffs.append(f"{self.table} {k}: DELETED")
            elif self.after[k] != j:
                changed = sorted(c for c in set(j) | set(self.after[k]) if j.get(c) != self.after[k].get(c))
                diffs.append(f"{self.table} {k}: changed {changed}")
        for k in self.after:
            if k not in self.before:
                diffs.append(f"{self.table} {k}: ADDED")
        return diffs

    def restore(self, conn) -> None:
        """Put the 'before' state back (inserts deleted rows, reverts changed
        ones, deletes added ones). Best effort; errors are re-raised."""
        for k, j in self.before.items():
            if k not in self.after:
                conn.execute(
                    f"INSERT INTO {self.table} SELECT * FROM jsonb_populate_record(NULL::{self.table}, %s)",
                    [Jsonb(j)],
                )
            elif self.after[k] != j:
                cols = [c for c in j.keys()]
                col_sql = ", ".join(f'"{c}"' for c in cols)
                conn.execute(
                    f"UPDATE {self.table} t SET ({col_sql}) = "
                    f"(SELECT {col_sql} FROM jsonb_populate_record(NULL::{self.table}, %s)) "
                    f"WHERE ({self.key})::text = %s",
                    [Jsonb(j), k],
                )
        for k in self.after:
            if k not in self.before:
                if self.table == "stakeholders":   # audit rows written by the mutation trigger
                    conn.execute("DELETE FROM stakeholder_audit_logs WHERE stakeholder_id::text = %s", [k])
                conn.execute(f"DELETE FROM {self.table} t WHERE ({self.key})::text = %s", [k])


def triggers_off(conn) -> bool:
    """Skip triggers (audit logs, counters) for the rest of this transaction, so a
    restore/cleanup puts back exactly the snapshot. Needs a superuser owner; when
    that is not available the statements run with triggers on."""
    conn.execute("SAVEPOINT mbtrg")
    try:
        conn.execute("SET LOCAL session_replication_role = replica")
        conn.execute("RELEASE SAVEPOINT mbtrg")
        return True
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT mbtrg")
        return False


def triggers_on(conn) -> None:
    """Undo triggers_off() for the rest of the transaction (so rows inserted
    afterwards get their normal trigger side effects, e.g. audit rows)."""
    conn.execute("SAVEPOINT mbtrg_on")
    try:
        conn.execute("SET LOCAL session_replication_role = origin")
        conn.execute("RELEASE SAVEPOINT mbtrg_on")
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT mbtrg_on")


@contextmanager
def planted(table: str, key_col: str, key: str, values: Dict[str, Any]):
    """Temporarily set `values` on one existing row (owner connection, committed),
    then put the previous values back - even when the body raises. Yields True
    when the row existed (False: nothing was planted)."""
    cols = list(values)
    with owner_conn() as conn:
        before = conn.execute(
            f"SELECT {', '.join(cols)} FROM {table} WHERE ({key_col})::text = %s", [key]).fetchone()
        if before:
            conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = %s' for c in cols)} "
                         f"WHERE ({key_col})::text = %s", [adapt(values[c]) for c in cols] + [key])
        conn.commit()
    try:
        yield bool(before)
    finally:
        if before:
            with owner_conn() as conn:
                conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = %s' for c in cols)} "
                             f"WHERE ({key_col})::text = %s", [adapt(before[c]) for c in cols] + [key])
                conn.commit()


def snap_ids(table: str, ids: Sequence[str], key: str = "id", exclude: Iterable[str] = ()) -> Snap:
    return Snap(table, f"({key})::text = ANY(%s)", [list(ids)], key=key, exclude=exclude)


class Watch:
    """A group of snapshots around one action:

        with Watch([snap1, snap2]) as w:
            ...do the HTTP call...
        w.diffs   -> list of changes (already restored when non-empty)
    """

    def __init__(self, snaps: Sequence[Snap], restore: bool = True):
        self.snaps = list(snaps)
        self.do_restore = restore
        self.diffs: List[str] = []
        self.restore_error: Optional[str] = None

    def __enter__(self):
        with owner_conn() as conn:
            for s in self.snaps:
                s.take(conn)
            conn.rollback()
        return self

    def __exit__(self, exc_type, exc, tb):
        with owner_conn() as conn:
            for s in self.snaps:
                self.diffs.extend(s.compare(conn))
            conn.rollback()
            if self.diffs and self.do_restore:
                try:
                    triggers_off(conn)
                    for s in self.snaps:
                        s.restore(conn)
                    conn.commit()
                except Exception as e:  # report, never mask the leak itself
                    conn.rollback()
                    self.restore_error = f"{type(e).__name__}: {e}"
        return False


def jdump(v: Any) -> str:
    return json.dumps(v, default=str, sort_keys=True)
