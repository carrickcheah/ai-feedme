"""FeedMe memgc-service — FastAPI sidecar wrapping memgc-py.

Phase 3 Stage A: real implementation. 5 endpoints:
    POST /open         — initialize MemGC instance (idempotent)
    POST /answer       — PRISM agentic retrieval
    POST /extract      — write atomic memories from a transcript
    POST /consolidate  — compress a transcript into dense YAML AgentState
    POST /dreaming     — decay-score + archive cold memories

Single-tenant FeedMe: one MemGC instance at /data/memgc.db, no restaurant_id needed.

Run locally:
    cd memgc-service
    uv sync
    uv run uvicorn service:app --host 0.0.0.0 --port 8003 --reload

Or via docker-compose (uses Dockerfile + bind-mount).
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from threading import Lock
from typing import Any

# Load .env from the parent ai-feedme directory so we get Azure keys.
try:
    from dotenv import load_dotenv

    _env_path = Path(__file__).parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass

# Force HF Hub offline mode — model is cached locally on first download.
# Avoids rate-limit failures on unauthenticated requests to huggingface.co.
# To re-download a model, unset these or run `uv run python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"`.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Heavy import — defer the actual MemGC import until first use so /health works
# even when memgc package isn't installed (eg early dev).
DATA_DIR = Path(os.environ.get("MEMGC_DATA_DIR", "/data" if Path("/data").exists() else "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "memgc.db"

app = FastAPI(
    title="FeedMe memgc-service",
    version="0.1.0",
    description="FastAPI wrapper around memgc-py for the FeedMe TS supervisor",
)

# ── Singleton MemGC instance (single-tenant prototype) ──────────
_mc_lock = Lock()
_mc: Any = None  # MemGC instance; typed Any to avoid eager import


def _get_mc() -> Any:
    """Lazy-init the MemGC instance. Idempotent."""
    global _mc
    with _mc_lock:
        if _mc is None:
            try:
                from memgc import MemGC  # type: ignore[import-not-found]
            except ImportError as e:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "memgc package not installed. "
                        "Run `cd memgc-service && uv sync` then restart this service. "
                        f"Original error: {e}"
                    ),
                ) from e
            print(f"[memgc-service] opening MemGC at {DB_PATH}", file=sys.stderr, flush=True)
            t0 = time.time()
            _mc = MemGC.open(str(DB_PATH))
            print(f"[memgc-service] MemGC opened in {time.time() - t0:.1f}s", file=sys.stderr, flush=True)
        return _mc


# ── /health ─────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness probe. Tries to verify memgc is importable + DB writable."""
    memgc_installed = False
    memgc_version = None
    try:
        import memgc  # type: ignore[import-not-found]

        memgc_installed = True
        memgc_version = getattr(memgc, "__version__", "unknown")
    except ImportError:
        pass
    return {
        "status": "ok",
        "service": "memgc-service",
        "version": "0.1.0",
        "memgc_installed": memgc_installed,
        "memgc_version": memgc_version,
        "data_dir": str(DATA_DIR),
        "data_dir_writable": os.access(DATA_DIR, os.W_OK),
        "db_path": str(DB_PATH),
        "db_exists": DB_PATH.exists(),
        "mc_initialized": _mc is not None,
    }


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "memgc-service",
        "version": "0.1.0",
        "phase": "3 Stage A — real implementation",
        "endpoints": {
            "GET /health": "liveness",
            "POST /open": "init MemGC (idempotent)",
            "POST /answer": "PRISM agentic retrieval",
            "POST /extract": "write atomic memories",
            "POST /consolidate": "YAML AgentState compress",
            "POST /dreaming": "decay-based GC pass",
        },
    }


# ── Request/response models ─────────────────────────────────────


class OpenRequest(BaseModel):
    pass  # single-tenant; no params needed


class AnswerRequest(BaseModel):
    question: str
    k_pool: int = 100
    n_iterations: int = 3
    n_samples: int = 7
    use_reranker: bool = True


class ExtractMessage(BaseModel):
    speaker: str
    text: str


class ExtractRequest(BaseModel):
    messages: list[ExtractMessage]
    session_date: str | None = None


class ConsolidateRequest(BaseModel):
    messages: list[ExtractMessage]


class DreamingRequest(BaseModel):
    threshold: float = 0.05
    half_life_days: float = 90.0
    dry_run: bool = False


# ── Endpoints ───────────────────────────────────────────────────


@app.post("/open")
def open_db(_payload: OpenRequest | None = None) -> dict[str, Any]:
    """Initialize MemGC (idempotent — does nothing if already open)."""
    try:
        _get_mc()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MemGC.open failed: {e}") from e
    return {"db_path": str(DB_PATH), "ready": True}


@app.post("/answer")
def answer(payload: AnswerRequest) -> dict[str, Any]:
    """PRISM agentic retrieval loop. Returns synthesized text + supporting evidence."""
    mc = _get_mc()
    try:
        result = mc.answer(
            payload.question,
            k_pool=payload.k_pool,
            n_iterations=payload.n_iterations,
            n_samples=payload.n_samples,
            use_reranker=payload.use_reranker,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"answer() failed: {e}") from e

    # Memory objects vary by MemGC version; coerce defensively
    memories = []
    for m in getattr(result, "memories", []) or []:
        try:
            memories.append(
                {
                    "id": getattr(m, "id", None),
                    "speaker": getattr(m, "speaker", None),
                    "content": getattr(m, "text", None) or getattr(m, "content", None),
                }
            )
        except Exception:
            pass

    return {
        "text": getattr(result, "text", ""),
        "memories": memories,
        "mode": getattr(result, "mode", "agentic"),
        "elapsed_s": getattr(result, "elapsed_s", None),
        "tokens": getattr(result, "tokens", {}),
    }


@app.post("/extract")
def extract(payload: ExtractRequest) -> dict[str, Any]:
    """Distill atomic facts from a transcript and store them. Dedup'd by SHA-1."""
    mc = _get_mc()
    messages = [{"speaker": m.speaker, "text": m.text} for m in payload.messages]
    try:
        if payload.session_date is not None:
            new_ids = mc.extract(messages, session_date=payload.session_date)
        else:
            new_ids = mc.extract(messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"extract() failed: {e}") from e
    return {"new_ids": new_ids if isinstance(new_ids, list) else [], "count": len(new_ids) if hasattr(new_ids, "__len__") else 0}


@app.post("/consolidate")
def consolidate(payload: ConsolidateRequest) -> dict[str, Any]:
    """Compress a noisy transcript into a dense YAML AgentState snapshot."""
    mc = _get_mc()
    messages = [{"speaker": m.speaker, "text": m.text} for m in payload.messages]
    try:
        yaml_text = mc.consolidate(messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"consolidate() failed: {e}") from e
    return {"yaml": yaml_text}


@app.post("/dreaming")
def dreaming(payload: DreamingRequest) -> dict[str, Any]:
    """Decay-score every memory, archive cold rows. Audit trail preserved."""
    mc = _get_mc()
    try:
        stats = mc.dreaming(
            threshold=payload.threshold,
            half_life_days=payload.half_life_days,
            dry_run=payload.dry_run,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"dreaming() failed: {e}") from e
    return {
        "scanned": getattr(stats, "scanned", 0),
        "archived": getattr(stats, "archived", 0),
        "kept": getattr(stats, "kept", 0),
        "archived_ids": list(getattr(stats, "archived_ids", [])),
        "elapsed_s": getattr(stats, "elapsed_s", None),
    }
