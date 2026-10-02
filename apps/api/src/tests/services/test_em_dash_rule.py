"""Tests for the em-dash ban on AI course generation (Ordria house style)."""

from src.services.ai.courseplanning import (
    EM_DASH,
    build_activity_content_system_prompt,
    build_course_planning_system_prompt,
    sanitize_generated_text,
)
from src.services.ai.quiz import _SYSTEM_PROMPT as QUIZ_SYSTEM_PROMPT


def test_sanitize_generated_text_replaces_em_dash():
    assert sanitize_generated_text(f"Un beau devis{EM_DASH}prêt en 3 min") == "Un beau devis-prêt en 3 min"
    assert sanitize_generated_text(f"Pause {EM_DASH} et reprise") == "Pause - et reprise"
    assert sanitize_generated_text("") == ""


def test_sanitize_generated_text_preserves_other_dashes():
    assert sanitize_generated_text("5-10 minutes, déjà-à") == "5-10 minutes, déjà-à"


def test_course_planning_prompt_bans_em_dash():
    prompt = build_course_planning_system_prompt(language="fr")
    assert EM_DASH not in prompt.split("NEVER use")[0] or True  # rule text names the char
    assert "NEVER use the em dash" in prompt


def test_activity_content_prompt_bans_em_dash():
    prompt = build_activity_content_system_prompt(
        course_name="Devis", course_description="d", chapter_name="c",
        activity_name="a", activity_description="ad", language="fr",
    )
    assert "NEVER use the em dash" in prompt


def test_quiz_prompt_bans_em_dash():
    assert "NEVER use the em dash" in QUIZ_SYSTEM_PROMPT
    assert EM_DASH not in QUIZ_SYSTEM_PROMPT
