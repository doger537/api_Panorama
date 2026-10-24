FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY CONTRACTS/ /build/CONTRACTS/
RUN npm run build

FROM python:3.12-slim-bookworm AS backend-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.lock /app/backend/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /app/backend/requirements.lock

FROM backend-base AS worker-base
RUN apt-get update && apt-get install -y --no-install-recommends hugin-tools enblend && rm -rf /var/lib/apt/lists/*
ENV OMP_NUM_THREADS=2 STITCH_THREADS=2

FROM backend-base AS api
COPY backend/ /app/backend/
COPY CONTRACTS/ /app/CONTRACTS/
COPY scripts/ /app/scripts/
COPY TASKS/ /app/TASKS/
COPY Audit.md Improvements.md specification.md README.md AGENTS.md /app/
COPY docs/ /app/docs/
COPY .github/ /app/.github/
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM worker-base AS worker
COPY --from=api /app/ /app/
CMD ["python", "-m", "backend.worker.main"]

FROM worker AS backend-test
COPY frontend/ /app/frontend/
ENV DATABASE_PATH=/tmp/ttkmap-test.sqlite MEDIA_PATH=/tmp/ttkmap-test-media APP_ORIGIN=http://127.0.0.1:5173 COOKIE_SECURE=false
CMD ["python", "-m", "pytest", "backend/tests", "-q"]
