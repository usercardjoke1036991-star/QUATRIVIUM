import { isAddress } from 'ethers';
import { ZERO_ADDRESS } from './bsc';
import { DEPLOYED_MAINNET, DEPLOYED_TESTNET } from './deployedAddresses';
import { isDemoAccount } from './rpcConfig';

export const RESERVA_ABI = [
  'function LOCK() view returns (uint256)',
  'function MAX_APY_BP() view returns (uint256)',
  'function token() view returns (address)',
  'function credit() view returns (address)',
  'function bote() view returns (uint256)',
  'function fundador() view returns (address)',
  'function posiciones(address) view returns (uint256 principal, uint256 desde, bool activa, bool enRed)',
  'function desbloqueoDe(address) view returns (uint256)',
  'function techoRendimiento(uint256 principal, uint256 elapsed) view returns (uint256)',
  'function tramo(uint256 principal) view returns (uint256)',
  'function boostRedBp(uint256 t) view returns (uint256)',
  'function corteFundadorBp(uint256 t) view returns (uint256)',
  'function boostPagado(address) view returns (uint256)',
  'function extraComisionDe(address beneficiario, uint256 montoBase) view returns (uint256 extra, uint256 founderCut)',
  'function boostPausado() view returns (bool)',
  'function guardianes() view returns (uint256)',
  'function isGuardian(address) view returns (bool)',
  'function bloquear(uint256 monto)',
  'function desbloquear()',
  'function renovar()',
  'function aportarBote(uint256 monto)',
  'function liquidarBoostComision(address beneficiario, uint256 montoBase) returns (uint256 pagado)',
  'function setCredit(address _credit)',
  'error EsperaTimelock()',
  'error MismaLlave()',
  'error SoloAdmin()',
  'error MontoCero()',
  'error NadaQueMover()',
  'function apyHoyBps() view returns (uint256)',
  'function saludReserva() view returns (uint256 bote_, uint256 bloqueado_, uint256 apyBps)',
  'function totalBloqueado() view returns (uint256)',
];

function envAddr(name: string): string {
  return String(process.env[name] || '').trim();
}

export function getReservaAddress(): string {
  if (isDemoAccount()) {
    return envAddr('EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET') || DEPLOYED_TESTNET.reserva || '';
  }
  return envAddr('EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET') || DEPLOYED_MAINNET.reserva || '';
}

export function isReservaConfigured(): boolean {
  const address = getReservaAddress();
  if (!address || !isAddress(address) || address.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    return false;
  }
  const official = (
    isDemoAccount()
      ? String(DEPLOYED_TESTNET.reserva || '')
      : String(DEPLOYED_MAINNET.reserva || '')
  ).toLowerCase();
  if (!official || official === ZERO_ADDRESS.toLowerCase()) return false;
  return address.toLowerCase() === official;
}

export function reservaUsesPracticeLedger(): boolean {
  return isDemoAccount() && !isReservaConfigured();
}
