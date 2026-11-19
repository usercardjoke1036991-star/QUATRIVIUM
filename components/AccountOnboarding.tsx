import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { BrandLogo } from './BrandLogo';
import { BrandSplash } from './BrandSplash';
import { UsernameSection } from './UsernameSection';
import { LinkWalletForm } from './LinkWalletForm';
import { loadClaimedUsername } from '../services/accountUsername';
import { hasCompletedWalletLink, loadLinkedExternalWallet } from '../services/linkedWallet';
import { loadLockedSponsor, lockSponsorOnce } from '../services/sponsorLock';
import { resolveSponsorInput } from '../utils/sponsorLock';
import { AppText, AppTextInput } from './AppText';
import { WalletFailedEscape } from './WalletFailedEscape';

interface AccountOnboardingProps {
  walletAddress: string;
  walletReady: boolean;
  walletFailed?: boolean;
  onRetryWallet?: () => void;
  isRegistered: boolean;
  kycDeclarado?: boolean;
  identityBound?: boolean;
  isLoading: boolean;
  paused?: boolean;
  inviteCode?: string;
  canRegisterOnChain?: boolean;
  /** La cadena ya dijo si esta cuenta está registrada. */
  registrationKnown?: boolean;
  /** La fundadora ya nace registrada: no se vuelve a firmar sola. */
  skipAutoRegister?: boolean;
  onRegister: (padre?: string) => void;
  onInviteLocked?: () => void;
  onDeclareKyc?: () => Promise<boolean>;
  onPhoneBound?: () => void;
  children: React.ReactNode;
}

export const AccountOnboarding: React.FC<AccountOnboardingProps> = ({
  walletAddress,
  walletReady,
  walletFailed,
  onRetryWallet,
  isRegistered,
  isLoading,
  paused,
  inviteCode = '',
  canRegisterOnChain = false,
  registrationKnown = false,
  skipAutoRegister = false,
  onRegister,
  onInviteLocked,
  children,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [usernameReady, setUsernameReady] = useState(false);
  const [linkedWallet, setLinkedWallet] = useState('');
  const [linkedReady, setLinkedReady] = useState(false);
  const [inviteDraft, setInviteDraft] = useState(inviteCode);
  const [inviteError, setInviteError] = useState('');
  const [sponsorChecked, setSponsorChecked] = useState(false);
  const [sponsorLocked, setSponsorLocked] = useState(false);
  const triedRegister = useRef(false);

  useEffect(() => {
    let done = false;
    const finish = (value = '') => {
      if (done) return;
      done = true;
      setUsername(value);
      setUsernameReady(true);
    };
    const watchdog = setTimeout(() => {
      void loadClaimedUsername()
        .then((value) => finish(value))
        .catch(() => finish(''));
    }, 3000);
    loadClaimedUsername()
      .then((value) => {
        clearTimeout(watchdog);
        finish(value);
      })
      .catch(() => {
        clearTimeout(watchdog);
        finish('');
      });
    return () => {
      done = true;
      clearTimeout(watchdog);
    };
  }, [walletAddress]);

  useEffect(() => {
    if (inviteCode) setInviteDraft(inviteCode);
  }, [inviteCode]);

  useEffect(() => {
    let done = false;
    if (!walletAddress) {
      setSponsorLocked(false);
      setSponsorChecked(true);
      return undefined;
    }
    setSponsorChecked(false);
    loadLockedSponsor(walletAddress)
      .then((lock) => {
        if (done) return;
        setSponsorLocked(Boolean(lock?.padre || lock?.chosen));
        setSponsorChecked(true);
      })
      .catch(() => {
        if (done) return;
        setSponsorLocked(false);
        setSponsorChecked(true);
      });
    return () => {
      done = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    let done = false;
    if (!walletAddress) {
      setLinkedWallet('');
      setLinkedReady(true);
      return;
    }
    setLinkedReady(false);
    loadLinkedExternalWallet(walletAddress)
      .then((stored) => {
        if (!done) {
          setLinkedWallet(stored);
          setLinkedReady(true);
        }
      })
      .catch(() => {
        if (!done) setLinkedReady(true);
      });
    return () => {
      done = true;
    };
  }, [walletAddress]);

  const onboardingDone = Boolean(
    (sponsorLocked || isRegistered) && hasCompletedWalletLink(linkedWallet)
  );

  useEffect(() => {
    if (!sponsorLocked || triedRegister.current || skipAutoRegister || !registrationKnown) return;
    if (!onboardingDone || isRegistered || !canRegisterOnChain || paused || isLoading) return;
    triedRegister.current = true;
    onRegister();
  }, [
    onboardingDone,
    isRegistered,
    canRegisterOnChain,
    paused,
    isLoading,
    onRegister,
    registrationKnown,
    skipAutoRegister,
    sponsorLocked,
  ]);

  if (walletFailed || (walletReady && !walletAddress)) {
    return (
      <SafeAreaView
        style={[
          styles.fill,
          { backgroundColor: colors.bg, justifyContent: 'center', paddingHorizontal: 24 },
        ]}
      >
        <AppText style={[styles.title, { color: colors.text }]}>{t('appWalletFailed')}</AppText>
        <WalletFailedEscape onRetry={onRetryWallet} />
      </SafeAreaView>
    );
  }

  const askSponsor = !isRegistered && !sponsorLocked && registrationKnown;

  if (
    !walletReady ||
    !usernameReady ||
    !linkedReady ||
    (!isRegistered && !sponsorChecked) ||
    (!isRegistered && !sponsorLocked && !registrationKnown)
  ) {
    return <BrandSplash />;
  }

  const confirmSponsor = async () => {
    try {
      const resolved = resolveSponsorInput(inviteDraft, walletAddress);
      if (!resolved.ok) {
        setInviteError(resolved.reason === 'self' ? t('cannotSelfInvite') : t('invalidSponsor'));
        return;
      }
      await lockSponsorOnce(walletAddress, inviteDraft, true);
      onInviteLocked?.();
      setSponsorLocked(true);
    } catch (err) {
      const reason = err instanceof Error ? err.message : '';
      setInviteError(reason === 'self' ? t('cannotSelfInvite') : t('invalidSponsor'));
    }
  };

  if (askSponsor) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <BrandLogo size={64} style={styles.logo} />
          <AppText style={[styles.title, { color: colors.text }]}>{t('signupInviteLabel')}</AppText>
          <AppText style={[styles.inviteLead, { color: colors.textMuted }]}>
            {t('signupInviteLead')}
          </AppText>
          <AppTextInput
            value={inviteDraft}
            onChangeText={(value) => {
              setInviteDraft(value);
              setInviteError('');
            }}
            placeholder={t('invitePlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[
              styles.inviteInput,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.inputBorder,
                color: colors.text,
              },
            ]}
          />
          {inviteError ? (
            <AppText style={[styles.inviteError, { color: colors.danger }]}>{inviteError}</AppText>
          ) : null}
          <UsernameSection
            walletAddress={walletAddress}
            claimedUsername={username}
            beforeClaim={async () => {
              const resolved = resolveSponsorInput(inviteDraft, walletAddress);
              if (!resolved.ok) {
                setInviteError(
                  resolved.reason === 'self' ? t('cannotSelfInvite') : t('invalidSponsor')
                );
                throw new Error('invite');
              }
              await lockSponsorOnce(walletAddress, inviteDraft, true);
              onInviteLocked?.();
            }}
            onClaimed={async (value) => {
              await lockSponsorOnce(walletAddress, inviteDraft, true);
              onInviteLocked?.();
              setSponsorLocked(true);
              setUsername(value);
            }}
          />
          <TouchableOpacity
            style={[styles.continue, { backgroundColor: colors.primary }]}
            onPress={() => {
              void confirmSponsor();
            }}
          >
            <AppText style={[styles.continueText, { color: colors.onPrimary }]}>
              {t('createContinue')}
            </AppText>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!hasCompletedWalletLink(linkedWallet)) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <BrandLogo size={64} style={styles.logo} />
          <AppText style={[styles.title, { color: colors.text }]}>{t('linkWalletTitle')}</AppText>
          <AppText style={[styles.lead, { color: colors.textMuted }]}>
            {t('linkWalletLead')}
          </AppText>
          <LinkWalletForm
            internalWallet={walletAddress}
            onLinked={(external) => {
              setLinkedWallet(external);
            }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 40,
  },
  logo: {
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  inviteLead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  inviteInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 13,
  },
  inviteError: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  continue: {
    marginTop: 12,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
