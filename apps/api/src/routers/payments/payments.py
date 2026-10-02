"""
Payments router — Ordria OSS reimplementation of the EE payments API.

The web UI (apps/web/services/payments/*) was built against this exact
surface; every endpoint below matches the paths and payloads those services
call, so the store, offer pages, checkout flow and dashboard work unchanged.

Auth model:
- Org admins manage configs, groups, offers (require_org_admin).
- Authenticated users check out, read enrollments, open the billing portal.
- public-listing / public offer / by-resource / webhook are public (the
  webhook authenticates via Stripe signature, not cookies).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.payments import (
    OfferCreate,
    OfferUpdate,
    PaymentConfigInit,
    PaymentsGroupCreate,
    PaymentsGroupUpdate,
)
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_org_admin
from src.services.payments import stripe_provider
from src.services.payments.payments import (
    activate_platform_stripe_config,
    add_group_resource,
    add_group_sync,
    add_offer_resource,
    archive_offer,
    build_connect_url,
    cancel_enrollment_subscription,
    create_billing_portal,
    create_checkout,
    create_group,
    delete_group,
    delete_payment_config,
    fulfill_checkout_session,
    get_group_resources,
    get_group_syncs,
    get_groups,
    get_my_enrollments,
    get_offer,
    get_offer_resources,
    get_offers,
    get_offers_by_resource,
    get_org_customers,
    get_payment_configs,
    get_public_offers,
    get_stripe_overview,
    initialize_payment_config,
    remove_group_resource,
    remove_group_sync,
    remove_offer_resource,
    update_group,
    update_offer,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])


def _frontend_origin(request: Request) -> str:
    """Best-effort origin for connect shims and Stripe redirects."""
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    return str(request.base_url).rstrip("/")


# ── Payment provider configuration ───────────────────────────────────────────


@router.get("/{org_id}/config", summary="List payment configs (org admin)")
async def api_get_payment_configs(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_payment_configs(org_id, db_session)


@router.post("/{org_id}/config", summary="Initialize a payment config (org admin)")
async def api_initialize_payment_config(
    config_object: PaymentConfigInit,
    provider: str = Query("stripe"),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await initialize_payment_config(
        org_id, provider, config_object.enabled, db_session
    )


@router.delete("/{org_id}/config", summary="Delete a payment config (org admin)")
async def api_delete_payment_config(
    id: int = Query(...),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await delete_payment_config(org_id, id, db_session)


# ── Stripe connect shims (v1: platform account, instant activation) ─────────


@router.post(
    "/{org_id}/stripe/connect/link",
    summary="Stripe connect URL (org admin)",
)
async def api_stripe_connect_link(
    request: Request,
    redirect_uri: str = Query(""),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    if not stripe_provider.is_stripe_configured():
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured on this deployment (missing STRIPE_SECRET_KEY)",
        )
    origin = _frontend_origin(request)
    return {"connect_url": build_connect_url(org_id, origin)}


@router.get(
    "/stripe/oauth/callback",
    summary="Complete the Stripe connection (called by the web callback page)",
)
async def api_stripe_oauth_callback(
    code: str = Query(...),
    org_id: int = Query(...),
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
    _admin: bool = Depends(require_org_admin),
):
    # v1: every org runs on the platform account — the code is a sentinel.
    return await activate_platform_stripe_config(org_id, db_session)


# ── Payments groups ──────────────────────────────────────────────────────────


@router.get("/{org_id}/groups", summary="List payments groups (org admin)")
async def api_get_groups(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_groups(org_id, db_session)


@router.post("/{org_id}/groups", summary="Create a payments group (org admin)")
async def api_create_group(
    group_object: PaymentsGroupCreate,
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await create_group(org_id, group_object.model_dump(), db_session)


@router.put("/{org_id}/groups/{group_id}", summary="Update a group (org admin)")
async def api_update_group(
    group_object: PaymentsGroupUpdate,
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await update_group(
        org_id, group_id, group_object.model_dump(exclude_none=True), db_session
    )


@router.delete("/{org_id}/groups/{group_id}", summary="Delete a group (org admin)")
async def api_delete_group(
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await delete_group(org_id, group_id, db_session)


@router.get(
    "/{org_id}/groups/{group_id}/resources", summary="Group resources (org admin)"
)
async def api_get_group_resources(
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_group_resources(org_id, group_id, db_session)


@router.post(
    "/{org_id}/groups/{group_id}/resources", summary="Add resource (org admin)"
)
async def api_add_group_resource(
    resource_uuid: str = Query(...),
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await add_group_resource(org_id, group_id, resource_uuid, db_session)


@router.delete(
    "/{org_id}/groups/{group_id}/resources", summary="Remove resource (org admin)"
)
async def api_remove_group_resource(
    resource_uuid: str = Query(...),
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await remove_group_resource(org_id, group_id, resource_uuid, db_session)


@router.get(
    "/{org_id}/groups/{group_id}/sync", summary="Group UserGroup syncs (org admin)"
)
async def api_get_group_syncs(
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_group_syncs(org_id, group_id, db_session)


@router.post(
    "/{org_id}/groups/{group_id}/sync", summary="Sync a UserGroup (org admin)"
)
async def api_add_group_sync(
    usergroup_id: int = Query(...),
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await add_group_sync(org_id, group_id, usergroup_id, db_session)


@router.delete(
    "/{org_id}/groups/{group_id}/sync", summary="Unsync a UserGroup (org admin)"
)
async def api_remove_group_sync(
    usergroup_id: int = Query(...),
    org_id: int = Path(...),
    group_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await remove_group_sync(org_id, group_id, usergroup_id, db_session)


# ── Offers ───────────────────────────────────────────────────────────────────
# NOTE: fixed segments (public-listing, by-resource) are declared BEFORE the
# {offer_ref} routes so FastAPI does not capture them as an offer reference.


@router.get("/{org_id}/offers/public-listing", summary="Store listing (public)")
async def api_get_public_offers(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_public_offers(org_id, db_session)


@router.get("/{org_id}/offers/by-resource", summary="Offers for a resource (public)")
async def api_get_offers_by_resource(
    org_id: int = Path(...),
    resource_uuid: str = Query(...),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_offers_by_resource(org_id, resource_uuid, db_session)


@router.get("/{org_id}/offers", summary="List offers (org admin)")
async def api_get_offers(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_offers(org_id, db_session)


@router.post("/{org_id}/offers", summary="Create an offer (org admin)")
async def api_create_offer(
    offer_object: OfferCreate,
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await create_offer(org_id, offer_object.model_dump(), db_session)


@router.get("/{org_id}/offers/{offer_ref}/public", summary="Public offer page")
async def api_get_public_offer(
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_offer(org_id, offer_ref, db_session, public=True)


@router.get(
    "/{org_id}/offers/{offer_ref}/resources", summary="Offer resources (org admin)"
)
async def api_get_offer_resources(
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_offer_resources(org_id, offer_ref, db_session)


@router.post(
    "/{org_id}/offers/{offer_ref}/resources", summary="Add offer resource (org admin)"
)
async def api_add_offer_resource(
    resource_uuid: str = Query(...),
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await add_offer_resource(org_id, offer_ref, resource_uuid, db_session)


@router.delete(
    "/{org_id}/offers/{offer_ref}/resources",
    summary="Remove offer resource (org admin)",
)
async def api_remove_offer_resource(
    resource_uuid: str = Query(...),
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await remove_offer_resource(org_id, offer_ref, resource_uuid, db_session)


@router.post(
    "/{org_id}/offers/{offer_ref}/checkout",
    summary="Create a Checkout Session for an offer",
)
async def api_create_checkout(
    redirect_uri: str = Query(...),
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    return await create_checkout(
        org_id, offer_ref, current_user, redirect_uri, db_session
    )


@router.get("/{org_id}/offers/{offer_ref}", summary="Offer details (org admin)")
async def api_get_offer(
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_offer(org_id, offer_ref, db_session)


@router.put("/{org_id}/offers/{offer_ref}", summary="Update an offer (org admin)")
async def api_update_offer(
    offer_object: OfferUpdate,
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await update_offer(
        org_id, offer_ref, offer_object.model_dump(exclude_none=True), db_session
    )


@router.delete("/{org_id}/offers/{offer_ref}", summary="Archive an offer (org admin)")
async def api_archive_offer(
    org_id: int = Path(...),
    offer_ref: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await archive_offer(org_id, offer_ref, db_session)


# ── Enrollments & billing portal ─────────────────────────────────────────────


@router.get("/{org_id}/enrollments/mine", summary="My enrollments in this org")
async def api_get_my_enrollments(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    return await get_my_enrollments(org_id, int(current_user.id), db_session)


@router.post("/{org_id}/billing/portal", summary="Open the Stripe billing portal")
async def api_billing_portal(
    return_url: str = Query(...),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    return await create_billing_portal(org_id, current_user, return_url, db_session)


# ── Stripe dashboard data ────────────────────────────────────────────────────


@router.get("/{org_id}/stripe/overview", summary="Payments overview (org admin)")
async def api_stripe_overview(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_stripe_overview(org_id, db_session)


@router.get("/{org_id}/stripe/charges", summary="Recent charges (org admin)")
async def api_stripe_charges(
    limit: int = Query(25),
    starting_after: str | None = Query(None),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    try:
        return stripe_provider.list_charges(limit=limit, starting_after=starting_after)
    except stripe_provider.StripeNotConfiguredError:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    except Exception as exc:
        logger.warning("Stripe charges listing failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not list charges")


@router.get("/{org_id}/stripe/subscriptions", summary="Subscriptions (org admin)")
async def api_stripe_subscriptions(
    status: str = Query("active"),
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    try:
        return stripe_provider.list_subscriptions(status=status)
    except stripe_provider.StripeNotConfiguredError:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    except Exception as exc:
        logger.warning("Stripe subscriptions listing failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not list subscriptions")


@router.get("/{org_id}/customers", summary="Customers of this org (org admin)")
async def api_get_org_customers(
    org_id: int = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
    _admin: bool = Depends(require_org_admin),
):
    return await get_org_customers(org_id, db_session)


# ── Webhook (public — authenticated by Stripe signature) ─────────────────────


@router.post("/stripe/webhook", summary="Stripe webhook receiver")
async def api_stripe_webhook(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe_provider.construct_webhook_event(payload, signature)
    except stripe_provider.StripeNotConfiguredError:
        raise HTTPException(
            status_code=503, detail="Stripe webhook secret not configured"
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type = getattr(event, "type", "")
    data_object = getattr(getattr(event, "data", None), "object", None)

    if event_type in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        payment_status = getattr(data_object, "payment_status", "unpaid")
        if payment_status != "unpaid":
            await fulfill_checkout_session(data_object, db_session)
    elif event_type == "checkout.session.async_payment_failed":
        logger.info(
            "Checkout async payment failed: %s", getattr(data_object, "id", "?")
        )
    elif event_type in (
        "customer.subscription.deleted",
        "customer.subscription.canceled",
    ):
        await cancel_enrollment_subscription(data_object, db_session)

    return {"received": True}
