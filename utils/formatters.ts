/**
 * Formats cooldown time in seconds to human-readable format
 * @param seconds - Cooldown time in seconds
 * @returns Formatted string (e.g., "2d 3h 15m")
 */
export const formatCooldown = (seconds: number, availableLabel = 'Disponible'): string => {
  if (seconds <= 0) return availableLabel;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);

  return parts.length > 0 ? parts.join(' ') : '0s';
};

/** Live loan-wait clock, e.g. `47:59:12` or `1d 23:59:01`. */
export const formatCountdownClock = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${pad(hours % 24)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
};

/**
 * Formats wallet address to shortened version
 * @param address - Full wallet address
 * @returns Shortened address (e.g., "0x1234...5678")
 */
export const formatAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * Formats number to USD currency format
 * @param amount - Amount to format
 * @returns Formatted USD string
 */
function groupThousands(whole: string): string {
  let out = '';
  let n = 0;
  for (let i = whole.length - 1; i >= 0; i -= 1) {
    if (n > 0 && n % 3 === 0) out = `.${out}`;
    out = `${whole[i]}${out}`;
    n += 1;
  }
  return out;
}

export const formatUSD = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  const [whole, cents] = Math.abs(safe).toFixed(2).split('.');
  const grouped = groupThousands(whole);
  return `$${safe < 0 ? '-' : ''}${grouped}.${cents}`;
};

export const formatDueDate = (unixSeconds: number): string => {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString();
};

export const parsePositiveDecimal = (input: string): string | null => {
  const normalized = input.replace(',', '.').trim();
  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  if (Number(normalized) <= 0) return null;
  return normalized;
};

/**
 * Calculates loan amount with interest
 * @param principal - Original loan amount
 * @param interestRate - Interest rate as decimal (e.g., 0.3 for 30%)
 * @returns Total amount with interest
 */
export const calculateLoanWithInterest = (
  principal: number,
  interestRate: number = 0.3
): number => {
  return principal * (1 + interestRate);
};
