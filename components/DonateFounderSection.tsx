import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { FAMA_PER_USDT } from '../constants/fama';
import { fameFromDonateUsd, supportKind, supportNameKey } from '../constants/support';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { accessPayUsdt, hasCreditAccess, voluntaryDonateUsd } from '../utils/creditGates';
import { formatUSD, parsePositiveDecimal } from '../utils/formatters';
import { AppSubsection } from './AppSection';
import { AppText, AppTextInput } from './AppText';
import { AppIcon } from './icons';

interface DonateFounderSectionProps {
  isLoading: boolean;
  tokenSymbol: string;
  tokenSupported: boolean;
  walletConnected: boolean;
  founderAddress?: string;
  donatedUsd: number;
  altaPaid?: boolean;
  lpUsd: number;
  canSend?: boolean;
  onDonate: (amount: string) => void;
}

export function DonateFounderSection({
  isLoading,
  tokenSymbol,
  tokenSupported,
  walletConnected,
  founderAddress,
  donatedUsd,
  altaPaid = false,
  lpUsd,
  canSend = false,
  onDonate,
}: DonateFounderSectionProps) {
  const [amount, setAmount] = useState('5');
  const { t } = useI18n();
  const { colors } = useTheme();
  const kind = supportKind(voluntaryDonateUsd(donatedUsd), lpUsd);
  const titleKey = supportNameKey(kind);
  const blocked = isLoading || !walletConnected || !canSend || !founderAddress || !tokenSupported;
  const parsed = parsePositiveDecimal(amount);
  const fameGain = parsed ? fameFromDonateUsd(Number(parsed)) : 0;
  const voluntary = voluntaryDonateUsd(donatedUsd);
  const accessPaid = hasCreditAccess(donatedUsd, altaPaid);

  return (
    <View style={styles.stack}>
      <AppSubsection title={t('donateTitle')} defaultOpen icon="star">
        <AppText style={[styles.lead, { color: colors.text }]}>{t('donateLead')}</AppText>
        <AppText style={[styles.meta, { color: colors.textMuted }]}>{t('donateNotPool')}</AppText>
        {!canSend ? (
          <AppText style={[styles.meta, { color: colors.warnText }]}>
            {t('liveCreditNotReady')}
          </AppText>
        ) : !founderAddress ? (
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('donateWalletPending')}
          </AppText>
        ) : !tokenSupported && walletConnected ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('tokenNotEnabled')}
          </AppText>
        ) : null}
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('supportDonateBenefit', { points: String(FAMA_PER_USDT), symbol: tokenSymbol })}
        </AppText>
        {titleKey ? (
          <AppText style={[styles.title, { color: colors.primary }]}>
            {t('supportYourTitle', { title: t(titleKey) })}
          </AppText>
        ) : null}
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {t('donateSupportTotal')} · {formatUSD(voluntary)}
        </AppText>
        {accessPaid ? (
          <AppText style={[styles.meta, { color: colors.textMuted }]}>
            {t('donateAccessNote', { amount: String(accessPayUsdt()) })}
          </AppText>
        ) : null}
        <AppText style={[styles.label, { color: colors.primary }]}>
          {t('donateAmount')} ({tokenSymbol})
        </AppText>
        <AppTextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="5"
          editable={!blocked}
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
        />
        {fameGain > 0 ? (
          <AppText style={[styles.meta, { color: colors.primary }]}>
            {t('supportFamePreview', { points: String(fameGain) })}
          </AppText>
        ) : null}
        <TouchableOpacity
          disabled={blocked}
          onPress={() => onDonate(amount)}
          style={[styles.button, { backgroundColor: blocked ? colors.chip : colors.primary }]}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <View style={styles.buttonRow}>
              <AppIcon
                name="deposit"
                size={18}
                color={blocked ? colors.textMuted : colors.onPrimary}
              />
              <AppText
                style={[
                  styles.buttonText,
                  { color: blocked ? colors.textMuted : colors.onPrimary },
                ]}
              >
                {t('donateNow')}
              </AppText>
            </View>
          )}
        </TouchableOpacity>
      </AppSubsection>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 10,
  },
  lead: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  address: {
    fontFamily: 'monospace',
    fontSize: 11,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  warn: {
    fontSize: 12,
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
