"""Runs the backend on Modal (modal.com): serverless containers for Python.

Deploy (from backend/):   uvx modal deploy modal_app.py
Local test with a temporary URL that reloads on save:   uvx modal serve modal_app.py

Why Modal: free, no credit card, and the container shuts down when nobody is using
it, so the monthly free credit only pays for the minutes someone is actually on
the demo. The first request after a quiet period waits for a cold start (~20 s).

Secrets live in a Modal Secret named "rag-chatbot" (DATABASE_URL, GROQ_API_KEY,
LANGSMITH_API_KEY, JWT_SECRET). Create or update it from a local file with:
    uvx modal secret create rag-chatbot --from-dotenv <file> --force
"""

from pathlib import Path

import modal

BACKEND = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    # Exact package versions from uv.lock, without the dev tools (pytest, ruff...).
    .uv_sync(str(BACKEND), uv_version="0.11.12", extra_options="--no-dev")
    .env({"FASTEMBED_CACHE_PATH": "/models", "PYTHONUNBUFFERED": "1"})
    # Download the embedding model + reranker while building, not on every cold start.
    .add_local_dir(BACKEND / "app", "/root/app", copy=True)
    .run_commands("cd /root && python -c 'from app.embeddings import warm_up; warm_up()'")
    # Set after the warm-up: production mode refuses to start without the secrets,
    # which only exist at run time.
    .env(
        {
            "APP_ENV": "production",
            "CORS_ORIGINS": "https://rag-chatbot-six-psi.vercel.app,http://localhost:3000",
            "LANGSMITH_TRACING": "true",
            "LANGSMITH_ENDPOINT": "https://api.smith.langchain.com",
            "LANGSMITH_AGENT_ID": "rag",
            "LANGSMITH_AGENT_ENVIRONMENT": "production",
        }
    )
)

app = modal.App("rag-chatbot-api", image=image)


@app.function(
    secrets=[modal.Secret.from_name("rag-chatbot")],
    # Billed for the reserved 0.25 CPU while running, can burst to 1 CPU for
    # embedding/reranking. 768 MB is enough: the app peaks at ~450 MB.
    cpu=(0.25, 1.0),
    memory=768,
    scaledown_window=120,  # shut down 2 minutes after the last request
    max_containers=1,  # never more than one running: keeps the free credit safe
    timeout=600,  # a large upload is processed in the background for a few minutes
)
@modal.concurrent(max_inputs=20)  # one container serves many requests at once
@modal.asgi_app()
def api():
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    from app.main import app as fastapi_app

    # Modal's proxy passes the visitor's IP in X-Forwarded-For. Same as uvicorn's
    # --proxy-headers in the Dockerfile: the "guest accounts per IP" limit needs it.
    return ProxyHeadersMiddleware(fastapi_app, trusted_hosts="*")
