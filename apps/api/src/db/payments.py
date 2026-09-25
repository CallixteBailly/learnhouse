"""
Payments models — Ordria OSS reimplementation of the LearnHouse payments
surface (offers / groups / enrollments / provider config).

Design notes:
- The EE edition stores these models in a private package; this OSS variant
  keeps the exact table semantics the web UI expects (see
  apps/web/services/payments/*) so every dashboard/store page works
  unchanged.
- Money is stored as a decimal amount in `amount` (major unit, e.g. euros)
  plus an ISO currency code; Stripe calls convert to integer minor units.
- Entitlement model: an Offer points at a PaymentsGroup; the group links
  resources (what is sold) and syncs to UserGroups (what grants access).
  On successful checkout the buyer is enrolled, added to the org with the
  learner role and added to every synced UserGroup.
"""

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, ForeignKey, Index, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

OFFER_TYPE_ONE_TIME = "one_time"
OFFER_TYPE_SUBSCRIPTION = "subscription"
PRICE_TYPE_FIXED = "fixed_price"
PRICE_TYPE_CUSTOMER_CHOICE = "customer_choice"

ENROLLMENT_PENDING = "pending"
ENROLLMENT_ACTIVE = "active"
ENROLLMENT_CANCELED = "canceled"


class PaymentsConfig(SQLModel, table=True):
    __table_args__ = (Index("ix_paymentsconfig_org", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    enabled: bool = True
    active: bool = False
    provider: str = "stripe"
    # Platform account sentinel — v1 charges go to the platform's own Stripe
    # account (see services/payments/stripe_provider.py).
    provider_specific_id: Optional[str] = None
    provider_config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    mode: str = "standard"
    creation_date: str = ""
    update_date: str = ""


class PaymentsGroup(SQLModel, table=True):
    __table_args__ = (Index("ix_paymentsgroup_org", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    name: str
    description: str = ""
    creation_date: str = ""
    update_date: str = ""


class PaymentsGroupResource(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("payments_group_id", "resource_uuid", name="uc_pgresource"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    payments_group_id: int = Field(
        sa_column=Column(
            ForeignKey("paymentsgroup.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    resource_uuid: str
    creation_date: str = ""


class PaymentsGroupSync(SQLModel, table=True):
    """Bridge: buyers of offers attached to this group are added to the
    synced UserGroups — UserGroup membership is what grants course access."""

    __table_args__ = (
        UniqueConstraint("payments_group_id", "usergroup_id", name="uc_pgsync"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    payments_group_id: int = Field(
        sa_column=Column(
            ForeignKey("paymentsgroup.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    usergroup_id: int = Field(
        sa_column=Column(
            ForeignKey("usergroup.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    creation_date: str = ""


class PaymentsOffer(SQLModel, table=True):
    __table_args__ = (Index("ix_paymentsoffer_org", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    offer_uuid: str = Field(default_factory=lambda: f"offer_{uuid4()}", index=True)
    org_id: int = Field(
        sa_column=Column(
            ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    payments_config_id: Optional[int] = Field(
        default=None, foreign_key="paymentsconfig.id"
    )
    payments_group_id: Optional[int] = Field(
        default=None, foreign_key="paymentsgroup.id"
    )
    name: str
    description: str = ""
    offer_type: str = OFFER_TYPE_ONE_TIME
    price_type: str = PRICE_TYPE_FIXED
    benefits: str = ""
    amount: float = 0.0
    currency: str = "eur"
    archived: bool = False
    provider_product_id: Optional[str] = None
    creation_date: str = ""
    update_date: str = ""


class PaymentsOfferResource(SQLModel, table=True):
    """Resources displayed on the offer card / detail page ("what's included")."""

    __table_args__ = (
        UniqueConstraint("offer_id", "resource_uuid", name="uc_poresource"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    offer_id: int = Field(
        sa_column=Column(
            ForeignKey("paymentsoffer.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    resource_uuid: str
    creation_date: str = ""


class PaymentsEnrollment(SQLModel, table=True):
    __table_args__ = (
        Index("ix_paymentsenrollment_org_user", "org_id", "user_id"),
        Index("ix_paymentsenrollment_session", "stripe_session_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    offer_id: int = Field(
        sa_column=Column(
            ForeignKey("paymentsoffer.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    user_id: int = Field(
        sa_column=Column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    status: str = ENROLLMENT_PENDING
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_session_id: Optional[str] = None
    amount: float = 0.0
    currency: str = "eur"
    creation_date: str = ""
    update_date: str = ""


# ── API schemas ───────────────────────────────────────────────────────────────


def _now() -> str:
    return str(datetime.now())


class PaymentsGroupCreate(SQLModel):
    name: str
    description: str = ""


class PaymentsGroupUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None


class OfferCreate(SQLModel):
    name: str
    description: str = ""
    offer_type: str = OFFER_TYPE_ONE_TIME
    price_type: str = PRICE_TYPE_FIXED
    benefits: str = ""
    amount: float
    currency: str = "eur"
    payments_group_id: Optional[int] = None
    resource_uuids: list[str] = Field(default_factory=list)


class OfferUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    offer_type: Optional[str] = None
    price_type: Optional[str] = None
    benefits: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    payments_group_id: Optional[int] = None
    resource_uuids: Optional[list[str]] = None
    archived: Optional[bool] = None


class PaymentConfigInit(SQLModel):
    provider: str = "stripe"
    enabled: bool = True
