import { isAddress } from 'ethers';
import { ZERO_ADDRESS } from './bsc';
import { DEPLOYED_MAINNET, DEPLOYED_TESTNET } from './deployedAddresses';
import { isDemoAccount } from './rpcConfig';

export const FAMA_ABI = [
  'function FAMA_POR_USDT() view returns (uint256)',
  'function FAMA_POR_REFERIDO_L1() view returns (uint256)',
  'function famaPorGeneracion(uint8 gen) view returns (uint256)',
  'function FAMA_CANJE_POR_USDT() view returns (uint256)',
  'function FAMA_POR_DIA_RACHA() view returns (uint256)',
  'function credit() view returns (address)',
  'function token() view returns (address)',
  'function famaCaja(address) view returns (uint256)',
  'function famaRed(address) view returns (uint256)',
  'function famaRacha(address) view returns (uint256)',
  'function famaCanjeada(address) view returns (uint256)',
  'function famaRedCanjeada(address) view returns (uint256)',
  'function famaDisponible(address) view returns (uint256)',
  'function famaRedDisponible(address) view returns (uint256)',
  'function famaPerfil(address) view returns (uint256)',
  'function canjearFama(uint256 fama)',
  'function canjearFamaRed(uint256 fama)',
  'function notificarRacha(address hijo)',
  'function cobrarBonoRacha()',
  'function diasRacha(address) view returns (uint32)',
  'function obtenerRacha(address) view returns (uint32 dias, uint32 diasMax, uint32 ultimoDia, uint32 famaDias, uint32 hitoCobrado, uint256 siguienteHito, uint256 bonoPendiente, bool graciaVigente)',
];

function envAddr(name: string): string {
  return String(process.env[name] || '').trim();
}

/** Dirección conocida (env / deploy). El canje real se habilita con credit.famaHermano(). */
export function getKnownFamaAddress(): string {
  if (isDemoAccount()) {
    return envAddr('EXPO_PUBLIC_FAMA_ADDRESS_TESTNET') || String(DEPLOYED_TESTNET.fama || '');
  }
  return envAddr('EXPO_PUBLIC_FAMA_ADDRESS_MAINNET') || String(DEPLOYED_MAINNET.fama || '');
}

export function isFamaAddress(addr: string): boolean {
  const value = String(addr || '').trim();
  if (!value || !isAddress(value)) return false;
  return value.toLowerCase() !== ZERO_ADDRESS.toLowerCase();
}
