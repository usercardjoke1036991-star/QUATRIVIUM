import React from 'react';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { apkIntegrity } from '../utils/sovereignSurface';
import { AppText } from './AppText';

interface ApkIntegrityNoteProps {
  localHash?: string;
  publishedHash?: string;
}

/** Avisa solo si el hash local no es el que publicó la billetera fundadora. */
export function ApkIntegrityNote({ localHash = '', publishedHash = '' }: ApkIntegrityNoteProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (apkIntegrity(localHash, publishedHash) !== 'mismatch') return null;
  return <AppText style={{ color: colors.danger || colors.text }}>{t('apkHashMismatch')}</AppText>;
}
