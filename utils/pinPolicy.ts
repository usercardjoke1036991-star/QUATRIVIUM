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

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (WEAK_PINS.has(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if (ASC.includes(pin) || DESC.includes(pin)) return true;
  const unique = new Set(pin.split('')).size;
  return unique <= 2;
}

export function lockoutMs(fails: number): number {
  if (fails < 5) return 0;
  if (fails < 8) return 30_000;
  if (fails < 12) return 5 * 60_000;
  return 30 * 60_000;
}

export function remainingLockMs(until: number, now = Date.now()): number {
  return Math.max(0, until - now);
}
