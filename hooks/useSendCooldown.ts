import { useCallback, useEffect, useRef, useState } from 'react';

export function useSendCooldown(seconds = 60) {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<(n: number) => void>(() => {});

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  tick.current = (n: number) => {
    setLeft(n);
    if (n <= 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => tick.current(n - 1), 1000);
  };

  const start = useCallback(
    (from?: number) => {
      if (timer.current) clearTimeout(timer.current);
      const next = typeof from === 'number' ? Math.max(0, Math.floor(from)) : seconds;
      tick.current(next);
    },
    [seconds]
  );

  return { left, start };
}
