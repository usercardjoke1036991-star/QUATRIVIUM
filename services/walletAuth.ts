import {
  getAddress,
  verifyTypedData,
  type Signer,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';
import { getContractAddress } from '../constants/contractConfig';
import { NETWORK_CONFIG } from '../constants/rpcConfig';
import { getDeviceHash } from './deviceBinding';

export type AuthPurpose =
  | 'vincular-avisos'
  | 'vincular-billetera'
  | 'perfil'
  | 'otp'
  | 'email'
  | 'username'
  | 'demo-identity'
  | 'session'
  | 'identity'
  | 'autofund'
  | 'admin-totp';

export const BIND_WALLET_PURPOSE = 'vincular-billetera' as const;

export const BIND_TYPES: Record<string, TypedDataField[]> = {
  BindWallet: [
    { name: 'appWallet', type: 'address' },
    { name: 'externalWallet', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

const ZERO_PLACEHOLDER = '0x0000000000000000000000000000000000000001';
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const AUTH_TYPES: Record<string, TypedDataField[]> = {
  Auth: [
    { name: 'wallet', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'deviceHash', type: 'bytes32' },
    { name: 'phone', type: 'string' },
  ],
};

export function authDomain(
  chainId = NETWORK_CONFIG.chainId,
  verifyingContract = getContractAddress()
): TypedDataDomain {
  const contract =
    verifyingContract &&
    /^0x[0-9a-fA-F]{40}$/.test(verifyingContract) &&
    !/^0x0{40}$/i.test(verifyingContract)
      ? verifyingContract
      : ZERO_PLACEHOLDER;
  return {
    name: 'Quatrivium Credit',
    version: '2',
    chainId,
    verifyingContract: contract,
  };
}

export type AuthFields = {
  timestamp: number;
  signature: string;
  purpose: AuthPurpose;
  deviceHash: string;
  phone: string;
};

function authValue(
  wallet: string,
  purpose: AuthPurpose,
  timestamp: number,
  deviceHash: string,
  phone: string
) {
  return {
    wallet: getAddress(wallet),
    purpose,
    timestamp,
    deviceHash: deviceHash || ZERO_HASH,
    phone: phone || '',
  };
}

export async function signWalletAuth(
  signer: Signer,
  wallet: string,
  purpose: AuthPurpose,
  extras?: { timestamp?: number; deviceHash?: string; phone?: string }
): Promise<AuthFields> {
  const timestamp = extras?.timestamp ?? Date.now();
  const deviceHash = extras?.deviceHash || (await getDeviceHash());
  const phone = extras?.phone || '';
  const value = authValue(wallet, purpose, timestamp, deviceHash, phone);
  const signature = await signer.signTypedData(authDomain(), AUTH_TYPES, value);
  return { timestamp, signature, purpose, deviceHash, phone };
}

export async function signedAuthBody(
  signer: Signer,
  wallet: string,
  purpose: AuthPurpose,
  extras?: { phone?: string }
): Promise<Record<string, string | number>> {
  const auth = await signWalletAuth(signer, wallet, purpose, extras);
  return {
    wallet: getAddress(wallet),
    purpose: auth.purpose,
    timestamp: auth.timestamp,
    signature: auth.signature,
    deviceHash: auth.deviceHash,
    phone: auth.phone,
  };
}

export function recoverWalletAuth(
  wallet: string,
  purpose: AuthPurpose,
  timestamp: number,
  signature: string,
  chainId = NETWORK_CONFIG.chainId,
  verifyingContract = getContractAddress(),
  deviceHash = ZERO_HASH,
  phone = ''
): string {
  return getAddress(
    verifyTypedData(
      authDomain(chainId, verifyingContract),
      AUTH_TYPES,
      authValue(wallet, purpose, timestamp, deviceHash, phone),
      signature
    )
  );
}

export function isFreshTimestamp(timestamp: number, maxAgeMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  return Number.isFinite(timestamp) && timestamp > 0 && Math.abs(now - timestamp) <= maxAgeMs;
}

function bindValue(appWallet: string, externalWallet: string, timestamp: number) {
  return {
    appWallet: getAddress(appWallet),
    externalWallet: getAddress(externalWallet),
    purpose: BIND_WALLET_PURPOSE,
    timestamp,
  };
}

export async function signBindExternalWallet(
  signer: Signer,
  appWallet: string,
  externalWallet: string
): Promise<{ timestamp: number; signature: string }> {
  const timestamp = Date.now();
  const value = bindValue(appWallet, externalWallet, timestamp);
  const signature = await signer.signTypedData(authDomain(), BIND_TYPES, value);
  const recovered = recoverBindExternalWallet(appWallet, externalWallet, timestamp, signature);
  if (recovered !== getAddress(externalWallet)) throw new Error('bind');
  return { timestamp, signature };
}

export function recoverBindExternalWallet(
  appWallet: string,
  externalWallet: string,
  timestamp: number,
  signature: string,
  chainId = NETWORK_CONFIG.chainId,
  verifyingContract = getContractAddress()
): string {
  return getAddress(
    verifyTypedData(
      authDomain(chainId, verifyingContract),
      BIND_TYPES,
      bindValue(appWallet, externalWallet, timestamp),
      signature
    )
  );
}
