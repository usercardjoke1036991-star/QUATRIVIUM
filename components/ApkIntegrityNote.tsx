import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageContext';
import { readSigningCertSha256 } from '../modules/quatrivium-signing-cert';
import { useTheme } from '../theme/ThemeContext';
import { apkCertCheck } from '../utils/sovereignSurface';
import { AppText } from './AppText';

interface ApkIntegrityNoteProps {
  localCert?: string;
  publishedCert?: string;
  registryEmpty?: boolean;
  readFailed?: boolean;
}

/** Vacío o sin respuesta: versión no verificada. Huella distinta: aviso fuerte. */
export function ApkIntegrityNote({
  localCert = '',
  publishedCert = '',
  registryEmpty = false,
  readFailed = false,
}: ApkIntegrityNoteProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [readCert, setReadCert] = useState(localCert);

  useEffect(() => {
    if (localCert) {
      setReadCert(localCert);
      return;
    }
    let alive = true;
    readSigningCertSha256()
      .then((value) => {
        if (alive && value) setReadCert(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [localCert]);

  const status = apkCertCheck({
    localCert: readCert,
    publishedCert,
    registryEmpty: registryEmpty || !publishedCert,
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
