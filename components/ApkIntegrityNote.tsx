import React from 'react';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { apkCheck } from '../utils/sovereignSurface';
import { AppText } from './AppText';

interface ApkIntegrityNoteProps {
  localHash?: string;
  publishedHash?: string;
  registryEmpty?: boolean;
  readFailed?: boolean;
}

/** Vacío o sin respuesta: versión no verificada. Hash distinto: aviso fuerte. */
export function ApkIntegrityNote({
  localHash = '',
  publishedHash = '',
  registryEmpty = false,
  readFailed = false,
}: ApkIntegrityNoteProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const status = apkCheck({
    localHash,
    publishedHash,
    registryEmpty: registryEmpty || !publishedHash,
    readFailed,
  });
  if (status === 'match') return null;
  if (status === 'unverified') {
    return <AppText style={{ color: colors.textMuted }}>{t('apkUnverified')}</AppText>;
  }
  return (
    <AppText style={{ color: colors.danger, fontWeight: '700' }}>{t('apkHashMismatch')}</AppText>
  );
}
