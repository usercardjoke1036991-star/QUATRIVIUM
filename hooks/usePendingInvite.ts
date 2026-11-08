import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { extractInviteFromUrl, INVITE_STORAGE_KEY } from '../utils/inviteCode';

export const usePendingInvite = () => {
  const [pendingInviteCode, setPendingInviteCode] = useState('');

  const persist = useCallback(async (code: string) => {
    setPendingInviteCode(code);
    await AsyncStorage.setItem(INVITE_STORAGE_KEY, code);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyUrl = async (url?: string | null) => {
      if (!url) return;
      const code = extractInviteFromUrl(url);
      if (!code || cancelled) return;
      await persist(code);
    };

    AsyncStorage.getItem(INVITE_STORAGE_KEY)
      .then((saved) => {
        if (!cancelled && saved) setPendingInviteCode(saved);
      })
      .catch(() => {});

    Linking.getInitialURL()
      .then(applyUrl)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => {
      applyUrl(url).catch(() => {});
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [persist]);

  const clearPendingInvite = useCallback(async () => {
    setPendingInviteCode('');
    await AsyncStorage.removeItem(INVITE_STORAGE_KEY);
  }, []);

  return { pendingInviteCode, clearPendingInvite };
};
