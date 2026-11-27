import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { formatAddress } from '../utils/formatters';
import { hasLinkedExternalWallet, loadRequiredExternalWallet } from '../services/linkedWallet';
import { isDemoMode } from '../constants/rpcConfig';
import { useAppMode } from '../wallet/AppModeContext';
import { LinkWalletForm } from './LinkWalletForm';
import { AppText } from './AppText';
interface LinkedWalletCardProps {
  internalWallet: string;
  compact?: boolean;
}
/** Billetera externa de retiro. Se vincula con una prueba en cadena (LinkWalletForm); no hay sesión que conectar. */
export function LinkedWalletCard({ internalWallet, compact = false }: LinkedWalletCardProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { mode } = useAppMode();
  const [linked, setLinked] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!internalWallet) return undefined;
    let live = true;
    loadRequiredExternalWallet(internalWallet)
      .then((stored) => {
        if (live) setLinked(stored);
      })
      .catch(() => {
        if (live) setLinked('');
      });
    return () => {
      live = false;
    };
  }, [internalWallet, mode]);
  const boundLabel = linked ? 'linkWalletChange' : 'linkWalletBind';
  return (
    <View
      style={[
        styles.box,
        compact ? styles.compact : null,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <AppText style={[styles.title, { color: colors.text }]}>{t('wallet')}</AppText>
      <AppText style={[styles.meta, { color: colors.textMuted }]}>
        {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
      </AppText>
      {linked ? (
        <AppText selectable style={[styles.lead, { color: colors.textMuted }]}>
          {formatAddress(linked)}
        </AppText>
      ) : null}
      {editing ? (
        <>
          <LinkWalletForm
            internalWallet={internalWallet}
            allowSkip={false}
            onLinked={(external) => {
              if (hasLinkedExternalWallet(external)) setLinked(external);
              setEditing(false);
            }}
          />
          <TouchableOpacity
            onPress={() => setEditing(false)}
            style={styles.cancel}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <AppText style={[styles.btnText, { color: colors.textMuted }]}>{t('cancel')}</AppText>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          onPress={() => setEditing(true)}
          style={[styles.btn, { backgroundColor: linked ? colors.chip : colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t(boundLabel)}
        >
          <AppText style={[styles.btnText, { color: linked ? colors.text : colors.onPrimary }]}>
            {t(boundLabel)}
          </AppText>
        </TouchableOpacity>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  compact: {
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    fontSize: 12,
    lineHeight: 17,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
});
