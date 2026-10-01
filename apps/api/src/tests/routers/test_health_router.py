"""
Router tests for src/routers/health.py

Covers: GET /api/v1/health (liveness, no DB) and GET /api/v1/health/ready
(readiness, DB-dependent).
"""

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.routers.health import router


@pytest.fixture
def app(db):
    """Minimal FastAPI app with the health router."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/health")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestHealthRouter:
    """Router-level tests for the health endpoints."""

    async def test_health_liveness_no_db(self):
        # Liveness must have NO database dependency — a bare app without any
        # DB wiring (and no db fixture) must still answer 200. If someone
        # re-adds a DB dependency to the liveness route, this fails loudly.
        bare = FastAPI()
        bare.include_router(router, prefix="/api/v1/health")
        async with AsyncClient(
            transport=ASGITransport(app=bare), base_url="http://test"
        ) as c:
            response = await c.get("/api/v1/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    async def test_ready_returns_ok_with_db(self, client):
        response = await client.get("/api/v1/health/ready")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "database": True}
