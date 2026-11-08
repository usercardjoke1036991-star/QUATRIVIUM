import { useEffect, useRef, useState } from 'react';
import { cooldownRestanteDesdeTimestamp, PRESTAMO_COOLDOWN_SECS } from '../utils/creditCooldown';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function endFromInputs(ultimoPrestamoTimestamp: number, cooldownHintSec: number): number {
  const now = nowSec();
  const fromTs =
    Number.isFinite(ultimoPrestamoTimestamp) && ultimoPrestamoTimestamp > 0
      ? Math.floor(ultimoPrestamoTimestamp) + PRESTAMO_COOLDOWN_SECS
      : 0;
  const hint = Math.max(0, Math.floor(cooldownHintSec || 0));
  const fromHint = hint > 0 ? now + hint : 0;
  return Math.max(fromTs, fromHint);
}

/** Seconds left until the next loan can be requested. Ticks every second. */
export function useLiveCooldown(ultimoPrestamoTimestamp: number, cooldownHintSec = 0): number {
  const endRef = useRef(endFromInputs(ultimoPrestamoTimestamp, cooldownHintSec));
  const [left, setLeft] = useState(() =>
    Math.max(
      cooldownRestanteDesdeTimestamp(ultimoPrestamoTimestamp),
      Math.max(0, Math.floor(cooldownHintSec || 0))
    )
  );

  useEffect(() => {
    const nextEnd = endFromInputs(ultimoPrestamoTimestamp, cooldownHintSec);
    if (ultimoPrestamoTimestamp > 0 || nextEnd > endRef.current) {
      endRef.current = nextEnd;
    } else if (endRef.current <= 0) {
      endRef.current = nextEnd;
    }
    let id: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const next = endRef.current > 0 ? Math.max(0, endRef.current - nowSec()) : 0;
      setLeft(next);
      if (next <= 0 && id) {
        clearInterval(id);
        id = undefined;
      }
    };
    tick();
    if (endRef.current - nowSec() > 0) {
      id = setInterval(tick, 1000);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [ultimoPrestamoTimestamp, cooldownHintSec]);

  return left;
}
