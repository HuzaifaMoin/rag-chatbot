from functools import lru_cache

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# pydantic-settings only fills the Settings object. LangSmith and Groq read
# os.environ directly, so load the same files into the process env too.
# Real environment variables (e.g. in Docker / CI) still win.
load_dotenv("../.env")
load_dotenv(".env")


class Settings(BaseSettings):
    # Reads ../.env (repo root) first, then backend/.env if present.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://rag:rag@localhost:5432/rag"

    jwt_secret: str = "dev-only-insecure-secret-change-me-in-env"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

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
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
