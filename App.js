import React, { useEffect, useState } from 'react';
import { Linking as RNLinking, LogBox, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider, useI18n } from './i18n/LanguageContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ProfileProvider } from './profile/ProfileContext';
import { migrateLegacyStorage } from './utils/legacyStorage';
import HomeScreen from './app/index';
import { ScreenGuard } from './components/ScreenGuard';
import { AppLockGate } from './components/AppLockGate';
import { LanguageWelcome } from './components/LanguageWelcome';
import { LegalWelcome } from './components/LegalWelcome';
import { FundsConfirmHost } from './components/FundsConfirmHost';
import { AppModeProvider } from './wallet/AppModeContext';
import { AppWalletProvider } from './wallet/AppWalletContext';
import * as Linking from 'expo-linking';
import { rememberAppUrl } from './utils/pendingDeepLink';
import { BrandSplash } from './components/BrandSplash';

LogBox.ignoreLogs([
  'User rejected methods',
  'Reject Session',
  'Proposal expired',
  'Request expired',
  'User denied',
  'denied transaction',
]);

const BRAND_HOLD_MS = 1700;

function DeferredWeb3({ children }) {
  const { t } = useI18n();
  const [Box, setBox] = useState(null);
  useEffect(() => {
    let live = true;
    import('./web3Config')
      .then((mod) => {
        if (live) setBox(() => mod.Web3Provider);
      })
      .catch(() => {
        if (live)
          setBox(
            () =>
              ({ children: inner }) =>
                inner
          );
      });
    return () => {
      live = false;
    };
  }, []);
  if (__DEV__) {
    console.log('[boot] DeferredWeb3', { ready: Boolean(Box) });
  }
  if (!Box) {
    return <BrandSplash tagline={t('splashTagline')} />;
  }
  const Provider = Box;
  return <Provider>{children}</Provider>;
}

export default function App() {
  const [brandHoldOver, setBrandHoldOver] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBrandHoldOver(true), BRAND_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    migrateLegacyStorage().catch(() => {});
    const remember = (url) => rememberAppUrl(url);
    Linking.getInitialURL()
      .then(remember)
      .catch(() => {});
    RNLinking.getInitialURL()
      .then(remember)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => remember(url));
    const rnSub = RNLinking.addEventListener('url', ({ url }) => remember(url));
    return () => {
      sub.remove();
      rnSub.remove();
    };
  }, []);

  if (__DEV__) {
    console.log('[boot] App render', { brandHoldOver });
  }

  if (!brandHoldOver) {
    return <BrandSplash />;
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        <ThemeProvider>
          <LanguageProvider>
            <AppModeProvider>
              <LanguageWelcome>
                <LegalWelcome>
                  <AppLockGate>
                    <FundsConfirmHost>
                      <DeferredWeb3>
                        <AppWalletProvider>
                          <ProfileProvider>
                            <HomeScreen />
                          </ProfileProvider>
                        </AppWalletProvider>
                      </DeferredWeb3>
                    </FundsConfirmHost>
                  </AppLockGate>
                </LegalWelcome>
              </LanguageWelcome>
            </AppModeProvider>
          </LanguageProvider>
        </ThemeProvider>
        <ScreenGuard />
      </View>
    </SafeAreaProvider>
  );
}
