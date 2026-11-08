import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { claimUsername, checkUsernameAvailable } from '../services/accountUsername';
import { isValidUsername, normalizeUsername } from '../utils/usernamePolicy';
import { AppText, AppTextInput } from './AppText';

interface UsernameSectionProps {
  walletAddress: string;
  claimedUsername: string;
  legalName?: string;
  includeLegalName?: boolean;
  beforeClaim?: () => Promise<void>;
  onClaimed: (username: string, legalName?: string) => void;
}

export const UsernameSection: React.FC<UsernameSectionProps> = ({
  walletAddress,
  claimedUsername,
  beforeClaim,
  onClaimed,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [username, setUsername] = useState(claimedUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(!claimedUsername);
  const valid = isValidUsername(username);
  const done = Boolean(claimedUsername) && !editing;

  const save = async () => {
    if (!valid || !walletAddress) return;
    setBusy(true);
    setError('');
    try {
      if (beforeClaim) await beforeClaim();
      const next = normalizeUsername(username);
      const free = await checkUsernameAvailable(walletAddress, next);
      if (!free) {
        setError(t('usernameTaken'));
        return;
      }
      const saved = await claimUsername(walletAddress, next);
      await Promise.resolve(onClaimed(saved));
      setEditing(false);
    } catch (caught) {
      const reason = String((caught as Error)?.message || '');
      if (reason === 'invite' || reason === 'invalid' || reason === 'self') return;
      if (reason.includes('username')) setError(t('usernameInvalid'));
      else setError(t('usernameInvalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('usernameLead')}</AppText>
      {done ? (
        <View
          style={[styles.done, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <AppIcon name="check" size={16} color={colors.success} />
          <View style={styles.doneCopy}>
            <AppText style={[styles.doneText, { color: colors.text }]}>@{claimedUsername}</AppText>
            <AppText style={[styles.hint, { color: colors.textMuted, marginBottom: 0 }]}>
              {t('usernameLocked')}
            </AppText>
          </View>
        </View>
      ) : (
        <View>
          <AppText style={[styles.label, { color: colors.text }]}>{t('usernameField')}</AppText>
          <AppTextInput
            value={username}
            onChangeText={(value) => setUsername(normalizeUsername(value))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="usuario"
            placeholderTextColor={colors.textMuted}
            maxLength={20}
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.inputBorder,
                color: colors.text,
              },
            ]}
          />
          <AppText style={[styles.hint, { color: colors.textMuted }]}>{t('usernameHint')}</AppText>
          <TouchableOpacity
            disabled={busy || !valid || !walletAddress}
            onPress={() => void save()}
            style={[
              styles.button,
              { backgroundColor: colors.connect },
              (busy || !valid) && { backgroundColor: colors.chip },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <AppText style={styles.buttonText}>{t('usernameSave')}</AppText>
            )}
          </TouchableOpacity>
          {error ? (
            <AppText style={[styles.warn, { color: colors.danger }]}>{error}</AppText>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 15,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  warn: {
    fontSize: 13,
    lineHeight: 18,
  },
  done: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '600',
  },
  doneCopy: {
    flex: 1,
  },
});
