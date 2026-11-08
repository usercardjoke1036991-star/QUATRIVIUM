import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { setPickerActive } from '../utils/pickerHold';
import {
  canSubmitPublicIdentity,
  EMPTY_PROFILE,
  isValidDisplayName,
  normalizeDisplayName,
  publicPhotoFromAsset,
  publishOwnProfile,
  saveOwnProfile,
} from '../services/userProfile';
import { AppText, AppTextInput } from './AppText';

interface PublicIdentityFormProps {
  walletAddress: string;
  onSaved: () => void | Promise<void>;
}

export const PublicIdentityForm: React.FC<PublicIdentityFormProps> = ({
  walletAddress,
  onSaved,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [publicPhoto, setPublicPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickPhoto = async () => {
    setPickerActive(true);
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('publicFaceTitle'), t('profilePhotoDenied'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        aspect: [1, 1],
        quality: 0.2,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const photo = await publicPhotoFromAsset(result.assets[0]);
      if (!photo) {
        setError(t('publicPhotoTooBig'));
        return;
      }
      setPublicPhoto(photo);
      setError('');
    } catch {
      setError(t('profilePhotoUnavailable'));
    } finally {
      setPickerActive(false);
    }
  };

  const submit = async () => {
    const name = normalizeDisplayName(displayName);
    if (!isValidDisplayName(name)) {
      setError(t('usernameInvalid'));
      return;
    }
    if (!canSubmitPublicIdentity(name, publicPhoto)) {
      setError(t('publicPhotoNeed'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const stored = await saveOwnProfile(
        {
          ...EMPTY_PROFILE,
          displayName: name,
          publicPhoto,
          photoUri: publicPhoto,
          publicFace: true,
        },
        walletAddress || undefined
      );
      if (walletAddress) {
        await publishOwnProfile(walletAddress, stored);
      }
      await onSaved();
    } catch {
      setError(t('profileSaveError'));
    } finally {
      setBusy(false);
    }
  };

  const ready = canSubmitPublicIdentity(displayName, publicPhoto);

  return (
    <View style={styles.wrap}>
      <AppTextInput
        value={displayName}
        onChangeText={(value) => setDisplayName(normalizeDisplayName(value))}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={24}
        placeholder={t('publicNameField')}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
        ]}
      />
      <TouchableOpacity
        onPress={() => void pickPhoto()}
        style={[styles.photoBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
        accessibilityRole="button"
        accessibilityLabel={t('publicPhotoPick')}
      >
        {publicPhoto ? (
          <Image source={{ uri: publicPhoto }} style={styles.preview} />
        ) : (
          <AppText style={[styles.photoBtnText, { color: colors.text }]}>
            {t('publicPhotoPick')}
          </AppText>
        )}
      </TouchableOpacity>
      {error ? <AppText style={[styles.error, { color: colors.danger }]}>{error}</AppText> : null}
      <TouchableOpacity
        disabled={busy || !ready}
        onPress={() => void submit()}
        style={[
          styles.primary,
          { backgroundColor: colors.connect },
          (!ready || busy) && { backgroundColor: colors.chip },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#111" />
        ) : (
          <AppText style={styles.primaryText}>{t('publicFaceSave')}</AppText>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  photoBtn: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  preview: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
  },
  primary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
  },
});
