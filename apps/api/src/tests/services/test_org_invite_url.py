"""URL-shape tests for send_invite_email.

The invite email's signup link is built from get_org_signup_base_url. On
multi-tenant deployments WITHOUT a shared subdomain cookie domain (the central
LMS on learn.ordria.fr) the link must be path-based /orgs/{slug}/signup — the
{slug}.{domain} subdomain form has no DNS there and lands on a dead host.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from starlette.requests import Request

from src.db.organizations import OrganizationRead
from src.db.users import UserRead


def _request(headers=None, scheme="https", server=("api.test", 443)):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [
            (key.encode(), value.encode()) for key, value in (headers or {}).items()
        ],
        "query_string": b"",
        "scheme": scheme,
        "server": server,
    }
    return Request(scope)


def _config(**overrides):
    # Mirrors the PRODUCTION runtime config verbatim, including the config.yaml
    # default cookie_domain ".localhost" (2026-10-01 regression: that value
    # starts with "." and used to trigger the subdomain branch).
    hosting = SimpleNamespace(
        allowed_origins=[],
        allowed_regexp="",
        self_hosted=False,
        tenancy=overrides.pop("tenancy", "multi"),
        domain=overrides.pop("domain", "learn.ordria.fr"),
        frontend_domain=overrides.pop("frontend_domain", "learn.ordria.fr"),
        ssl=overrides.pop("ssl", True),
        cookie_config=SimpleNamespace(
            domain=overrides.pop("cookie_domain", ".localhost"),
        ),
    )
    return SimpleNamespace(
        hosting_config=hosting,
        general_config=SimpleNamespace(development_mode=False),
    )


class TestSendInviteEmailUrl:
    @pytest.mark.asyncio
    async def test_signup_url_is_path_based_without_subdomain_cookie(self):
        """Central LMS (no subdomain cookie domain): the emailed link points
        at /orgs/{slug}/signup on the frontend origin, never at
        {slug}.learn.ordria.fr which has no DNS."""
        from src.services.orgs.invites import send_invite_email

        org = OrganizationRead.model_construct(
            id=39, name="PROTECH", slug="protech", org_uuid="org-protech"
        )
        user = UserRead.model_construct(
            id=1, username="admin", email="admin@ordria.fr", user_uuid="u1"
        )
        request = _request({"origin": "https://learn.ordria.fr"})
        fake_store = SimpleNamespace(
            find_code_by_uuid=AsyncMock(
                return_value=SimpleNamespace(code="FORM-123")
            )
        )

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(),
        ), patch(
            "src.services.orgs.invites.store", fake_store
        ), patch(
            "src.services.orgs.invites.send_invitation_email",
            return_value=Mock(),
        ) as mock_send:
            sent = await send_invite_email(
                org,
                "invite-code-uuid",
                user,
                "invitee@test.com",
                request,
                db_session=Mock(),
            )

        assert sent is True
        signup_url = mock_send.call_args.kwargs["signup_url"]
        assert signup_url == (
            "https://learn.ordria.fr/orgs/protech/signup?inviteCode=FORM-123"
        )
        assert "protech.learn.ordria.fr" not in signup_url
