from fastapi import APIRouter, Depends
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.organizations import Organization
from src.core.events.database import get_db_session
from src.core.ee_hooks import is_multi_org_allowed
from src.core.deployment_mode import get_deployment_mode
from src.services.orgs.cache import get_cached_instance_info, set_cached_instance_info
from config.config import get_learnhouse_config

router = APIRouter()


def _strip_port(domain: str) -> str:
    """Strip port from a domain string (e.g. 'localhost:3000' -> 'localhost')."""
    return domain.split(":")[0] if ":" in domain else domain


@router.get(
    "/info",
    summary="Get instance info",
    description=(
        "Public endpoint returning instance configuration (deployment mode, default org slug, "
        "frontend domain, and multi-org flag). Result is cached for performance."
    ),
    responses={
        200: {"description": "Instance configuration for the current deployment."},
    },
)
async def get_instance_info(db_session: AsyncSession = Depends(get_db_session)):
    """Public endpoint returning instance configuration."""
    cached = get_cached_instance_info()
    if cached is not None:
        return cached

    default_org_slug = "default"
    try:
        statement = select(Organization).where(Organization.slug == "default")
        default_org = (await db_session.execute(statement)).scalars().first()
        if not default_org:
            statement = select(Organization).order_by(Organization.id).limit(1)
            default_org = (await db_session.execute(statement)).scalars().first()
        if default_org:
            default_org_slug = default_org.slug
    except Exception:
        pass

    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    top_domain = _strip_port(frontend_domain)
    tenancy = config.hosting_config.tenancy

    # Diagnostics: Redis + HLS queue health (is the transcode pipeline alive?).
    redis_probe = {"configured": False, "ping": False, "queue_len": None, "error": None}
    try:
        from src.core.redis import get_redis_client
        from src.services.utils.hls_jobs import hls_enabled, REDIS_QUEUE_KEY
        client = get_redis_client()
        redis_probe["configured"] = client is not None
        if client is not None:
            redis_probe["ping"] = bool(client.ping())
            redis_probe["queue_len"] = int(client.llen(REDIS_QUEUE_KEY))
    except Exception as e:
        redis_probe["error"] = f"{type(e).__name__}: {str(e)[:120]}"
    hls_diag = {"enabled": None}
    try:
        from src.services.utils.hls_jobs import hls_enabled
        hls_diag["enabled"] = hls_enabled()
    except Exception:
        pass

    result = {
        "mode": get_deployment_mode(),
        "tenancy": tenancy,
        # Deprecated: prefer `tenancy`. Will be removed in a future release.
        "multi_org_enabled": tenancy == "multi" and is_multi_org_allowed(),
        "default_org_slug": default_org_slug,
        "frontend_domain": frontend_domain,
        "top_domain": top_domain,
        # Diagnostics: which content backend the running process resolved
        # (env LEARNHOUSE_CONTENT_DELIVERY_TYPE vs config.yaml default).
        "content_delivery": config.hosting_config.content_delivery.type,
        "content_bucket": config.hosting_config.content_delivery.s3api.bucket_name,
        "redis": redis_probe,
        "hls": hls_diag,
    }

    set_cached_instance_info(result)
    return result
