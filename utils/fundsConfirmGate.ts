/** Datos que la pantalla debe mostrar antes de firmar un movimiento de LUSD. */

import { formatEther, parseUnits } from 'ethers';

export const NETWORK_FEE_UNAVAILABLE = 'no disponible';

type FeeTx = { to?: string | null; data?: string | null; from?: string | null };

type FeeQuote = {
  estimateGas(tx: FeeTx): Promise<bigint>;
  getFeeData(): Promise<{ maxFeePerGas?: bigint | null; gasPrice?: bigint | null }>;
};

/** Gas estimado por el precio actual. Si la lectura falla, no se inventa una comisión. */
export async function quoteNetworkFee(source: FeeQuote, tx: FeeTx): Promise<string> {
  try {
    const gas = await source.estimateGas(tx);
    const fee = await source.getFeeData();
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (price == null || price <= 0n || gas <= 0n) return NETWORK_FEE_UNAVAILABLE;
    const eth = formatEther(gas * price);
    const trimmed = eth.includes('.') ? eth.replace(/0+$/, '').replace(/\.$/, '') : eth;
    return `${trimmed} ETH`;
  } catch {
    return NETWORK_FEE_UNAVAILABLE;
  }
}

function positiveAmount(raw: string): boolean {
  const amount = String(raw || '').trim();
  if (!amount) return false;
  try {
    return parseUnits(amount, 18) > 0n;
  } catch {
    return false;
  }
}

export function reservaConfirmAmount(
  kind: 'lock' | 'unlock' | 'renew',
  typed: string | null,
  principal: string | null
): string | null {
  const raw = kind === 'lock' ? typed : principal;
  const amount = String(raw || '').trim();
  if (!positiveAmount(amount)) return null;
  return amount;
}

export type FundsTxDetails = {
  amount: string;
  symbol: string;
  destination: string;
  fee: string;
};

export function fundsTx(amount: string, destination: string, fee: string): FundsTxDetails {
  return {
    amount: String(amount || '').trim(),
    symbol: 'LUSD',
    destination: String(destination || '').trim(),
    fee: String(fee || '').trim(),
  };
}

export function fundsDetailsComplete(details?: Partial<FundsTxDetails> | null): boolean {
  if (!details) return false;
  if (!positiveAmount(String(details.amount || ''))) return false;
  if (!String(details.symbol || '').trim()) return false;
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(details.destination || '').trim())) return false;
  if (/^0x0{40}$/i.test(String(details.destination || '').trim())) return false;
  if (!String(details.fee || '').trim()) return false;
  return true;
}

export function addressEdges(address: string): { start: string; end: string; full: string } | null {
  const full = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(full)) return null;
  return { start: full.slice(0, 6), end: full.slice(-4), full };
}

export type FundsConfirmMode = 'secret' | 'button';

/** La pantalla siempre aparece. Sin datos no se aprueba. Sin protección, el botón confirma y no hay PIN. */
export function fundsConfirmPlan(input: {
  movesFunds: boolean;
  protectionOn: boolean;
  details?: Partial<FundsTxDetails> | null;
}): { showScreen: boolean; mode: FundsConfirmMode; canApprove: boolean } {
  if (!input.movesFunds) {
    return { showScreen: true, mode: 'secret', canApprove: true };
  }
  return {
    showScreen: true,
    mode: input.protectionOn ? 'secret' : 'button',
    canApprove: fundsDetailsComplete(input.details),
  };
}
