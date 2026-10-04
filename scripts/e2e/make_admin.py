"""One-shot : crée l'admin superadmin de la stack E2E (org 'default' existante).

Usage : docker exec -i learnhouse-app-prod sh -c 'cd /app/api && uv run python -' < scripts/e2e/make_admin.py
"""
import asyncio
import os

from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import UserCreate
from src.services.setup.setup import install_create_organization_user


async def main() -> None:
    url = os.environ["LEARNHOUSE_SQL_CONNECTION_STRING"]
    if "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(url)
    async with AsyncSession(engine, expire_on_commit=False) as s:
        await install_create_organization_user(
            UserCreate(
                username="admin",
                email=os.environ.get("E2E_ADMIN_EMAIL", "admin@learnhouse.local"),
                password=os.environ.get("E2E_ADMIN_PASSWORD", "Admin2026"),
            ),
            "default",
            s,
            is_superadmin=True,
        )
        print("ADMIN CREATED")
    await engine.dispose()


asyncio.run(main())
