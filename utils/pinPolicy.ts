const WEAK_PINS = new Set([
  '000000',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123456',
  '654321',
  '123123',
  '321321',
  '121212',
  '212121',
  '112233',
  '332211',
  '123321',
  '100000',
  '012345',
  '543210',
  '101010',
  '202020',
  '135790',
  '147258',
  '159357',
]);

const ASC = '01234567890';
const DESC = '09876543210';

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;

export function isPinLengthOk(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

export function isWeakPin(pin: string): boolean {
  if (!isPinLengthOk(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  if (pin.length === 6) {
    if (WEAK_PINS.has(pin)) return true;
    if (ASC.includes(pin) || DESC.includes(pin)) return true;
    if (new Set(pin.split('')).size <= 2) return true;
  }
  return false;
}

const LOCK_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const LOCK_DAY_MS = 24 * 60 * 60 * 1000;

/** 30 s, 1 min, 5 min, 15 min, 1 h, y 24 h en cada fallo extra. Nunca borra la billetera. */
export function lockoutMs(fails: number): number {
  if (fails <= 0) return 0;
  if (fails > LOCK_STEPS_MS.length) return LOCK_DAY_MS;
  return LOCK_STEPS_MS[fails - 1];
}

export function remainingLockMs(until: number, now = Date.now()): number {
  return Math.max(0, until - now);
}

/** Dos sellos de bloque cuentan como la misma hora si caben en este margen. */
export const CHAIN_AGREE_MS = 3 * 60 * 1000;

export interface WaitClock {
  fails: number;
  waitMs: number;
  left: number;
  /** Último performance.now() contado con la app abierta. No es la hora del teléfono. */
  seen: number;
  /** Hora de cadena, en ms, guardada en el fallo. 0 si ese fallo no tuvo quorum. */
  chainAt: number;
}

export interface WaitSample {
  /** performance.now() mientras la app sigue abierta. */
  mono: number;
  /** Hora de cadena acordada por dos RPC, o null sin red. */
  chain: number | null;
}

/** Empieza la espera completa en el fallo. seen es el reloj monótono; chainAt, la hora de cadena. */
export function startWait(fails: number, mono: number, chainAt = 0): WaitClock {
  const waitMs = lockoutMs(fails);
  return {
    fails,
    waitMs,
    left: waitMs,
    seen: mono,
    chainAt: chainAt > 0 ? chainAt : 0,
  };
}

/**
 * Dos de N sellos coinciden si su diferencia cabe en unos minutos.
 * Vale cualquier par, no solo los dos primeros. Se queda el menor del par más cerrado,
 * para que un nodo adelantado no acorte la espera.
 */
export function agreedChainMs(stamps: (number | null | undefined)[]): number | null {
  const values = stamps.filter(
    (stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp) && stamp > 0
  );
  let best: { gap: number; at: number } | null = null;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const gap = Math.abs(values[i] - values[j]);
      if (gap > CHAIN_AGREE_MS) continue;
      const at = Math.min(values[i], values[j]);
      if (!best || gap < best.gap || (gap === best.gap && at < best.at)) best = { gap, at };
    }
  }
  return best ? best.at : null;
}

/**
 * La hora del teléfono no cumple la espera.
 * Con hora de cadena, el tiempo es el del bloque guardado en el fallo: volver después abre.
 * Sin red, solo cuenta performance.now() desde la última muestra con la app abierta.
 * Un reloj monótono que vuelve atrás (la app se reinició) no descuenta.
 */
export function advanceWait(gate: WaitClock, sample: WaitSample): WaitClock {
  const mono = Number.isFinite(sample.mono) && sample.mono >= 0 ? sample.mono : gate.seen;
  if (gate.left <= 0 || gate.waitMs <= 0) return { ...gate, left: 0, seen: mono };
  if (sample.chain != null && sample.chain > 0 && gate.chainAt > 0) {
    const elapsed = sample.chain - gate.chainAt;
    if (elapsed < 0) return { ...gate, seen: mono };
    return { ...gate, left: Math.max(0, gate.waitMs - elapsed), seen: mono };
  }
  if (!(gate.seen > 0)) return { ...gate, seen: mono };
  const delta = mono - gate.seen;
  if (delta < 0) return { ...gate, seen: mono };
  return { ...gate, left: Math.max(0, gate.left - delta), seen: mono };
}
