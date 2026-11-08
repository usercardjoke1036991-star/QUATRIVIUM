import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectDeviceLang, isRtl, LANGUAGES, type Lang } from './languages';
import { translations, type TranslationKey } from './translations';
import { setTxErrorLang } from '../utils/txErrors';

I18nManager.allowRTL(true);

const STORAGE_KEY = 'quatrivium.lang';
const CHOSEN_KEY = 'quatrivium.langChosen';

type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  langReady: boolean;
  langChosen: boolean;
  setLang: (lang: Lang) => void;
  chooseLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Vars) => string;
  rtl: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name])
  );
}

function lookup(lang: Lang, key: TranslationKey): string {
  return translations[lang]?.[key] || translations.es[key] || key;
}

function applyRtl(next: Lang): boolean {
  const wantRtl = isRtl(next);
  if (I18nManager.isRTL === wantRtl) return false;
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(wantRtl);
  return true;
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(detectDeviceLang);
  const [langReady, setLangReady] = useState(false);
  const [langChosen, setLangChosen] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setLangReady(true);
    };
    const watchdog = setTimeout(finish, 3000);
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(CHOSEN_KEY)])
      .then(([saved, chosen]) => {
        if (saved && LANGUAGES.some((item) => item.code === saved)) {
          const next = saved as Lang;
          setLangState(next);
          applyRtl(next);
        }
        setLangChosen(chosen === '1');
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(watchdog);
        finish();
      });
    return () => {
      done = true;
      clearTimeout(watchdog);
    };
  }, []);

  const persistLang = useCallback((next: Lang, announceRtl: boolean) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    const needsRestart = applyRtl(next);
    if (announceRtl && needsRestart) {
      Alert.alert(lookup(next, 'language'), lookup(next, 'rtlNeedsRestart'));
    }
  }, []);

  const setLang = useCallback(
    (next: Lang) => {
      persistLang(next, true);
    },
    [persistLang]
  );

  const chooseLang = useCallback(
    (next: Lang) => {
      persistLang(next, true);
      setLangChosen(true);
      AsyncStorage.setItem(CHOSEN_KEY, '1').catch(() => {});
    },
    [persistLang]
  );

  useEffect(() => {
    setTxErrorLang(lang);
  }, [lang]);

  const t = useCallback(
    (key: TranslationKey, vars?: Vars) => interpolate(lookup(lang, key), vars),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, langReady, langChosen, setLang, chooseLang, t, rtl: isRtl(lang) }),
    [chooseLang, lang, langChosen, langReady, setLang, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside LanguageProvider');
  }
  return ctx;
};
