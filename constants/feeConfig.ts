import { type Signer } from 'ethers';

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

export async function resolveFeeCollector(_signer: Signer): Promise<string> {
  return '';
}
