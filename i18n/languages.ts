export const LANGUAGES = [
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧' },
  { code: 'zh', native: '中文', english: 'Chinese', flag: '🇨🇳' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  { code: 'ar', native: 'العربية', english: 'Arabic', flag: '🇸🇦' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', flag: '🇧🇩' },
  { code: 'pt', native: 'Português', english: 'Portuguese', flag: '🇧🇷' },
  { code: 'ru', native: 'Русский', english: 'Russian', flag: '🇷🇺' },
  { code: 'ur', native: 'اردو', english: 'Urdu', flag: '🇵🇰' },
  { code: 'id', native: 'Indonesia', english: 'Indonesian', flag: '🇮🇩' },
  { code: 'fr', native: 'Français', english: 'French', flag: '🇫🇷' },
  { code: 'ja', native: '日本語', english: 'Japanese', flag: '🇯🇵' },
  { code: 'de', native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  { code: 'ko', native: '한국어', english: 'Korean', flag: '🇰🇷' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', flag: '🇹🇷' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', flag: '🇻🇳' },
  { code: 'it', native: 'Italiano', english: 'Italian', flag: '🇮🇹' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const RTL_LANGS: Lang[] = ['ar', 'ur'];

export const isRtl = (lang: Lang) => RTL_LANGS.includes(lang);

export function detectDeviceLang(): Lang {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const base = tag.split(/[-_]/)[0]?.toLowerCase();
    if (base && LANGUAGES.some((item) => item.code === base)) {
      return base as Lang;
    }
  } catch {
    // ignore
  }
  return 'es';
}
