from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# pydantic-settings only fills the Settings object. LangSmith and Groq read
# os.environ directly, so load the same files into the process env too.
# Real environment variables (e.g. in Docker / CI) still win.
load_dotenv("../.env")
load_dotenv(".env")

DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-in-env"


def to_asyncpg_url(url: str) -> str:
    """Accept the connection string hosts like Neon give you
    (postgresql://user:pw@host/db?sslmode=require&channel_binding=require)
    and turn it into what SQLAlchemy + asyncpg expect
    (postgresql+asyncpg://user:pw@host/db?ssl=require)."""
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    query = []
    for key, value in parse_qsl(parts.query):
        if key == "sslmode":  # libpq's name; asyncpg calls it "ssl"
            query.append(("ssl", value))
        elif key != "channel_binding":  # libpq-only option asyncpg doesn't understand
            query.append((key, value))
    return urlunsplit(parts._replace(scheme=scheme, query=urlencode(query)))


class Settings(BaseSettings):
    # Reads ../.env (repo root) first, then backend/.env if present.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # "production" turns on the safety checks below. Set APP_ENV=production when deploying.
    app_env: Literal["local", "production"] = "local"

    database_url: str = "postgresql+asyncpg://rag:rag@localhost:5432/rag"

    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Which websites may call the API from a browser. In .env / the host's settings,
    # a comma-separated list: CORS_ORIGINS=https://my-app.vercel.app,http://localhost:3000
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # Local, free models (run on CPU via fastembed / ONNX).
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    reranker_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    chunk_size: int = 1000
    chunk_overlap: int = 150

    retrieval_candidates: int = 20  # per retriever, before fusion + rerank
    retrieval_top_k: int = 5

    # LLMs (Groq free tier). Small/fast model for the plumbing steps,
    # larger model for the final answer and tool use.
    groq_api_key: str = ""
    # Each Groq model has its own free quota (~8k tokens/min), so splitting the
    # work across two models roughly doubles throughput.
    fast_model: str = "openai/gpt-oss-20b"
    answer_model: str = "openai/gpt-oss-120b"
    guard_model: str = "meta-llama/llama-prompt-guard-2-86m"
    injection_threshold: float = 0.8  # prompt-guard probability above which we refuse
    max_tool_steps: int = 4
    max_answer_attempts: int = 2  # regenerate once if the grounding check fails
    web_search_results: int = 5

    max_upload_mb: int = 20

    # "Try the demo": throwaway guest accounts with the Northwind handbook preloaded.
    guest_ttl_hours: int = 24  # guests (and everything they made) are deleted after this
    guest_daily_questions: int = 15  # answered questions per guest per 24 hours
    guest_max_documents: int = 4  # the handbook + 3 uploads of their own
    guest_max_upload_mb: int = 2
    guests_per_ip_per_hour: int = 10  # stops one visitor creating thousands of accounts

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, value: str) -> str:
        return to_asyncpg_url(value)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            # "a, b/" -> ["a", "b"]  (browsers send the origin without a trailing slash)
            return [o.strip().rstrip("/") for o in value.split(",") if o.strip()]
        return value

    @model_validator(mode="after")
    def _production_checks(self) -> "Settings":
        """Refuse to start a production server with settings that are only safe locally."""
        if self.app_env == "production":
            # Anyone who knows the secret can make a login token for any user.
            if self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError(
                    "APP_ENV=production needs a real JWT_SECRET (32+ characters). Make one with: "
                    'python -c "import secrets; print(secrets.token_urlsafe(32))"'
                )
            if not self.groq_api_key:
                raise ValueError("APP_ENV=production needs GROQ_API_KEY")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
