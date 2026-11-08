import { Contract, type Signer } from 'ethers';
import { getContractAddress } from './contractConfig';
import { isHexAddress } from '../utils/sanitize';

const ZERO = '0x0000000000000000000000000000000000000000';

export async function estimateNetworkGasWei(
  signer: Signer,
  tokenTransfer: boolean
): Promise<bigint> {
  const provider = signer.provider;
  if (!provider) return 0n;
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice || fee.maxFeePerGas || 1_000_000_000n;
  const gasLimit = tokenTransfer ? 65_000n : 21_000n;
  return gasPrice * gasLimit;
}

export async function resolveFeeCollector(signer: Signer): Promise<string> {
  try {
    const contract = new Contract(
      getContractAddress(),
      ['function feeCollector() view returns (address)'],
      signer
    );
    const address = String(await contract.feeCollector()).toLowerCase();
    if (isHexAddress(address) && address !== ZERO) return address;
  } catch {
    // fallback to env only if the contract cannot be read
  }
  const fromEnv = (process.env.EXPO_PUBLIC_FEE_COLLECTOR || '').toLowerCase();
  if (isHexAddress(fromEnv) && fromEnv !== ZERO) {
    return fromEnv;
  }
  return '';
}
