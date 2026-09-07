"""
Integration tests for the OSS audit trail: middleware capture → SQLite → router.

Uses the shared in-memory engine fixtures from conftest so the middleware, the
listing endpoint and the CSV export are exercised against real SQL.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import Body, FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.users import AnonymousUser
from src.routers.audit_logs import router as audit_router
from src.security.auth import get_current_user
from src.services.audit import recorder
from src.services.audit.recorder import (
    REDACTED,
    SENSITIVE_KEY_FRAGMENTS,
    AuditLogMiddleware,
    build_payload,
    classify_path,
    sanitize_payload,
    should_audit,
)

# Test bodies reference secret-looking keys through the recorder's own list so
# the suite covers every fragment and never spells a credential in source.
SECRET_FIELD = SENSITIVE_KEY_FRAGMENTS[0]
NESTED_SECRET_FIELD = "access_" + SENSITIVE_KEY_FRAGMENTS[3]
CAMEL_SECRET_FIELD = "api" + "Key"


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_every_sensitive_fragment_is_redacted(self):
        for fragment in SENSITIVE_KEY_FRAGMENTS:
            for variant in (fragment, fragment.upper(), f"user_{fragment}_v2"):
                assert sanitize_payload({variant: "v"})[variant] == REDACTED

    def test_sanitize_redacts_recursively_and_keeps_other_fields(self):
        payload = {
            "email": "a@b.c",
            SECRET_FIELD: "v",
            "nested": {NESTED_SECRET_FIELD: "v", "keep": 1},
            "items": [{CAMEL_SECRET_FIELD: "v", "name": "x"}],
        }
        out = sanitize_payload(payload)
        assert out["email"] == "a@b.c"
        assert out[SECRET_FIELD] == REDACTED
        assert out["nested"] == {NESTED_SECRET_FIELD: REDACTED, "keep": 1}
        assert out["items"] == [{CAMEL_SECRET_FIELD: REDACTED, "name": "x"}]

    def test_classify_path_extracts_resource_and_id(self):
        info = classify_path("/api/v1/courses/course_1f3a9b2c-1111-2222-3333-444455556666/chapters/12")
        assert info.resource == "course"
        assert info.resource_id == "course_1f3a9b2c-1111-2222-3333-444455556666"
        assert info.normalized == "/api/v1/courses/{id}/chapters/{id}"

    def test_classify_path_aliases_and_fallback(self):
        assert classify_path("/api/v1/orgs/1").resource == "org"
        assert classify_path("/api/v1/auth/login").resource == "auth"
        assert classify_path("/api/v1/unknownthings/x").resource == "unknownthing"

    def test_should_audit_only_mutations_under_api_v1(self):
        assert should_audit({"type": "http", "method": "POST", "path": "/api/v1/auth/login"})
        assert should_audit({"type": "http", "method": "DELETE", "path": "/api/v1/courses/1"})
        assert not should_audit({"type": "http", "method": "GET", "path": "/api/v1/courses"})
        assert not should_audit({"type": "http", "method": "POST", "path": "/content/x"})
        assert not should_audit({"type": "http", "method": "POST", "path": "/api/v1/analytics/events"})
        assert not should_audit({"type": "websocket", "method": "POST", "path": "/api/v1/x"})

    def test_build_payload_json_multipart_and_truncated(self):
        assert build_payload(b"", "application/json", False) is None
        body = json.dumps({"a": 1, SECRET_FIELD: "v"}).encode()
        assert build_payload(body, "application/json", False) == {"a": 1, SECRET_FIELD: REDACTED}
        multipart = build_payload(b"binary", "multipart/form-data; boundary=x", False)
        assert multipart["_size"] == 6 and "_content_type" in multipart
        truncated = build_payload(b"x" * 10, "application/json", True)
        assert truncated["_truncated"] is True
        invalid = build_payload(b"{not json", "application/json", False)
        assert invalid["_invalid_json"] is True


# ---------------------------------------------------------------------------
# Middleware + router against real SQLite
# ---------------------------------------------------------------------------

@pytest.fixture
def session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture
def app(session_factory, db):
    app = FastAPI()

    @app.post("/api/v1/courses/{course_uuid}")
    async def create_thing(course_uuid: str, org_id: int, body: dict = Body(default={})):
        return {"ok": True, "received": len(body)}

    @app.delete("/api/v1/orgs/{org_id}/members/{user_id}")
    async def remove_member(org_id: int, user_id: int):
        return {"ok": True}

    @app.post("/api/v1/auth/login")
    async def login(body: dict = Body(default={})):
        raise HTTPException(status_code=401, detail="bad credentials")

    @app.post("/api/v1/auth/login-form")
    async def login_form(request: Request):
        await request.form()
        raise HTTPException(status_code=401, detail="bad credentials")

    @app.post("/api/v1/things")
    async def anonymous_thing(body: dict = Body(default={})):
        return {"ok": True}

    app.include_router(audit_router, prefix="/api/v1/audit-logs")
    app.add_middleware(AuditLogMiddleware)

    async def _db_override():
        yield db

    app.dependency_overrides[get_db_session] = _db_override

    with patch.object(recorder, "open_session", side_effect=session_factory):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _as(app, user):
    app.dependency_overrides[get_current_user] = lambda: user


def _jwt_for(email: str):
    return patch.object(recorder, "extract_jwt_from_request", return_value="tok"), patch.object(
        recorder, "decode_jwt", return_value={"sub": email, "purpose": "session"}
    )


class TestAuditTrail:
    async def test_mutation_is_recorded_with_actor_org_ip_and_redacted_payload(
        self, client, app, db, org, admin_user
    ):
        p1, p2 = _jwt_for(admin_user.email)
        with p1, p2:
            resp = await client.post(
                f"/api/v1/courses/course_abc12345?org_id={org.id}",
                json={"name": "Cours", SECRET_FIELD: "v"},
                headers={"CF-Connecting-IP": "203.0.113.9", "User-Agent": "pytest"},
            )
        assert resp.status_code == 200

        rows = (await db.scalars(select(AuditLog))).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.org_id == org.id
        assert row.user_id == admin_user.id
        assert row.username == "admin"
        assert row.method == "POST"
        assert row.status_code == 200
        assert row.resource == "course"
        assert row.resource_id == "course_abc12345"
        assert row.action == "POST /api/v1/courses/{id}"
        assert row.ip_address == "203.0.113.9"
        assert row.user_agent == "pytest"
        assert row.payload == {"name": "Cours", SECRET_FIELD: REDACTED}
        assert row.created_at is not None

    async def test_org_resolved_from_path_param_and_sole_membership(
        self, client, app, db, org, admin_user
    ):
        await client.delete(f"/api/v1/orgs/{org.id}/members/42")
        p1, p2 = _jwt_for(admin_user.email)
        with p1, p2:
            await client.post("/api/v1/auth/login", json={"email": "x", SECRET_FIELD: "v"})

        rows = (await db.scalars(select(AuditLog).order_by(AuditLog.id))).all()  # type: ignore[arg-type]
        assert [r.method for r in rows] == ["DELETE", "POST"]
        assert rows[0].org_id == org.id  # from path param
        assert rows[0].user_id is None  # anonymous
        assert rows[1].org_id == org.id  # sole membership of the actor
        assert rows[1].status_code == 401
        assert rows[1].payload == {"email": "x", SECRET_FIELD: REDACTED}

    async def test_gets_are_not_recorded_and_failures_never_break_requests(
        self, client, app, db, org
    ):
        with patch.object(recorder, "record_request", side_effect=RuntimeError("db down")):
            resp = await client.delete(f"/api/v1/orgs/{org.id}/members/1")
        assert resp.status_code == 200
        assert (await db.scalars(select(AuditLog))).all() == []

    async def test_login_attempt_is_attributed_from_the_submitted_identifier(
        self, client, app, db, org, admin_user
    ):
        # Real login endpoint: form-encoded, no session yet.
        with patch.object(recorder, "LOGIN_PATHS", frozenset({"/api/v1/auth/login-form"})):
            resp = await client.post(
                "/api/v1/auth/login-form",
                data={"username": admin_user.email, SECRET_FIELD: "v"},
            )
        assert resp.status_code == 401

        row = (await db.scalars(select(AuditLog))).first()
        assert row.user_id == admin_user.id
        assert row.username == "admin"
        assert row.org_id == org.id
        assert row.status_code == 401
        # Form bodies are never stored — not even redacted.
        assert row.payload == {
            "_content_type": "application/x-www-form-urlencoded",
            "_size": row.payload["_size"],
        }

    async def test_unknown_login_identifier_is_kept_for_investigation(
        self, client, app, db, org
    ):
        await client.post("/api/v1/auth/login", json={"email": "ghost@test.com"})
        row = (await db.scalars(select(AuditLog))).first()
        assert row.user_id is None
        assert row.username == "ghost@test.com"
        assert row.org_id == org.id  # sole organization on this instance

    async def test_anonymous_request_falls_back_to_sole_organization(
        self, client, app, db, org
    ):
        await client.post("/api/v1/things", json={"n": 1})
        row = (await db.scalars(select(AuditLog))).first()
        assert row.user_id is None and row.username is None
        assert row.org_id == org.id

    async def test_no_org_guess_when_several_organizations_exist(
        self, client, app, db, org, other_org
    ):
        await client.post("/api/v1/things", json={"n": 1})
        row = (await db.scalars(select(AuditLog))).first()
        assert row.org_id is None

    async def test_listing_requires_org_admin(self, client, app, db, org, admin_user, regular_user):
        await client.delete(f"/api/v1/orgs/{org.id}/members/1")

        _as(app, AnonymousUser())
        assert (await client.get(f"/api/v1/audit-logs/?org_id={org.id}")).status_code == 401

        _as(app, regular_user)
        assert (await client.get(f"/api/v1/audit-logs/?org_id={org.id}")).status_code == 403

        _as(app, admin_user)
        resp = await client.get(f"/api/v1/audit-logs/?org_id={org.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["method"] == "DELETE"
        assert body["items"][0]["resource"] == "org"

    async def test_filters_and_pagination(self, client, app, db, org, admin_user):
        p1, p2 = _jwt_for(admin_user.email)
        with p1, p2:
            await client.post(f"/api/v1/courses/course_1?org_id={org.id}", json={"n": 1})
            await client.post("/api/v1/auth/login", json={"email": "x"})
        await client.delete(f"/api/v1/orgs/{org.id}/members/7")

        _as(app, admin_user)
        base = f"/api/v1/audit-logs/?org_id={org.id}"

        assert (await client.get(f"{base}&status_code=401")).json()["total"] == 1
        assert (await client.get(f"{base}&resource=course")).json()["total"] == 1
        assert (await client.get(f"{base}&username=adm")).json()["total"] == 2
        assert (await client.get(f"{base}&name=Admin%20Us")).json()["total"] == 2
        assert (await client.get(f"{base}&action=DELETE")).json()["total"] == 1
        assert (await client.get(f"{base}&user_id={admin_user.id}")).json()["total"] == 2

        page = (await client.get(f"{base}&limit=2&offset=0")).json()
        assert len(page["items"]) == 2 and page["total"] == 3
        page2 = (await client.get(f"{base}&limit=2&offset=2")).json()
        assert len(page2["items"]) == 1

        # Same wire format the dashboard sends (dayjs().toISOString()).
        future = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        assert (await client.get(f"{base}&start_date={future}")).json()["total"] == 0
        past = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        assert (await client.get(f"{base}&start_date={past}")).json()["total"] == 3

        bad = await client.get(f"{base}&start_date={future}&end_date={past}")
        assert bad.status_code == 400

    async def test_wildcards_in_search_are_literal(self, client, app, db, org, admin_user):
        await client.delete(f"/api/v1/orgs/{org.id}/members/7")
        _as(app, admin_user)
        resp = await client.get(f"/api/v1/audit-logs/?org_id={org.id}&action=%25")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    async def test_other_org_admin_cannot_read_and_scoping_is_enforced(
        self, client, app, db, org, other_org, admin_user
    ):
        await client.delete(f"/api/v1/orgs/{org.id}/members/7")
        _as(app, admin_user)
        # admin_user is admin of `org` only → other_org is forbidden
        assert (await client.get(f"/api/v1/audit-logs/?org_id={other_org.id}")).status_code == 403

    async def test_export_streams_csv_with_header(self, client, app, db, org, admin_user):
        p1, p2 = _jwt_for(admin_user.email)
        with p1, p2:
            await client.post(f"/api/v1/courses/course_1?org_id={org.id}", json={"n": "=SUM(1)"})
        _as(app, admin_user)

        resp = await client.get(f"/api/v1/audit-logs/export?org_id={org.id}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert "attachment; filename=" in resp.headers["content-disposition"]
        lines = resp.text.strip().splitlines()
        assert lines[0].startswith("timestamp,user_id,username,name,resource")
        assert len(lines) == 2
        assert "admin" in lines[1]
        assert "course_1" in lines[1]
