FROM python:3.11-slim

WORKDIR /app

# memgc-py is bind-mounted at runtime via docker-compose; we install ITS
# dependencies here so `import memgc` finds everything it needs.
# Pinned to match memgc-py/pyproject.toml. Add libs here if memgc adds deps.
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.32" \
    "pydantic>=2.9" \
    "httpx>=0.27" \
    "sqlite-vec>=0.1.6" \
    "numpy>=2.0" \
    "rank-bm25>=0.2.2" \
    "python-dotenv>=1.0" \
    "tiktoken>=0.7" \
    "pyyaml>=6.0" \
    "openai>=1.50" \
    "cerebras-cloud-sdk>=1.67.0" \
    "sentence-transformers>=3.0" \
    "ollama>=0.3"

ENV PYTHONPATH=/memgc-py/src
ENV HF_HUB_OFFLINE=0
ENV TRANSFORMERS_OFFLINE=0

COPY service.py ./

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8003/health').read()" || exit 1

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8003"]
