import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VerificationFeeKind } from '../utils/creditGates';

const PREFIX = 'qc.verify.fee.v1.';
const TTL_MS = 2 * 60 * 60 * 1000;

function receiptKey(wallet: string, kind: VerificationFeeKind, target: string): string {
  const owner = String(wallet || '')
    .trim()
    .toLowerCase();
  const mark = String(target || '')
    .trim()
    .toLowerCase();
  return `${PREFIX}${owner}.${kind}.${mark}`;
}

/** Recibo corto: si ya se cobró el 0,50 y el vínculo/guardado falló, no se cobra otra vez. El OTP sigue intentando vincular. */
export async function hasVerificationFeeReceipt(
  wallet: string,
  kind: VerificationFeeKind,
  target: string
): Promise<boolean> {
  const owner = String(wallet || '').trim();
  const mark = String(target || '').trim();
  if (!owner || !mark) return false;
  try {
    const raw = await AsyncStorage.getItem(receiptKey(owner, kind, mark));
    const at = Number(raw || 0);
    if (!Number.isFinite(at) || at <= 0) return false;
    return Date.now() - at < TTL_MS;
  } catch {
    return false;
  }
}

export async function markVerificationFeeReceipt(
  wallet: string,
  kind: VerificationFeeKind,
  target: string
): Promise<void> {
  const owner = String(wallet || '').trim();
  const mark = String(target || '').trim();
  if (!owner || !mark) return;
  try {
    await AsyncStorage.setItem(receiptKey(owner, kind, mark), String(Date.now()));
  } catch {
    // Si no se guarda, el siguiente intento puede cobrar de nuevo.
  }
}
