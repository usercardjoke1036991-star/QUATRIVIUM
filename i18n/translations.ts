import type { Lang } from './languages';
import es from './locales/es.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import hi from './locales/hi.json';
import ar from './locales/ar.json';
import bn from './locales/bn.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import ur from './locales/ur.json';
import id from './locales/id.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';
import de from './locales/de.json';
import ko from './locales/ko.json';
import tr from './locales/tr.json';
import vi from './locales/vi.json';
import it from './locales/it.json';

export type TranslationKey = keyof typeof es;

export const translations: Record<Lang, Record<TranslationKey, string>> = {
  es,
  en,
  zh,
  hi,
  ar,
  bn,
  pt,
  ru,
  ur,
  id,
  fr,
  ja,
  de,
  ko,
  tr,
  vi,
  it,
};
