export interface CompatibleWallet {
  id: string;
  name: string;
  color: string;
}

export const COMPATIBLE_WALLETS: CompatibleWallet[] = [
  { id: 'metamask', name: 'MetaMask', color: '#F6851B' },
  { id: 'trust', name: 'Trust Wallet', color: '#3375BB' },
  { id: 'binance', name: 'Binance Web3', color: '#F0B90B' },
  { id: 'okx', name: 'OKX Wallet', color: '#111111' },
  { id: 'safepal', name: 'SafePal', color: '#4C6FFF' },
  { id: 'tokenpocket', name: 'TokenPocket', color: '#2980FE' },
  { id: 'coinbase', name: 'Coinbase Wallet', color: '#0052FF' },
  { id: 'bitget', name: 'Bitget Wallet', color: '#00C2CE' },
  { id: 'rainbow', name: 'Rainbow', color: '#174299' },
  { id: 'rabby', name: 'Rabby', color: '#7084FF' },
  { id: 'other', name: 'Otra 0x', color: '#2F6F4E' },
];
