# Inscription enrichie (Phase 1 Ordria) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collecter à l'inscription (et sur le profil) le métier (liste administrable, obligatoire), le téléphone (optionnel) et deux consentements RGPD horodatés.

**Architecture:** Approche « profil flexible » — les données vivent dans les colonnes JSON existantes du User (`profile`, `extra_metadata`), zéro migration de la table `user`. Une nouvelle table `job_title` (créée automatiquement au boot par `SQLModel.metadata.create_all`, déjà en place dans `connect_to_db`) porte la liste administrable des métiers, seedée idémpotemment au démarrage. La validation serveur est factored dans un module dédié et branchée sur les trois chemins de création d'utilisateur et sur la mise à jour de profil.

**Tech Stack:** FastAPI + SQLModel async (apps/api), Next.js 14 + Formik (apps/web), pytest (fixtures `db`/`org` de `src/tests/conftest.py`).

**Spec:** `docs/superpowers/specs/2026-09-23-inscription-enrichie-design.md`

## Global Constraints

- Aucune migration de la table `user` — interdit d'ajouter des colonnes à `User`.
- La table `job_title` est créée par `create_all` au boot ; le seed doit être idempotent (INSERT seulement si table vide) et exclu des tests (`if not is_testing`).
- Les consentements (`extra_metadata.consents`) sont écrits uniquement à l'inscription, côté serveur (horodatage + `CONSENT_TEXT_VERSION = "2026-09"`), et ne sont jamais modérables via `PUT /users/{id}`.
- Codes d'erreur HTTP 400 : `INVALID_JOB`, `INVALID_PHONE`, `CONSENT_REQUIRED` (dans `detail.code`).
- Structure stockée `profile["job"]` : `{"title_id": int|null, "slug": str, "label": str, "other": str|null}` ; cas « Autre » = `{"title_id": null, "slug": "other", "other": "..."}`.
- Regex téléphone : `^\+?[0-9 .()-]{6,20}$` (après trim).
- Les inscriptions OAuth (`is_oauth=True`) passent SANS validation (le métier leur sera demandé par la bannière douce).
- Frontend : styles avec les variables CSS `--ordria-*` (conventions du formulaire existant), i18n via `t()` avec `defaultValue` français.
- L'endpoint public des métiers ne renvoie QUE les métiers actifs, triés `sort_order` puis `label`.
- Commandes pytest : `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/... -v` (venv du repo).
- ⚠️ Working tree : ~38 fichiers modifiés non commités = seule copie de la prod. Chaque commit N'AJOUTE QUE les fichiers listés dans la tâche — JAMAIS `git add -A`.

---

### Task 1: Modèle `JobTitle` (API)

**Files:**
- Create: `apps/api/src/db/job_titles.py`
- Test: `apps/api/src/tests/services/test_job_titles.py`

**Interfaces:**
- Consumes: fixtures `db` (conftest, SQLite mémoire + `create_all`).
- Produces: `JobTitle` (table), `JobTitleCreate(label: str, slug: str|None, sort_order: int)`, `JobTitleUpdate(label|sort_order|is_active)`, `JobTitleRead(id, label, slug, is_active, sort_order)` — utilisés Tasks 2-3.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/src/tests/services/test_job_titles.py
"""Tests for the job_title model + service (Ordria enriched signup, Phase 1)."""
import pytest

from src.db.job_titles import JobTitle


@pytest.mark.asyncio
async def test_job_title_model_roundtrip(db):
    jt = JobTitle(label="Community Manager", slug="community_manager", sort_order=1)
    db.add(jt)
    await db.commit()
    await db.refresh(jt)

    assert jt.id is not None
    assert jt.is_active is True
    assert jt.slug == "community_manager"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.db.job_titles'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/src/db/job_titles.py
from typing import Optional

from sqlmodel import Field, SQLModel


class JobTitleBase(SQLModel):
    label: str
    slug: str
    is_active: bool = True
    sort_order: int = 0


class JobTitle(JobTitleBase, table=True):
    __table_args__ = {"extend_existing": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: str = ""
    update_date: str = ""


class JobTitleCreate(SQLModel):
    label: str
    slug: Optional[str] = None  # derived from label when omitted
    sort_order: int = 0


class JobTitleUpdate(SQLModel):
    label: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class JobTitleRead(JobTitleBase):
    id: int
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/api/src/db/job_titles.py apps/api/src/tests/services/test_job_titles.py
git commit -m "feat(api): job_title model for enriched signup"
```

---

### Task 2: Service métiers + seed idempotent

**Files:**
- Create: `apps/api/src/services/job_titles/__init__.py` (vide)
- Create: `apps/api/src/services/job_titles/job_titles.py`
- Test: `apps/api/src/tests/services/test_job_titles.py` (append)

**Interfaces:**
- Consumes: `JobTitle`, `JobTitleCreate`, `JobTitleUpdate` (Task 1).
- Produces (utilisés Tasks 3-4) :
  - `slugify_job_title(label: str) -> str`
  - `DEFAULT_JOB_TITLES: list[tuple[str, int]]`
  - `seed_default_job_titles(db_session: AsyncSession) -> int`
  - `list_active_job_titles(db_session) -> list[JobTitle]`
  - `get_job_title_by_id(db_session, job_title_id: int) -> JobTitle | None`
  - `create_job_title(db_session, obj: JobTitleCreate) -> JobTitle` (HTTP 400 si conflit)
  - `update_job_title(db_session, job_title_id, obj: JobTitleUpdate) -> JobTitle` (404 si absent)
  - `deactivate_job_title(db_session, job_title_id) -> JobTitle`

- [ ] **Step 1: Write the failing tests (append au fichier)**

```python
# apps/api/src/tests/services/test_job_titles.py (append)
from src.services.job_titles.job_titles import (
    DEFAULT_JOB_TITLES,
    create_job_title,
    deactivate_job_title,
    list_active_job_titles,
    seed_default_job_titles,
    slugify_job_title,
)
from src.db.job_titles import JobTitleCreate


@pytest.mark.asyncio
async def test_slugify_strips_accents():
    assert slugify_job_title("Responsable e-commerce") == "responsable_e_commerce"
    assert slugify_job_title("Développeur / Développeuse") == "developpeur_developpeuse"


@pytest.mark.asyncio
async def test_seed_is_idempotent(db):
    first = await seed_default_job_titles(db)
    second = await seed_default_job_titles(db)

    assert first == len(DEFAULT_JOB_TITLES)
    assert second == 0  # second boot inserts nothing

    titles = await list_active_job_titles(db)
    assert len(titles) == len(DEFAULT_JOB_TITLES)


@pytest.mark.asyncio
async def test_list_active_excludes_inactive_and_sorts(db):
    await seed_default_job_titles(db)
    await deactivate_job_title(db, 1)  # Community Manager -> inactive

    titles = await list_active_job_titles(db)

    assert all(t.is_active for t in titles)
    assert "community_manager" not in [t.slug for t in titles]
    orders = [t.sort_order for t in titles]
    assert orders == sorted(orders)


@pytest.mark.asyncio
async def test_create_conflict_rejected(db):
    await seed_default_job_titles(db)
    with pytest.raises(Exception) as exc:
        await create_job_title(db, JobTitleCreate(label="Community Manager"))
    assert exc.value.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.services.job_titles'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/src/services/job_titles/__init__.py
(empty file)
```

```python
# apps/api/src/services/job_titles/job_titles.py
import re
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.job_titles import JobTitle, JobTitleCreate, JobTitleUpdate

# (label, sort_order) — catalogue de départ, modifiable par le superadmin.
DEFAULT_JOB_TITLES = [
    ("Community Manager", 1),
    ("Responsable marketing", 2),
    ("Chargé de communication", 3),
    ("Développeur / Développeuse", 4),
    ("Designer UX/UI", 5),
    ("Product Manager", 6),
    ("Chef de projet digital", 7),
    ("Traffic manager", 8),
    ("Graphiste", 9),
    ("Motion designer", 10),
    ("Rédacteur / Rédactrice web", 11),
    ("Consultant SEO", 12),
    ("Consultant data", 13),
    ("Commercial / Commerciale", 14),
    ("Responsable e-commerce", 15),
    ("Assistant(e) de direction", 16),
    ("Dirigeant(e) d'entreprise", 17),
    ("Indépendant / Freelance", 18),
    ("Étudiant(e)", 19),
    ("Demandeur d'emploi", 20),
]


def slugify_job_title(label: str) -> str:
    s = label.strip().lower()
    for accents, plain in (("àâä", "a"), ("éèêë", "e"), ("îï", "i"), ("ôö", "o"), ("ûüù", "u"), ("ç", "c")):
        for ch in accents:
            s = s.replace(ch, plain)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


async def seed_default_job_titles(db_session: AsyncSession) -> int:
    """Insert the default catalog once. Idempotent: safe on every container boot."""
    existing = (await db_session.execute(select(JobTitle).limit(1))).scalars().first()
    if existing:
        return 0
    now = str(datetime.now())
    for label, order in DEFAULT_JOB_TITLES:
        db_session.add(
            JobTitle(
                label=label,
                slug=slugify_job_title(label),
                sort_order=order,
                creation_date=now,
                update_date=now,
            )
        )
    await db_session.commit()
    return len(DEFAULT_JOB_TITLES)


async def list_active_job_titles(db_session: AsyncSession) -> list[JobTitle]:
    statement = (
        select(JobTitle)
        .where(JobTitle.is_active == True)  # noqa: E712
        .order_by(JobTitle.sort_order, JobTitle.label)
    )
    return list((await db_session.execute(statement)).scalars().all())


async def get_job_title_by_id(
    db_session: AsyncSession, job_title_id: int
) -> Optional[JobTitle]:
    return (
        await db_session.execute(select(JobTitle).where(JobTitle.id == job_title_id))
    ).scalars().first()


async def create_job_title(db_session: AsyncSession, obj: JobTitleCreate) -> JobTitle:
    slug = obj.slug or slugify_job_title(obj.label)
    conflict = (
        await db_session.execute(
            select(JobTitle).where(
                (JobTitle.slug == slug) | (JobTitle.label == obj.label.strip())
            )
        )
    ).scalars().first()
    if conflict:
        raise HTTPException(status_code=400, detail="Job title already exists")
    now = str(datetime.now())
    jt = JobTitle(
        label=obj.label.strip(),
        slug=slug,
        sort_order=obj.sort_order,
        creation_date=now,
        update_date=now,
    )
    db_session.add(jt)
    await db_session.commit()
    await db_session.refresh(jt)
    return jt


async def update_job_title(
    db_session: AsyncSession, job_title_id: int, obj: JobTitleUpdate
) -> JobTitle:
    jt = await get_job_title_by_id(db_session, job_title_id)
    if not jt:
        raise HTTPException(status_code=404, detail="Job title not found")
    if obj.label is not None:
        jt.label = obj.label.strip()
        jt.slug = slugify_job_title(jt.label)
    if obj.sort_order is not None:
        jt.sort_order = obj.sort_order
    if obj.is_active is not None:
        jt.is_active = obj.is_active
    jt.update_date = str(datetime.now())
    db_session.add(jt)
    await db_session.commit()
    await db_session.refresh(jt)
    return jt


async def deactivate_job_title(
    db_session: AsyncSession, job_title_id: int
) -> JobTitle:
    return await update_job_title(
        db_session, job_title_id, JobTitleUpdate(is_active=False)
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/api/src/services/job_titles/ apps/api/src/tests/services/test_job_titles.py
git commit -m "feat(api): job titles service with idempotent default seed"
```

---

### Task 3: Router métiers (public + admin CRUD) + montage + seed au boot

**Files:**
- Create: `apps/api/src/routers/job_titles.py`
- Modify: `apps/api/src/router.py` (montage du router)
- Modify: `apps/api/src/core/events/database.py` (appel du seed dans `connect_to_db`)
- Test: `apps/api/src/tests/services/test_job_titles.py` (append)

**Interfaces:**
- Consumes: services Task 2 ; `require_superadmin` (`src/security/superadmin.py:31`) ; `get_db_session`.
- Produces (consommé par le web Tasks 6-7, 11) :
  - `GET /api/v1/job-titles/public` → `list[JobTitleRead]` (sans auth)
  - `POST /api/v1/job-titles/admin` (superadmin) → `JobTitleRead`
  - `PUT /api/v1/job-titles/admin/{job_title_id}` (superadmin) → `JobTitleRead`
  - `DELETE /api/v1/job-titles/admin/{job_title_id}` (superadmin, soft) → `JobTitleRead`

- [ ] **Step 1: Write the failing tests (append)**

```python
# apps/api/src/tests/services/test_job_titles.py (append)
def test_router_declares_public_and_admin_routes():
    from src.routers import job_titles

    paths = {r.path for r in job_titles.router.routes}
    assert "/public" in paths
    assert "/admin" in paths
    assert "/admin/{job_title_id}" in paths


@pytest.mark.asyncio
async def test_admin_guard_rejects_anonymous(db):
    from fastapi import HTTPException

    from src.db.users import AnonymousUser
    from src.security.superadmin import require_superadmin

    with pytest.raises(HTTPException) as exc:
        await require_superadmin(current_user=AnonymousUser(), db_session=db)
    assert exc.value.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.routers.job_titles'`

- [ ] **Step 3: Write the router**

```python
# apps/api/src/routers/job_titles.py
from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.job_titles import JobTitleCreate, JobTitleRead, JobTitleUpdate
from src.security.superadmin import require_superadmin
from src.services.job_titles.job_titles import (
    create_job_title,
    deactivate_job_title,
    list_active_job_titles,
    update_job_title,
)

router = APIRouter()


@router.get(
    "/public",
    response_model=list[JobTitleRead],
    tags=["job-titles"],
    summary="List active job titles (public)",
)
async def api_list_public_job_titles(
    db_session: AsyncSession = Depends(get_db_session),
):
    """Feeds the public signup form — actives only, ordered."""
    return await list_active_job_titles(db_session)


@router.post(
    "/admin",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Create a job title (superadmin)",
)
async def api_create_job_title(
    job_object: JobTitleCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await create_job_title(db_session, job_object)


@router.put(
    "/admin/{job_title_id}",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Update a job title (superadmin)",
)
async def api_update_job_title(
    job_title_id: int,
    job_object: JobTitleUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await update_job_title(db_session, job_title_id, job_object)


@router.delete(
    "/admin/{job_title_id}",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Deactivate a job title (superadmin, soft delete)",
)
async def api_deactivate_job_title(
    job_title_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await deactivate_job_title(db_session, job_title_id)
```

- [ ] **Step 4: Mount the router + seed at boot**

Dans `apps/api/src/router.py`, ajouter à l'import ligne 11 :

```python
from src.routers import dev, trail, users, auth, orgs, roles, search, job_titles
```

Puis juste après le bloc `v1_router.include_router(users.router, ...)` (lignes ~65-70) :

```python
v1_router.include_router(
    job_titles.router,
    prefix="/job-titles",
    tags=["job-titles"],
)
```

Dans `apps/api/src/core/events/database.py`, fonction `connect_to_db` (~ligne 345) : après le bloc `if not is_testing: await conn.run_sync(SQLModel.metadata.create_all)` et avant `app.db_engine = engine`, ajouter :

```python
        # Seed the default job-title catalog once (Ordria enriched signup).
        if not is_testing:
            try:
                from src.services.job_titles.job_titles import seed_default_job_titles

                async with _async_session_factory() as session:
                    await seed_default_job_titles(session)
            except Exception:
                logging.warning(
                    "Could not seed default job titles", exc_info=True
                )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_job_titles.py -v`
Expected: PASS (7 passed)

- [ ] **Step 6: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/api/src/routers/job_titles.py apps/api/src/router.py apps/api/src/core/events/database.py apps/api/src/tests/services/test_job_titles.py
git commit -m "feat(api): public + superadmin job-titles routes, boot seed"
```

---

### Task 4: Validation d'inscription branchée sur les 3 chemins de création

**Files:**
- Create: `apps/api/src/services/users/signup_profile.py`
- Modify: `apps/api/src/services/users/users.py` — `create_user` (:52), `create_user_with_invite` (:195), `create_user_without_org` (:265)
- Test: `apps/api/src/tests/services/test_signup_profile.py` (nouveau)

**Interfaces:**
- Consumes: `JobTitle` (Task 1), services Task 2 ; `UserCreate.profile` / `UserCreate.extra_metadata` (dicts, déjà transportés par le schéma existant).
- Produces :
  - `CONSENT_TEXT_VERSION = "2026-09"` (constante, à bump si les textes légaux changent)
  - `validate_and_normalize_signup_profile(db_session, user_object) -> None` — mut `user_object.profile["job"]` normalisé, `profile["phone"]` trimé, `extra_metadata["consents"]` réécrit côté serveur ; lève `HTTPException 400` `{code, message}` (`INVALID_JOB` / `INVALID_PHONE` / `CONSENT_REQUIRED`)
  - `validate_profile_update(db_session, user_object) -> None` (Task 5)

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/src/tests/services/test_signup_profile.py
"""Validation contract for the Ordria enriched signup (job/phone/consents)."""
import pytest
from fastapi import HTTPException

from src.db.job_titles import JobTitle
from src.db.users import UserCreate
from src.services.job_titles.job_titles import seed_default_job_titles
from src.services.users.signup_profile import (
    CONSENT_TEXT_VERSION,
    validate_and_normalize_signup_profile,
)


def _user(**overrides) -> UserCreate:
    base = dict(
        username="jdoe",
        email="jdoe@example.com",
        password="Str0ng!Pass1",
        first_name="John",
        last_name="Doe",
        profile={},
        extra_metadata={},
    )
    base.update(overrides)
    return UserCreate(**base)


def _consents() -> dict:
    return {"terms": True, "privacy": True}


@pytest.mark.asyncio
async def test_happy_path_with_job_from_list(db):
    await seed_default_job_titles(db)
    jt = (await db.execute(
        __import__("sqlmodel").select(JobTitle).where(JobTitle.slug == "community_manager")
    )).scalars().first()

    user = _user(profile={"job": {"title_id": jt.id}, "phone": " 06 12 34 56 78 "},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)

    assert user.profile["job"] == {
        "title_id": jt.id, "slug": "community_manager",
        "label": "Community Manager", "other": None,
    }
    assert user.profile["phone"] == "06 12 34 56 78"
    for kind in ("terms", "privacy"):
        stamp = user.extra_metadata["consents"][kind]
        assert stamp["accepted"] is True
        assert stamp["version"] == CONSENT_TEXT_VERSION
        assert stamp["accepted_at"]  # server-side ISO timestamp


@pytest.mark.asyncio
async def test_happy_path_with_other_job(db):
    user = _user(profile={"job": {"other": "Architecte 3D"}},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)

    assert user.profile["job"]["slug"] == "other"
    assert user.profile["job"]["other"] == "Architecte 3D"
    assert user.profile["job"]["title_id"] is None


@pytest.mark.asyncio
async def test_missing_job_rejected(db):
    user = _user(extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_JOB"


@pytest.mark.asyncio
async def test_inactive_job_id_rejected(db):
    from src.services.job_titles.job_titles import deactivate_job_title

    await seed_default_job_titles(db)
    await deactivate_job_title(db, 1)

    user = _user(profile={"job": {"title_id": 1}},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_JOB"


@pytest.mark.asyncio
async def test_missing_consents_rejected(db):
    await seed_default_job_titles(db)
    user = _user(profile={"job": {"other": "Freelance"}},
                 extra_metadata={"consents": {"terms": True}})  # privacy absent
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "CONSENT_REQUIRED"


@pytest.mark.asyncio
async def test_invalid_phone_rejected(db):
    user = _user(profile={"job": {"other": "Freelance"}, "phone": "abc"},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_PHONE"


@pytest.mark.asyncio
async def test_empty_job_other_rejected(db):
    user = _user(profile={"job": {"other": "   "}},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_JOB"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_signup_profile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.services.users.signup_profile'`

- [ ] **Step 3: Write the validation module**

```python
# apps/api/src/services/users/signup_profile.py
"""Ordria enriched-signup contract: job (required), phone (optional), RGPD consents.

Storage (spec 2026-09-23):
  profile["job"]   {"title_id": int|None, "slug": str, "label": str, "other": str|None}
  profile["phone"] str | None
  extra_metadata["consents"]["terms"|"privacy"] =
      {"accepted": True, "accepted_at": <server ISO>, "version": CONSENT_TEXT_VERSION}
"""
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.job_titles import JobTitle

# Bump when the CGV / privacy texts change materially so new consents carry
# the new version (old consents keep their historical version — proof trail).
CONSENT_TEXT_VERSION = "2026-09"

PHONE_REGEX = re.compile(r"^\+?[0-9 .()-]{6,20}$")
OTHER_JOB_SLUG = "other"


def _http(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": code, "message": message})


async def _resolve_job(db_session: AsyncSession, job: Any) -> Optional[dict]:
    if not isinstance(job, dict):
        return None
    title_id = job.get("title_id")
    other = job.get("other")
    other = other.strip() if isinstance(other, str) else ""

    if title_id is not None:
        jt = (
            await db_session.execute(
                select(JobTitle).where(
                    JobTitle.id == int(title_id),
                    JobTitle.is_active == True,  # noqa: E712
                )
            )
        ).scalars().first()
        if not jt:
            raise _http("INVALID_JOB", "Unknown or inactive job title")
        return {"title_id": jt.id, "slug": jt.slug, "label": jt.label, "other": None}

    if other:
        if len(other) > 100:
            raise _http("INVALID_JOB", "Job 'other' must be at most 100 characters")
        return {"title_id": None, "slug": OTHER_JOB_SLUG, "other": other}
    return None


def _consent_stamp() -> dict:
    return {
        "accepted": True,
        "accepted_at": datetime.now(timezone.utc).isoformat(),
        "version": CONSENT_TEXT_VERSION,
    }


async def validate_and_normalize_signup_profile(
    db_session: AsyncSession, user_object
) -> None:
    """Enforce the enriched-signup contract. Mutates user_object in place."""
    profile = dict(user_object.profile or {})
    extra = dict(user_object.extra_metadata or {})

    job = await _resolve_job(db_session, profile.get("job"))
    if job is None:
        raise _http("INVALID_JOB", "A job title is required at signup")
    profile["job"] = job

    phone = profile.get("phone")
    if phone is not None:
        phone = str(phone).strip()
        if phone and not PHONE_REGEX.match(phone):
            raise _http("INVALID_PHONE", "Phone number format is invalid")
        profile["phone"] = phone or None

    raw = extra.get("consents")
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("terms") is not True or raw.get("privacy") is not True:
        raise _http("CONSENT_REQUIRED", "Terms and privacy consents are required")
    extra["consents"] = {"terms": _consent_stamp(), "privacy": _consent_stamp()}

    user_object.profile = profile
    user_object.extra_metadata = extra


async def validate_profile_update(db_session: AsyncSession, user_object) -> None:
    """Validate job/phone on profile updates. Consents are never touched here."""
    profile = dict(user_object.profile or {})
    if profile.get("job") is not None:
        job = await _resolve_job(db_session, profile.get("job"))
        if job is None:
            raise _http("INVALID_JOB", "Job title is invalid")
        profile["job"] = job
    if profile.get("phone") is not None:
        phone = str(profile["phone"]).strip()
        if phone and not PHONE_REGEX.match(phone):
            raise _http("INVALID_PHONE", "Phone number format is invalid")
        profile["phone"] = phone or None
    user_object.profile = profile
```

- [ ] **Step 4: Wire into the three creation paths**

Dans `apps/api/src/services/users/users.py`, ajouter l'import en tête :

```python
from src.services.users.signup_profile import (
    validate_and_normalize_signup_profile,
)
```

Dans `create_user` (:52) — insérer juste APRÈS le bloc de validation du mot de passe (après le `if user_object.password and not is_oauth: ...`, ~ligne 73) :

```python
    # Ordria enriched signup: job (required) + phone (optional) + RGPD consents.
    # OAuth signups skip the requirement — the soft banner collects the job later.
    if not is_oauth:
        await validate_and_normalize_signup_profile(db_session, user_object)
```

Dans `create_user_with_invite` (:195) — même insertion juste après la validation du mot de passe (repérer le bloc `validate_password_complexity` équivalent, avant `user = User.model_validate(user_object)`) :

```python
    if not is_oauth:
        await validate_and_normalize_signup_profile(db_session, user_object)
```

Dans `create_user_without_org` (:265) — même insertion au même repère :

```python
    if not is_oauth:
        await validate_and_normalize_signup_profile(db_session, user_object)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_signup_profile.py src/tests/services/test_job_titles.py -v`
Expected: PASS (15 passed)

- [ ] **Step 6: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/api/src/services/users/signup_profile.py apps/api/src/services/users/users.py apps/api/src/tests/services/test_signup_profile.py
git commit -m "feat(api): enforce job/phone/consent contract on all signup paths"
```

---

### Task 5: `update_user` — merge profil + consents protégés

**Files:**
- Modify: `apps/api/src/services/users/users.py:353-410` (`update_user`)
- Test: `apps/api/src/tests/services/test_signup_profile.py` (append)

**Interfaces:**
- Consumes: `validate_profile_update` (Task 4).
- Produces: `PUT /api/v1/users/{id}` accepte `profile.job` / `profile.phone` éditables ; `profile` est MERGÉ (les clés absentes conservent la valeur existante) ; `extra_metadata.consents` est ignoré (jamais écrasé ni supprimé).

- [ ] **Step 1: Write the failing tests (append)**

```python
# apps/api/src/tests/services/test_signup_profile.py (append)
from src.services.users.signup_profile import validate_profile_update
from src.db.users import UserUpdate


@pytest.mark.asyncio
async def test_update_validates_bad_phone(db):
    await seed_default_job_titles(db)
    user = UserUpdate(
        username="jdoe", email="jdoe@example.com",
        profile={"phone": "not-a-phone"},
    )
    with pytest.raises(HTTPException) as exc:
        await validate_profile_update(db, user)
    assert exc.value.detail["code"] == "INVALID_PHONE"


@pytest.mark.asyncio
async def test_update_accepts_valid_job_change(db):
    await seed_default_job_titles(db)
    from sqlmodel import select
    from src.db.job_titles import JobTitle as JT

    jt = (await db.execute(select(JT).where(JT.slug == "designer_ux_ui"))).scalars().first()
    user = UserUpdate(
        username="jdoe", email="jdoe@example.com",
        profile={"job": {"title_id": jt.id}},
    )
    await validate_profile_update(db, user)
    assert user.profile["job"]["slug"] == "designer_ux_ui"
```

- [ ] **Step 2: Run tests to verify current state**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_signup_profile.py -v`
Expected: PASS — ces deux tests couvrent le module déjà écrit en Task 4 ; le garde-fou réel de cette tâche est le merge de `update_user` (Step 3) validé par la suite complète du Step 4.

- [ ] **Step 3: Merge semantics dans `update_user`**

Dans `apps/api/src/services/users/users.py`, fonction `update_user`, remplacer le segment entre le contrôle de conflit email/username et la boucle `for key, value in user_data.items():` par :

```python
    # Ordria: profile is a JSON column replaced wholesale — merge instead so a
    # partial update never wipes the signup-collected job/phone, and so the
    # RGPD consents (extra_metadata.consents) stay append-only (set at signup).
    user_data = user_object.model_dump(exclude_unset=True)

    if "profile" in user_data:
        merged_profile = dict(user.profile or {})
        merged_profile.update(user_data["profile"] or {})
        user_data["profile"] = merged_profile
        user_object.profile = merged_profile  # validator sees the merged view

    if "extra_metadata" in user_data:
        merged_extra = dict(user.extra_metadata or {})
        incoming_extra = dict(user_data["extra_metadata"] or {})
        incoming_extra.pop("consents", None)  # consents are never editable here
        merged_extra.update(incoming_extra)
        user_data["extra_metadata"] = merged_extra

    await validate_profile_update(db_session, user_object)
```

(Le bloc original `user_data = user_object.model_dump(exclude_unset=True)` situé plus haut est supprimé — remplacé par celui-ci ; les lignes sur l'email re-verification et `_PROTECTED_FIELDS` restent inchangées, placées après.)

- [ ] **Step 4: Run full API user tests**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests/services/test_signup_profile.py src/tests/services/test_job_titles.py -v && .venv/bin/python -m pytest src/tests -k "user" -v --timeout=120 | tail -20`
Expected: PASS — aucune regression sur les tests users existants.

- [ ] **Step 5: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/api/src/services/users/users.py apps/api/src/tests/services/test_signup_profile.py
git commit -m "feat(api): merge-safe profile update, consents append-only"
```

---

### Task 6: Web — service fetch métiers + types

**Files:**
- Create: `apps/web/services/users/jobTitles.ts`
- Modify: `apps/web/services/auth/auth.ts:211` (`NewAccountBody`)

**Interfaces:**
- Consumes: `GET /api/v1/job-titles/public` (Task 3).
- Produces :
  - `JobTitle { id: number; label: string; slug: string; is_active: boolean; sort_order: number }`
  - `getPublicJobTitles(): Promise<JobTitle[]>` — dégrade en `[]` si l'API échoue (le formulaire affichera alors seulement « Autre »)
  - `NewAccountBody` étendu de `profile?: Record<string, unknown>` et `extra_metadata?: Record<string, unknown>`

- [ ] **Step 1: Create the service**

```typescript
// apps/web/services/users/jobTitles.ts
'use server'
import { getAPIUrl } from '@services/config/config'
import { secureFetch } from '@services/utils/ts/requests'

export interface JobTitle {
  id: number
  label: string
  slug: string
  is_active: boolean
  sort_order: number
}

export async function getPublicJobTitles(): Promise<JobTitle[]> {
  try {
    const res = await secureFetch(
      `${getAPIUrl()}job-titles/public`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      } as RequestInit
    )
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    // Graceful degradation: signup form falls back to "Other" only.
    return []
  }
}
```

- [ ] **Step 2: Extend `NewAccountBody`**

Dans `apps/web/services/auth/auth.ts`, interface `NewAccountBody` (:211) — ajouter à la fin :

```typescript
  // Ordria enriched signup — forwarded as-is by the /api/signup gateway.
  profile?: Record<string, unknown>
  extra_metadata?: Record<string, unknown>
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/anthonybailly/learnhouse/apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | tail -5`
Expected: aucune erreur sur les fichiers touchés (le piège TS5101 exige `--ignoreDeprecations 6.0`).

- [ ] **Step 4: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/services/users/jobTitles.ts apps/web/services/auth/auth.ts
git commit -m "feat(web): public job titles service + signup payload types"
```

---

### Task 7: Web — formulaire OpenSignup enrichi

**Files:**
- Modify: `apps/web/app/auth/signup/OpenSignup.tsx`

**Interfaces:**
- Consumes: `getPublicJobTitles`, `JobTitle` (Task 6) ; `signup()` (inchangé — le gateway `app/api/signup/route.ts` transmet `...rest`, donc `profile`/`extra_metadata` passent sans modification du gateway).

- [ ] **Step 1: State + fetch des métiers**

Dans `OpenSignup.tsx`, imports additionnels :

```typescript
import { getPublicJobTitles, type JobTitle } from '@services/users/jobTitles'
```

Dans le composant, après `const turnstileRequired = useTurnstileRequired()` :

```typescript
  const [jobTitles, setJobTitles] = React.useState<JobTitle[]>([])

  React.useEffect(() => {
    let cancelled = false
    getPublicJobTitles().then((titles) => {
      if (!cancelled) setJobTitles(titles)
    })
    return () => {
      cancelled = true
    }
  }, [])
```

- [ ] **Step 2: initialValues + validation formik**

`initialValues` — ajouter :

```typescript
      jobTitleId: '' as string | '',
      jobOther: '',
      phone: '',
      consentTerms: false,
      consentPrivacy: false,
```

Dans `validate(values, t)` — ajouter avant `return errors` :

```typescript
  if (!values.jobTitleId) {
    errors.jobTitleId = t('signup.job_required', { defaultValue: 'Veuillez choisir votre métier' })
  }
  if (values.jobTitleId === 'other' && !values.jobOther?.trim()) {
    errors.jobOther = t('validation.required', { defaultValue: 'Requis' })
  }
  if (values.phone && !/^\+?[0-9 .()-]{6,20}$/.test(values.phone.trim())) {
    errors.phone = t('signup.invalid_phone', { defaultValue: 'Numéro invalide' })
  }
  if (!values.consentTerms || !values.consentPrivacy) {
    errors.consentTerms = t('signup.consent_required', { defaultValue: 'Vous devez accepter pour continuer' })
  }
```

- [ ] **Step 3: Construire `profile`/`extra_metadata` au submit**

Dans `onSubmit`, avant `let res = await signup(values)` :

```typescript
      const selectedJob = jobTitles.find((j) => String(j.id) === values.jobTitleId)
      const profile: Record<string, unknown> = {
        job: selectedJob
          ? { title_id: selectedJob.id, slug: selectedJob.slug, label: selectedJob.label, other: null }
          : { title_id: null, slug: 'other', other: values.jobOther?.trim() || null },
      }
      if (values.phone?.trim()) {
        profile['phone'] = values.phone.trim()
      }
      const payload = {
        ...values,
        profile,
        extra_metadata: { consents: { terms: true, privacy: true } },
      }
      let res = await signup(payload)
```

- [ ] **Step 4: Rendu des nouveaux champs**

Insérer après le champ `username` (avant `<FormField name="bio">`) :

```tsx
          <FormField name="jobTitleId">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {t('signup.job_label', { defaultValue: 'Votre métier' })}
              </Form.Label>
              {formik.touched.jobTitleId && formik.errors.jobTitleId && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.jobTitleId}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <select
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.jobTitleId}
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all text-sm"
              >
                <option value="">{t('signup.job_choose', { defaultValue: 'Choisir…' })}</option>
                {jobTitles.map((j) => (
                  <option key={j.id} value={String(j.id)}>{j.label}</option>
                ))}
                <option value="other">{t('signup.job_other', { defaultValue: 'Autre' })}</option>
              </select>
            </Form.Control>
          </FormField>

          {formik.values.jobTitleId === 'other' && (
            <FormField name="jobOther">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                  {t('signup.job_other_precise', { defaultValue: 'Précisez (facultatif)' })}
                </Form.Label>
                {formik.touched.jobOther && formik.errors.jobOther && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.jobOther}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.jobOther}
                  type="text"
                  maxLength={100}
                  className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
                />
              </Form.Control>
            </FormField>
          )}

          <FormField name="phone">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {`${t('signup.phone_label', { defaultValue: 'Téléphone' })} (${t('common.optional', { defaultValue: 'facultatif' })})`}
              </Form.Label>
              {formik.touched.phone && formik.errors.phone && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.phone}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.phone}
                type="tel"
                autoComplete="tel"
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
          </FormField>

          <div className="space-y-2 my-2">
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentTerms}
                onChange={formik.handleChange}
                name="consentTerms"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_terms', { defaultValue: "J'accepte les" })}{' '}
                <a href="https://ordria.fr/cgv" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_terms_link', { defaultValue: 'conditions générales' })}
                </a>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentPrivacy}
                onChange={formik.handleChange}
                name="consentPrivacy"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_privacy', { defaultValue: "J'accepte la" })}{' '}
                <a href="https://ordria.fr/mentions-legales" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_privacy_link', { defaultValue: 'politique de confidentialité' })}
                </a>
              </span>
            </label>
            {formik.touched.consentTerms && formik.errors.consentTerms && (
              <p className="text-red-500 text-xs">{formik.errors.consentTerms}</p>
            )}
          </div>
```

Bouton submit — durcir la condition `disabled` :

```tsx
disabled={isSubmitting || !!message || (turnstileRequired && !formik.values.turnstileToken) || !formik.values.jobTitleId || !formik.values.consentTerms || !formik.values.consentPrivacy}
```

- [ ] **Step 5: Vérification manuelle (dev local)**

Run: stack locale docker (learnhouse-db-dev/redis-dev) + `cd apps/web && npm run dev` → ouvrir `http://localhost:1338/org/<slug>/signup` (admin@school.dev/Test1234! pour créer un org de test si besoin).
Vérifier : le select se remplit, « Autre » révèle le champ, téléphone facultatif, cases bloquent le bouton, inscription OK puis refus serveur en retoirant `profile` via devtools network (facultatif).
Screenshot: `screenshots/phase1-opensignup.png`.

- [ ] **Step 6: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/app/auth/signup/OpenSignup.tsx
git commit -m "feat(web): enriched open signup form (job/phone/consents)"
```

---

### Task 8: Web — formulaire InviteOnlySignUp enrichi

**Files:**
- Modify: `apps/web/app/auth/signup/InviteOnlySignUp.tsx`

**Interfaces:**
- Consumes: `getPublicJobTitles`, `JobTitle` (Task 6) ; `signUpWithInviteCode` (gateway — transmet `...rest`).

- [ ] **Step 1: State + fetch des métiers**

Import additionnel :

```typescript
import { getPublicJobTitles, type JobTitle } from '@services/users/jobTitles'
```

Dans le composant, state + effet :

```typescript
  const [jobTitles, setJobTitles] = React.useState<JobTitle[]>([])

  React.useEffect(() => {
    let cancelled = false
    getPublicJobTitles().then((titles) => {
      if (!cancelled) setJobTitles(titles)
    })
    return () => {
      cancelled = true
    }
  }, [])
```

- [ ] **Step 2: initialValues + validation**

`initialValues` du Formik — ajouter :

```typescript
      jobTitleId: '',
      jobOther: '',
      phone: '',
      consentTerms: false,
      consentPrivacy: false,
```

Dans `validate(values, t)` — ajouter avant `return errors` :

```typescript
  if (!values.jobTitleId) {
    errors.jobTitleId = t('signup.job_required', { defaultValue: 'Veuillez choisir votre métier' })
  }
  if (values.jobTitleId === 'other' && !values.jobOther?.trim()) {
    errors.jobOther = t('validation.required', { defaultValue: 'Requis' })
  }
  if (values.phone && !/^\+?[0-9 .()-]{6,20}$/.test(values.phone.trim())) {
    errors.phone = t('signup.invalid_phone', { defaultValue: 'Numéro invalide' })
  }
  if (!values.consentTerms || !values.consentPrivacy) {
    errors.consentTerms = t('signup.consent_required', { defaultValue: 'Vous devez accepter pour continuer' })
  }
```

- [ ] **Step 3: Construire le payload au submit**

Avant l'appel `signUpWithInviteCode(...)` du `onSubmit` :

```typescript
      const selectedJob = jobTitles.find((j) => String(j.id) === values.jobTitleId)
      const profile: Record<string, unknown> = {
        job: selectedJob
          ? { title_id: selectedJob.id, slug: selectedJob.slug, label: selectedJob.label, other: null }
          : { title_id: null, slug: 'other', other: values.jobOther?.trim() || null },
      }
      if (values.phone?.trim()) {
        profile['phone'] = values.phone.trim()
      }
      const payload = {
        ...values,
        profile,
        extra_metadata: { consents: { terms: true, privacy: true } },
      }
```

Puis remplacer l'appel par `signUpWithInviteCode(payload, inviteCode)`.

- [ ] **Step 4: Rendu des nouveaux champs**

Insérer le même bloc JSX que la Task 7 Step 4 (select métier + champ « Précisez » conditionnel + téléphone + deux cases de consentement avec liens ordria.fr), au-dessus du bouton de soumission, et durcir le `disabled` du bouton :

```tsx
disabled={isSubmitting || !!message || (turnstileRequired && !formik.values.turnstileToken) || !formik.values.jobTitleId || !formik.values.consentTerms || !formik.values.consentPrivacy}
```

Bloc JSX complet à insérer (identique à Task 7 Step 4 — copier tel quel) :

```tsx
          <FormField name="jobTitleId">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {t('signup.job_label', { defaultValue: 'Votre métier' })}
              </Form.Label>
              {formik.touched.jobTitleId && formik.errors.jobTitleId && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.jobTitleId}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <select
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.jobTitleId}
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all text-sm"
              >
                <option value="">{t('signup.job_choose', { defaultValue: 'Choisir…' })}</option>
                {jobTitles.map((j) => (
                  <option key={j.id} value={String(j.id)}>{j.label}</option>
                ))}
                <option value="other">{t('signup.job_other', { defaultValue: 'Autre' })}</option>
              </select>
            </Form.Control>
          </FormField>

          {formik.values.jobTitleId === 'other' && (
            <FormField name="jobOther">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                  {t('signup.job_other_precise', { defaultValue: 'Précisez (facultatif)' })}
                </Form.Label>
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.jobOther}
                  type="text"
                  maxLength={100}
                  className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
                />
              </Form.Control>
            </FormField>
          )}

          <FormField name="phone">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {`${t('signup.phone_label', { defaultValue: 'Téléphone' })} (${t('common.optional', { defaultValue: 'facultatif' })})`}
              </Form.Label>
              {formik.touched.phone && formik.errors.phone && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.phone}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.phone}
                type="tel"
                autoComplete="tel"
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
          </FormField>

          <div className="space-y-2 my-2">
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentTerms}
                onChange={formik.handleChange}
                name="consentTerms"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_terms', { defaultValue: "J'accepte les" })}{' '}
                <a href="https://ordria.fr/cgv" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_terms_link', { defaultValue: 'conditions générales' })}
                </a>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentPrivacy}
                onChange={formik.handleChange}
                name="consentPrivacy"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_privacy', { defaultValue: "J'accepte la" })}{' '}
                <a href="https://ordria.fr/mentions-legales" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_privacy_link', { defaultValue: 'politique de confidentialité' })}
                </a>
              </span>
            </label>
            {formik.touched.consentTerms && formik.errors.consentTerms && (
              <p className="text-red-500 text-xs">{formik.errors.consentTerms}</p>
            )}
          </div>
```

- [ ] **Step 5: Typecheck + vérification manuelle + commit**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | tail -5` → aucune erreur.
Manuel (facultatif si pas d'org inviteOnly sous la main) : passer une org en inviteOnly via l'admin et dérouler le formulaire.

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/app/auth/signup/InviteOnlySignUp.tsx
git commit -m "feat(web): enriched invite-only signup form"
```

---

### Task 9: Web — profil éditable (métier + téléphone)

**Files:**
- Modify: `apps/web/components/Objects/Account/subpages/AccountGeneral.tsx`

**Interfaces:**
- Consumes: `getPublicJobTitles` (Task 6) ; `updateProfile` (service existant du fichier) ; `PUT /users/{id}` accepte `profile.job`/`profile.phone` (Task 5).

- [ ] **Step 1: Champs dans le formulaire AccountGeneral**

Dans `AccountGeneral.tsx` : importer `getPublicJobTitles, type JobTitle` ; state `const [jobTitles, setJobTitles] = React.useState<JobTitle[]>([])` + `useEffect` de chargement (identique à Task 7 Step 1).

Dans les `initialValues` du Formik du fichier, ajouter :

```typescript
      jobTitleId: user?.profile?.job?.title_id ? String(user.profile.job.title_id) : '',
      jobOther: user?.profile?.job?.other || '',
      phone: user?.profile?.phone || '',
```

Dans le `onSubmit` existant (là où le payload `updateProfile` est construit), fusionner :

```typescript
      const selectedJob = jobTitles.find((j) => String(j.id) === values.jobTitleId)
      const job = selectedJob
        ? { title_id: selectedJob.id, slug: selectedJob.slug, label: selectedJob.label, other: null }
        : values.jobOther?.trim()
          ? { title_id: null, slug: 'other', other: values.jobOther.trim() }
          : null
      const profile = { ...(user?.profile || {}) }
      if (job) profile.job = job
      if (values.phone?.trim()) profile.phone = values.phone.trim()
      // pass `profile` in the updateProfile payload alongside existing fields
```

- [ ] **Step 2: JSX — deux champs (même style shadcn/ui que le fichier : `Label` + `Input`/`Select`)**

Ajouter dans la grille du formulaire (à côté des champs existants) :

```tsx
        <div className="space-y-2">
          <Label htmlFor="jobTitleId">
            {t('signup.job_label', { defaultValue: 'Votre métier' })}
          </Label>
          <select
            id="jobTitleId"
            value={values.jobTitleId}
            onChange={handleChange}
            onBlur={handleBlur}
            className="w-full h-10 rounded-md border border-gray-200 bg-white px-3 text-sm"
          >
            <option value="">{t('signup.job_choose', { defaultValue: 'Choisir…' })}</option>
            {jobTitles.map((j) => (
              <option key={j.id} value={String(j.id)}>{j.label}</option>
            ))}
            <option value="other">{t('signup.job_other', { defaultValue: 'Autre' })}</option>
          </select>
        </div>
        {values.jobTitleId === 'other' && (
          <div className="space-y-2">
            <Label htmlFor="jobOther">
              {t('signup.job_other_precise', { defaultValue: 'Précisez (facultatif)' })}
            </Label>
            <Input id="jobOther" value={values.jobOther} onChange={handleChange} onBlur={handleBlur} maxLength={100} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="phone">
            {`${t('signup.phone_label', { defaultValue: 'Téléphone' })} (${t('common.optional', { defaultValue: 'facultatif' })})`}
          </Label>
          <Input id="phone" type="tel" value={values.phone} onChange={handleChange} onBlur={handleBlur} />
        </div>
```

- [ ] **Step 3: Typecheck + manuel + commit**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | tail -5` → OK.
Manuel : page profil → changer métier → recharger → persisté ; le job saisi à l'inscription apparaît pré-rempli.

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/components/Objects/Account/subpages/AccountGeneral.tsx
git commit -m "feat(web): editable job + phone on account profile"
```

---

### Task 10: Web — métier/téléphone visibles dans la fiche membre (admin org)

**Files:**
- Modify: `apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx` (table des membres, ~ligne 521-530)

**Interfaces:**
- Consumes: l'API membres renvoie déjà `UserRead` (qui porte `profile`) — aucun changement API.
- Produces: sous le nom/email de chaque membre, une ligne discrète « Métier · Téléphone » quand disponible.

- [ ] **Step 1: Ajouter la ligne métier/téléphone**

Dans `OrgUsers.tsx`, repérer la cellule qui affiche le nom (~ligne 521 : `{user.user.first_name + ' ' + user.user.last_name}`) puis l'email (~ligne 527-530 : `{user.user.email && (...)}`). Juste après le bloc email, ajouter :

```tsx
                              {(user.user.profile?.job?.label || user.user.profile?.job?.other || user.user.profile?.phone) && (
                                <div className="text-xs text-gray-400 flex items-center gap-1.5 mt-0.5">
                                  {user.user.profile?.job?.label && (
                                    <span>{user.user.profile.job.label}</span>
                                  )}
                                  {user.user.profile?.job?.other && !user.user.profile?.job?.label && (
                                    <span>{user.user.profile.job.other}</span>
                                  )}
                                  {user.user.profile?.phone && (
                                    <span>· {user.user.profile.phone}</span>
                                  )}
                                </div>
                              )}
```

- [ ] **Step 2: Vérification manuelle**

Page Dashboard org → Users : un membre inscrit via le nouveau formulaire affiche son métier (et téléphone si renseigné) ; un ancien membre sans métier n'affiche rien.

- [ ] **Step 3: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx
git commit -m "feat(web): show job/phone in org members list"
```

---

### Task 11: Web — bannière douce « Complétez votre profil »

**Files:**
- Create: `apps/web/components/Objects/Badges/CompleteProfileBanner.tsx`
- Modify: `apps/web/app/orgs/[orgslug]/(withmenu)/layout.tsx` (montage)

**Interfaces:**
- Consumes: `useLHSession` (session user), `user.profile.job`.
- Produces: bannière non bloquante, fermable par session (`sessionStorage`), lien vers les réglages profil.

- [ ] **Step 1: Create the component**

```tsx
// apps/web/components/Objects/Badges/CompleteProfileBanner.tsx
'use client'
import React from 'react'
import Link from 'next/link'
import { Briefcase, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

const DISMISS_KEY = 'lh_profile_job_dismissed'

export function CompleteProfileBanner({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const { data: session } = useLHSession() as any
  const [dismissed, setDismissed] = React.useState(true)

  React.useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  // Show only for logged-in users whose profile has no job yet (OAuth-era
  // accounts and pre-Phase-1 accounts). Never blocking.
  const user = session?.user
  const hasJob = !!user?.profile?.job
  if (!user || hasJob || dismissed) return null

  return (
    <div className="w-full bg-[var(--ordria-accent)]/10 border-b border-[var(--ordria-accent)]/30">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <Briefcase size={16} className="text-[var(--ordria-accent)] shrink-0" />
        <p className="grow text-sm text-[var(--ordria-foreground)]">
          {t('signup.complete_profile_banner', {
            defaultValue: 'Complétez votre profil — indiquez votre métier pour des recommandations sur mesure.',
          })}
        </p>
        <Link
          href={`/${orgslug}/account/general`}
          onClick={() => sessionStorage.setItem(DISMISS_KEY, '1')}
          className="text-xs font-bold text-[var(--ordria-accent)] hover:underline shrink-0"
        >
          {t('signup.complete_profile_cta', { defaultValue: 'Compléter' })}
        </Link>
        <button
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1')
            setDismissed(true)
          }}
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
          className="text-[var(--ordria-muted)] hover:text-[var(--ordria-foreground)] shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default CompleteProfileBanner
```

- [ ] **Step 2: Montage dans le layout learner**

Dans `apps/web/app/orgs/[orgslug]/(withmenu)/layout.tsx` : importer le composant et le rendre en tout premier enfant du conteneur principal (au-dessus du header/menu), en lui passant le `orgslug` du paramètre de route. Exemple d'insertion minimal (conserver la structure existante du fichier) :

```tsx
import CompleteProfileBanner from '@components/Objects/Badges/CompleteProfileBanner'
// ...dans le JSX du layout, premier élément :
<CompleteProfileBanner orgslug={params.orgslug} />
```

- [ ] **Step 3: Vérification manuelle + commit**

Manuel : compte ancien sans métier → bannière visible, fermable, lien fonctionne ; compte avec métier → absente.
Screenshot: `screenshots/phase1-banner.png`.

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/components/Objects/Badges/CompleteProfileBanner.tsx "apps/web/app/orgs/[orgslug]/(withmenu)/layout.tsx"
git commit -m "feat(web): soft complete-profile banner for jobless accounts"
```

---

### Task 12: Web — page admin superadmin des métiers

**Files:**
- Create: `apps/web/components/Admin/JobTitleList.tsx`
- Create: `apps/web/app/admin/(dashboard)/job-titles/page.tsx`
- Modify: `apps/web/components/Admin/AdminLeftMenu.tsx` (entrée de menu)

**Interfaces:**
- Consumes: routes admin Task 3 ; session superadmin (`/admin` garde l'accès).
- Produces: page `…/admin/job-titles` (liste + création + renommage + désactivation).

- [ ] **Step 1: Create the list component**

```tsx
// apps/web/components/Admin/JobTitleList.tsx
'use client'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { toast } from 'react-hot-toast'

interface JobTitle {
  id: number
  label: string
  slug: string
  is_active: boolean
  sort_order: number
}

export default function JobTitleList() {
  const { data: session } = useLHSession() as any
  const token = session?.tokens?.access_token
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = React.useState('')

  const { data: titles, isLoading } = useQuery<JobTitle[]>({
    queryKey: ['admin', 'job-titles'],
    queryFn: async () => {
      // Admin listing = public listing (actives) + deactivated ones are hidden
      // from signup anyway; for the admin table we fetch the public list.
      const res = await fetch(`${getAPIUrl()}job-titles/public`)
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await fetch(`${getAPIUrl()}job-titles/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Métier ajouté')
      setNewLabel('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'job-titles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${getAPIUrl()}job-titles/admin/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Métier désactivé')
      queryClient.invalidateQueries({ queryKey: ['admin', 'job-titles'] })
    },
    onError: () => toast.error('Échec de la désactivation'),
  })

  if (isLoading) return <p className="text-white/40">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nouveau métier (ex. Data Analyst)"
          className="bg-white/5 border-white/10 text-white max-w-sm"
        />
        <Button
          onClick={() => newLabel.trim() && createMutation.mutate(newLabel.trim())}
          disabled={!newLabel.trim() || createMutation.isPending}
        >
          Ajouter
        </Button>
      </div>

      <div className="rounded-lg border border-white/10 divide-y divide-white/5">
        {(titles || []).map((jt) => (
          <div key={jt.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-white font-medium text-sm">{jt.label}</p>
              <p className="text-white/30 text-xs">{jt.slug}</p>
            </div>
            <Button
              variant="ghost"
              className="text-red-400 hover:text-red-300 text-xs"
              onClick={() => deactivateMutation.mutate(jt.id)}
            >
              Désactiver
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the page**

```tsx
// apps/web/app/admin/(dashboard)/job-titles/page.tsx
import React from 'react'
import type { Metadata } from 'next'
import JobTitleList from '@components/Admin/JobTitleList'

export const metadata: Metadata = {
  title: 'Job titles',
}

export default function AdminJobTitlesPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Job titles</h1>
        <p className="text-white/40 mt-1">
          Catalogue des métiers proposés à l'inscription (global à la plateforme).
        </p>
      </div>
      <JobTitleList />
    </div>
  )
}
```

- [ ] **Step 3: Menu entry**

Dans `apps/web/components/Admin/AdminLeftMenu.tsx` — ajouter l'icône `Briefcase` à l'import phosphor existant (même import que `Buildings`, `Users`, `ChartBar`, `Key`), puis insérer ce NavLink entre « Analytics » et « Developers » (~ligne 63-68) :

```tsx
          <NavLink
            href="/admin/job-titles"
            icon={<Briefcase size={16} weight="fill" />}
            label="Job titles"
          />
```

- [ ] **Step 4: Typecheck + manuel + commit**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | tail -5` → OK.
Manuel : `/admin/job-titles` en superadmin → ajouter « Data Analyst » → apparaît dans le select d'inscription → désactiver → disparaît du select.
Screenshot: `screenshots/phase1-admin-jobs.png`.

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/components/Admin/JobTitleList.tsx "apps/web/app/admin/(dashboard)/job-titles/page.tsx" apps/web/components/Admin/AdminLeftMenu.tsx
git commit -m "feat(web): superadmin job-titles management page"
```

---

### Task 13: i18n 22 locales + suite complète + checklist manuelle

**Files:**
- Modify: `apps/web/locales/fr.json`, `apps/web/locales/en.json` (clés complètes)
- Modify: les 20 autres `apps/web/locales/*.json` (mêmes clés, valeur française — cohérent avec le `defaultValue` i18next déjà en place partout)

**Interfaces:**
- Consumes: clés utilisées Tasks 7-10 : `signup.job_label`, `signup.job_choose`, `signup.job_other`, `signup.job_other_precise`, `signup.job_required`, `signup.phone_label`, `signup.invalid_phone`, `signup.consent_terms`, `signup.consent_terms_link`, `signup.consent_privacy`, `signup.consent_privacy_link`, `signup.consent_required`, `signup.complete_profile_banner`, `signup.complete_profile_cta`, `common.close`.

- [ ] **Step 1: Ajouter le bloc `signup` aux 22 locales**

Script (exécuter depuis `apps/web`) :

```bash
cd /Users/anthonybailly/learnhouse/apps/web
python3 - <<'EOF'
import json, glob

fr = {
  "job_label": "Votre métier",
  "job_choose": "Choisir…",
  "job_other": "Autre",
  "job_other_precise": "Précisez (facultatif)",
  "job_required": "Veuillez choisir votre métier",
  "phone_label": "Téléphone",
  "invalid_phone": "Numéro invalide",
  "consent_terms": "J'accepte les",
  "consent_terms_link": "conditions générales",
  "consent_privacy": "J'accepte la",
  "consent_privacy_link": "politique de confidentialité",
  "consent_required": "Vous devez accepter pour continuer",
  "complete_profile_banner": "Complétez votre profil — indiquez votre métier pour des recommandations sur mesure.",
  "complete_profile_cta": "Compléter"
}
en = {
  "job_label": "Your job",
  "job_choose": "Choose…",
  "job_other": "Other",
  "job_other_precise": "Please specify (optional)",
  "job_required": "Please choose your job",
  "phone_label": "Phone",
  "invalid_phone": "Invalid phone number",
  "consent_terms": "I accept the",
  "consent_terms_link": "terms and conditions",
  "consent_privacy": "I accept the",
  "consent_privacy_link": "privacy policy",
  "consent_required": "You must accept to continue",
  "complete_profile_banner": "Complete your profile — tell us your job for tailored recommendations.",
  "complete_profile_cta": "Complete"
}

for path in glob.glob("locales/*.json"):
    data = json.load(open(path, encoding="utf-8"))
    data.setdefault("signup", {})
    block = en if path.endswith("en.json") else fr
    data["signup"].update(block)
    # common.close used by the banner dismiss button
    data.setdefault("common", {}).setdefault("close", "Fermer" if block is fr else "Close")
    json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("updated", path)
EOF
```

- [ ] **Step 2: Suite pytest complète**

Run: `cd /Users/anthonybailly/learnhouse/apps/api && .venv/bin/python -m pytest src/tests -x -q --timeout=300 2>&1 | tail -10`
Expected: même baseline que main (8 échecs env-LLM préexistants tolérés — cf. mémoire projet ; AUCUN nouvel échec).

- [ ] **Step 3: Checklist manuelle finale (navigateur, dev local)**

1. `/org/<slug>/signup` : inscription complète avec métier de la liste + téléphone + 2 cases → succès ; en base (ou via la page profil) : job normalisé, phone, consents horodatés.
2. Inscription sans métier → bouton désactivé ; en forçant via API (curl sans `profile`) → 400 `INVALID_JOB`.
3. Métro invalide → erreur champ.
4. « Autre » sans précision → accepté (précision facultative).
5. Compte OAuth/ancien → bannière douce visible, fermable.
6. Profil : changement de métier persiste ; effacement téléphone impossible via consents (extra_metadata.consents intouchable — vérifier via re-GET user).
7. Admin `/admin/job-titles` : ajout → visible dans le select ; désactivation → retiré du select.
8. `en` locale : textes anglais ; autre locale (ex. `de`) : fallback français.

- [ ] **Step 4: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/locales/*.json
git commit -m "feat(web): i18n keys for enriched signup (22 locales)"
```

---

## Déploiement (après validation locale)

1. `git push origin feat/cloudflare-compatibility` (ou push manuel si hook Mimosa bloque — cf. mémoire projet).
2. API : `cd apps/cloudflare-api && npx wrangler deploy` — la table `job_title` est créée + seedée au boot du conteneur (rollout ~2 min, 502 transitoires normaux).
3. Web : `cd apps/web && npx opennextjs-cloudflare build && npx wrangler deploy`.
4. Vérif prod : `curl https://learn.ordria.fr/api/v1/job-titles/public | head` → liste des 20 métiers ; test d'inscription réel sur l'org de test.
