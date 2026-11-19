import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { CompatibleWallet } from '../constants/compatibleWallets';

const WALLET_ICONS = {
  metamask: require('../assets/wallets/metamask.png'),
  trust: require('../assets/wallets/trust.png'),
  okx: require('../assets/wallets/okx.png'),
  safepal: require('../assets/wallets/safepal.png'),
  tokenpocket: require('../assets/wallets/tokenpocket.png'),
  coinbase: require('../assets/wallets/coinbase.png'),
  bitget: require('../assets/wallets/bitget.png'),
  rainbow: require('../assets/wallets/rainbow.png'),
  rabby: require('../assets/wallets/rabby.png'),
  other: require('../assets/wallets/other.png'),
} as const;

export const WalletMark: React.FC<{ wallet: CompatibleWallet; size?: number }> = ({
  wallet,
  size = 44,
}) => {
  const source = WALLET_ICONS[wallet.id as keyof typeof WALLET_ICONS] || WALLET_ICONS.other;
  return (
    <View
      style={[styles.wrap, { width: size, height: size, borderRadius: Math.round(size * 0.22) }]}
    >
      <Image source={source} style={{ width: size, height: size }} resizeMode="cover" />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
});
