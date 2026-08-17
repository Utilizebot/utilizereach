"""
Database Client (PostgreSQL)

Previously this returned Supabase clients; it now returns a local
PostgreSQL-backed client exposing the same query-builder interface
(see database/pg.py), so existing call sites work unchanged.

Both the "regular" and "admin" accessors return the same client —
there is no RLS layer anymore; authorization happens in the API layer.
"""

from .pg import PostgresClient, get_client, is_database_configured


def is_supabase_configured() -> bool:
    """Legacy name — now checks the Postgres connection config."""
    return is_database_configured()


def get_supabase_client() -> PostgresClient:
    return get_client()


def get_supabase_admin_client() -> PostgresClient:
    return get_client()
