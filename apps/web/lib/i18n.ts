'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';

const LOCALE_LOADERS: Record<string, () => Promise<{ default: any }>> = {
  fr: () => import('../locales/fr.json'),
  de: () => import('../locales/de.json'),
  es: () => import('../locales/es.json'),
  ar: () => import('../locales/ar.json'),
  ja: () => import('../locales/ja.json'),
  pt: () => import('../locales/pt.json'),
  ru: () => import('../locales/ru.json'),
  zh: () => import('../locales/zh.json'),
  hi: () => import('../locales/hi.json'),
  ko: () => import('../locales/ko.json'),
  it: () => import('../locales/it.json'),
  tr: () => import('../locales/tr.json'),
  vi: () => import('../locales/vi.json'),
  id: () => import('../locales/id.json'),
  pl: () => import('../locales/pl.json'),
  uk: () => import('../locales/uk.json'),
  nl: () => import('../locales/nl.json'),
  th: () => import('../locales/th.json'),
  bn: () => import('../locales/bn.json'),
  fa: () => import('../locales/fa.json'),
  sk: () => import('../locales/sk.json'),
};

// Only bundle English; lazy-load all other locales on demand
const resources = {
  en: { common: en },
};

let _hydrationDone = false;
const _pendingBundles: Array<[string, any]> = [];

/**
 * Called by I18nProvider right after hydration commits: release any locale
 * bundles that finished loading during hydration. Safe to call repeatedly.
 */
export function i18nHydrationDone() {
  if (_hydrationDone) return;
  _hydrationDone = true;
  let flushed = false;
  while (_pendingBundles.length) {
    const [code, bundle] = _pendingBundles.shift()!;
    i18n.addResourceBundle(code, 'common', bundle, true, true);
    flushed = true;
  }
  if (flushed) {
    // Resources changed without a language change — force subscribed
    // components to re-render with the now-available translations.
    i18n.emit('languageChanged', i18n.language);
  }
}

async function loadLocale(lng: string) {
  const code = lng.split('-')[0]
  if (code === 'en' || !LOCALE_LOADERS[code]) return;
  if (i18n.hasResourceBundle(code, 'common')) return;

  try {
    const mod = await LOCALE_LOADERS[code]();
    // Hydration safety: the server always renders English (no request-scoped
    // language detection server-side, only the bundled en resources). If a
    // cached locale chunk resolves BEFORE React hydrates, applying it
    // immediately would make the hydration pass render translated text
    // against English server HTML → React #418 mismatch → full client
    // re-render. So on the client the bundle is held back until hydration
    // completes (i18nHydrationDone), then applied with a re-render. The
    // visible EN→locale swap after mount is unchanged; the mismatch and
    // double-render are gone.
    if (typeof window === 'undefined') {
      i18n.addResourceBundle(code, 'common', mod.default, true, true);
    } else if (_hydrationDone) {
      i18n.addResourceBundle(code, 'common', mod.default, true, true);
      i18n.emit('languageChanged', i18n.language);
    } else {
      _pendingBundles.push([code, mod.default]);
    }
  } catch (e) {
    console.warn(`Failed to load locale: ${lng}`, e);
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    detection: {
      order: ['localStorage', 'cookie', 'querystring', 'navigator', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18next',
    },
    react: {
      useSuspense: false,
    }
  });

// Load the detected language if it's not English · export the promise
// so I18nProvider can wait for resources before rendering
export const initialLocaleReady = loadLocale(i18n.language.split('-')[0]);

/**
 * Switch language safely · preloads the bundle before switching
 * so the UI never flashes English as a fallback.
 */
export async function changeLanguage(lng: string) {
  await loadLocale(lng)
  return i18n.changeLanguage(lng)
}

export default i18n;
