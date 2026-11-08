import { Contract, getAddress, isAddress } from 'ethers';
import { ALTA_ABI, getAltaAddress, isAltaConfigured } from '../constants/altaConfig';
import { CONTRACT_ABI, getContractAddress } from '../constants/contractConfig';
import {
  assertTrustedRpc,
  getProviderWithFallback,
  isContractConfigured,
} from '../constants/rpcConfig';
import { loadAppWallet } from './appWallet';
import { waitMined } from '../utils/waitMined';

const SEAL = 10n ** 18n;

export type SponsorSettleResult = 'settled' | 'empty' | 'waiting' | 'no-seal' | 'unavailable';

async function altaAndCredit() {
  if (!isAltaConfigured() || !isContractConfigured()) return null;
  const provider = await assertTrustedRpc(getProviderWithFallback());
  const alta = new Contract(getAltaAddress(), ALTA_ABI, provider);
  const credit = new Contract(getContractAddress(), CONTRACT_ABI, provider);
  return { provider, alta, credit };
}

/** Invitados directos cuyo importe de padrino ya cumplió los 7 días y sigue en el alta. */
export async function expiredSponsorDebtors(candidates: string[]): Promise<string[]> {
  const ready = await altaAndCredit();
  if (!ready) return [];
  const block = await ready.provider.getBlock('latest');
  const now = Number(block?.timestamp || 0);
  const expired: string[] = [];
  for (const candidate of candidates) {
    if (!isAddress(candidate)) continue;
    const deudor = getAddress(candidate);
    const [apartado, expira] = await Promise.all([
      ready.alta.padrinoApartado(deudor),
      ready.alta.padrinoExpira(deudor),
    ]);
    const amount = BigInt(apartado);
    const deadline = Number(expira);
    if (amount > 0n && deadline > 0 && now >= deadline) expired.push(deudor);
  }
  return expired;
}

/** Llama a vencerPadrinoAlPool solo si hay importe vencido y quien llama ya pagó el alta. */
export async function settleExpiredSponsor(deudor: string): Promise<SponsorSettleResult> {
  if (!isAddress(deudor)) return 'unavailable';
  const ready = await altaAndCredit();
  if (!ready) return 'unavailable';
  const debtor = getAddress(deudor);
  const signer = await loadAppWallet();
  if (!signer) return 'unavailable';
  const caller = getAddress(await signer.getAddress());
  const [apartado, expira, seal, block] = await Promise.all([
    ready.alta.padrinoApartado(debtor),
    ready.alta.padrinoExpira(debtor),
    ready.credit.verificadoAlPool(caller),
    ready.provider.getBlock('latest'),
  ]);
  if (BigInt(apartado) === 0n) return 'empty';
  const now = Number(block?.timestamp || 0);
  if (now < Number(expira)) return 'waiting';
  if (BigInt(seal) < SEAL) return 'no-seal';
  const alta = new Contract(getAltaAddress(), ALTA_ABI, signer);
  await alta.vencerPadrinoAlPool.staticCall(debtor);
  await waitMined(await alta.vencerPadrinoAlPool(debtor));
  return 'settled';
}
