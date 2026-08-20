import { describe, expect, it } from 'vitest';
import { translate, translations } from './translate';
import type { Language, TranslationKey } from './translate';

/**
 * The dictionary's shape is the safety property here.
 *
 * Language-major storage — `{ vi: {...}, en: {...} }` — lets the two halves
 * drift: a key added to one and missed in the other renders the raw key name,
 * in production, in one language only, and nothing fails until somebody
 * switches locale. Key-major storage makes that unspellable, and these tests
 * pin the guarantee rather than trusting the shape to stay.
 */
describe('translations', () => {
  const languages: Language[] = ['vi', 'en'];

  it('says the same things in both languages', () => {
    const vi = Object.keys(translations.vi).sort();
    const en = Object.keys(translations.en).sort();

    expect(vi).toEqual(en);
    expect(vi.length).toBeGreaterThan(100);
  });

  it('never leaves a phrase blank', () => {
    for (const language of languages) {
      for (const [key, value] of Object.entries(translations[language])) {
        expect(value, `${language}.${key}`).not.toBe('');
        expect(typeof value).toBe('string');
      }
    }
  });

  it('resolves a key in the language asked for', () => {
    expect(translate('vi', 'logout')).toBe('Đăng xuất');
    expect(translate('en', 'logout')).toBe('Logout');
  });

  it('falls back to the key rather than rendering nothing', () => {
    // Unreachable through the type, so this is the belt to the compiler's
    // braces: a screen showing `nope` is obviously wrong to whoever sees it,
    // where an empty box just looks like a layout bug.
    expect(translate('vi', 'nope' as TranslationKey)).toBe('nope');
  });

  it('keeps Vietnamese and English actually distinct where they should be', () => {
    // Guards against a copy-paste that leaves one language holding the other's
    // strings — which a key-count check would happily pass.
    const differing = (Object.keys(translations.vi) as TranslationKey[]).filter(
      (key) => translations.vi[key] !== translations.en[key],
    );

    expect(differing.length).toBeGreaterThan(50);
  });
});
