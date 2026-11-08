import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { getContractAddress } from '../constants/contractConfig';
import { FAMA_PER_USDT } from '../constants/fama';
import { fameFromPoolUsd } from '../constants/support';
import { isContractConfigured } from '../constants/rpcConfig';
import { useAppMode } from '../wallet/AppModeContext';
import { parsePositiveDecimal } from '../utils/formatters';
import { AppIcon } from './icons';
import { AppSubsection } from './AppSection';
import { AppText, AppTextInput } from './AppText';

interface PoolSupportSectionProps {
  isLoading: boolean;
  tokenSymbol: string;
  tokenSupported: boolean;
  poolBalance: string;
  poolOutstanding?: string;
  poolCash?: string;
  lpBalance?: string;
  walletConnected: boolean;
  paused?: boolean;
  onDepositPool: (amount: string) => void;
}

export const PoolSupportSection: React.FC<PoolSupportSectionProps> = ({
  isLoading,
  tokenSymbol,
  tokenSupported,
  poolBalance,
  poolOutstanding,
  poolCash,
  lpBalance,
  walletConnected,
  paused = false,
  onDepositPool,
}) => {
  const [depositAmount, setDepositAmount] = useState('10');
  const { t } = useI18n();
  const parsedDeposit = parsePositiveDecimal(depositAmount);
  const fameGain = parsedDeposit ? fameFromPoolUsd(Number(parsedDeposit)) : 0;
  const { colors } = useTheme();
  const { mode } = useAppMode();
  const allowDeposit = mode !== 'demo';
  const contractReady = isContractConfigured();
  const blocked = isLoading || !walletConnected || paused || !contractReady;
  const lpValue = Number.parseFloat(lpBalance || '0');
  const showNav = contractReady;

  return (
    <View style={styles.stack}>
      <AppSubsection
        title={t('subsectionPoolInfo')}
        defaultOpen={!allowDeposit || !contractReady}
        icon="info"
      >
        <AppText style={[styles.lead, { color: colors.text }]}>{t('poolPublicLead')}</AppText>
        <AppText style={[styles.locked, { color: colors.textMuted }]}>
          {t('supportPoolBenefit', { points: String(FAMA_PER_USDT), symbol: tokenSymbol })}
        </AppText>
        <AppText style={[styles.locked, { color: colors.textMuted }]}>
          {t('poolLockedNote')}
        </AppText>
        {!allowDeposit ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>{t('poolRealOnly')}</AppText>
        ) : null}
        {showNav ? (
          <AppText
            style={[
              styles.destination,
              {
                color: colors.textMuted,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {t('poolDestination', { amount: `${poolBalance} ${tokenSymbol}` })}
          </AppText>
        ) : !contractReady ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('liveCreditNotReady')}
          </AppText>
        ) : null}
        {showNav && poolCash && poolOutstanding ? (
          <AppText style={[styles.locked, { color: colors.textMuted }]}>
            {t('poolNavExplain', {
              cash: `${poolCash} ${tokenSymbol}`,
              loans: `${poolOutstanding} ${tokenSymbol}`,
            })}
          </AppText>
        ) : null}
        {showNav && lpValue > 0 ? (
          <AppText style={[styles.locked, { color: colors.primary }]}>
            {t('yourLpPosition')}: {lpBalance} {tokenSymbol}
          </AppText>
        ) : null}
        {contractReady ? (
          <>
            <AppText style={[styles.label, { color: colors.primary }]}>
              {t('poolContractLabel')}
            </AppText>
            <AppText
              selectable
              style={[styles.address, { color: colors.primary, backgroundColor: colors.surface }]}
            >
              {getContractAddress()}
            </AppText>
          </>
        ) : null}
      </AppSubsection>
      {allowDeposit ? (
        <AppSubsection
          title={t('subsectionPoolDeposit')}
          defaultOpen={contractReady}
          icon="deposit"
        >
          {!contractReady ? (
            <AppText style={[styles.warn, { color: colors.warnText }]}>
              {t('liveCreditNotReady')}
            </AppText>
          ) : (
            <>
              <AppText style={[styles.locked, { color: colors.textMuted }]}>
                {t('externalPaysLead')}
              </AppText>
              {!walletConnected && (
                <AppText style={[styles.warn, { color: colors.warnText }]}>
                  {t('connectFirst')}
                </AppText>
              )}
              {!tokenSupported && walletConnected && (
                <AppText style={[styles.warn, { color: colors.warnText }]}>
                  {t('tokenNotEnabled')}
                </AppText>
              )}
              <AppText style={[styles.label, { color: colors.primary }]}>
                {t('amountDeposit')} ({tokenSymbol})
              </AppText>
              <AppTextInput
                value={depositAmount}
                onChangeText={setDepositAmount}
                keyboardType="decimal-pad"
                placeholder="10"
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
                <AppText style={[styles.locked, { color: colors.primary }]}>
                  {t('supportFamePreview', { points: String(fameGain) })}
                </AppText>
              ) : null}
              <TouchableOpacity
                disabled={blocked}
                onPress={() => onDepositPool(depositAmount)}
                style={[
                  styles.button,
                  { backgroundColor: colors.primary },
                  blocked && { backgroundColor: colors.chip },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#111" size="small" />
                ) : (
                  <View style={styles.buttonRow}>
                    <AppIcon name="deposit" size={18} color="#111" />
                    <AppText style={styles.buttonText}>{t('depositPool')}</AppText>
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}
        </AppSubsection>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 10,
  },
  lead: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  destination: {
    fontSize: 12,
    lineHeight: 18,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  locked: {
    fontSize: 12,
    lineHeight: 18,
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
  disabled: {
    backgroundColor: '#9e9e9e',
  },
  buttonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
});
