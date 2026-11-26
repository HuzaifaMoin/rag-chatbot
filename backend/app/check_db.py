"""Prepare and check a database before deploying.

    uv run python -m app.check_db                             # the DATABASE_URL in .env
    uv run python -m app.check_db --env-file ../.env.production   # e.g. your Neon database

It connects, turns on pgvector, creates any missing tables (safe to run again: existing
tables and data are left alone), then prints a short report. The password is never printed.
"""

import argparse
import asyncio
import sys
import time
from urllib.parse import urlsplit

from dotenv import load_dotenv


def masked(url: str) -> str:
    """postgresql+asyncpg://user:secret@host/db?ssl=require -> postgresql+asyncpg://user:***@host/db"""
    parts = urlsplit(url)
    host = parts.hostname or "?"
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{parts.username}:***@{host}{port}{parts.path}"


async def check() -> int:
    # Imported here, after the env file is loaded: app.db connects using DATABASE_URL on import.
    from sqlalchemy import text

    from app.config import get_settings
    from app.db import engine, init_db

    print(f"Database:  {masked(get_settings().database_url)}")
    try:
        started = time.perf_counter()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        print(f"Connected in {(time.perf_counter() - started) * 1000:.0f} ms")

        await init_db()  # CREATE EXTENSION vector + create missing tables

        async with engine.connect() as conn:
            version = await conn.scalar(text("SHOW server_version"))
            vector = await conn.scalar(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            )
            # Ask our side of the connection, not the server: behind a proxy like Neon's
            # the database itself only sees the (unencrypted) hop from the proxy.
            raw = await conn.get_raw_connection()
            transport = getattr(raw.driver_connection, "_transport", None)
            ssl = transport is not None and transport.get_extra_info("ssl_object") is not None
            tables = (
                await conn.scalars(
                    text(
                        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                        "ORDER BY tablename"
                    )
                )
            ).all()
            started = time.perf_counter()
            await conn.execute(text("SELECT 1"))
            ping = (time.perf_counter() - started) * 1000
    except Exception as e:  # show a readable message instead of a long traceback
        print(f"FAILED: {type(e).__name__}: {e}")
        return 1
    finally:
        await engine.dispose()

    print(f"Postgres:  {version}")
    print(f"pgvector:  {vector}")
    print(f"Encrypted: {'yes (SSL)' if ssl else 'no'}")
    print(f"Tables:    {', '.join(tables)}")
    print(f"Round trip: {ping:.0f} ms per query")
    print("OK: the database is ready.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env-file", help="read DATABASE_URL from this file instead of .env")
    args = parser.parse_args()
    if args.env_file:
        if not load_dotenv(args.env_file, override=True):
            sys.exit(f"Couldn't read {args.env_file} (or it's empty).")
    sys.exit(asyncio.run(check()))


if __name__ == "__main__":
    main()
