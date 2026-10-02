"""TypeSafe / Jev integration (https://docs.typesafe.ai).

Jev is a System One judgment model: it answers typed questions (yes/no,
choice, score) with probabilities instead of generating text. In LearnHouse
it powers course-plan auditing during AI course creation — a deterministic
"conventions checklist" would miss semantic gaps (audience unstated,
objectives not actionable, chapters not sequenced); Jev judges those.

Design rules:
- The API key lives in the TYPESAFE_API_KEY env var (never in source).
- Every call is best-effort: on any error the audit degrades to
  {"enabled": false} and course creation is unaffected.
"""

from typing import Any, Dict, List, Optional

import logging
import os

import httpx

logger = logging.getLogger(__name__)

_TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
_JEV_MODEL = "jev-latest"
_TIMEOUT_SECONDS = 20.0

# Yes/no judgments above this probability count as "ok".
_NoulOkThreshold = 0.5


def is_typesafe_enabled() -> bool:
    """TypeSafe/Jev auditing is active only when an API key is configured."""
    return bool(os.environ.get("TYPESAFE_API_KEY", "").strip())


def jev_evaluate(state: Any, questions: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Ask Jev a batch of typed questions about `state`.

    Returns the full response body ({"model", "answers", "usage"}) or None on
    any failure (auth, network, validation, overload). Never raises: auditing
    is an enhancement, not a dependency.
    """
    api_key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not api_key:
        return None

    payload = {"state": state, "model": _JEV_MODEL, "questions": questions}
    try:
        response = httpx.post(
            _TYPESAFE_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:  # noqa: BLE001 — best-effort by contract
        logger.warning("TypeSafe/Jev evaluation failed (audit degraded): %s", e)
        return None


# -----------------------------------------------------------------------------
# Course-plan audit
# -----------------------------------------------------------------------------

# Convention checklist: each entry maps a Jev question id to a human label.
# These mirror the CoursePlan contract (schemas/courseplanning.py) plus the
# information a complete formation description should carry.
_AUDIT_CHECKS: Dict[str, str] = {
    "name_precise": "Nom du cours précis (pas générique)",
    "description_present": "Description du cours renseignée",
    "audience_stated": "Public visé clairement identifié",
    "objectives_actionable": "Objectifs d'apprentissage mesurables",
    "learnings_present": "Acquis pédagogiques exprimés",
    "tags_present": "Mots-clés / tags renseignés",
    "chapters_present": "Au moins un chapitre planifié",
    "chapters_sequenced": "Chapitres dans une progression logique",
    "every_chapter_has_activities": "Chaque chapitre a des activités",
    "every_activity_described": "Chaque activité a une description",
    "duration_evident": "Durée / volume horaire perceptible",
    "prerequisites_addressed": "Prérequis évoqués (ou absence explicitée)",
    "evaluation_present": "Modalités d'évaluation ou de certification présentes",
}

_NEXT_MISSING_CHOICES = ["audience", "objectives", "duration", "prerequisites", "evaluation", "structure", "rien"]
_NEXT_MISSING_RECOMMENDATIONS = {
    "audience": "Précisez à qui s'adresse la formation (métier, niveau, contexte).",
    "objectives": "Formulez des objectifs mesurables : ce que l'apprenant saura faire à la fin.",
    "duration": "Indiquez la durée ou le volume horaire (ex. 3 jours, 6 sessions de 3 h 30).",
    "prerequisites": "Précisez les prérequis, ou indiquez explicitement qu'il n'y en a pas.",
    "evaluation": "Ajoutez les modalités d'évaluation (quiz final, projet, certification).",
    "structure": "Complétez la structure : chapitres avec activités décrites.",
    "rien": "La formation couvre toutes les conventions : vous pouvez finaliser.",
}


def _plan_state(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Extract the plan fields Jev needs, tolerating missing keys."""
    chapters = plan.get("chapters") or []
    return {
        "course_name": plan.get("name", ""),
        "course_description": plan.get("description", ""),
        "learnings": plan.get("learnings", ""),
        "tags": plan.get("tags", ""),
        "chapters": [
            {
                "name": c.get("name", ""),
                "description": c.get("description", ""),
                "activities": [
                    {
                        "name": a.get("name", ""),
                        "type": a.get("type", ""),
                        "description": a.get("description", ""),
                    }
                    for a in (c.get("activities") or [])
                ],
            }
            for c in chapters
        ],
    }


def audit_course_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Audit a CoursePlan against the course-creation conventions with Jev.

    Returns a structured report:
    {
      "enabled": bool,
      "model": str | None,
      "checks": [{id, label, ok, probability}],
      "completeness": {"score": float},
      "next_missing": {"topic": str},
      "recommendation": str,
    }
    Degrades to {"enabled": false} when Jev is unavailable.
    """
    if not is_typesafe_enabled():
        return {
            "enabled": False,
            "checks": [],
            "completeness": {"score": None},
            "next_missing": {"topic": None},
            "recommendation": None,
        }

    questions: Dict[str, Dict[str, Any]] = {
        check_id: {"type": "noul", "instructions": label}
        for check_id, label in _AUDIT_CHECKS.items()
    }
    state = _plan_state(plan)
    questions["completeness_score"] = {
        "type": "score",
        "instructions": (
            "En tant qu'expert pédagogique, évaluez la complétude globale de ce "
            "plan de formation par rapport aux conventions : identification du "
            "public, objectifs mesurables, structure chapitres/activités, durée, "
            "prérequis et évaluation."
        ),
        "criteria": [
            "Plan squelettique : la plupart des conventions manquent",
            "Conventions partiellement couvertes : plusieurs informations clés manquent",
            "Bon niveau : l'essentiel est couvert, quelques précisions manquent",
            "Plan complet et prêt à finaliser",
        ],
    }
    questions["next_missing_topic"] = {
        "type": "choice",
        "instructions": (
            "Quelle information manquante est la plus importante à demander au "
            "concepteur de la formation maintenant ? Si rien de crucial ne "
            "manque, choisissez « rien »."
        ),
        "criteria": {
            topic: _NEXT_MISSING_RECOMMENDATIONS[topic]
            for topic in _NEXT_MISSING_CHOICES
        },
    }

    result = jev_evaluate(state, questions)
    if not result or not result.get("answers"):
        return {
            "enabled": False,
            "checks": [],
            "completeness": {"score": None},
            "next_missing": {"topic": None},
            "recommendation": None,
        }

    answers = result["answers"]
    checks: List[Dict[str, Any]] = []
    for check_id, label in _AUDIT_CHECKS.items():
        answer = answers.get(check_id, {})
        probability = answer.get("noul")
        checks.append(
            {
                "id": check_id,
                "label": label,
                "ok": probability is not None and probability >= _NoulOkThreshold,
                "probability": probability,
            }
        )

    score_answer = answers.get("completeness_score", {})
    raw_score = score_answer.get("score")
    # Normalise the 0..3 level scale to a 0..100 completeness percentage.
    score = None
    if raw_score is not None:
        try:
            score = round(min(max(float(raw_score), 0.0), 3.0) / 3.0 * 100)
        except (TypeError, ValueError):
            score = None

    choice_answer = answers.get("next_missing_topic", {})
    topic = choice_answer.get("choice") or "rien"
    recommendation = _NEXT_MISSING_RECOMMENDATIONS.get(
        topic, _NEXT_MISSING_RECOMMENDATIONS["rien"]
    )

    return {
        "enabled": True,
        "model": result.get("model"),
        "checks": checks,
        "completeness": {"score": score},
        "next_missing": {"topic": topic},
        "recommendation": recommendation,
    }
