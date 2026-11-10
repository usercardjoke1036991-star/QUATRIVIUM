/** Datos que la pantalla debe mostrar antes de firmar un movimiento de LUSD. */

export const NETWORK_FEE_ESTIMATE = '0.0002 ETH';

export type FundsTxDetails = {
  amount: string;
  symbol: string;
  destination: string;
  fee: string;
};

export function fundsTx(amount: string, destination: string): FundsTxDetails {
  return {
    amount: String(amount || '').trim(),
    symbol: 'LUSD',
    destination: String(destination || '').trim(),
    fee: NETWORK_FEE_ESTIMATE,
  };
}

export function fundsDetailsComplete(details?: Partial<FundsTxDetails> | null): boolean {
  if (!details) return false;
  const amount = String(details.amount || '').trim();
  if (!amount || amount === '0' || amount === '0.0' || amount === '0.00') return false;
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
