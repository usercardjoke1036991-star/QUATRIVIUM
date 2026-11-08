import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { parseAppDeepLink } from '../utils/appDeepLink';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { LanguageSelector } from './LanguageSelector';
import { ThemeToggle } from './ThemeToggle';
import { ModeToggle } from './ModeToggle';
import { SecuritySettings } from './SecuritySettings';
import { AdminAccess } from './AdminAccess';
import { ProfileAvatar } from './ProfileAvatar';
import { rankFrameOuterSize } from './RankFrame';
import { useEquippedFrame } from '../hooks/useEquippedFrame';
import { isFounderWallet } from '../utils/founderWallet';
import { AppIcon } from './icons';
import { BrandLogo } from './BrandLogo';
import { useUserProfile } from '../profile/ProfileContext';
import { useWalletLevel } from '../hooks/useWalletLevel';
import { isPhraseBackedUp } from '../services/appWallet';
import { useAppMode } from '../wallet/AppModeContext';
import type { TranslationKey } from '../i18n/translations';
import { AppText } from './AppText';
import { LegalDocuments } from './LegalDocuments';
import { HowTheAppWorks } from './HowTheAppWorks';
import { isPickerHeld } from '../utils/pickerHold';

type Panel =
  | 'home'
  | 'security'
  | 'appearance'
  | 'language'
  | 'mode'
  | 'admin'
  | 'privacy'
  | 'terms'
  | 'guide';

const HUB_PHOTO = 44;

interface SettingsButtonProps {
  isFounder?: boolean;
  founderAddress?: string;
  naturalLevel?: number;
}

export const SettingsButton: React.FC<SettingsButtonProps> = ({
  isFounder = false,
  founderAddress = '',
  naturalLevel = 1,
}) => {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('home');
  const [phraseWarning, setPhraseWarning] = useState(false);
  const { t } = useI18n();
  const { colors } = useTheme();
  const { profile, walletAddress } = useUserProfile();
  const level = useWalletLevel(walletAddress, naturalLevel);
  const founder = isFounder || isFounderWallet(walletAddress, founderAddress);
  const { displayLevel } = useEquippedFrame(walletAddress, founder, level);
  const frameBox = rankFrameOuterSize(HUB_PHOTO, displayLevel);
  const { mode } = useAppMode();

  useEffect(() => {
    isPhraseBackedUp()
      .then((backed) => setPhraseWarning(!backed))
      .catch(() => {});
  }, [open]); // re-check when settings modal closes

  useEffect(() => {
    const apply = (url?: string | null) => {
      const link = parseAppDeepLink(url);
      if (link?.kind === 'room') {
        if (isPickerHeld()) return;
        setOpen(false);
        setPanel('home');
        return;
      }
      if (link?.kind !== 'settings') return;
      setOpen(true);
      setPanel(link.panel);
    };
    Linking.getInitialURL()
      .then(apply)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => apply(url));
    return () => sub.remove();
  }, []);

  const close = () => {
    if (isPickerHeld()) return;
    setOpen(false);
    setPanel('home');
  };

  const titles: Record<Panel, TranslationKey> = {
    home: 'settings',
    security: 'securityTitle',
    appearance: 'appearance',
    language: 'language',
    mode: 'appModeTitle',
    admin: 'settingsAdminTitle',
    privacy: 'legalPrivacy',
    terms: 'legalTerms',
    guide: 'settingsGuideTitle',
  };

  const MenuRow = ({
    icon,
    label,
    onPress,
  }: {
    icon: 'shield' | 'sun' | 'globe' | 'bank' | 'info';
    label: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.menuRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppIcon name={icon} size={18} color={colors.primary} />
      <AppText style={[styles.menuLabel, { color: colors.text }]}>{label}</AppText>
      <AppText style={[styles.chevron, { color: colors.textMuted }]}>›</AppText>
    </TouchableOpacity>
  );

  return (
    <>
      <View style={[styles.avatarSlot, { width: frameBox, height: frameBox }]}>
        <ProfileAvatar
          profile={profile}
          wallet={walletAddress}
          size={HUB_PHOTO}
          badge
          publicView
          level={walletAddress ? displayLevel : undefined}
          frameLevel={walletAddress ? displayLevel : undefined}
          showRankLabel={false}
          onPress={() => setOpen(true)}
          accessibilityLabel={t('settings')}
        />
        {phraseWarning && (
          <View
            style={[styles.phraseBadge, { backgroundColor: colors.danger }]}
            accessibilityLabel={t('securityPhraseTodo')}
          />
        )}
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={[styles.frame, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel={t('closeSettings')}
          />
          <View style={[styles.sheet, { backgroundColor: colors.modalBg }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              {panel === 'home' ? (
                <Pressable onLongPress={() => setPanel('admin')} delayLongPress={1200}>
                  <BrandLogo size={32} />
                </Pressable>
              ) : (
                <TouchableOpacity
                  onPress={() => setPanel('home')}
                  accessibilityRole="button"
                  accessibilityLabel={t('settingsBack')}
                >
                  <AppText style={[styles.back, { color: colors.primary }]}>
                    {t('settingsBack')}
                  </AppText>
                </TouchableOpacity>
              )}
              <View style={styles.sheetTitles}>
                <AppText style={[styles.sheetTitle, { color: colors.text }]}>
                  {t(titles[panel])}
                </AppText>
                {panel === 'home' ? (
                  <AppText style={[styles.sheetLead, { color: colors.textMuted }]}>
                    {t('settingsLead')}
                  </AppText>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={close}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel={t('closeSettings')}
              >
                <AppText style={[styles.closeText, { color: colors.textMuted }]}>×</AppText>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {panel === 'home' ? (
                <View>
                  <MenuRow
                    icon="shield"
                    label={t('securityTitle')}
                    onPress={() => setPanel('security')}
                  />
                  <MenuRow
                    icon="sun"
                    label={t('appearance')}
                    onPress={() => setPanel('appearance')}
                  />
                  <MenuRow
                    icon="globe"
                    label={t('language')}
                    onPress={() => setPanel('language')}
                  />
                  <MenuRow
                    icon="bank"
                    label={t('settingsAccountNow', {
                      world: mode === 'demo' ? t('appModeDemo') : t('appModeLive'),
                    })}
                    onPress={() => setPanel('mode')}
                  />
                  <MenuRow
                    icon="info"
                    label={t('settingsGuideTitle')}
                    onPress={() => setPanel('guide')}
                  />
                  <MenuRow
                    icon="info"
                    label={t('legalPrivacy')}
                    onPress={() => setPanel('privacy')}
                  />
                  <MenuRow icon="info" label={t('legalTerms')} onPress={() => setPanel('terms')} />
                </View>
              ) : null}
              {panel === 'security' ? <SecuritySettings /> : null}
              {panel === 'appearance' ? <ThemeToggle hideLabel /> : null}
              {panel === 'language' ? <LanguageSelector hideLabel /> : null}
              {panel === 'mode' ? <ModeToggle /> : null}
              {panel === 'guide' ? <HowTheAppWorks /> : null}
              {panel === 'privacy' ? <LegalDocuments mode="read" doc="privacy" /> : null}
              {panel === 'terms' ? <LegalDocuments mode="read" doc="terms" /> : null}
              {panel === 'admin' ? <AdminAccess /> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  avatarSlot: {
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '88%',
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    zIndex: 2,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetBody: {
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  sheetTitles: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  sheetLead: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  back: {
    fontSize: 15,
    fontWeight: '600',
  },
  close: {
    paddingHorizontal: 6,
  },
  closeText: {
    fontSize: 28,
    lineHeight: 30,
  },
  menuRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
  },
  phraseBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
});
