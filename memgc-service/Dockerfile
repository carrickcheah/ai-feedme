FROM python:3.11-slim

WORKDIR /app

# Install runtime deps (memgc-py source is bind-mounted via docker-compose volume)
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.32" \
    "pydantic>=2.9"

# PYTHONPATH set in docker-compose so `import memgc` resolves to the bind-mount
ENV PYTHONPATH=/memgc-py/src

COPY service.py ./

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=10s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8003/health').read()" || exit 1

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8003"]
