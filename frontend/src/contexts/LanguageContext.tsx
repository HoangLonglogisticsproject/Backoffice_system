import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { translate, type Language, type TranslationKey } from '@/types/translate';

/**
 * Which language the interface speaks, and the lookup every screen uses.
 *
 * The choice is a UI preference and nothing more — it is not part of the
 * session, it is not sent to the server, and no API response varies by it. So
 * it lives in `localStorage` rather than anywhere the backend can see, and a
 * signed-out visitor keeps their choice.
 */
interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const STORAGE_KEY = 'language';
const DEFAULT_LANGUAGE: Language = 'vi';

/** Narrow, because `localStorage` can hold anything a previous version wrote. */
const asLanguage = (value: string | null): Language | null =>
  value === 'vi' || value === 'en' ? value : null;

export function LanguageProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);

  // Read after mount rather than in the initial state: the same component tree
  // is rendered in tests and in jsdom, where storage may not exist at all.
  useEffect(() => {
    const saved = asLanguage(safeRead());
    if (saved) setLanguage(saved);
  }, []);

  const choose = useCallback((next: Language) => {
    setLanguage(next);
    safeWrite(next);
  }, []);

  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);

  const value = useMemo(
    () => ({ language, setLanguage: choose, t }),
    [language, choose, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Storage access that cannot take the page down.
 *
 * `localStorage` throws in private-browsing modes and when a policy disables
 * it. A language preference is not worth a blank screen, so a failure means
 * "no preference saved" and the default stands.
 */
function safeRead(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeWrite(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Preference is not persisted this session. The UI still switched.
  }
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
