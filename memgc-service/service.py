"""FeedMe memgc-service — FastAPI sidecar that wraps memgc-py.

Phase 0: stub with /health only. The 5 endpoints (answer/extract/consolidate/
dreaming + per-restaurant open) land in Phase 3 when we wire MemGC for real.

Run locally:
    uv run uvicorn service:app --host 0.0.0.0 --port 8003 --reload

Run in Docker:
    See ../docker-compose.yml — service name `memgc-service`, port 8003.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DATA_DIR = Path(os.environ.get("MEMGC_DATA_DIR", "/data/tenants"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="FeedMe memgc-service",
    version="0.0.1",
    description="FastAPI wrapper around memgc-py for the FeedMe TS supervisor",
)


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness probe used by docker-compose + Bun app /ready."""
    return {
        "status": "ok",
        "service": "memgc-service",
        "phase": 0,
        "memgc_installed": _check_memgc_import(),
        "data_dir": str(DATA_DIR),
        "data_dir_writable": os.access(DATA_DIR, os.W_OK),
    }


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "memgc-service",
        "version": "0.0.1",
        "phase": 0,
        "endpoints": [
            {"method": "GET", "path": "/health", "status": "implemented"},
            {"method": "POST", "path": "/answer", "status": "stub (Phase 3)"},
            {"method": "POST", "path": "/extract", "status": "stub (Phase 3)"},
            {"method": "POST", "path": "/consolidate", "status": "stub (Phase 3)"},
            {"method": "POST", "path": "/dreaming", "status": "stub (Phase 3)"},
        ],
    }


# ============================================================
# Phase 3 stubs — return 501 until implemented
# ============================================================


class AnswerRequest(BaseModel):
    restaurant_id: str
    question: str


class ExtractRequest(BaseModel):
    restaurant_id: str
    messages: list[dict[str, str]]


class ConsolidateRequest(BaseModel):
    restaurant_id: str
    messages: list[dict[str, str]]


class DreamingRequest(BaseModel):
    restaurant_id: str
    threshold: float = 0.05
    half_life_days: float = 90.0
    dry_run: bool = False


@app.post("/answer", status_code=501)
def answer(_payload: AnswerRequest) -> dict[str, Any]:
    raise HTTPException(status_code=501, detail="Phase 3: not yet implemented")


@app.post("/extract", status_code=501)
def extract(_payload: ExtractRequest) -> dict[str, Any]:
    raise HTTPException(status_code=501, detail="Phase 3: not yet implemented")


@app.post("/consolidate", status_code=501)
def consolidate(_payload: ConsolidateRequest) -> dict[str, Any]:
    raise HTTPException(status_code=501, detail="Phase 3: not yet implemented")


@app.post("/dreaming", status_code=501)
def dreaming(_payload: DreamingRequest) -> dict[str, Any]:
    raise HTTPException(status_code=501, detail="Phase 3: not yet implemented")


# ============================================================
# Helpers
# ============================================================


def _check_memgc_import() -> bool:
    """Smoke test: can we import memgc from the bind-mounted source?"""
    try:
        import memgc  # type: ignore[import-not-found]
        _ = memgc.__version__
        return True
    except Exception:
        return False
