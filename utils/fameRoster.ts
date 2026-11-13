import { getAddress } from 'ethers';

const ZERO = '0x0000000000000000000000000000000000000000';

function normalizeAddress(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return '';
  }
}

/** Orden estable de altas leídas en la cadena: bloque, índice, y referidos del padre. */
export function rosterFromSignupEvents(
  events: { blockNumber?: number; index?: number; usuario: string; padre?: string }[]
): { order: string[]; referrals: Map<string, number> } {
  const order: string[] = [];
  const seen = new Set<string>();
  const referrals = new Map<string, number>();
  const remember = (address: string) => {
    const keyAddr = address.toLowerCase();
    if (!keyAddr || seen.has(keyAddr) || address === ZERO) return;
    seen.add(keyAddr);
    order.push(address);
  };
  const sorted = [...events].sort((left, right) => {
    const block = (left.blockNumber || 0) - (right.blockNumber || 0);
    if (block !== 0) return block;
    return (left.index || 0) - (right.index || 0);
  });
  for (const event of sorted) {
    const usuario = normalizeAddress(event.usuario);
    const padre = normalizeAddress(event.padre || '');
    if (!usuario) continue;
    remember(usuario);
    if (padre && padre !== ZERO && padre.toLowerCase() !== usuario.toLowerCase()) {
      remember(padre);
      referrals.set(padre.toLowerCase(), (referrals.get(padre.toLowerCase()) || 0) + 1);
    }
  }
  return { order, referrals };
}
