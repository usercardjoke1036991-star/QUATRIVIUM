import {
  FeeData,
  JsonRpcProvider,
  Transaction,
  TransactionResponse,
  type BlockTag,
  type TransactionRequest,
} from 'ethers';
import { publicRpcList } from '../constants/rpcConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  broadcastRawAcrossRpcs,
  hashSightings,
  highestFee,
  highestPendingNonce,
  nonceAfterHold,
  publicJsonRpc,
  rejectReusedNonce,
} from '../utils/broadcastRpc';
import {
  deleteHold,
  readHold,
  settleHold,
  shouldReleaseHold,
  type HoldStore,
} from '../utils/pendingHold';

const holdStore: HoldStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: async (key, value) => {
    await AsyncStorage.setItem(key, value);
  },
  del: async (key) => {
    await AsyncStorage.removeItem(key);
  },
};

export async function nonceForSender(networkNonce: number, from: string): Promise<number> {
  const held = await readHold(holdStore, from);
  if (!held) return networkNonce;
  if (networkNonce > held.nonce) {
    await deleteHold(holdStore, from);
    return networkNonce;
  }
  return nonceAfterHold(networkNonce, held);
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
      const held = await readHold(holdStore, address);
      if (
        held &&
        shouldReleaseHold(await hashSightings(urls, held.hash, publicJsonRpc), networkNonce, held)
      ) {
        await deleteHold(holdStore, address);
        return networkNonce;
      }
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
    rejectReusedNonce(await readHold(holdStore, tx.from), tx.nonce, tx.hash);
    const outcome = await broadcastRawAcrossRpcs({
      urls,
      raw: signedTx,
      from: tx.from,
      nonce: tx.nonce,
      hash: tx.hash,
      call: publicJsonRpc,
    });
    let networkNonce: number | null = null;
    try {
      networkNonce = await highestPendingNonce(urls, tx.from, publicJsonRpc);
    } catch {
      networkNonce = null;
    }
    const seen = await hashSightings(urls, outcome.hash, publicJsonRpc);
    const release = outcome.kind === 'pending' && seen === 0 && networkNonce === tx.nonce;
    const kept = await settleHold(holdStore, {
      from: tx.from,
      nonce: tx.nonce,
      hash: outcome.hash,
      release,
    });
    if (kept === 'released') throw new Error('broadcast-failed');
    const response = new TransactionResponse(
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
    (response as TransactionResponse & { broadcastKind: 'sent' | 'pending' }).broadcastKind =
      outcome.kind;
    return response;
  };

  return provider;
}
