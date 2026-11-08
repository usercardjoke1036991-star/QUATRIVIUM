import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './AppText';
import { AppIcon } from './icons';

interface ActivateCreditSectionProps {
  isRegistered: boolean;
  checking?: boolean;
  hasActiveLoan?: boolean;
  onRegister: () => void;
  onGoLoans?: () => void;
  isLoading: boolean;
  paused?: boolean;
  contractReady?: boolean;
}

export const ActivateCreditSection: React.FC<ActivateCreditSectionProps> = ({
  isRegistered,
  checking = false,
  hasActiveLoan = false,
  onRegister,
  onGoLoans,
  isLoading,
  paused = false,
  contractReady = true,
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [note, setNote] = useState('');
  const { t } = useI18n();
  const { colors } = useTheme();
  const busy = isLoading || localBusy;
  const blocked = busy || paused || !contractReady;

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <AppIcon name="id" size={16} color={colors.textMuted} />
          <AppText style={[styles.title, { color: colors.text }]}>{t('howItWorks')}</AppText>
        </View>
        <TouchableOpacity
          onPress={() => setShowInfo((value) => !value)}
          style={[styles.infoButton, { backgroundColor: colors.chip }]}
        >
          <AppIcon name="info" size={15} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.cycle}>
        {(['jobCycle1', 'jobCycle2', 'jobCycle3', 'jobCycle4', 'jobCycle5'] as const).map(
          (key, index) => (
            <View key={key} style={styles.cycleRow}>
              <AppText style={[styles.cycleNum, { color: colors.primary }]}>{index + 1}</AppText>
              <AppText style={[styles.cycleText, { color: colors.text }]}>{t(key)}</AppText>
            </View>
          )
        )}
      </View>

      {showInfo ? (
        <View
          style={[
            styles.identityInfo,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <AppText style={[styles.identityNote, { color: colors.textMuted }]}>
            {t('howItWorksBody')}
          </AppText>
        </View>
      ) : null}

      {checking && !isRegistered ? (
        <View
          style={[
            styles.registeredBadge,
            { backgroundColor: colors.chip, borderColor: colors.border },
          ]}
        >
          <ActivityIndicator color={colors.primary} />
          <AppText style={[styles.registeredText, { color: colors.text }]}>
            {t('checkingCredit')}
          </AppText>
        </View>
      ) : isRegistered ? (
        <View
          style={[
            styles.activeBox,
            { backgroundColor: colors.surface, borderColor: colors.success },
          ]}
        >
          <View style={styles.activeTitleRow}>
            <AppIcon name="check" size={20} color={colors.success} />
            <AppText style={[styles.activeTitle, { color: colors.success }]}>
              {t('readyToBorrow')}
            </AppText>
          </View>
          <AppText style={[styles.activeLead, { color: colors.text }]}>
            {t('creditLineActiveLead')}
          </AppText>
          {onGoLoans ? (
            <TouchableOpacity
              onPress={onGoLoans}
              style={[styles.registerButton, { backgroundColor: colors.primary, marginTop: 12 }]}
              accessibilityRole="button"
              accessibilityLabel={t('creditLineActiveNext')}
            >
              <AppText style={styles.registerButtonText}>
                {hasActiveLoan ? t('pay') : t('creditLineActiveNext')}
              </AppText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View>
          {!contractReady ? (
            <AppText style={[styles.note, { color: colors.warnText }]}>
              {t('liveCreditNotReady')}
            </AppText>
          ) : null}
          <TouchableOpacity
            disabled={blocked}
            onPress={() => {
              setNote(t('activatingCredit'));
              setLocalBusy(true);
              void Promise.resolve(onRegister()).finally(() => {
                setLocalBusy(false);
                setNote('');
              });
            }}
            style={[
              styles.registerButton,
              { backgroundColor: colors.connect },
              blocked && { backgroundColor: colors.chip },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <View style={styles.btnRow}>
                <AppIcon name="user" size={16} color={blocked ? colors.textMuted : '#111'} />
                <AppText
                  style={[styles.registerButtonText, blocked && { color: colors.textMuted }]}
                >
                  {paused ? t('actionPaused') : t('activateCredit')}
                </AppText>
              </View>
            )}
          </TouchableOpacity>
          {note ? (
            <AppText style={[styles.note, { color: colors.textMuted }]}>{note}</AppText>
          ) : null}
        </View>
      )}

      <View
        style={[
          styles.securityNote,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <AppIcon name="shield" size={15} color={colors.textMuted} />
        <AppText style={[styles.securityNoteText, { color: colors.textMuted }]}>
          {t('securityNote')}
        </AppText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  infoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  identityInfo: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  identityNote: {
    fontSize: 13,
    lineHeight: 19,
  },
  cycle: {
    gap: 8,
    marginBottom: 14,
  },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cycleNum: {
    fontSize: 14,
    fontWeight: '700',
    width: 16,
    marginTop: 1,
  },
  cycleText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  registeredBadge: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  registeredText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  activeBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 4,
  },
  activeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  activeTitle: {
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
  },
  activeLead: {
    fontSize: 14,
    lineHeight: 20,
  },
  registerButton: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  registerButtonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    textAlign: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securityNote: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  securityNoteText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
});
