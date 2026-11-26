"""Production settings: database URL conversion, CORS list, and the startup safety checks."""

import pytest
from pydantic import ValidationError

from app.config import DEV_JWT_SECRET, Settings, to_asyncpg_url

GOOD_SECRET = "x" * 40


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """config.py copies .env into the environment; hide those values from these tests."""
    for name in ("APP_ENV", "JWT_SECRET", "GROQ_API_KEY", "CORS_ORIGINS", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)


def make(**values) -> Settings:
    # _env_file=None: ignore the real .env, so only these values (and defaults) count.
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        # Neon's copy-paste string
        (
            "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb"
            "?sslmode=require&channel_binding=require",
            "postgresql+asyncpg://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?ssl=require",
        ),
        ("postgres://u:p@host:5432/db", "postgresql+asyncpg://u:p@host:5432/db"),
        # already in our format: unchanged
        (
            "postgresql+asyncpg://rag:rag@localhost:5432/rag",
            "postgresql+asyncpg://rag:rag@localhost:5432/rag",
        ),
    ],
)
def test_database_url_is_converted_for_asyncpg(given, expected):
    assert to_asyncpg_url(given) == expected
    assert make(database_url=given).database_url == expected


def test_cors_origins_from_a_comma_separated_string(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://rag.vercel.app/, http://localhost:3000")
    assert make().cors_origins == ["https://rag.vercel.app", "http://localhost:3000"]


def test_local_mode_allows_the_dev_secret():
    assert make(app_env="local").jwt_secret == DEV_JWT_SECRET


@pytest.mark.parametrize("secret", [DEV_JWT_SECRET, "too-short"])
def test_production_refuses_a_weak_jwt_secret(secret):
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        make(app_env="production", jwt_secret=secret, groq_api_key="gsk_test")


def test_production_needs_a_groq_key():
    with pytest.raises(ValidationError, match="GROQ_API_KEY"):
        make(app_env="production", jwt_secret=GOOD_SECRET, groq_api_key="")


def test_production_starts_with_good_settings():
    s = make(app_env="production", jwt_secret=GOOD_SECRET, groq_api_key="gsk_test")
    assert s.app_env == "production"
