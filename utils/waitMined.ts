import { getProviderWithFallback } from '../constants/rpcConfig';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_MS = 45_000;
const POLL_MS = 1_500;
const RPC_MS = 8_000;

type MinedTx = {
  hash?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Espera el recibo en el RPC de la app. Nunca usa tx.wait() de WalletConnect (se cuelga). */
export async function waitMined(tx: MinedTx, timeoutMs = DEFAULT_MS) {
  const hash = typeof tx.hash === 'string' ? tx.hash : '';
  if (!HASH.test(hash)) throw new Error('tx-timeout');
  const provider = getProviderWithFallback();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await Promise.race([
        provider.getTransactionReceipt(hash),
        sleep(RPC_MS).then(() => null),
      ]);
      if (receipt) {
        if (Number(receipt.status) === 0) throw new Error('tx-reverted');
        return receipt;
      }
    } catch (error) {
      if (String((error as Error)?.message || '') === 'tx-reverted') throw error;
    }
    await sleep(POLL_MS);
  }
  throw new Error('tx-timeout');
}
