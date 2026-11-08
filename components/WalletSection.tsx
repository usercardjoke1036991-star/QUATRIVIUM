import React, { useState } from 'react';
import { Alert, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { copyText } from '../utils/copyText';
import { formatAddress } from '../utils/formatters';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useAppMode } from '../wallet/AppModeContext';
import { BrandLogo } from './BrandLogo';
import { AppIcon, TokenLogo } from './icons';
import { TransferWalletsModal } from './TransferWalletsModal';
import { LinkedWalletCard } from './LinkedWalletCard';
import type { Token } from '../constants/tokens';
import { AppText } from './AppText';

interface WalletSectionProps {
  walletAddress: string;
  bnbBalance: string;
  tokenBalance: string;
  selectedToken: Token;
  isLoading: boolean;
  onSent: () => void;
  onConnectAdmin?: () => void;
}

export const WalletSection: React.FC<WalletSectionProps> = ({
  walletAddress,
  bnbBalance,
  tokenBalance,
  selectedToken,
  isLoading,
  onSent,
  onConnectAdmin,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { mode } = useAppMode();
  const isDemo = mode === 'demo';
  const [transferMode, setTransferMode] = useState<'in' | 'out' | null>(null);

  const copyAddress = async () => {
    const result = await copyText(walletAddress);
    if (result === 'copied') {
      Alert.alert(t('ready'), t('addressCopied'));
      return;
    }
    if (result === 'failed') {
      Alert.alert(t('wallet'), walletAddress);
    }
  };

  const shareAddress = async () => {
    try {
      await Share.share({ message: walletAddress });
    } catch {
      Alert.alert(t('wallet'), walletAddress);
    }
  };

  if (!walletAddress) {
    return (
      <View style={[styles.warnBox, { backgroundColor: colors.warnBg }]}>
        <AppText style={[styles.warn, { color: colors.warnText }]}>{t('appWalletLoading')}</AppText>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.walletInfo}>
        <BrandLogo size={44} />
        <View style={styles.grow}>
          <AppText style={[styles.walletLabel, { color: colors.textMuted }]}>
            {isDemo ? t('accountWorldDemo') : t('accountWorldLive')}
          </AppText>
          <TouchableOpacity
            onPress={() => void copyAddress()}
            accessibilityRole="button"
            accessibilityLabel={t('copyAddress')}
          >
            <AppText style={[styles.walletAddress, { color: colors.text }]}>
              {formatAddress(walletAddress)}
            </AppText>
          </TouchableOpacity>
        </View>
        <View style={styles.balanceContainer}>
          <AppText style={[styles.balanceLabel, { color: colors.textMuted }]}>
            {t('bnbBalance')}
          </AppText>
          <View style={styles.bnbRow}>
            <TokenLogo symbol="ETH" size={16} />
            <AppText style={[styles.balanceValue, { color: colors.connect }]}>
              {bnbBalance} ETH
            </AppText>
          </View>
        </View>
      </View>
      <LinkedWalletCard internalWallet={walletAddress} />
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.modeButton, { backgroundColor: colors.connect }]}
          onPress={() => void copyAddress()}
          accessibilityRole="button"
          accessibilityLabel={t('copyAddress')}
        >
          <View style={styles.actionRow}>
            <AppIcon name="copy" size={16} color="#111" />
            <AppText style={styles.actionText}>{t('copyAddress')}</AppText>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, { backgroundColor: colors.connect }]}
          onPress={() => void shareAddress()}
          accessibilityRole="button"
          accessibilityLabel={t('appWalletShare')}
        >
          <View style={styles.actionRow}>
            <AppIcon name="share" size={16} color="#111" />
            <AppText style={styles.actionText}>{t('appWalletShare')}</AppText>
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.modeButton, { backgroundColor: colors.primary }]}
          onPress={() => setTransferMode('in')}
          accessibilityRole="button"
          accessibilityLabel={t('appWalletInTitle')}
        >
          <AppText style={styles.actionText}>{t('appWalletInTitle')}</AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, { backgroundColor: colors.primary }]}
          onPress={() => setTransferMode('out')}
          accessibilityRole="button"
          accessibilityLabel={t('appWalletSendTitle')}
        >
          <AppText style={styles.actionText}>{t('appWalletSendTitle')}</AppText>
        </TouchableOpacity>
      </View>
      {onConnectAdmin ? (
        <TouchableOpacity onPress={onConnectAdmin} accessibilityRole="button">
          <AppText style={[styles.hint, { color: colors.textMuted }]}>
            {t('appWalletAdminConnect')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      <TransferWalletsModal
        visible={transferMode !== null}
        mode={transferMode || 'in'}
        walletAddress={walletAddress}
        tokenBalance={tokenBalance}
        bnbBalance={bnbBalance}
        selectedToken={selectedToken}
        isLoading={isLoading}
        onClose={() => setTransferMode(null)}
        onSent={onSent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  actionButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  walletInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  grow: {
    flex: 1,
    paddingRight: 8,
  },
  walletLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  walletAddress: {
    fontSize: 14,
    fontWeight: '600',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  bnbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 10,
  },
  warn: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  warnBox: {
    borderRadius: 12,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
