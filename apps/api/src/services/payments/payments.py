"""
Payments service — Ordria OSS reimplementation.

Business logic for payment configs, payments groups, offers, checkout
orchestration, enrollments and webhook fulfillment. Stripe specifics live in
stripe_provider.py; this module stays provider-agnostic where possible.

Entitlement model (mirrors the EE semantics the web UI was built against):
- Offer → PaymentsGroup (resources sold) → PaymentsGroupSync → UserGroups.
- On successful checkout: buyer enrolled (PaymentsEnrollment active), added
  to the org with the learner role (role_id=4, same as the open-join flow),
  and added to every synced UserGroup — UserGroup membership is what grants
  course access in LearnHouse.
"""

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.payments import (
    ENROLLMENT_ACTIVE,
    ENROLLMENT_CANCELED,
    ENROLLMENT_PENDING,
    PaymentsConfig,
    PaymentsEnrollment,
    PaymentsGroup,
    PaymentsGroupResource,
    PaymentsGroupSync,
    PaymentsOffer,
    PaymentsOfferResource,
)
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.payments import stripe_provider

logger = logging.getLogger(__name__)

# Learner role, same as the open-join flow (apps/api/src/services/orgs/join.py).
LEARNER_ROLE_ID = 4


def _now() -> str:
    return str(datetime.now())


# ── Config ────────────────────────────────────────────────────────────────────


async def get_payment_configs(org_id: int, db_session: AsyncSession) -> list[dict]:
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    configs = (await db_session.execute(statement)).scalars().all()
    return [_config_read(c) for c in configs]


def _config_read(config: PaymentsConfig) -> dict:
    return {
        "id": config.id,
        "org_id": config.org_id,
        "enabled": config.enabled,
        "active": config.active,
        "provider": config.provider,
        "provider_specific_id": config.provider_specific_id,
        "provider_config": config.provider_config or {},
        "mode": config.mode,
        "configured": config.active
        and (
            config.provider != "stripe" or stripe_provider.is_stripe_configured()
        ),
    }


async def initialize_payment_config(
    org_id: int, provider: str, enabled: bool, db_session: AsyncSession
) -> dict:
    if provider != "stripe":
        raise HTTPException(status_code=400, detail="Unsupported payment provider")

    statement = select(PaymentsConfig).where(
        PaymentsConfig.org_id == org_id, PaymentsConfig.provider == provider
    )
    config = (await db_session.execute(statement)).scalars().first()
    if config is None:
        config = PaymentsConfig(
            org_id=org_id,
            provider=provider,
            enabled=enabled,
            active=False,
            creation_date=_now(),
            update_date=_now(),
        )
        db_session.add(config)
    else:
        config.enabled = enabled
        config.update_date = _now()

    await db_session.commit()
    await db_session.refresh(config)
    return _config_read(config)


async def activate_platform_stripe_config(
    org_id: int, db_session: AsyncSession
) -> dict:
    """Mark the org's Stripe config active against the platform account.

    In the EE edition this step exchanges a Stripe Connect OAuth code for a
    connected-account id. Ordria v1 runs every org on the platform's own
    Stripe account, so activation is immediate.
    """
    if not stripe_provider.is_stripe_configured():
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured on this deployment (missing STRIPE_SECRET_KEY)",
        )

    statement = select(PaymentsConfig).where(
        PaymentsConfig.org_id == org_id, PaymentsConfig.provider == "stripe"
    )
    config = (await db_session.execute(statement)).scalars().first()
    if config is None:
        config = PaymentsConfig(
            org_id=org_id,
            provider="stripe",
            enabled=True,
            active=True,
            provider_specific_id=stripe_provider.PLATFORM_ACCOUNT_SENTINEL,
            creation_date=_now(),
            update_date=_now(),
        )
        db_session.add(config)
    else:
        config.active = True
        config.enabled = True
        config.provider_specific_id = stripe_provider.PLATFORM_ACCOUNT_SENTINEL
        config.update_date = _now()

    await db_session.commit()
    await db_session.refresh(config)
    return _config_read(config)


async def delete_payment_config(org_id: int, config_id: int, db_session: AsyncSession):
    statement = select(PaymentsConfig).where(
        PaymentsConfig.org_id == org_id, PaymentsConfig.id == config_id
    )
    config = (await db_session.execute(statement)).scalars().first()
    if not config:
        raise HTTPException(status_code=404, detail="Payment config not found")
    await db_session.delete(config)
    await db_session.commit()
    return {"detail": "Payment config deleted"}


def build_connect_url(org_id: int, frontend_origin: str) -> str:
    """EE parity shim: return the OAuth-ish URL the config UI opens in a popup.

    The UI then calls /payments/stripe/oauth/callback which activates the
    platform config — no real Stripe OAuth round-trip in v1.
    """
    return f"{frontend_origin}/payments/stripe/connect/oauth?code={stripe_provider.PLATFORM_ACCOUNT_SENTINEL}&state=org_id={org_id}"


# ── Groups ────────────────────────────────────────────────────────────────────


async def get_groups(org_id: int, db_session: AsyncSession) -> list[dict]:
    statement = select(PaymentsGroup).where(PaymentsGroup.org_id == org_id)
    groups = (await db_session.execute(statement)).scalars().all()
    return [_group_read(g) for g in groups]


def _group_read(group: PaymentsGroup) -> dict:
    return {
        "id": group.id,
        "org_id": group.org_id,
        "name": group.name,
        "description": group.description,
    }


async def create_group(
    org_id: int, data: dict, db_session: AsyncSession
) -> dict:
    group = PaymentsGroup(
        org_id=org_id,
        name=data.get("name", ""),
        description=data.get("description", ""),
        creation_date=_now(),
        update_date=_now(),
    )
    db_session.add(group)
    await db_session.commit()
    await db_session.refresh(group)
    return _group_read(group)


async def update_group(
    org_id: int, group_id: int, data: dict, db_session: AsyncSession
) -> dict:
    group = await _get_group(org_id, group_id, db_session)
    if "name" in data and data["name"] is not None:
        group.name = data["name"]
    if "description" in data and data["description"] is not None:
        group.description = data["description"]
    group.update_date = _now()
    db_session.add(group)
    await db_session.commit()
    await db_session.refresh(group)
    return _group_read(group)


async def delete_group(org_id: int, group_id: int, db_session: AsyncSession):
    group = await _get_group(org_id, group_id, db_session)
    await db_session.delete(group)
    await db_session.commit()
    return {"detail": "Payments group deleted"}


async def _get_group(
    org_id: int, group_id: int, db_session: AsyncSession
) -> PaymentsGroup:
    statement = select(PaymentsGroup).where(
        PaymentsGroup.org_id == org_id, PaymentsGroup.id == group_id
    )
    group = (await db_session.execute(statement)).scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Payments group not found")
    return group


async def get_group_resources(
    org_id: int, group_id: int, db_session: AsyncSession
) -> list[dict]:
    await _get_group(org_id, group_id, db_session)
    statement = select(PaymentsGroupResource).where(
        PaymentsGroupResource.payments_group_id == group_id
    )
    rows = (await db_session.execute(statement)).scalars().all()
    return [{"resource_uuid": r.resource_uuid} for r in rows]


async def add_group_resource(
    org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession
) -> dict:
    await _get_group(org_id, group_id, db_session)
    existing = await _get_group_resource(group_id, resource_uuid, db_session)
    if not existing:
        db_session.add(
            PaymentsGroupResource(
                payments_group_id=group_id,
                resource_uuid=resource_uuid,
                creation_date=_now(),
            )
        )
        await db_session.commit()
    return {"detail": "Resource added"}


async def remove_group_resource(
    org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession
) -> dict:
    await _get_group(org_id, group_id, db_session)
    existing = await _get_group_resource(group_id, resource_uuid, db_session)
    if existing:
        await db_session.delete(existing)
        await db_session.commit()
    return {"detail": "Resource removed"}


async def _get_group_resource(
    group_id: int, resource_uuid: str, db_session: AsyncSession
) -> Optional[PaymentsGroupResource]:
    statement = select(PaymentsGroupResource).where(
        PaymentsGroupResource.payments_group_id == group_id,
        PaymentsGroupResource.resource_uuid == resource_uuid,
    )
    return (await db_session.execute(statement)).scalars().first()


async def get_group_syncs(
    org_id: int, group_id: int, db_session: AsyncSession
) -> list[dict]:
    await _get_group(org_id, group_id, db_session)
    statement = select(PaymentsGroupSync).where(
        PaymentsGroupSync.payments_group_id == group_id
    )
    rows = (await db_session.execute(statement)).scalars().all()
    return [{"usergroup_id": r.usergroup_id} for r in rows]


async def add_group_sync(
    org_id: int, group_id: int, usergroup_id: int, db_session: AsyncSession
) -> dict:
    group = await _get_group(org_id, group_id, db_session)

    ug_statement = select(UserGroup).where(
        UserGroup.id == usergroup_id, UserGroup.org_id == org_id
    )
    usergroup = (await db_session.execute(ug_statement)).scalars().first()
    if not usergroup:
        raise HTTPException(status_code=404, detail="UserGroup not found in this org")

    statement = select(PaymentsGroupSync).where(
        PaymentsGroupSync.payments_group_id == group.id,
        PaymentsGroupSync.usergroup_id == usergroup_id,
    )
    existing = (await db_session.execute(statement)).scalars().first()
    if not existing:
        db_session.add(
            PaymentsGroupSync(
                payments_group_id=group.id,
                usergroup_id=usergroup_id,
                creation_date=_now(),
            )
        )
        await db_session.commit()
    return {"detail": "UserGroup synced"}


async def remove_group_sync(
    org_id: int, group_id: int, usergroup_id: int, db_session: AsyncSession
) -> dict:
    await _get_group(org_id, group_id, db_session)
    statement = select(PaymentsGroupSync).where(
        PaymentsGroupSync.payments_group_id == group_id,
        PaymentsGroupSync.usergroup_id == usergroup_id,
    )
    existing = (await db_session.execute(statement)).scalars().first()
    if existing:
        await db_session.delete(existing)
        await db_session.commit()
    return {"detail": "UserGroup sync removed"}


# ── Offers ────────────────────────────────────────────────────────────────────


async def _resolve_resource(resource_uuid: str, db_session: AsyncSession) -> dict:
    """Resolve a resource uuid to the display shape the store cards render."""
    resource_type = "course"
    base_uuid = resource_uuid
    for prefix in ("course_", "podcast_", "playground_"):
        if resource_uuid.startswith(prefix):
            resource_type = prefix.rstrip("_")
            base_uuid = resource_uuid[len(prefix):]
            break

    name = resource_uuid
    description: Optional[str] = None
    thumbnail_image: Optional[str] = None
    org_uuid: Optional[str] = None

    if resource_type == "course":
        statement = select(Course).where(Course.course_uuid == resource_uuid)
        course = (await db_session.execute(statement)).scalars().first()
        if course:
            name = course.name
            description = course.description
            thumbnail_image = course.thumbnail_image
            org_statement = select(Organization).where(Organization.id == course.org_id)
            org = (await db_session.execute(org_statement)).scalars().first()
            org_uuid = org.org_uuid if org else None

    return {
        "resource_uuid": resource_uuid,
        "resource_type": resource_type,
        "name": name,
        "description": description or "",
        "thumbnail_image": thumbnail_image or "",
        "org_uuid": org_uuid or "",
    }


async def _offer_read(
    offer: PaymentsOffer, db_session: AsyncSession, with_resources: bool = True
) -> dict:
    payload = {
        "id": offer.id,
        "offer_uuid": offer.offer_uuid,
        "org_id": offer.org_id,
        "payments_config_id": offer.payments_config_id,
        "payments_group_id": offer.payments_group_id,
        "name": offer.name,
        "description": offer.description,
        "offer_type": offer.offer_type,
        "price_type": offer.price_type,
        "benefits": offer.benefits,
        "amount": offer.amount,
        "currency": offer.currency,
        "archived": offer.archived,
    }
    if with_resources:
        statement = select(PaymentsOfferResource).where(
            PaymentsOfferResource.offer_id == offer.id
        )
        rows = (await db_session.execute(statement)).scalars().all()
        payload["included_resources"] = [
            await _resolve_resource(r.resource_uuid, db_session) for r in rows
        ]
    return payload


async def get_offers(
    org_id: int, db_session: AsyncSession, include_archived: bool = True
) -> list[dict]:
    statement = select(PaymentsOffer).where(PaymentsOffer.org_id == org_id)
    offers = (await db_session.execute(statement)).scalars().all()
    result = []
    for offer in offers:
        if not include_archived and offer.archived:
            continue
        result.append(await _offer_read(offer, db_session))
    return result


async def get_public_offers(org_id: int, db_session: AsyncSession) -> list[dict]:
    """Store listing: active offers of orgs whose Stripe config is live."""
    return [
        offer
        for offer in await get_offers(org_id, db_session, include_archived=False)
        if offer["amount"] is not None and offer["amount"] > 0
    ]


async def _get_offer_by_ref(
    org_id: int, offer_ref: str, db_session: AsyncSession, include_archived: bool = True
) -> PaymentsOffer:
    """Resolve an offer by numeric id or offer_uuid."""
    statement = select(PaymentsOffer).where(PaymentsOffer.org_id == org_id)
    offers = (await db_session.execute(statement)).scalars().all()
    for offer in offers:
        if str(offer.id) == offer_ref or offer.offer_uuid == offer_ref:
            if offer.archived and not include_archived:
                raise HTTPException(status_code=404, detail="Offer not found")
            return offer
    raise HTTPException(status_code=404, detail="Offer not found")


async def get_offer(
    org_id: int, offer_ref: str, db_session: AsyncSession, public: bool = False
) -> dict:
    offer = await _get_offer_by_ref(
        org_id, offer_ref, db_session, include_archived=not public
    )
    if public and offer.archived:
        raise HTTPException(status_code=404, detail="Offer not found")
    return await _offer_read(offer, db_session)


async def create_offer(org_id: int, data: dict, db_session: AsyncSession) -> dict:
    if float(data.get("amount") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    offer = PaymentsOffer(
        org_id=org_id,
        name=data["name"],
        description=data.get("description", ""),
        offer_type=data.get("offer_type", "one_time"),
        price_type=data.get("price_type", "fixed_price"),
        benefits=data.get("benefits", ""),
        amount=float(data["amount"]),
        currency=data.get("currency", "eur"),
        payments_config_id=data.get("payments_config_id"),
        payments_group_id=data.get("payments_group_id"),
        creation_date=_now(),
        update_date=_now(),
    )
    db_session.add(offer)
    await db_session.flush()

    for resource_uuid in data.get("resource_uuids") or []:
        db_session.add(
            PaymentsOfferResource(
                offer_id=offer.id,
                resource_uuid=resource_uuid,
                creation_date=_now(),
            )
        )

    await db_session.commit()
    await db_session.refresh(offer)
    return await _offer_read(offer, db_session)


async def update_offer(
    org_id: int, offer_ref: str, data: dict, db_session: AsyncSession
) -> dict:
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)

    for field in (
        "name",
        "description",
        "offer_type",
        "price_type",
        "benefits",
        "currency",
        "payments_config_id",
        "payments_group_id",
    ):
        if field in data and data[field] is not None:
            setattr(offer, field, data[field])
    if "amount" in data and data["amount"] is not None:
        if float(data["amount"]) <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")
        offer.amount = float(data["amount"])
    if "archived" in data and data["archived"] is not None:
        offer.archived = bool(data["archived"])
    offer.update_date = _now()

    if "resource_uuids" in data and data["resource_uuids"] is not None:
        statement = select(PaymentsOfferResource).where(
            PaymentsOfferResource.offer_id == offer.id
        )
        for row in (await db_session.execute(statement)).scalars().all():
            await db_session.delete(row)
        await db_session.flush()
        for resource_uuid in data["resource_uuids"]:
            db_session.add(
                PaymentsOfferResource(
                    offer_id=offer.id,
                    resource_uuid=resource_uuid,
                    creation_date=_now(),
                )
            )

    db_session.add(offer)
    await db_session.commit()
    await db_session.refresh(offer)
    return await _offer_read(offer, db_session)


async def archive_offer(org_id: int, offer_ref: str, db_session: AsyncSession) -> dict:
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)
    offer.archived = True
    offer.update_date = _now()
    db_session.add(offer)
    await db_session.commit()
    return {"detail": "Offer archived"}


async def get_offer_resources(
    org_id: int, offer_ref: str, db_session: AsyncSession
) -> list[dict]:
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)
    statement = select(PaymentsOfferResource).where(
        PaymentsOfferResource.offer_id == offer.id
    )
    rows = (await db_session.execute(statement)).scalars().all()
    return [await _resolve_resource(r.resource_uuid, db_session) for r in rows]


async def add_offer_resource(
    org_id: int, offer_ref: str, resource_uuid: str, db_session: AsyncSession
) -> dict:
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)
    statement = select(PaymentsOfferResource).where(
        PaymentsOfferResource.offer_id == offer.id,
        PaymentsOfferResource.resource_uuid == resource_uuid,
    )
    if not (await db_session.execute(statement)).scalars().first():
        db_session.add(
            PaymentsOfferResource(
                offer_id=offer.id,
                resource_uuid=resource_uuid,
                creation_date=_now(),
            )
        )
        await db_session.commit()
    return {"detail": "Resource added"}


async def remove_offer_resource(
    org_id: int, offer_ref: str, resource_uuid: str, db_session: AsyncSession
) -> dict:
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)
    statement = select(PaymentsOfferResource).where(
        PaymentsOfferResource.offer_id == offer.id,
        PaymentsOfferResource.resource_uuid == resource_uuid,
    )
    row = (await db_session.execute(statement)).scalars().first()
    if row:
        await db_session.delete(row)
        await db_session.commit()
    return {"detail": "Resource removed"}


async def get_offers_by_resource(
    org_id: int, resource_uuid: str, db_session: AsyncSession
) -> list[dict]:
    """Offers that include this resource (buy button on course pages)."""
    offers = await get_offers(org_id, db_session, include_archived=False)
    matching = []
    for offer in offers:
        if any(
            r["resource_uuid"] == resource_uuid
            for r in offer.get("included_resources", [])
        ):
            matching.append(offer)
    return matching


# ── Checkout & enrollments ───────────────────────────────────────────────────


async def _require_active_stripe_config(
    org_id: int, db_session: AsyncSession
) -> PaymentsConfig:
    statement = select(PaymentsConfig).where(
        PaymentsConfig.org_id == org_id,
        PaymentsConfig.provider == "stripe",
        PaymentsConfig.active == True,  # noqa: E712
    )
    config = (await db_session.execute(statement)).scalars().first()
    if not config:
        raise HTTPException(
            status_code=400,
            detail="Payments are not configured for this organization",
        )
    return config


async def create_checkout(
    org_id: int,
    offer_ref: str,
    user: Any,
    redirect_uri: str,
    db_session: AsyncSession,
) -> dict:
    await _require_active_stripe_config(org_id, db_session)
    offer = await _get_offer_by_ref(org_id, offer_ref, db_session)

    # Pending enrollment — fulfilled by the signed webhook.
    existing = await _get_enrollment_by_session_ref(org_id, offer.id, user.id, db_session)
    if not existing:
        db_session.add(
            PaymentsEnrollment(
                org_id=org_id,
                offer_id=offer.id,
                user_id=int(user.id),
                status=ENROLLMENT_PENDING,
                amount=offer.amount,
                currency=offer.currency,
                creation_date=_now(),
                update_date=_now(),
            )
        )
        await db_session.commit()

    try:
        checkout_url = stripe_provider.create_checkout_session(
            offer=offer, org_id=org_id, user=user, redirect_uri=redirect_uri
        )
    except stripe_provider.StripeNotConfiguredError:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # Stripe API error
        logger.warning("Stripe checkout session creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not create checkout session")

    return {"checkout_url": checkout_url}


async def _get_enrollment_by_session_ref(
    org_id: int, offer_id: int, user_id: int, db_session: AsyncSession
) -> Optional[PaymentsEnrollment]:
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org_id,
        PaymentsEnrollment.offer_id == offer_id,
        PaymentsEnrollment.user_id == user_id,
    )
    return (await db_session.execute(statement)).scalars().first()


async def get_my_enrollments(
    org_id: int, user_id: int, db_session: AsyncSession
) -> list[dict]:
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org_id,
        PaymentsEnrollment.user_id == user_id,
    )
    enrollments = (await db_session.execute(statement)).scalars().all()
    return [
        {
            "id": e.id,
            "org_id": e.org_id,
            "offer_id": e.offer_id,
            "user_id": e.user_id,
            "status": e.status,
            "stripe_customer_id": e.stripe_customer_id,
            "stripe_subscription_id": e.stripe_subscription_id,
            "amount": e.amount,
            "currency": e.currency,
            "creation_date": e.creation_date,
        }
        for e in enrollments
    ]


async def create_billing_portal(
    org_id: int, user: Any, return_url: str, db_session: AsyncSession
) -> dict:
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org_id,
        PaymentsEnrollment.user_id == int(user.id),
        PaymentsEnrollment.stripe_customer_id != None,  # noqa: E712
    )
    enrollment = (await db_session.execute(statement)).scalars().first()
    if not enrollment or not enrollment.stripe_customer_id:
        raise HTTPException(
            status_code=404, detail="No Stripe customer found for this user"
        )
    try:
        url = stripe_provider.create_billing_portal_session(
            stripe_customer_id=enrollment.stripe_customer_id, return_url=return_url
        )
    except Exception as exc:
        logger.warning("Stripe billing portal session failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not open billing portal")
    return {"portal_url": url}


# ── Webhook fulfillment ───────────────────────────────────────────────────────


async def fulfill_checkout_session(session: Any, db_session: AsyncSession) -> None:
    """Grant entitlements for a completed Checkout Session.

    Called for checkout.session.completed and
    checkout.session.async_payment_succeeded when payment_status != unpaid.
    Idempotent: replaying an event re-uses the same enrollment row.
    """
    metadata = getattr(session, "metadata", None) or {}
    try:
        org_id = int(metadata.get("org_id", 0))
        offer_id = int(metadata.get("offer_id", 0))
        user_id = int(metadata.get("user_id", 0))
    except (TypeError, ValueError):
        logger.warning("Webhook session without usable metadata, skipping")
        return
    if not (org_id and offer_id and user_id):
        logger.warning("Webhook session metadata incomplete, skipping")
        return

    statement = select(PaymentsOffer).where(
        PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id
    )
    offer = (await db_session.execute(statement)).scalars().first()
    if not offer:
        logger.warning("Webhook for unknown offer %s in org %s", offer_id, org_id)
        return

    enrollment = await _get_enrollment_by_session_ref(org_id, offer_id, user_id, db_session)
    if enrollment is None:
        enrollment = PaymentsEnrollment(
            org_id=org_id,
            offer_id=offer_id,
            user_id=user_id,
            creation_date=_now(),
            update_date=_now(),
        )
        db_session.add(enrollment)

    enrollment.status = ENROLLMENT_ACTIVE
    enrollment.stripe_session_id = getattr(session, "id", None)
    customer = getattr(session, "customer", None)
    enrollment.stripe_customer_id = (
        customer if isinstance(customer, str) else getattr(customer, "id", None)
    )
    subscription = getattr(session, "subscription", None)
    enrollment.stripe_subscription_id = (
        subscription if isinstance(subscription, str) else getattr(subscription, "id", None)
    )
    enrollment.amount = offer.amount
    enrollment.currency = offer.currency
    enrollment.update_date = _now()
    db_session.add(enrollment)

    # Org membership with the learner role — same as the open-join flow.
    await _ensure_org_membership(org_id, user_id, db_session)

    # UserGroup memberships — what actually grants course access.
    if offer.payments_group_id:
        statement = select(PaymentsGroupSync).where(
            PaymentsGroupSync.payments_group_id == offer.payments_group_id
        )
        syncs = (await db_session.execute(statement)).scalars().all()
        for sync in syncs:
            await _ensure_usergroup_membership(
                sync.usergroup_id, user_id, org_id, db_session
            )

    await db_session.commit()
    logger.info(
        "Fulfilled checkout session %s: user %s enrolled in offer %s (org %s)",
        getattr(session, "id", "?"),
        user_id,
        offer_id,
        org_id,
    )


async def cancel_enrollment_subscription(subscription: Any, db_session: AsyncSession):
    """Mark enrollments canceled when their subscription ends."""
    subscription_id = getattr(subscription, "id", None)
    if not subscription_id:
        return
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.stripe_subscription_id == subscription_id
    )
    enrollments = (await db_session.execute(statement)).scalars().all()
    for enrollment in enrollments:
        enrollment.status = ENROLLMENT_CANCELED
        enrollment.update_date = _now()
        db_session.add(enrollment)
    await db_session.commit()


async def _ensure_org_membership(
    org_id: int, user_id: int, db_session: AsyncSession
) -> None:
    statement = select(UserOrganization).where(
        UserOrganization.org_id == org_id, UserOrganization.user_id == user_id
    )
    if (await db_session.execute(statement)).scalars().first():
        return
    db_session.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=LEARNER_ROLE_ID,
            creation_date=_now(),
            update_date=_now(),
        )
    )


async def _ensure_usergroup_membership(
    usergroup_id: int, user_id: int, org_id: int, db_session: AsyncSession
) -> None:
    statement = select(UserGroupUser).where(
        UserGroupUser.usergroup_id == usergroup_id,
        UserGroupUser.user_id == user_id,
    )
    if (await db_session.execute(statement)).scalars().first():
        return
    db_session.add(
        UserGroupUser(
            usergroup_id=usergroup_id,
            user_id=user_id,
            org_id=org_id,
            creation_date=_now(),
            update_date=_now(),
        )
    )


# ── Dashboard aggregates ──────────────────────────────────────────────────────


async def get_org_customers(org_id: int, db_session: AsyncSession) -> list[dict]:
    """Distinct buyers (from active enrollments) with per-user aggregates."""
    from src.db.users import User

    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org_id,
        PaymentsEnrollment.status == ENROLLMENT_ACTIVE,
    )
    result = await db_session.scalars(statement)
    enrollments = result.all()

    by_user: dict[int, dict] = {}
    for enrollment in enrollments:
        user_id = int(enrollment.user_id)
        entry = by_user.get(user_id)
        if entry is None:
            user = await db_session.get(User, user_id)
            entry = {
                "id": f"user_{user_id}",
                "name": (
                    f"{getattr(user, 'first_name', '') or ''} "
                    f"{getattr(user, 'last_name', '') or ''}"
                ).strip()
                or (getattr(user, "username", None) or f"user_{user_id}"),
                "email": getattr(user, "email", None),
                "enrollments": 0,
                "total_spent": 0,
            }
            by_user[user_id] = entry
        entry["enrollments"] += 1
        entry["total_spent"] += int(round((enrollment.amount or 0) * 100))
    return list(by_user.values())


async def get_stripe_overview(org_id: int, db_session: AsyncSession) -> dict:
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org_id,
        PaymentsEnrollment.status == ENROLLMENT_ACTIVE,
    )
    enrollments = (await db_session.execute(statement)).scalars().all()
    customers = {e.stripe_customer_id for e in enrollments if e.stripe_customer_id}
    active_subscribers = sum(1 for e in enrollments if e.stripe_subscription_id)
    # Major units → cents for the dashboard formatter.
    total_revenue = int(round(sum(e.amount or 0 for e in enrollments) * 100))
    return {
        "total_revenue": total_revenue,
        "total_customers": len(customers),
        "active_subscribers": active_subscribers,
        "total_enrollments": len(enrollments),
    }
