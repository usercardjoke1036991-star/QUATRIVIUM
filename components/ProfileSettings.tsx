import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useUserProfile } from '../profile/ProfileContext';
import {
  hasLockedPublicIdentity,
  loadOwnProfile,
  persistPickedPhoto,
  type UserProfile,
} from '../services/userProfile';
import { AppIcon } from './icons';
import { setPickerActive } from '../utils/pickerHold';
import { ProfileAvatar } from './ProfileAvatar';
import { PublicFacePicker } from './PublicFacePicker';
import { PublicIdentityForm } from './PublicIdentityForm';
import { UsernameSection } from './UsernameSection';
import { useWalletLevel } from '../hooks/useWalletLevel';
import { getRankForLevel } from '../constants/ranks';
import { displayMaxLoanLevel } from '../constants/loanTiers';
import { cachedProtocolCaps } from '../services/quatriviumCreditService';
import { loadClaimedUsername } from '../services/accountUsername';
import { AppText } from './AppText';
import { hasUnsavedChanges } from '../utils/unsavedChanges';

export const ProfileSettings: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { profile, walletAddress, saveProfile } = useUserProfile();
  const level = useWalletLevel(walletAddress);
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState('');

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    loadClaimedUsername()
      .then(setUsername)
      .catch(() => {});
  }, [walletAddress]);

  const apply = (patch: Partial<UserProfile>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const pickPhoto = async () => {
    setPickerActive(true);
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('profilePhoto'), t('profilePhotoDenied'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        aspect: [1, 1],
        quality: 0.45,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = await persistPickedPhoto(result.assets[0]);
      if (!uri) {
        Alert.alert(t('profilePhoto'), t('profilePhotoUnavailable'));
        return;
      }
      apply({ photoUri: uri });
    } catch {
      Alert.alert(t('profilePhoto'), t('profilePhotoUnavailable'));
    } finally {
      setPickerActive(false);
    }
  };

  const dirty = hasUnsavedChanges(
    { photoUri: draft.photoUri, avatarId: draft.avatarId, displayName: draft.displayName },
    { photoUri: profile.photoUri, avatarId: profile.avatarId, displayName: profile.displayName }
  );

  const publicChosen = hasLockedPublicIdentity(profile);

  const handleSave = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await saveProfile({
        ...draft,
        displayName: publicChosen ? profile.displayName : '',
        publicPhoto: publicChosen ? profile.publicPhoto : '',
        publicFace: publicChosen,
      });
      Alert.alert(t('ready'), t('profileSaved'));
    } catch {
      Alert.alert(t('error'), t('profileSaveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <ProfileAvatar
          profile={draft}
          wallet={walletAddress}
          size={72}
          publicView
          level={walletAddress ? level : undefined}
          rankName={t(getRankForLevel(level).nameKey)}
          showRankLabel={Boolean(walletAddress)}
        />
        <View style={styles.heroText}>
          <AppText style={[styles.heroName, { color: colors.text }]}>
            {username ? `@${username}` : draft.displayName || t('profileNamePlaceholder')}
          </AppText>
          <AppText style={[styles.heroHint, { color: colors.textMuted }]}>
            {t('profileLead')}
          </AppText>
          {publicChosen ? (
            <AppText style={[styles.heroName, { color: colors.text, marginTop: 4 }]}>
              {profile.displayName}
            </AppText>
          ) : null}
          {walletAddress ? (
            <AppText style={[styles.heroHint, { color: colors.textMuted }]}>
              {t('level')} {level}/{displayMaxLoanLevel(cachedProtocolCaps().maxLevel)} ·{' '}
              {t(getRankForLevel(level).nameKey)}
            </AppText>
          ) : null}
        </View>
      </View>

      <AppText style={[styles.section, { color: colors.text }]}>{t('publicFaceTitle')}</AppText>
      <AppText style={[styles.heroHint, { color: colors.textMuted, marginBottom: 8 }]}>
        {publicChosen ? t('publicFaceLocked') : t('publicIdentityLead')}
      </AppText>
      {publicChosen ? (
        <PublicFacePicker
          value={draft.avatarId}
          locked
          onChange={(avatarId) => apply({ avatarId })}
        />
      ) : (
        <PublicIdentityForm
          walletAddress={walletAddress}
          onSaved={async () => {
            const stored = await loadOwnProfile(walletAddress || undefined);
            if (hasLockedPublicIdentity(stored)) await saveProfile(stored);
          }}
        />
      )}

      <UsernameSection
        walletAddress={walletAddress}
        claimedUsername={username}
        onClaimed={(value) => {
          setUsername(value);
        }}
      />

      <TouchableOpacity
        style={[styles.photoBtn, { borderColor: colors.border }]}
        onPress={pickPhoto}
      >
        <AppIcon name="id" size={16} color={colors.textMuted} />
        <AppText style={[styles.photoBtnText, { color: colors.textMuted }]}>
          {t('profilePickPhoto')}
        </AppText>
      </TouchableOpacity>
      <AppText style={[styles.remove, { color: colors.textMuted }]}>
        {t('profilePhotoPrivate')}
      </AppText>
      {draft.photoUri ? (
        <TouchableOpacity onPress={() => apply({ photoUri: '' })}>
          <AppText style={[styles.remove, { color: colors.textMuted }]}>
            {t('profileRemovePhoto')}
          </AppText>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[
          styles.save,
          { backgroundColor: colors.primary },
          (saving || !dirty) && styles.disabled,
        ]}
        onPress={() => void handleSave()}
        disabled={
          saving || !dirty || (Boolean(username) && !draft.publicFace && draft.avatarId < 0)
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: saving || !dirty }}
        accessibilityLabel={t('profileSave')}
      >
        <AppIcon name="save" size={16} color="#111" />
        <AppText style={styles.saveText}>{t('profileSave')}</AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  heroText: {
    flex: 1,
  },
  heroName: {
    fontSize: 16,
    fontWeight: '800',
  },
  heroHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  section: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  photoBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 6,
  },
  photoBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  remove: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  save: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.5,
  },
});
