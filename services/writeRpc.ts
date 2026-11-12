import {
  FeeData,
  JsonRpcProvider,
  Transaction,
  TransactionResponse,
  type BlockTag,
  type TransactionRequest,
} from 'ethers';
import { NETWORK_CONFIG, publicRpcList } from '../constants/rpcConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  broadcastRawAcrossRpcs,
  hashSightings,
  highestFee,
  highestPendingNonce,
  nonceAfterHold,
  publicJsonRpc,
  rejectReusedNonce,
  type RpcCall,
} from '../utils/broadcastRpc';
import {
  deleteHold,
  discardChainHolds,
  readHold,
  settleHold,
  shouldReleaseHold,
  type HoldStore,
} from '../utils/pendingHold';

export type WriteRpcInject = {
  urls: readonly string[];
  nodes: JsonRpcProvider[];
  call: RpcCall;
};

let unseenRecheckMs = 1_500;
let receiptNodes: ReceiptNode[] | null = null;

export type ReceiptLike = {
  hash?: string;
  blockNumber?: number | null;
  blockHash?: string | null;
  status?: number | bigint;
};

export type ReceiptNode = {
  getTransactionReceipt(hash: string): Promise<unknown>;
};

/** Solo pruebas de WalletConnect: los recibos salen de estos nodos, no de la billetera. */
function setReceiptNodes(nodes: ReceiptNode[] | null): void {
  receiptNodes = nodes;
}

export function ownReceiptNodes(): ReceiptNode[] {
  if (receiptNodes) return receiptNodes;
  const network = { chainId: NETWORK_CONFIG.chainId, name: NETWORK_CONFIG.chainName };
  return publicRpcList().map((url) => {
    const node = new JsonRpcProvider(url, network, { staticNetwork: true, batchMaxCount: 1 });
    return {
      getTransactionReceipt: (wanted: string) => node.getTransactionReceipt(wanted),
    };
  });
}

function confirmedReceipt(receipt: unknown, hash: string): ReceiptLike | null {
  if (!receipt || typeof receipt !== 'object') return null;
  const row = receipt as ReceiptLike;
  if (row.blockNumber == null || Number(row.blockNumber) <= 0) return null;
  if (!row.blockHash) return null;
  if (String(row.hash || '').toLowerCase() !== hash.toLowerCase()) return null;
  return row;
}

function sameReceipt(left: ReceiptLike, right: ReceiptLike): boolean {
  return (
    String(left.hash || '').toLowerCase() === String(right.hash || '').toLowerCase() &&
    String(left.blockHash || '').toLowerCase() === String(right.blockHash || '').toLowerCase() &&
    Number(left.status) === Number(right.status)
  );
}

function agreedReceipt(values: readonly ReceiptLike[]): ReceiptLike | null {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (sameReceipt(values[i], values[j])) return values[i];
    }
  }
  return null;
}

/**
 * Hacen falta dos RPC propios que coincidan en hash, estado y bloque.
 * No tienen que ser los dos primeros: vale cualquier par entre los N.
 * Si ninguno coincide, o solo responde uno, el envío sigue pendiente.
 */
export async function firstConfirmedReceipt(
  hash: string,
  nodes: readonly ReceiptNode[]
): Promise<ReceiptLike | null> {
  let thrown: unknown = null;
  const settled = await Promise.all(
    nodes.map(async (node) => {
      try {
        const receipt = await node.getTransactionReceipt(hash);
        const confirmed = confirmedReceipt(receipt, hash);
        if (!confirmed) return { ok: false as const, empty: true };
        return { ok: true as const, empty: false, value: confirmed };
      } catch (error) {
        thrown = error;
        return { ok: false as const, empty: false };
      }
    })
  );
  const values = settled.flatMap((row) => (row.ok ? [row.value] : []));
  const agreed = agreedReceipt(values);
  if (agreed) return agreed;
  if (values.length >= 1 || settled.some((row) => row.empty)) return null;
  throw thrown instanceof Error ? thrown : new Error('rpc');
}

/** Solo pruebas: la segunda consulta del hash no tiene que esperar un segundo. */
function setUnseenRecheck(ms: number): void {
  unseenRecheckMs = ms;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const holdStore: HoldStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: async (key, value) => {
    await AsyncStorage.setItem(key, value);
  },
  del: async (key) => {
    await AsyncStorage.removeItem(key);
  },
};

let holdStoreOverride: HoldStore | null = null;

/** Solo pruebas: el módulo ya cargado no puede cambiar de AsyncStorage a mitad de la suite. */
function setHoldStore(store: HoldStore | null): void {
  holdStoreOverride = store;
}

function holds(): HoldStore {
  return holdStoreOverride ?? holdStore;
}

export async function nonceForSender(
  chainId: number,
  networkNonce: number,
  from: string
): Promise<number> {
  const held = await readHold(holds(), chainId, from);
  if (!held) return networkNonce;
  if (networkNonce > held.nonce) {
    await deleteHold(holds(), chainId, from);
    return networkNonce;
  }
  return nonceAfterHold(networkNonce, held);
}

/** Borra el pendiente de esta red. La pantalla ya avisó que podría cobrarse dos veces. */
export async function discardPendingSends(chainId: number): Promise<number> {
  return discardChainHolds(holds(), chainId);
}

/** Proveedor de escritura: nonce, gas, comisión y espera no salen de un solo RPC. */
export function createWriteProvider(
  chainId: number,
  chainName: string,
  injected?: WriteRpcInject
): JsonRpcProvider {
  const urls = [...(injected?.urls ?? publicRpcList())];
  const call = injected?.call ?? publicJsonRpc;
  if (urls.length === 0) throw new Error('no-rpc');
  const network = { chainId, name: chainName };
  const nodes =
    injected?.nodes ??
    urls.map((url) => new JsonRpcProvider(url, network, { staticNetwork: true, batchMaxCount: 1 }));
  const provider = nodes[0];
  const primaryReceipt = provider.getTransactionReceipt.bind(provider);
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
      const networkNonce = await highestPendingNonce(urls, address, call);
      const held = await readHold(holds(), chainId, address);
      if (held?.unseen) {
        const seen = await hashSightings(urls, held.hash, call);
        if (seen > 0) throw new Error('pending-nonce');
        await deleteHold(holds(), chainId, address);
        return networkNonce;
      }
      if (
        held &&
        shouldReleaseHold(await hashSightings(urls, held.hash, call), networkNonce, held)
      ) {
        await deleteHold(holds(), chainId, address);
        return networkNonce;
      }
      return nonceForSender(chainId, networkNonce, address);
    }
    const raw = await relay((node) => node.getTransactionCount(address, blockTag));
    return Number(raw);
  };

  provider.getTransactionReceipt = ((hash: string) =>
    firstConfirmedReceipt(
      hash,
      nodes.map((node, index) => ({
        getTransactionReceipt: (wanted: string) =>
          index === 0 ? primaryReceipt(wanted) : node.getTransactionReceipt(wanted),
      }))
    )) as JsonRpcProvider['getTransactionReceipt'];
  (provider as JsonRpcProvider & { quatriviumReceipts?: boolean }).quatriviumReceipts = true;

  provider.broadcastTransaction = async (signedTx: string) => {
    const tx = Transaction.from(signedTx);
    if (!tx.from || tx.hash == null || tx.nonce == null || !tx.signature) {
      throw new Error('unsigned');
    }
    rejectReusedNonce(await readHold(holds(), chainId, tx.from), tx.nonce, tx.hash);
    const outcome = await broadcastRawAcrossRpcs({
      urls,
      raw: signedTx,
      from: tx.from,
      nonce: tx.nonce,
      hash: tx.hash,
      call,
    });
    let networkNonce: number | null = null;
    try {
      networkNonce = await highestPendingNonce(urls, tx.from, call);
    } catch {
      networkNonce = null;
    }
    let seen = await hashSightings(urls, outcome.hash, call);
    if (
      outcome.kind === 'pending' &&
      seen === 0 &&
      networkNonce != null &&
      networkNonce <= tx.nonce
    ) {
      await sleep(unseenRecheckMs);
      seen = await hashSightings(urls, outcome.hash, call);
      try {
        networkNonce = await highestPendingNonce(urls, tx.from, call);
      } catch {
        networkNonce = null;
      }
      if (seen === 0 && networkNonce != null && networkNonce <= tx.nonce) {
        await settleHold(holds(), {
          chainId,
          from: tx.from,
          nonce: tx.nonce,
          hash: outcome.hash,
          release: false,
          unseen: true,
        });
        throw new Error('broadcast-unseen');
      }
    }
    if (networkNonce != null && networkNonce > tx.nonce) {
      await deleteHold(holds(), chainId, tx.from);
    } else {
      await settleHold(holds(), {
        chainId,
        from: tx.from,
        nonce: tx.nonce,
        hash: outcome.hash,
        release: false,
      });
    }
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
    const visible = response as TransactionResponse & {
      broadcastKind: 'sent' | 'pending';
      broadcastSeen: number;
    };
    visible.broadcastSeen = seen;
    visible.broadcastKind = seen >= 2 ? 'sent' : 'pending';
    return response;
  };

  return provider;
}

if (__DEV__) {
  const host = globalThis as { __qcDev?: Record<string, Record<string, unknown>> };
  (host.__qcDev ??= {}).write = { setReceiptNodes, setUnseenRecheck, setHoldStore };
}
