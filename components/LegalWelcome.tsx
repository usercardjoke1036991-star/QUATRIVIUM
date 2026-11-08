import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/LanguageContext';
import {
  isCurrentLegalAccepted,
  LEGAL_STORAGE_KEY,
  makeLegalRecord,
  parseLegalRecord,
} from '../utils/legalConsent';
import { BrandLogo } from './BrandLogo';
import { AppText } from './AppText';
import { LegalDocuments } from './LegalDocuments';
import { APP_DISPLAY_NAME } from '../constants/brand';

export const LegalWelcome: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors } = useTheme();
  const { t, rtl } = useI18n();
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const align = rtl ? ('right' as const) : ('left' as const);

  useEffect(() => {
    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 3000);
    AsyncStorage.getItem(LEGAL_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        setAccepted(isCurrentLegalAccepted(parseLegalRecord(raw)));
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAccepted(false);
        setReady(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, []);

  if (!ready) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg, justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (accepted) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
      <BrandLogo size={56} style={styles.logo} />
      <AppText style={[styles.brand, { color: colors.text, textAlign: align }]}>
        {APP_DISPLAY_NAME}
      </AppText>
      <AppText style={[styles.title, { color: colors.text, textAlign: align }]}>
        {t('legalTitle')}
      </AppText>
      <LegalDocuments
        mode="gate"
        onAccept={() => {
          const record = makeLegalRecord(new Date().toISOString());
          setAccepted(true);
          AsyncStorage.setItem(LEGAL_STORAGE_KEY, JSON.stringify(record)).catch(() => {});
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  logo: {
    marginTop: 16,
    marginHorizontal: 24,
  },
  brand: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginHorizontal: 24,
    marginTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    marginHorizontal: 24,
    marginTop: 6,
    marginBottom: 2,
    letterSpacing: 0.2,
  },
});
