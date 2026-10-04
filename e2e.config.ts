// E2E agentique LearnHouse — couche GLM (skill e2e-coverage).
// Cible : stack locale Ordria (docker compose -p e2ecov, port 3001),
// image construite depuis CE repo — la plus fidèle à la prod Ordria.
// La clé vit dans .env (gitignoré) : e2e ne lit aucun .env lui-même.
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

try { process.loadEnvFile(); } catch { /* .env optionnel : les tests sans agent marchent sans clé */ }

// GLM via l'endpoint OpenAI-compatible de Z.AI (clé du coding plan, validée
// en phase 0 : glm-5.3-flash répond sur /chat/completions).
// Override modèle : E2E_GLM_MODEL=glm-5.3 npx e2e run (si un step échoue).
const glm = createOpenAICompatible({
  name: 'zai',
  baseURL: process.env.GLM_BASE_URL ?? 'https://api.z.ai/api/coding/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY ?? 'missing-key',
});

export default {
  agents: {
    default: {
      model: glm.chatModel(process.env.E2E_GLM_MODEL ?? 'glm-5.3-flash'),
      system:
        'You are a thorough QA agent for LearnHouse, a French-first LMS. ' +
        'The UI language is mostly French — read what is on screen and act on ' +
        'what is actually rendered, never on assumed labels. Verify every outcome.',
      // assert/extract ont 30 s par défaut — trop juste pour GLM sur les pages
      // lourdes : on monte la garde à 90 s.
      judgmentTimeout: 90_000,
    },
  },
  // Comptes de TEST locaux (stack docker e2ecov, jamais de production).
  // Surcharge par env : E2E_USER_ADMIN_USERNAME / E2E_USER_ADMIN_PASSWORD, etc.
  credentials: {
    admin: {
      username: process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com',
      password: process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026',
    },
    student: {
      username: process.env.E2E_USER_STUDENT_USERNAME ?? 'student-e2e@e2e-tests.com',
      password: process.env.E2E_USER_STUDENT_PASSWORD ?? 'E2eStudent!234',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? 'http://localhost:3001',
    },
  }],
} satisfies E2EConfig;
