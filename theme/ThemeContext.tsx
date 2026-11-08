import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, AppState, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, type ThemeColors, type ThemeName, type ThemePreference } from './palette';

const STORAGE_KEY = 'quatrivium.theme';

interface ThemeValue {
  preference: ThemePreference;
  theme: ThemeName;
  isDark: boolean;
  colors: ThemeColors;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function isPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'minimalist' || value === 'system';
}

function nativeScheme(preference: ThemePreference): 'light' | 'dark' | null {
  if (preference === 'system') return null;
  return preference === 'dark' ? 'dark' : 'light';
}

function resolveScheme(value: string | null | undefined): ThemeName {
  return value === 'dark' ? 'dark' : 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hookScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [systemTheme, setSystemTheme] = useState<ThemeName>(() =>
    resolveScheme(Appearance.getColorScheme())
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (isPreference(saved)) setPreference(saved);
      })
      .catch(() => {});
  }, []);

  const syncSystem = useCallback(() => {
    setSystemTheme(resolveScheme(Appearance.getColorScheme() ?? hookScheme));
  }, [hookScheme]);

  useEffect(() => {
    Appearance.setColorScheme(nativeScheme(preference));
  }, [preference]);

  useEffect(() => {
    const appearance = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemTheme(resolveScheme(colorScheme));
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncSystem();
    });
    return () => {
      appearance.remove();
      app.remove();
    };
  }, [syncSystem]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const theme: ThemeName = preference === 'system' ? systemTheme : preference;

  const value = useMemo(
    () => ({
      preference,
      theme,
      isDark: theme === 'dark',
      colors: palettes[theme],
      setTheme,
    }),
    [preference, theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
};
