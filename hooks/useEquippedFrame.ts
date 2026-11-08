import { useCallback, useEffect, useState } from 'react';
import {
  equippedFrameLevel,
  loadEquippedFrame,
  saveEquippedFrame,
  subscribeEquippedFrame,
} from '../services/equippedFrame';

export function useEquippedFrame(wallet: string, isFounder: boolean, naturalLevel: number) {
  const [equipped, setEquipped] = useState(0);

  useEffect(() => {
    if (!isFounder || !wallet) {
      setEquipped(0);
      return;
    }
    let live = true;
    void loadEquippedFrame(wallet)
      .then((level) => {
        if (live) setEquipped(level);
      })
      .catch(() => {});
    const stop = subscribeEquippedFrame((changed, level) => {
      if (changed === wallet.trim().toLowerCase()) setEquipped(level);
    });
    return () => {
      live = false;
      stop();
    };
  }, [wallet, isFounder]);

  const wearFrame = useCallback(
    async (level: number) => {
      if (!isFounder || !wallet) return 0;
      const next = await saveEquippedFrame(wallet, level);
      setEquipped(next);
      return next;
    },
    [isFounder, wallet]
  );

  return {
    equippedLevel: isFounder ? equipped : 0,
    displayLevel: isFounder ? equippedFrameLevel(naturalLevel, equipped) : naturalLevel || 1,
    wearFrame,
  };
}
