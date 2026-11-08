import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { isContractConfigured } from '../constants/rpcConfig';
import { useAppMode } from '../wallet/AppModeContext';

/** Una línea: qué cuenta está abierta. Sin red, contrato ni cadena. */
export const AccountWorldCard: React.FC = () => {
  const { mode } = useAppMode();
  const { t } = useI18n();
  const { colors } = useTheme();
  const demo = mode === 'demo';
  const livePending = !demo && !isContractConfigured('mainnet');
  const title = demo ? t('accountWorldDemo') : t('accountWorldLive');
  const tag = demo
    ? t('accountWorldDemoTag')
    : livePending
      ? t('accountWorldLivePendingTag')
      : t('accountWorldLiveTag');
  const accent = demo ? colors.warnText : livePending ? colors.warnText : colors.success;
  const bg = demo || livePending ? colors.warnBg : colors.chip;

  return (
    <View
      style={[styles.box, { backgroundColor: bg, borderColor: colors.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${tag}`}
    >
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>
      <AppText style={[styles.tag, { color: accent }]}>{tag}</AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  tag: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: '700',
  },
});
