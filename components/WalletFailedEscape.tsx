import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { requestWalletOpenEscape } from '../services/walletOpenEscape';
import { walletFailEscapes } from '../utils/accountEntry';
import { AppText } from './AppText';

interface WalletFailedEscapeProps {
  passwordSet?: boolean;
  onRetry?: () => void;
}

export const WalletFailedEscape: React.FC<WalletFailedEscapeProps> = ({
  passwordSet = true,
  onRetry,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const escapes = walletFailEscapes(passwordSet);

  return (
    <View style={styles.wrap}>
      {onRetry ? (
        <TouchableOpacity onPress={() => onRetry()} accessibilityRole="button" style={styles.row}>
          <AppText style={[styles.action, { color: colors.primary }]}>
            {t('appWalletRetry')}
          </AppText>
        </TouchableOpacity>
      ) : null}
      {escapes.includes('unlock') ? (
        <TouchableOpacity
          onPress={() => requestWalletOpenEscape('unlock')}
          accessibilityRole="button"
          style={styles.row}
        >
          <AppText style={[styles.action, { color: colors.primary }]}>{t('lockUnlock')}</AppText>
        </TouchableOpacity>
      ) : null}
      {escapes.includes('restore') ? (
        <TouchableOpacity
          onPress={() => requestWalletOpenEscape('restore')}
          accessibilityRole="button"
          style={styles.row}
        >
          <AppText style={[styles.action, { color: colors.primary }]}>
            {t('restoreAccount')}
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
    alignItems: 'center',
    gap: 10,
  },
  row: {
    paddingVertical: 4,
  },
  action: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
