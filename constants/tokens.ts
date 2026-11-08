import { getUsdtAddress } from './contractConfig';
import { ARBITRUM_MAINNET } from './bsc';
import { DEPLOYED_TESTNET } from './deployedAddresses';
import { isDemoMode } from './rpcConfig';

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  priceUSD: number;
  color: string;
}

export interface ConfigurableStable {
  symbol: string;
  address: string;
  feed: string;
}

const LUSD_META: Omit<Token, 'address'> = {
  symbol: 'LUSD',
  decimals: 18,
  priceUSD: 1.0,
  color: '#2EB6EA',
};

/** LUSD es la moneda única en Arbitrum One (sin otras stables secundarias). */
export function getConfigurableStables(): ConfigurableStable[] {
  return [];
}

export function getSupportedTokens(): Token[] {
  const lusd: Token = {
    ...LUSD_META,
    address: isDemoMode() ? getUsdtAddress() : ARBITRUM_MAINNET.lusd,
  };
  return [lusd];
}

export function getTokenMeta(address: string): Token | undefined {
  const needle = address.toLowerCase();
  return getSupportedTokens().find((token) => token.address.toLowerCase() === needle);
}

/** LUSD oficial del mundo activo. Un RPC caído no debe tratarlo como «token apagado». */
export function isOfficialWorldToken(address: string): boolean {
  const needle = (address || '').trim().toLowerCase();
  if (!needle.startsWith('0x') || needle.length !== 42) return false;
  if (isDemoMode()) {
    return (
      needle === getUsdtAddress().toLowerCase() || needle === DEPLOYED_TESTNET.usdt.toLowerCase()
    );
  }
  return needle === ARBITRUM_MAINNET.lusd.toLowerCase();
}
