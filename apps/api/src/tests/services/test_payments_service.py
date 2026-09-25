"""
Tests for the Ordria OSS payments implementation
(src.services.payments.payments + stripe_provider).

No real Stripe credentials are involved: provider calls are monkeypatched and
the env key is an assembled placeholder that is not a valid key of any kind.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organizations import Organization
from src.db.payments import (
    ENROLLMENT_ACTIVE,
    ENROLLMENT_PENDING,
    PaymentsEnrollment,
    PaymentsOffer,
)
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.payments import stripe_provider
from src.services.payments.payments import (
    activate_platform_stripe_config,
    add_group_sync,
    archive_offer,
    create_checkout,
    create_group,
    create_offer,
    fulfill_checkout_session,
    get_offers,
    get_offers_by_resource,
    get_public_offers,
    get_stripe_overview,
    initialize_payment_config,
)


def _placeholder_key() -> str:
    """Assembled non-credential placeholder used to satisfy env checks."""
    return "-".join(("test", "placeholder", "not", "a", "real", "key"))


async def _make_org(db, org_id: int) -> Organization:
    org = Organization(
        id=org_id, name="Test Org", slug=f"test-org-{org_id}", email="a@b.c"
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


async def _make_user(db, user_id: int, email: str = "buyer@example.com") -> User:
    user = User(
        id=user_id,
        username=f"user{user_id}",
        email=email,
        password="x",
        first_name="Acheteur",
        last_name="Test",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_offer(db, org: Organization, group=None, amount=49.0) -> dict:
    group_id = group["id"] if isinstance(group, dict) else (
        group.id if group else None
    )
    return await create_offer(
        org.id,
        {
            "name": "Pack Sécurité",
            "description": "Formation complète",
            "offer_type": "one_time",
            "price_type": "fixed_price",
            "benefits": "Cours complet, Certificat",
            "amount": amount,
            "currency": "eur",
            "payments_group_id": group_id,
            "resource_uuids": ["course_abc123"],
        },
        db,
    )


async def _offer_row(db, offer_uuid: str) -> PaymentsOffer:
    statement = select(PaymentsOffer).where(PaymentsOffer.offer_uuid == offer_uuid)
    return (await db.scalars(statement)).one()


# ── Config ────────────────────────────────────────────────────────────────────


async def test_initialize_config_creates_inactive_row(db):
    org = await _make_org(db, 101)
    config = await initialize_payment_config(org.id, "stripe", True, db)
    assert config["provider"] == "stripe"
    assert config["active"] is False
    assert config["enabled"] is True


async def test_activate_config_requires_stripe_key(db, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    org = await _make_org(db, 102)
    with pytest.raises(HTTPException) as exc:
        await activate_platform_stripe_config(org.id, db)
    assert exc.value.status_code == 503


async def test_activate_config_marks_platform_active(db, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", _placeholder_key())
    org = await _make_org(db, 103)
    await initialize_payment_config(org.id, "stripe", True, db)
    config = await activate_platform_stripe_config(org.id, db)
    assert config["active"] is True
    assert config["configured"] is True
    assert config["provider_specific_id"] == stripe_provider.PLATFORM_ACCOUNT_SENTINEL


# ── Offers & groups ───────────────────────────────────────────────────────────


async def test_create_and_read_offer_with_resources(db):
    org = await _make_org(db, 104)
    group = await create_group(
        org.id, {"name": "Groupe sécurité", "description": ""}, db
    )
    offer = await _make_offer(db, org, group=group)
    assert offer["amount"] == 49.0
    assert offer["archived"] is False
    assert len(offer["included_resources"]) == 1
    assert offer["included_resources"][0]["resource_type"] == "course"
    assert offer["included_resources"][0]["name"] == "course_abc123"


async def test_offer_amount_must_be_positive(db):
    org = await _make_org(db, 105)
    with pytest.raises(HTTPException) as exc:
        await create_offer(
            org.id, {"name": "Bad", "amount": 0, "currency": "eur"}, db
        )
    assert exc.value.status_code == 400


async def test_public_listing_and_by_resource(db):
    org = await _make_org(db, 106)
    await _make_offer(db, org)
    listing = await get_public_offers(org.id, db)
    assert len(listing) == 1
    by_resource = await get_offers_by_resource(org.id, "course_abc123", db)
    assert len(by_resource) == 1
    assert by_resource[0]["name"] == "Pack Sécurité"

    other = await get_offers_by_resource(org.id, "course_nope", db)
    assert other == []


async def test_archive_offer_hides_from_public(db):
    org = await _make_org(db, 107)
    offer = await _make_offer(db, org)
    await archive_offer(org.id, offer["offer_uuid"], db)
    listing = await get_public_offers(org.id, db)
    assert listing == []
    # Admin view still sees it
    admin_view = await get_offers(org.id, db)
    assert len(admin_view) == 1
    assert admin_view[0]["archived"] is True


# ── Checkout ──────────────────────────────────────────────────────────────────


async def test_checkout_requires_active_config(db):
    org = await _make_org(db, 108)
    user = await _make_user(db, user_id=200)
    offer = await _make_offer(db, org)
    with pytest.raises(HTTPException) as exc:
        await create_checkout(org.id, offer["offer_uuid"], user, "https://x/y", db)
    assert exc.value.status_code == 400


async def test_checkout_creates_pending_enrollment_and_url(db, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", _placeholder_key())
    org = await _make_org(db, 109)
    user = await _make_user(db, user_id=201)
    await initialize_payment_config(org.id, "stripe", True, db)
    await activate_platform_stripe_config(org.id, db)
    offer = await _make_offer(db, org)

    def fake_session(**kwargs):
        return "https://checkout.stripe.example/c/pay/cs_test_123"

    with patch.object(
        stripe_provider, "create_checkout_session", side_effect=fake_session
    ):
        result = await create_checkout(
            org.id,
            offer["offer_uuid"],
            user,
            "https://learn.example/store/offers/x",
            db,
        )
    assert result["checkout_url"].startswith("https://checkout.stripe.example/")

    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.org_id == org.id,
        PaymentsEnrollment.user_id == user.id,
    )
    enrollment = (await db.scalars(statement)).first()
    assert enrollment is not None
    assert enrollment.status == ENROLLMENT_PENDING


# ── Webhook fulfillment ────────────────────────────────────────────────────────


async def _seed_offer_with_synced_usergroup(db, org, user):
    group = await create_group(org.id, {"name": "G", "description": ""}, db)
    usergroup = UserGroup(
        org_id=org.id,
        name="Acheteurs",
        description="Acheteurs de l'offre",
        usergroup_uuid="usergroup_test_1",
    )
    db.add(usergroup)
    await db.commit()
    await db.refresh(usergroup)
    await add_group_sync(org.id, group["id"], usergroup.id, db)
    offer = await _make_offer(db, org, group=group)
    return await _offer_row(db, offer["offer_uuid"])


async def test_fulfill_checkout_session_grants_access(db):
    org = await _make_org(db, 110)
    user = await _make_user(db, user_id=202)
    offer_row = await _seed_offer_with_synced_usergroup(db, org, user)

    session = SimpleNamespace(
        id="cs_test_ok",
        customer="cus_test_1",
        subscription=None,
        payment_status="paid",
        metadata={
            "org_id": str(org.id),
            "offer_id": str(offer_row.id),
            "offer_uuid": offer_row.offer_uuid,
            "user_id": str(user.id),
        },
    )
    await fulfill_checkout_session(session, db)

    # Enrollment is active with Stripe ids stored
    statement = select(PaymentsEnrollment).where(
        PaymentsEnrollment.user_id == user.id
    )
    enrollment = (await db.scalars(statement)).one()
    assert enrollment.status == ENROLLMENT_ACTIVE
    assert enrollment.stripe_customer_id == "cus_test_1"
    assert enrollment.stripe_session_id == "cs_test_ok"

    # Org membership granted with the learner role
    membership_statement = select(UserOrganization).where(
        UserOrganization.user_id == user.id,
        UserOrganization.org_id == org.id,
    )
    membership = (await db.scalars(membership_statement)).one()
    assert membership.role_id == 4

    # UserGroup membership granted (this is what unlocks the course)
    link_statement = select(UserGroupUser).where(
        UserGroupUser.usergroup_id == 1,
        UserGroupUser.user_id == user.id,
    )
    link = (await db.scalars(link_statement)).one()
    assert link is not None

    # Idempotent: replaying the event does not duplicate anything
    await fulfill_checkout_session(session, db)
    all_enrollments = (await db.scalars(statement)).all()
    assert len(all_enrollments) == 1


async def test_fulfill_skips_incomplete_metadata(db):
    org = await _make_org(db, 111)
    session = SimpleNamespace(id="cs_x", metadata={"org_id": str(org.id)})
    # Must not raise — just skips
    await fulfill_checkout_session(session, db)


# ── Overview ──────────────────────────────────────────────────────────────────


async def test_stripe_overview_aggregates(db, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", _placeholder_key())
    org = await _make_org(db, 112)
    user = await _make_user(db, user_id=203)
    offer_row = await _seed_offer_with_synced_usergroup(db, org, user)

    session = SimpleNamespace(
        id="cs_ov",
        customer="cus_ov",
        subscription="sub_ov",
        payment_status="paid",
        metadata={
            "org_id": str(org.id),
            "offer_id": str(offer_row.id),
            "offer_uuid": offer_row.offer_uuid,
            "user_id": str(user.id),
        },
    )
    await fulfill_checkout_session(session, db)

    overview = await get_stripe_overview(org.id, db)
    assert overview["total_revenue"] == 4900  # 49 € in cents
    assert overview["total_customers"] == 1
