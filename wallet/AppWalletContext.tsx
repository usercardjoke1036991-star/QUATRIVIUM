import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { HDNodeWallet, Wallet } from 'ethers';
import { subscribeRuntimeMode } from '../constants/rpcConfig';
import { setWalletSigner, clearWalletSigner } from '../services/quatriviumCreditService';
import {
  loadAppWallet,
  ensureAppWallet,
  importFromPhrase,
  recreateAppWallet,
  addressFromPhrase,
  withCurrentRpc,
} from '../services/appWallet';
import { wipeLocalAccount } from '../services/accountReset';
import { purgePersistedWrap, restoreSavedSessionWrap } from '../services/savedSession';
import { clearWalletSession, getWalletWrapKey } from '../services/walletSession';

interface AppWalletValue {
  address: string;
  ready: boolean;
  failed: boolean;
  signer: HDNodeWallet | Wallet | null;
  retry: () => Promise<void>;
  recreate: () => Promise<string>;
  restore: (phrase: string) => Promise<string>;
}

const AppWalletContext = createContext<AppWalletValue | null>(null);

export const AppWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [signer, setSigner] = useState<HDNodeWallet | Wallet | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const signerRef = useRef(signer);
  signerRef.current = signer;

  const boot = useCallback(async () => {
    if (!getWalletWrapKey()) {
      await restoreSavedSessionWrap();
    }
    if (__DEV__) {
      console.log('[boot] wallet wrap', { wrapReady: Boolean(getWalletWrapKey()) });
    }
    const wallet = await ensureAppWallet();
    setSigner(wallet);
    setWalletSigner(wallet);
    setFailed(false);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    const watchdog = setTimeout(() => {
      if (!cancelled && !finished) {
        setFailed(true);
        setReady(true);
      }
    }, 40000);
    const start = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await boot();
          finished = true;
          clearTimeout(watchdog);
          return;
        } catch {
          if (getWalletWrapKey()) {
            clearWalletSession();
            await purgePersistedWrap();
            break;
          }
          await restoreSavedSessionWrap();
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
      finished = true;
      clearTimeout(watchdog);
      if (!cancelled) {
        setFailed(true);
        setReady(true);
      }
    };
    void start();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [boot]);

  useEffect(
    () =>
      subscribeRuntimeMode(() => {
        const current = signerRef.current;
        if (current) {
          const next = withCurrentRpc(current);
          setSigner(next);
          setWalletSigner(next);
          return;
        }
        clearWalletSigner();
        void loadAppWallet()
          .then((wallet) => {
            if (!wallet) return;
            setSigner(wallet);
            setWalletSigner(wallet);
          })
          .catch(() => {});
      }),
    []
  );

  const retry = useCallback(async () => {
    setReady(false);
    setFailed(false);
    try {
      await boot();
    } catch {
      setFailed(true);
      setReady(true);
    }
  }, [boot]);

  const recreate = useCallback(async () => {
    const previous = signer?.address.toLowerCase() || '';
    await wipeLocalAccount(previous);
    const wallet = await recreateAppWallet();
    setSigner(wallet);
    setWalletSigner(wallet);
    return wallet.address.toLowerCase();
  }, [signer]);

  const restore = useCallback(
    async (phrase: string) => {
      const previous = signer?.address.toLowerCase() || '';
      const next = addressFromPhrase(phrase);
      if (previous && previous !== next) {
        await wipeLocalAccount(previous);
      }
      const wallet = await importFromPhrase(phrase);
      setSigner(wallet);
      setWalletSigner(wallet);
      return wallet.address.toLowerCase();
    },
    [signer]
  );

  const value = useMemo(
    () => ({
      address: signer?.address.toLowerCase() || '',
      ready,
      failed,
      signer,
      retry,
      recreate,
      restore,
    }),
    [failed, ready, recreate, restore, retry, signer]
  );

  return <AppWalletContext.Provider value={value}>{children}</AppWalletContext.Provider>;
};

export const useAppWallet = (): AppWalletValue => {
  const ctx = useContext(AppWalletContext);
  if (!ctx) {
    throw new Error('useAppWallet must be used inside AppWalletProvider');
  }
  return ctx;
};
