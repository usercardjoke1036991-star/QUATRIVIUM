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

export interface WaitClock {
  fails: number;
  waitMs: number;
  left: number;
  seen: number;
}

/** Empieza la espera completa en el fallo. seen es la última hora que vimos. */
export function startWait(fails: number, now: number): WaitClock {
  const waitMs = lockoutMs(fails);
  return { fails, waitMs, left: waitMs, seen: now };
}

/**
 * El reloj del teléfono no acorta la espera.
 * Un paso hacia adelante, dentro de la espera, la descuenta.
 * Si el reloj va hacia atrás, o salta más que la espera entera, se cuenta de nuevo desde el fallo.
 */
export function advanceWait(gate: WaitClock, now: number): WaitClock {
  if (gate.left <= 0 || gate.waitMs <= 0) return { ...gate, left: 0, seen: now };
  const delta = now - gate.seen;
  if (delta < 0 || delta > gate.waitMs) {
    return { ...gate, left: gate.waitMs, seen: now };
  }
  return { ...gate, left: Math.max(0, gate.left - delta), seen: now };
}
