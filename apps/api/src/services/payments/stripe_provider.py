"""
Stripe provider — Ordria OSS payments.

v1 model: a single platform Stripe account (Ordria's own) collects every
payment. Credentials come exclusively from the environment
(STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) — never from source code.

Stripe integration rules applied here (see stripe-best-practices skill):
- A `StripeClient` instance is created per call site; the deprecated global
  `stripe.api_key` pattern is never used.
- `payment_method_types` is never passed — dynamic payment methods.
- Fulfillment happens in the webhook handler (checkout.session.completed +
  async_payment_succeeded gated on payment_status), not on the success page.
- Checkout sessions carry an `integration_identifier` for Dashboard flow
  analytics.
"""

import logging
import os
from typing import Any

import stripe

logger = logging.getLogger(__name__)

# Tracks this integration's checkout flows in the Stripe Dashboard.
# Suffix of 8 random letters, per the integration_identifier convention.
INTEGRATION_IDENTIFIER = "ordria-checkout-ab12cd34"

# v1: the org's payments run on the platform's own Stripe account. The config
# UI only checks that provider_specific_id is set — a stable sentinel avoids
# an extra API round-trip at connect time.
PLATFORM_ACCOUNT_SENTINEL = "ordria-platform"


class StripeNotConfiguredError(Exception):
    """Raised when STRIPE_SECRET_KEY is missing on the deployment."""


def get_stripe_secret_key() -> str | None:
    """Platform API key from the environment (secret service in prod)."""
    return os.environ.get("STRIPE_SECRET_KEY") or None


def get_stripe_webhook_secret() -> str | None:
    """Webhook signing secret from the environment."""
    return os.environ.get("STRIPE_WEBHOOK_SECRET") or None


def is_stripe_configured() -> bool:
    return bool(get_stripe_secret_key())


def get_stripe_client() -> stripe.StripeClient:
    key = get_stripe_secret_key()
    if not key:
        raise StripeNotConfiguredError(
            "Stripe is not configured on this deployment (missing STRIPE_SECRET_KEY)"
        )
    return stripe.StripeClient(key)


def create_checkout_session(
    *,
    offer: Any,
    org_id: int,
    user: Any,
    redirect_uri: str,
) -> str:
    """Create a Stripe Checkout Session for an offer and return its URL.

    One-time offers use mode=payment; subscriptions use mode=subscription with
    a monthly inline price (price_data) — no Stripe Products/Prices need to be
    synchronized for v1.
    """
    client = get_stripe_client()
    is_subscription = offer.offer_type == "subscription"

    unit_amount = int(round(float(offer.amount) * 100))
    if unit_amount <= 0:
        raise ValueError("Offer amount must be greater than zero")

    line_item: dict[str, Any] = {
        "quantity": 1,
        "price_data": {
            "currency": str(offer.currency).lower(),
            "unit_amount": unit_amount,
            "product_data": {
                "name": offer.name,
                "description": (offer.description or "")[:255] or None,
            },
        },
    }
    if is_subscription:
        line_item["price_data"]["recurring"] = {"interval": "month"}

    separator = "&" if "?" in redirect_uri else "?"
    metadata = {
        "org_id": str(org_id),
        "offer_id": str(offer.id),
        "offer_uuid": offer.offer_uuid,
        "user_id": str(user.id),
    }

    params: dict[str, Any] = {
        "mode": "subscription" if is_subscription else "payment",
        "line_items": [line_item],
        "success_url": f"{redirect_uri}{separator}checkout=success",
        "cancel_url": f"{redirect_uri}{separator}checkout=cancelled",
        "client_reference_id": str(user.id),
        "metadata": metadata,
        "customer_email": getattr(user, "email", None),
        "integration_identifier": INTEGRATION_IDENTIFIER,
    }
    if not is_subscription:
        # Keep the Stripe customer after one-time payments so the billing
        # portal and the customers list work for every buyer.
        params["customer_creation"] = "always"
    else:
        params["subscription_data"] = {"metadata": metadata}

    session = client.checkout.sessions.create(**params)
    return str(session.url)


def create_billing_portal_session(
    *, stripe_customer_id: str, return_url: str
) -> str:
    client = get_stripe_client()
    session = client.billing_portal.sessions.create(
        customer=stripe_customer_id,
        return_url=return_url,
    )
    return str(session.url)


def construct_webhook_event(payload: bytes, signature: str) -> stripe.Event:
    """Verify the webhook signature before any processing."""
    secret = get_stripe_webhook_secret()
    if not secret:
        raise StripeNotConfiguredError(
            "Stripe webhook secret is not configured (missing STRIPE_WEBHOOK_SECRET)"
        )
    return stripe.Webhook.construct_event(payload, signature, secret)


def _customer_ref(charge_or_sub: Any) -> dict[str, Any]:
    customer = getattr(charge_or_sub, "customer", None)
    if customer is None:
        return {"id": None, "name": None, "email": None}
    if isinstance(customer, str):
        return {"id": customer, "name": None, "email": None}
    return {
        "id": getattr(customer, "id", None),
        "name": getattr(customer, "name", None),
        "email": getattr(customer, "email", None),
    }


def list_charges(limit: int = 25, starting_after: str | None = None) -> dict[str, Any]:
    """Recent platform charges, mapped to the shape the dashboard UI renders."""
    client = get_stripe_client()
    params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
    if starting_after:
        params["starting_after"] = starting_after
    charges = client.charges.list(**params)

    data = []
    for ch in charges.auto_paging_iter():
        card = getattr(getattr(ch, "payment_method_details", None), "card", None)
        data.append(
            {
                "id": ch.id,
                "created": ch.created,
                "customer": _customer_ref(ch),
                "card": {
                    "brand": getattr(card, "brand", None),
                    "last4": getattr(card, "last4", None),
                }
                if card
                else None,
                "amount": ch.amount,
                "currency": ch.currency,
                "amount_refunded": ch.amount_refunded,
                "paid": ch.paid,
                "status": ch.status,
            }
        )
        if len(data) >= max(1, min(int(limit), 100)):
            break

    return {
        "data": data,
        "next_cursor": (
            data[-1]["id"] if len(charges.data) >= int(limit) else None
        ),
    }


def list_subscriptions(status: str = "active", limit: int = 25) -> dict[str, Any]:
    """Active subscriptions, mapped to the dashboard UI shape."""
    client = get_stripe_client()
    subs = client.subscriptions.list(status=status, limit=max(1, min(int(limit), 100)))

    data = []
    for sub in subs.auto_paging_iter():
        plan = None
        items = getattr(sub, "items", None)
        if items and getattr(items, "data", None):
            item = items.data[0]
            price = getattr(item, "price", None)
            if price:
                plan = {
                    "interval": getattr(getattr(price, "recurring", None), "interval", None),
                    "amount": getattr(price, "unit_amount", None),
                    "currency": getattr(price, "currency", None),
                }
        data.append(
            {
                "id": sub.id,
                "customer": _customer_ref(sub),
                "status": sub.status,
                "plan": plan,
                "created": sub.created,
                "current_period_end": getattr(sub, "current_period_end", None),
            }
        )
    return {"data": data}
