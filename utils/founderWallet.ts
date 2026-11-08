import { getRealDonationWallet } from '../constants/deployedAddresses';

export function isFounderWallet(wallet?: string, founderAddress?: string): boolean {
  const me = String(wallet || '')
    .trim()
    .toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(me)) return false;
  const known = [founderAddress, getRealDonationWallet()]
    .map((value) =>
      String(value || '')
        .trim()
        .toLowerCase()
    )
    .filter((value) => /^0x[0-9a-f]{40}$/.test(value));
  return known.includes(me);
}
