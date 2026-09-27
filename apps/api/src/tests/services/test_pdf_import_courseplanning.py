"""Tests for PDF import in AI course planning and migration.

Root cause these guard against: PDF attachments were (1) forwarded to the LLM
as binary parts, which text-only OpenAI-compatible providers (e.g. z.ai GLM)
reject with HTTP 400, and (2) never text-extracted, so neither the course plan
nor the generated activity content reflected the document.
"""

import base64
import json
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

from src.services.ai.courseplanning import (
    build_attachment_context,
    extract_attachment_document_text,
    generate_activity_content_stream,
    generate_course_plan_stream,
)
from src.services.ai.schemas.courseplanning import (
    AttachmentData,
    CoursePlanningSessionData,
    DocumentText,
)

uuid4 = uuid.uuid4


def _build_pdf(body: bytes) -> bytes:
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(body)).encode() + b" >>\nstream\n" + body + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    ).encode()
    return out


_BODY = (
    b"BT /F1 11 Tf 40 780 Td 14 TL\n"
    b"(ZORBLAX METHODE AVANCEE) Tj T*\n"
    b"(Le Quirbux est une methode de soudure quantique.) Tj T*\n"
    b"(Le Flamwirt mesure l'indice Zephrik avec precision.) Tj T*\n"
    b"(L'examen final porte sur le taux de Vlork.) Tj T*\n"
    b"ET"
)
ZORBLAX_PDF_BYTES = _build_pdf(_BODY)
ZORBLAX_PDF_B64 = base64.b64encode(ZORBLAX_PDF_BYTES).decode()


def _pdf_attachment(name="zorblax.pdf"):
    return AttachmentData(
        type="file",
        name=name,
        content_base64=ZORBLAX_PDF_B64,
        mime_type="application/pdf",
    )


# ────────────────────────────────
# Text extraction
# ────────────────────────────────

def test_extract_attachment_document_text_pdf():
    text = extract_attachment_document_text(_pdf_attachment())
    assert "Quirbux" in text
    assert "Flamwirt" in text


def test_extract_attachment_document_text_non_pdf_returns_empty():
    att = AttachmentData(
        type="file",
        name="notes.txt",
        content_base64=base64.b64encode(b"hello").decode(),
        mime_type="text/plain",
    )
    assert extract_attachment_document_text(att) == ""


def test_extract_attachment_document_text_invalid_base64_returns_empty():
    att = AttachmentData(
        type="file", name="bad.pdf", content_base64="not-base64!!!", mime_type="application/pdf"
    )
    assert extract_attachment_document_text(att) == ""


def test_attachment_context_includes_pdf_text():
    context = build_attachment_context([_pdf_attachment()])
    assert "Quirbux" in context
    assert "zorblax.pdf" in context
    assert "[Binary document" not in context


def test_attachment_context_fallback_when_pdf_has_no_text_layer():
    scanned = base64.b64encode(b"\x00\x01 not a pdf").decode()
    att = AttachmentData(type="file", name="scan.pdf", content_base64=scanned, mime_type="application/pdf")
    context = build_attachment_context([att])
    assert "scan.pdf" in context
    assert "Quirbux" not in context


def test_attachment_context_text_file_still_inlined():
    att = AttachmentData(
        type="file",
        name="notes.txt",
        content_base64=base64.b64encode(b"hello world").decode(),
        mime_type="text/plain",
    )
    context = build_attachment_context([att])
    assert "hello world" in context


# ────────────────────────────────
# Planning stream: no binary file parts + session keeps doc texts
# ────────────────────────────────

def _stream_spy(result_text, captured):
    # generate_stream is an async generator: yield directly, don't return one.
    async def fake_generate_stream(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        yield result_text

    return fake_generate_stream


_PLAN_JSON = '{"name": "Cours Zorblax", "description": "d", "chapters": []}'


@pytest.mark.asyncio
async def test_plan_stream_excludes_file_binary_parts_and_saves_texts():
    session = CoursePlanningSessionData(session_uuid="cp_test", org_id=1, language="fr")
    captured = {}

    with patch(
        "src.services.ai.courseplanning.generate_stream",
        side_effect=_stream_spy(_PLAN_JSON, captured),
    ), patch(
        "src.services.ai.courseplanning.save_course_planning_session", return_value=True
    ):
        chunks = [
            c
            async for c in generate_course_plan_stream(
                prompt="Cree un cours depuis ce PDF",
                session=session,
                attachments=[_pdf_attachment()],
            )
        ]

    assert chunks  # stream produced content
    user_prompt = captured["user_prompt"]
    items = [user_prompt] if isinstance(user_prompt, str) else list(user_prompt)
    # No binary document part may be forwarded (text-only providers 400 on them).
    assert all(type(p).__name__ != "BinaryContent" for p in items)
    # The extracted text must ride in the textual prompt.
    assert any("Quirbux" in p for p in items if isinstance(p, str))
    # Session keeps the extracted text for activity content generation.
    assert any("Quirbux" in d.text for d in session.document_texts)


@pytest.mark.asyncio
async def test_plan_stream_keeps_image_parts():
    session = CoursePlanningSessionData(session_uuid="cp_test2", org_id=1, language="fr")
    img_b64 = base64.b64encode(b"\x89PNG fakedata").decode()
    image = AttachmentData(type="image", name="img.png", content_base64=img_b64, mime_type="image/png")
    captured = {}

    with patch(
        "src.services.ai.courseplanning.generate_stream",
        side_effect=_stream_spy(_PLAN_JSON, captured),
    ), patch(
        "src.services.ai.courseplanning.save_course_planning_session", return_value=True
    ):
        _ = [
            c
            async for c in generate_course_plan_stream(
                prompt="Cours avec image", session=session, attachments=[image]
            )
        ]

    items = (
        [captured["user_prompt"]]
        if isinstance(captured["user_prompt"], str)
        else list(captured["user_prompt"])
    )
    assert any(type(p).__name__ == "BinaryContent" for p in items)  # images stay multimodal


# ────────────────────────────────
# Activity content generation uses the stored document texts
# ────────────────────────────────

@pytest.mark.asyncio
async def test_activity_generation_injects_document_texts():
    session = CoursePlanningSessionData(session_uuid="cp_test3", org_id=1, language="fr")
    session.document_texts = [
        DocumentText(name="zorblax.pdf", text="Le Quirbux est une methode de soudure. Taux de Vlork.")
    ]
    captured = {}

    with patch(
        "src.services.ai.courseplanning.generate_stream",
        side_effect=_stream_spy('{"type": "doc", "content": []}', captured),
    ), patch(
        "src.services.ai.courseplanning.save_course_planning_session", return_value=True
    ):
        _ = [
            c
            async for c in generate_activity_content_stream(
                session=session,
                activity_uuid="activity_x",
                activity_name="Le Quirbux",
                activity_description="d",
                chapter_name="c",
                course_name="Zorblax",
                course_description="d",
            )
        ]

    assert "Quirbux" in captured["user_prompt"]
    assert "Vlork" in captured["user_prompt"]


def test_legacy_session_without_document_texts_loads():
    legacy = {"session_uuid": "cp_old", "org_id": 1, "language": "fr"}
    session = CoursePlanningSessionData(**legacy)
    assert session.document_texts == []


# ────────────────────────────────
# Migration suggest_structure reads PDF content
# ────────────────────────────────

def test_suggest_structure_prompt_contains_pdf_content(monkeypatch, tmp_path):
    from src.services.courses.migration import migration_service

    base = tmp_path / "migrations"
    monkeypatch.setattr(migration_service, "_TEMP_BASE_REAL", str(base))

    temp_id = str(uuid4())
    file_id = "22222222-2222-2222-2222-222222222222"
    temp_dir = base / temp_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    (temp_dir / f"{file_id}.pdf").write_bytes(ZORBLAX_PDF_BYTES)
    (temp_dir / "manifest.json").write_text(
        json.dumps(
            {
                "temp_id": temp_id,
                "created_at": "2026-01-01T00:00:00+00:00",
                "files": [
                    {
                        "file_id": file_id,
                        "filename": "zorblax.pdf",
                        "file_type": "application/pdf",
                        "size": len(ZORBLAX_PDF_BYTES),
                        "extension": "pdf",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    payload = {
        "course_name": "Formation Zorblax",
        "course_description": "d",
        "chapters": [
            {
                "name": "C1",
                "activities": [
                    {
                        "name": "A1",
                        "activity_type": "TYPE_DOCUMENT",
                        "activity_sub_type": "SUBTYPE_DOCUMENT_PDF",
                        "file_ids": [file_id],
                    }
                ],
            }
        ],
    }

    captured = {}

    async def fake_generate(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        return json.dumps(payload)

    monkeypatch.setattr("src.services.ai.llm.generate", fake_generate)

    import asyncio

    structure = asyncio.run(
        migration_service.suggest_structure(temp_id=temp_id, course_name="Formation Zorblax")
    )

    assert structure.chapters  # parsed fine
    assert "Quirbux" in captured["user_prompt"]
    assert "Flamwirt" in captured["user_prompt"]
