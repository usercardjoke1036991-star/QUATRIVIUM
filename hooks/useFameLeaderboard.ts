import { useCallback, useEffect, useState } from 'react';
import {
  loadFameLeaderboard,
  peekFameLeaderboard,
  type FameLeaderboardSnapshot,
} from '../services/fameLeaderboard';
import { isContractConfigured } from '../constants/rpcConfig';

const EMPTY: FameLeaderboardSnapshot = { players: [], partial: false };

export const useFameLeaderboard = (enabled: boolean, viewerAddress = '') => {
  const ready = enabled && isContractConfigured();
  const [data, setData] = useState<FameLeaderboardSnapshot>(
    () => (ready ? peekFameLeaderboard() : null) || EMPTY
  );
  const [isLoading, setIsLoading] = useState(() => ready && !peekFameLeaderboard());
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!ready) {
      setData(EMPTY);
      setIsLoading(false);
      return;
    }
    const warm = peekFameLeaderboard();
    if (warm) {
      setData(warm);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      setData(await loadFameLeaderboard(viewerAddress));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
      if (!warm) setData(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [ready, viewerAddress]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
};
