/** Direcciones públicas desplegadas. Mainnet (Arbitrum One) se rellena tras `npm run deploy:bsc`. */

export const DEPLOYED_TESTNET = {
  chainId: 421614,
  contract: '',
  usdt: '',
  reserva: '',
  fama: '',
  alta: '',
  startBlock: 0,
} as const;

export const DEPLOYED_MAINNET = {
  chainId: 42161,
  contract: '',
  usdt: '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b',
  reserva: '',
  fama: '',
  alta: '',
  /** Registro del APK. Vacío hasta el despliegue: la app dice versión no verificada. */
  apk: '',
  /** Billetera personal Real (donaciones). */
  founder: '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047',
  startBlock: 0,
} as const;

export function getRealDonationWallet(): string {
  return String(DEPLOYED_MAINNET.founder || '').trim();
}

export function getKnownStartBlock(contractAddress: string): number {
  const addr = String(contractAddress || '').toLowerCase();
  if (!addr) return 0;
  const test = String(DEPLOYED_TESTNET.contract || '').toLowerCase();
  if (test && addr === test) return DEPLOYED_TESTNET.startBlock;
  const official = String(DEPLOYED_MAINNET.contract || '').toLowerCase();
  if (official && addr === official) return DEPLOYED_MAINNET.startBlock;
  return 0;
}
