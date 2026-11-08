import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import {
  isContractConfigured,
  setProductMode,
  setRuntimeMode,
  type AppMode,
} from '../constants/rpcConfig';
import { parseAppDeepLink } from '../utils/appDeepLink';
import { APP_MODE_STORAGE_KEY, isFirstAppMode, resolvePersistedMode } from './appModePersist';

interface AppModeValue {
  mode: AppMode;
  ready: boolean;
  setMode: (next: AppMode) => Promise<boolean>;
}

const AppModeContext = createContext<AppModeValue | null>(null);

function applyChain(pref: AppMode): AppMode {
  const account: AppMode = pref === 'demo' ? 'demo' : 'live';
  setProductMode(account);
  // Demo y Real son mundos distintos: Real nunca lee el contrato ni los saldos de testnet.
  setRuntimeMode(account);
  return account;
}

async function rememberOpenedMode(mode: AppMode): Promise<void> {
  await AsyncStorage.setItem(APP_MODE_STORAGE_KEY, mode === 'demo' ? 'demo' : 'live').catch(
    () => {}
  );
}

export const AppModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<AppMode>('live');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = (next: AppMode = 'live') => {
      if (done) return;
      done = true;
      setModeState(applyChain(next));
      setReady(true);
    };
    AsyncStorage.getItem(APP_MODE_STORAGE_KEY)
      .then(async (saved) => {
        let pref = resolvePersistedMode(saved);
        if (pref === 'demo' && !isContractConfigured('testnet')) {
          pref = 'live';
        }
        if (isFirstAppMode(saved)) {
          pref = 'live';
          await rememberOpenedMode('live');
        }
        finish(pref);
      })
      .catch(() => {
        finish('live');
      });
    return () => {
      done = true;
    };
  }, []);

  const setMode = useCallback(async (next: AppMode) => {
    if (next === 'demo' && !isContractConfigured('testnet')) {
      return false;
    }
    const applied = applyChain(next);
    setModeState(applied);
    await rememberOpenedMode(applied);
    return true;
  }, []);

  useEffect(() => {
    if (!__DEV__ || !ready) return undefined;
    const apply = (url?: string | null) => {
      const link = parseAppDeepLink(url);
      if (link?.kind === 'mode') {
        void setMode(link.mode);
      }
    };
    Linking.getInitialURL()
      .then(apply)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => apply(url));
    return () => sub.remove();
  }, [ready, setMode]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void rememberOpenedMode(mode);
      }
    });
    return () => sub.remove();
  }, [mode]);

  const value = useMemo(() => ({ mode, ready, setMode }), [mode, ready, setMode]);

  useEffect(() => {
    applyChain(mode);
    if (ready) {
      void rememberOpenedMode(mode);
    }
  }, [mode, ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
};

export function useAppMode(): AppModeValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error('useAppMode must be used within AppModeProvider');
  }
  return ctx;
}
