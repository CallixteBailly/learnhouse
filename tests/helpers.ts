/**
 * Helpers partagés de la suite E2E agentique LearnHouse (skill e2e-coverage).
 *
 * - API REST directe (Node, pas de navigateur) : login admin, création de
 *   l'étudiant de test, seed du cours (calqué sur apps/e2e/features/courses/api.ts
 *   du harness Playwright, éprouvé sur l'image publiée).
 * - L'API limite les logins à 30 / 5 min / IP : chaque helper cache son token
 *   en mémoire pour le run, et apiLogin réessaie une fois sur 429.
 */
import type { Browser } from '@e2e-dev/web';

const BASE_URL = process.env.APP_URL ?? 'http://localhost:3009';
const API_URL = `${BASE_URL}/api/v1`;
const ORG_SLUG = 'default';

export { BASE_URL, API_URL, ORG_SLUG };

const ADMIN_EMAIL = process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com';
const ADMIN_PASSWORD = process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026';
export const STUDENT = {
  email: process.env.E2E_USER_STUDENT_USERNAME ?? 'student-e2e@e2e-tests.com',
  username: 'student_e2e',
  password: process.env.E2E_USER_STUDENT_PASSWORD ?? 'E2eStudent!234',
  firstName: 'Stu',
  lastName: 'E2e',
};

// ─── REST bas niveau ────────────────────────────────────────────────────────

export async function apiReq<T = any>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  asForm = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (asForm) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body as Record<string, string>);
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const tokenCache = new Map<string, string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Login API avec cache par email + retry unique sur 429 (rate limit 30/5min/IP). */
export async function apiLogin(email: string, password: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await apiReq<any>('POST', '/auth/login', null, { username: email, password }, true);
      const token = data?.tokens?.access_token || data?.access_token;
      if (!token) throw new Error('no access_token in login response');
      tokenCache.set(email, token);
      return token;
    } catch (e) {
      const msg = (e as Error).message;
      if (attempt === 0 && /-> 429/.test(msg)) {
        let waitMs = 8000;
        const m = msg.match(/"retry_after"\s*:\s*(\d+)/);
        if (m) waitMs = Math.min(Number(m[1]) * 1000 + 500, 60_000);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`apiLogin failed for ${email}`);
}

export async function getOrgId(): Promise<number> {
  const org = await apiReq<{ id: number }>('GET', `/orgs/slug/${ORG_SLUG}`, null);
  return org.id;
}

/** Crée l'étudiant de test s'il n'existe pas encore (idempotent par login). */
export async function ensureStudent(): Promise<void> {
  try {
    await apiLogin(STUDENT.email, STUDENT.password);
    return; // existe déjà
  } catch {
    /* pas encore créé */
  }
  const adminToken = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const orgId = await getOrgId();
  await apiReq('POST', `/users/${orgId}`, adminToken, {
    email: STUDENT.email,
    username: STUDENT.username,
    password: STUDENT.password,
    first_name: STUDENT.firstName,
    last_name: STUDENT.lastName,
    // Contrat d'inscription enrichie (Phase 1) : consentements RGPD obligatoires.
    extra_metadata: {
      consents: { terms: true, privacy: true },
      profile: {},
    },
  });
  // Le login suivant prouve la création ET met le token en cache.
  await apiLogin(STUDENT.email, STUDENT.password);
}

// ─── Seed cours (formes éprouvées du harness Playwright) ────────────────────

export interface SeededCourse {
  courseId: number;
  courseUuid: string;
  name: string;
  chapterId: number;
  activities: { id: number; uuid: string; name: string }[];
}

export async function createCourseApi(token: string, orgId: number, name: string) {
  const form = new FormData();
  form.append('name', name);
  form.append('description', 'Cours de couverture E2E');
  form.append('public', 'true');
  form.append('about', 'Cours de couverture E2E');
  form.append('learnings', '[]');
  form.append('tags', 'e2e');
  form.append('thumbnail_type', 'image');
  form.append('open_to_contributors', 'false');
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { id: number; course_uuid: string };
}

/** Cours seedé : 1 chapitre + 1 activité dynamique publiée + cours publié. */
export async function seedCourse(name: string): Promise<SeededCourse> {
  const token = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const orgId = await getOrgId();
  const course = await createCourseApi(token, orgId, name);
  const chapter = await apiReq<{ id: number }>('POST', '/chapters/', token, {
    name: `${name} — Chapitre 1`,
    description: 'Chapitre E2E',
    org_id: orgId,
    course_id: course.id,
    lock_type: 'public',
  });
  const activity = await apiReq<{ id: number; activity_uuid: string }>(
    'POST',
    `/activities/?coursechapter_id=${chapter.id}&org_id=${orgId}`,
    token,
    {
      name: `${name} — Activité dynamique`,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_EMBED',
      chapter_id: chapter.id,
      published: true,
      lock_type: 'public',
      content: {},
      details: {},
    },
  );
  // Publier le cours côté catalogue (contrat du harness Playwright : public
  // ET published).
  await apiReq('PUT', `/courses/${course.course_uuid}`, token, { public: true, published: true });
  return {
    courseId: course.id,
    courseUuid: course.course_uuid,
    name,
    chapterId: chapter.id,
    activities: [{ id: activity.id, uuid: activity.activity_uuid, name: `${name} — Activité dynamique` }],
  };
}

export async function deleteCourseApi(courseUuid: string): Promise<void> {
  const token = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await apiReq('DELETE', `/courses/${courseUuid}`, token);
}

// ─── État navigateur ────────────────────────────────────────────────────────

/** Colle le flag onboarding dismissé (calqué sur apps/e2e/global-setup.ts). */
export async function dismissOnboarding(browser: Browser): Promise<void> {
  await browser.evaluate(() => {
    window.localStorage.setItem(
      'lh_onboarding',
      JSON.stringify({
        completedSteps: [
          'create_course', 'add_activities', 'experience_editor', 'try_playgrounds',
          'invite_users', 'customize_org', 'teach_the_world',
        ],
        skippedSteps: [], minimized: true, expanded: false, showAllSteps: false,
        dismissed: true, welcomeSeen: true,
      }),
    );
    return true;
  }, null);
}
