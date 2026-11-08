import type { AppMode } from '../constants/rpcConfig';

/** En Cuenta Real el sobre no se guarda ni se opera desde AsyncStorage. */
export function allowWalletAsyncFallback(productMode: AppMode): boolean {
  return productMode !== 'live';
}
