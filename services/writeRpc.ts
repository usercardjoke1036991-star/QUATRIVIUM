import {
  FeeData,
  JsonRpcProvider,
  Transaction,
  TransactionResponse,
  type BlockTag,
  type TransactionRequest,
} from 'ethers';
import { publicRpcList } from '../constants/rpcConfig';
import {
  broadcastRawAcrossRpcs,
  highestFee,
  highestPendingNonce,
  nonceAfterHold,
  publicJsonRpc,
  rejectReusedNonce,
  type HeldSend,
} from '../utils/broadcastRpc';

const heldBySender = new Map<string, HeldSend>();

function holdKey(from: string): string {
  return from.toLowerCase();
}

export function notePendingSend(from: string, nonce: number, hash: string): void {
  heldBySender.set(holdKey(from), { nonce, hash: hash.toLowerCase() });
}

export function heldSend(from: string): HeldSend | null {
  return heldBySender.get(holdKey(from)) ?? null;
}

export function nonceForSender(networkNonce: number, from: string): number {
  const held = heldSend(from);
  const next = nonceAfterHold(networkNonce, held);
  if (held && networkNonce > held.nonce) heldBySender.delete(holdKey(from));
  return next;
}

/** Proveedor de escritura: nonce, gas, comisión y espera no salen de un solo RPC. */
export function createWriteProvider(chainId: number, chainName: string): JsonRpcProvider {
  const urls = publicRpcList();
  if (urls.length === 0) throw new Error('no-rpc');
  const network = { chainId, name: chainName };
  const nodes = urls.map(
    (url) => new JsonRpcProvider(url, network, { staticNetwork: true, batchMaxCount: 1 })
  );
  const provider = nodes[0];
  const primary = {
    getBlockNumber: provider.getBlockNumber.bind(provider),
    getTransaction: provider.getTransaction.bind(provider),
    getBlock: provider.getBlock.bind(provider),
    estimateGas: provider.estimateGas.bind(provider),
    getFeeData: provider.getFeeData.bind(provider),
  };

  const relay = async <T>(
    read: (node: JsonRpcProvider, index: number) => Promise<T>
  ): Promise<T> => {
    let last: unknown;
    for (let index = 0; index < nodes.length; index += 1) {
      try {
        return await read(nodes[index], index);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error('rpc');
  };

  provider.getBlockNumber = () =>
    relay((node, index) => (index === 0 ? primary.getBlockNumber() : node.getBlockNumber()));

  provider.getTransaction = async (hash: string) => {
    let sawNull = false;
    let last: unknown;
    for (let index = 0; index < nodes.length; index += 1) {
      try {
        const tx =
          index === 0
            ? await primary.getTransaction(hash)
            : await nodes[index].getTransaction(hash);
        if (tx) return tx;
        sawNull = true;
      } catch (error) {
        last = error;
      }
    }
    if (sawNull) return null;
    throw last instanceof Error ? last : new Error('rpc');
  };

  provider.getBlock = ((block: BlockTag, prefetchTxs?: boolean) =>
    relay((node, index) =>
      index === 0 ? primary.getBlock(block, prefetchTxs) : node.getBlock(block, prefetchTxs)
    )) as JsonRpcProvider['getBlock'];

  provider.estimateGas = (tx: TransactionRequest) =>
    relay((node, index) => (index === 0 ? primary.estimateGas(tx) : node.estimateGas(tx)));

  provider.getFeeData = async () => {
    const quote = await highestFee(
      nodes.map((node, index) => async () => {
        const data = index === 0 ? await primary.getFeeData() : await node.getFeeData();
        const tip = data.maxPriorityFeePerGas ?? data.gasPrice ?? 0n;
        const maxFee = data.maxFeePerGas ?? data.gasPrice ?? tip;
        return { maxFee, tip };
      })
    );
    return new FeeData(null, quote.maxFee, quote.tip);
  };

  provider.getTransactionCount = async (address: string, blockTag?: BlockTag) => {
    if (blockTag == null || blockTag === 'pending') {
      const networkNonce = await highestPendingNonce(urls, address, publicJsonRpc);
      return nonceForSender(networkNonce, address);
    }
    const raw = await relay((node) => node.getTransactionCount(address, blockTag));
    return Number(raw);
  };

  provider.broadcastTransaction = async (signedTx: string) => {
    const tx = Transaction.from(signedTx);
    if (!tx.from || tx.hash == null || tx.nonce == null || !tx.signature) {
      throw new Error('unsigned');
    }
    rejectReusedNonce(heldSend(tx.from), tx.nonce, tx.hash);
    const outcome = await broadcastRawAcrossRpcs({
      urls,
      raw: signedTx,
      from: tx.from,
      nonce: tx.nonce,
      hash: tx.hash,
      call: publicJsonRpc,
    });
    notePendingSend(tx.from, tx.nonce, outcome.hash);
    return new TransactionResponse(
      {
        hash: outcome.hash,
        blockNumber: null,
        blockHash: null,
        index: 0,
        type: tx.type ?? 0,
        to: tx.to,
        from: tx.from,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        data: tx.data,
        value: tx.value,
        gasPrice: tx.gasPrice ?? tx.maxFeePerGas ?? 0n,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        chainId: tx.chainId,
        signature: tx.signature,
        accessList: tx.accessList,
        authorizationList: tx.authorizationList,
      },
      provider
    );
  };

  return provider;
}
