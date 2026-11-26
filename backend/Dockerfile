# The backend as one container image: Python + packages + the embedding models.
#
#   docker build -t rag-backend backend
#   docker run -p 8000:8000 --env-file .env rag-backend
#
# Two stages: the first installs everything (needs build tools and uv), the second
# copies only the result, so the final image stays smaller.

# ---------- Stage 1: build ----------
FROM python:3.12-slim AS build

# uv, pinned to the version used locally (copied from its official image).
COPY --from=ghcr.io/astral-sh/uv:0.11.12 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Dependencies first: this layer is reused until pyproject.toml / uv.lock change,
# so editing app code doesn't reinstall every package.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# Download the embedding model + reranker now (~150 MB), not on the first request.
ENV FASTEMBED_CACHE_PATH=/app/models
COPY app/config.py app/embeddings.py app/__init__.py ./app/
RUN .venv/bin/python -c "from app.embeddings import warm_up; warm_up()"

# ---------- Stage 2: run ----------
FROM python:3.12-slim

# Run as a normal user, not root (also what Hugging Face Spaces expects: uid 1000).
RUN useradd --create-home --uid 1000 app
WORKDIR /app

COPY --from=build --chown=app:app /app/.venv /app/.venv
COPY --from=build --chown=app:app /app/models /app/models
COPY --chown=app:app app ./app

USER app
ENV PATH="/app/.venv/bin:$PATH" \
    FASTEMBED_CACHE_PATH=/app/models \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    PORT=8000 \
    FORWARDED_ALLOW_IPS="*"

EXPOSE 8000

# --proxy-headers: behind the host's proxy, read the visitor's real IP from
# X-Forwarded-For (the demo's "accounts per IP" limit needs it).
# FORWARDED_ALLOW_IPS=* trusts that header from any proxy, which is fine because the
# host's proxy is the only way in. PORT can be changed by the host (HF Spaces uses 7860).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
