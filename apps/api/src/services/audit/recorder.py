"""
Audit trail recorder.

Captures every state-changing API call (POST/PUT/PATCH/DELETE under /api/v1)
into the `audit_log` table: who did it, on which resource, from which IP, with
which outcome, and a sanitized copy of the request payload.

The middleware is a raw ASGI wrapper rather than a BaseHTTPMiddleware so the
request body can be tee'd without ever consuming it away from the route
handler. Recording happens after the response has been handed to the server,
inside a catch-all guard: an audit failure must never surface to the client.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import parse_qs

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.db.audit_logs import AuditLog
from src.security.auth import decode_jwt, extract_jwt_from_request
from src.services.audit.lookups import (
    find_user_by_email,
    org_id_for_course,
    org_id_for_slug,
    sole_membership_org_id,
    sole_organization_id,
    open_session,
)

logger = logging.getLogger(__name__)

AUDITED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
API_PREFIX = "/api/v1/"

# Credential-bearing endpoints: the caller has no session yet, so the actor is
# taken from the submitted identifier (never from the secret) — this is what
# lets failed login attempts show up against the targeted account.
LOGIN_PATHS = frozenset({"/api/v1/auth/login"})
LOGIN_IDENTIFIER_FIELDS = ("username", "email")

# High-frequency beacons that would drown the trail without adding accountability.
IGNORED_PATH_PREFIXES = (
    "/api/v1/analytics/events",
    "/api/v1/health",
    "/api/v1/monitoring",
)

# Body handling limits. Uploads (multipart) are never stored; JSON bodies are
# capped so a single bulky editor save cannot bloat the table.
MAX_BODY_CAPTURE_BYTES = 64 * 1024
MAX_PAYLOAD_STORED_BYTES = 4 * 1024
MAX_SANITIZE_DEPTH = 8

# Any key containing one of these fragments is redacted (case-insensitive).
SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "credential",
    "private_key",
    "card_number",
    "cvc",
    "cvv",
    "ssn",
)
REDACTED = "[REDACTED]"

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
# LearnHouse ids look like `course_<uuid>`, `activity_<uuid>`, `user_<uuid>`...
_PREFIXED_ID_RE = re.compile(r"^[a-z]+_[0-9a-fA-F-]{8,}$")
_NUMERIC_RE = re.compile(r"^\d+$")

# First path segment after /api/v1/ → resource label shown in the UI filter.
RESOURCE_ALIASES = {
    "orgs": "org",
    "users": "user",
    "courses": "course",
    "chapters": "chapter",
    "activities": "activity",
    "collections": "collection",
    "roles": "role",
    "usergroups": "usergroup",
    "assignments": "assignment",
    "certifications": "certification",
    "communities": "community",
    "boards": "board",
    "playgrounds": "playground",
    "podcasts": "podcast",
    "folders": "folder",
    "trail": "trail",
    "auth": "auth",
    "ai": "ai",
    "webhooks": "webhook",
    "api_tokens": "api_token",
    "integrations": "integration",
    "media": "media",
    "search": "search",
    "admin": "admin",
    "payments": "payment",
}


@dataclass
class PathInfo:
    resource: str
    resource_id: Optional[str]
    normalized: str


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in SENSITIVE_KEY_FRAGMENTS)


def sanitize_payload(value: Any, depth: int = 0) -> Any:
    """Recursively redact secret-looking keys; leaves structure intact."""
    if depth > MAX_SANITIZE_DEPTH:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {
            str(k): (REDACTED if is_sensitive_key(str(k)) else sanitize_payload(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [sanitize_payload(item, depth + 1) for item in value]
    return value


def _looks_like_identifier(segment: str) -> bool:
    return bool(
        _UUID_RE.match(segment)
        or _PREFIXED_ID_RE.match(segment)
        or _NUMERIC_RE.match(segment)
    )


def classify_path(path: str) -> PathInfo:
    """
    Split `/api/v1/courses/course_abc/chapters` into resource="course",
    resource_id="course_abc" and a normalized path with ids replaced by `{id}`
    so the same action groups together in searches.
    """
    relative = path[len(API_PREFIX):] if path.startswith(API_PREFIX) else path.strip("/")
    segments = [s for s in relative.split("/") if s]
    if not segments:
        return PathInfo(resource="root", resource_id=None, normalized=path)

    head = segments[0]
    resource = RESOURCE_ALIASES.get(head, head.rstrip("s") or head)

    resource_id: Optional[str] = None
    normalized_segments: list[str] = []
    for index, segment in enumerate(segments):
        if index > 0 and _looks_like_identifier(segment):
            if resource_id is None and index == 1:
                resource_id = segment[:128]
            normalized_segments.append("{id}")
        else:
            normalized_segments.append(segment)

    return PathInfo(
        resource=resource[:64],
        resource_id=resource_id,
        normalized=API_PREFIX + "/".join(normalized_segments),
    )


def _valid_ip(candidate: str) -> Optional[str]:
    candidate = candidate.strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def extract_client_ip(request: Request) -> Optional[str]:
    """
    Real client IP behind the Cloudflare → Worker → nginx chain.

    CF-Connecting-IP is set by Cloudflare's edge and cannot be forged by the
    client, so it wins. X-Forwarded-For's first hop is the next best signal;
    the raw socket peer is only the local nginx proxy.
    """
    headers = request.headers
    for header in ("cf-connecting-ip", "x-real-ip"):
        ip = _valid_ip(headers.get(header, ""))
        if ip:
            return ip
    forwarded = headers.get("x-forwarded-for", "")
    if forwarded:
        ip = _valid_ip(forwarded.split(",")[0])
        if ip:
            return ip
    if request.client and request.client.host:
        return _valid_ip(request.client.host)
    return None


def build_payload(body: bytes, content_type: str, truncated: bool) -> Optional[dict[str, Any]]:
    """Sanitized JSON payload, or a small descriptor when the body is not JSON."""
    if not body and not truncated:
        return None

    size = len(body)
    if truncated:
        return {"_truncated": True, "_captured_bytes": size, "_content_type": content_type[:80]}

    if "application/json" not in content_type.lower():
        return {"_content_type": content_type[:80] or "unknown", "_size": size}

    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {"_content_type": content_type[:80], "_size": size, "_invalid_json": True}

    sanitized = sanitize_payload(parsed)
    if not isinstance(sanitized, dict):
        sanitized = {"_value": sanitized}

    if len(json.dumps(sanitized, default=str)) > MAX_PAYLOAD_STORED_BYTES:
        return {
            "_truncated": True,
            "_size": size,
            "_keys": sorted(str(k) for k in sanitized.keys())[:50],
        }
    return sanitized


def _actor_from_request(request: Request) -> tuple[Optional[str], Optional[str]]:
    """
    Returns (email_from_jwt, static_username). API tokens (Bearer lh_...) are
    not tied to a session user, so they are labelled instead of resolved.
    """
    auth_header = request.headers.get("authorization", "").lower()
    if auth_header.startswith("bearer lh_"):
        return None, "api-token"

    token = extract_jwt_from_request(request)
    if not token:
        return None, None
    payload = decode_jwt(token)
    if not payload:
        return None, None
    if payload.get("purpose") not in (None, "session"):
        return None, None
    subject = payload.get("sub")
    return (str(subject) if subject else None), None


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None and str(value).strip() != "" else None
    except (TypeError, ValueError):
        return None


def login_identifier(path: str, body: bytes, content_type: str) -> Optional[str]:
    """
    The account a login attempt targets, read from the form/JSON body of a
    LOGIN_PATHS request. Only the identifier field is ever looked at.
    """
    if path not in LOGIN_PATHS or not body:
        return None
    lowered = content_type.lower()
    try:
        if "application/x-www-form-urlencoded" in lowered:
            fields = parse_qs(body.decode("utf-8", "replace"), keep_blank_values=False)
            for key in LOGIN_IDENTIFIER_FIELDS:
                values = fields.get(key)
                if values and values[0].strip():
                    return values[0].strip()[:255]
        elif "application/json" in lowered:
            parsed = json.loads(body.decode("utf-8"))
            if isinstance(parsed, dict):
                for key in LOGIN_IDENTIFIER_FIELDS:
                    value = parsed.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()[:255]
    except (UnicodeDecodeError, ValueError):
        return None
    return None


async def _resolve_org_id(
    db_session,
    request: Request,
    path_params: dict[str, Any],
    user_id: Optional[int],
) -> Optional[int]:
    """
    Org attribution, most explicit signal first: query/path org_id, then an
    org slug or course uuid in the path, then the actor's sole membership,
    and finally the instance's sole organization (single-tenant deployments).
    """
    org_id = _int_or_none(request.query_params.get("org_id"))
    if org_id is None:
        org_id = _int_or_none(path_params.get("org_id"))
    if org_id is not None:
        return org_id

    org_slug = path_params.get("org_slug") or path_params.get("orgslug")
    if isinstance(org_slug, str) and org_slug:
        found = await org_id_for_slug(db_session, org_slug)
        if found is not None:
            return found

    course_uuid = path_params.get("course_uuid")
    if isinstance(course_uuid, str) and course_uuid:
        found = await org_id_for_course(db_session, course_uuid)
        if found is not None:
            return found

    if user_id is not None:
        found = await sole_membership_org_id(db_session, user_id)
        if found is not None:
            return found

    return await sole_organization_id(db_session)


async def record_request(
    scope: Scope,
    body: bytes,
    body_truncated: bool,
    status_code: int,
) -> None:
    request = Request(scope)
    path = scope.get("path", "")
    method = scope.get("method", "")
    path_info = classify_path(path)
    path_params: dict[str, Any] = scope.get("path_params") or {}

    email, static_username = _actor_from_request(request)
    content_type = request.headers.get("content-type", "")
    if email is None and static_username is None:
        email = login_identifier(path, body, content_type)

    async with open_session() as db_session:
        user_id: Optional[int] = None
        username: Optional[str] = static_username

        if email:
            user = await find_user_by_email(db_session, email)
            if user is not None:
                user_id, username = user.id, user.username
            elif path in LOGIN_PATHS:
                # Unknown account: keep the attempted identifier visible so
                # enumeration / brute-force patterns remain investigable.
                username = email

        org_id = await _resolve_org_id(db_session, request, path_params, user_id)

        entry = AuditLog(
            org_id=org_id,
            user_id=user_id,
            username=username,
            resource=path_info.resource,
            resource_id=path_info.resource_id,
            action=f"{method} {path_info.normalized}"[:255],
            path=path[:512],
            method=method[:10],
            status_code=status_code,
            ip_address=extract_client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
            payload=build_payload(body, content_type, body_truncated),
        )
        db_session.add(entry)
        await db_session.commit()


def should_audit(scope: Scope) -> bool:
    if scope.get("type") != "http":
        return False
    if scope.get("method") not in AUDITED_METHODS:
        return False
    path = scope.get("path", "")
    if not path.startswith(API_PREFIX):
        return False
    return not path.startswith(IGNORED_PATH_PREFIXES)


class AuditLogMiddleware:
    """ASGI middleware — see module docstring."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not should_audit(scope):
            await self.app(scope, receive, send)
            return

        body_chunks: list[bytes] = []
        captured = 0
        truncated = False
        status_holder = {"status": 0}

        async def tee_receive() -> Message:
            nonlocal captured, truncated
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                if chunk:
                    if captured + len(chunk) <= MAX_BODY_CAPTURE_BYTES:
                        body_chunks.append(chunk)
                        captured += len(chunk)
                    else:
                        truncated = True
            return message

        async def tee_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message.get("status", 0))
            await send(message)

        try:
            await self.app(scope, tee_receive, tee_send)
        finally:
            # Unhandled exceptions reach here with status 0 → record as 500 so
            # the failed attempt still appears in the trail.
            status = status_holder["status"] or 500
            try:
                await record_request(scope, b"".join(body_chunks), truncated, status)
            except Exception:
                logger.warning(
                    "audit: failed to record %s %s",
                    scope.get("method"),
                    scope.get("path"),
                    exc_info=True,
                )
