import AsyncStorage from '@react-native-async-storage/async-storage';

function key(wallet: string): string {
  return `quatrivium.loanPaidAt.v1.${wallet.toLowerCase()}`;
}

/** Marca el segundo en que un pago cerró el crédito. Cada cierre reinicia las 48 h. */
export async function markLoanFullyPaid(
  wallet: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): Promise<number> {
  if (!wallet) return 0;
  const stamp = Math.floor(nowSec);
  if (!Number.isFinite(stamp) || stamp <= 0) return 0;
  await AsyncStorage.setItem(key(wallet), String(stamp));
  return stamp;
}

export async function readLoanFullyPaidAt(wallet: string): Promise<number> {
  if (!wallet) return 0;
  try {
    const raw = await AsyncStorage.getItem(key(wallet));
    const stamp = Number(raw);
    return Number.isFinite(stamp) && stamp > 0 ? Math.floor(stamp) : 0;
  } catch {
    return 0;
  }
}
