import { isAddress } from 'ethers';
import { ZERO_ADDRESS } from './arbitrum';
import { DEPLOYED_MAINNET, DEPLOYED_TESTNET } from './deployedAddresses';
import { isDemoAccount } from './rpcConfig';

export const ALTA_ABI = [
  'function pagarRegistro()',
  'function padrinoApartado(address) view returns (uint256)',
  'function padrinoExpira(address) view returns (uint256)',
  'function registroHecho(address) view returns (bool)',
  'function vencerPadrinoAlPool(address deudor)',
  'function credit() view returns (address)',
  'function reserva() view returns (address)',
];

/** Registro Real de una vez: 1 fundador + 1 Reserva + 1 padrino + 1 sello. */
export const CREDIT_ALTA_USDT = 4;
/** El 1 USDT de sello viaja dentro de los 4 del alta. */
export const CREDIT_SELLO_USDT = 1;

function envAddr(name: string): string {
  return String(process.env[name] || '').trim();
}

export function getAltaAddress(): string {
  if (isDemoAccount()) {
    return envAddr('EXPO_PUBLIC_ALTA_ADDRESS_TESTNET') || DEPLOYED_TESTNET.alta || '';
  }
  return envAddr('EXPO_PUBLIC_ALTA_ADDRESS_MAINNET') || DEPLOYED_MAINNET.alta || '';
}

export function isAltaConfigured(): boolean {
  const address = getAltaAddress();
  return (
    Boolean(address) && isAddress(address) && address.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
  );
}
