import { useCallback, useEffect, useState } from 'react';
import {
  loadReferralNetwork,
  peekReferralNetwork,
  type ReferralNetworkSnapshot,
} from '../services/referralNetwork';

const EMPTY: ReferralNetworkSnapshot = {
  directs: [],
  totalEarnedWei: '0',
  totalEarnedLabel: '0.00 USDT',
  commissionTotalWei: '0',
  commissionTotalLabel: '0.00 USDT',
  bonusTotalWei: '0',
  bonusTotalLabel: '0.00 USDT',
  activity: [],
  partial: false,
};

export const useReferralNetwork = (walletAddress: string, enabled: boolean) => {
  const [data, setData] = useState<ReferralNetworkSnapshot>(
    () => (enabled ? peekReferralNetwork(walletAddress) : null) || EMPTY
  );
  const [isLoading, setIsLoading] = useState(() => enabled && !peekReferralNetwork(walletAddress));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !walletAddress) {
      setData(peekReferralNetwork(walletAddress) || EMPTY);
      setIsLoading(false);
      return;
    }
    const warm = peekReferralNetwork(walletAddress);
    if (warm) {
      setData(warm);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      setData(await loadReferralNetwork(walletAddress));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
      if (!warm) setData(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, walletAddress]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
};
