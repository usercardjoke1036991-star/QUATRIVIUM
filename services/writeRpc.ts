import { JsonRpcProvider, Transaction, type TransactionResponse } from 'ethers';
import { publicRpcList } from '../constants/rpcConfig';
import { broadcastRawAcrossRpcs, publicJsonRpc } from '../utils/broadcastRpc';

type WrapResponse = {
  _wrapTransactionResponse: (
    tx: Transaction,
    network: unknown
  ) => { replaceableTransaction: (blockNumber: number) => TransactionResponse };
};

/** Proveedor de escritura: el envío recorre los RPC públicos y no firma una segunda transacción. */
export function createWriteProvider(chainId: number, chainName: string): JsonRpcProvider {
  const urls = publicRpcList();
  if (urls.length === 0) throw new Error('no-rpc');
  const provider = new JsonRpcProvider(
    urls[0],
    { chainId, name: chainName },
    { staticNetwork: true }
  );
  provider.broadcastTransaction = async (signedTx: string): Promise<TransactionResponse> => {
    const tx = Transaction.from(signedTx);
    if (!tx.from || tx.hash == null || tx.nonce == null) {
      throw new Error('unsigned');
    }
    await broadcastRawAcrossRpcs({
      urls,
      raw: signedTx,
      from: tx.from,
      nonce: tx.nonce,
      hash: tx.hash,
      call: publicJsonRpc,
    });
    const network = await provider.getNetwork();
    let blockNumber = 0;
    try {
      blockNumber = await provider.getBlockNumber();
    } catch {
      blockNumber = 0;
    }
    return (provider as unknown as WrapResponse)
      ._wrapTransactionResponse(tx, network)
      .replaceableTransaction(blockNumber);
  };
  return provider;
}
