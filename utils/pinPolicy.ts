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

export function lockoutMs(fails: number): number {
  if (fails <= 0) return 0;
  const index = Math.min(fails, LOCK_STEPS_MS.length) - 1;
  return LOCK_STEPS_MS[index];
}

export function remainingLockMs(until: number, now = Date.now()): number {
  return Math.max(0, until - now);
}
