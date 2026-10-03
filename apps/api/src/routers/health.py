from fastapi import Depends, APIRouter
from sqlmodel.ext.asyncio.session import AsyncSession
from src.services.health.health import check_health
from src.core.events.database import get_db_session


router = APIRouter()

@router.get(
    "",
    summary="Liveness check",
    description=(
        "Process liveness: answers 200 as long as the API process and its "
        "event loop are responsive. Deliberately has NO database dependency — "
        "a cold or suspended Neon must not fail the liveness probe, or "
        "platforms and rollout windows kill/restart a perfectly healthy "
        "container (2026-10-01 crash-loop lesson). Database readiness lives "
        "on GET /health/ready."
    ),
    responses={
        200: {"description": "The service process is alive and responsive."},
    },
)
async def health():
    return {"status": "ok"}

@router.get(
    "/ready",
    summary="Readiness check (database)",
    description=(
        "Verifies the service can actually serve traffic: pings the database "
        "and returns 503 when it cannot. Used by the in-container watchdog "
        "(start-api.sh) to decide a restart — a DB-dead API should be "
        "rebooted, while a DB-cold one is left alone to warm up."
    ),
    responses={
        200: {"description": "Service is ready; database connectivity confirmed."},
        503: {"description": "Database is not reachable — service not ready."},
    },
)
async def readiness(db_session: AsyncSession = Depends(get_db_session)):
    await check_health(db_session)
    return {"status": "ok", "database": True}
