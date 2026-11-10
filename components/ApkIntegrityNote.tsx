import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageContext';
import { readSigningCertSha256 } from '../modules/quatrivium-signing-cert';
import { useTheme } from '../theme/ThemeContext';
import { DEPLOYED_MAINNET } from '../constants/deployedAddresses';
import { getProviderWithFallback } from '../constants/rpcConfig';
import { readPublishedCert } from '../services/apkRegistry';
import { apkRegistryStatus } from '../utils/sovereignSurface';
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
  const [chainCert, setChainCert] = useState(publishedCert);
  const [chainFailed, setChainFailed] = useState(readFailed);

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

  useEffect(() => {
    if (publishedCert) {
      setChainCert(publishedCert);
      return;
    }
    const address = String(DEPLOYED_MAINNET.apk || '');
    if (!address) return;
    let alive = true;
    readPublishedCert(getProviderWithFallback(), address)
      .then((value) => {
        if (alive) setChainCert(value);
      })
      .catch(() => {
        if (alive) setChainFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [publishedCert]);

  const status = apkRegistryStatus({
    registryAddress: chainCert || publishedCert ? DEPLOYED_MAINNET.apk || 'set' : DEPLOYED_MAINNET.apk,
    localCert: readCert,
    publishedCert: chainCert,
    registryEmpty: registryEmpty || !chainCert,
    readFailed: chainFailed,
  });
  if (status === 'match') return null;
  if (status === 'unverified') {
    return <AppText style={{ color: colors.textMuted }}>{t('apkUnverified')}</AppText>;
  }
  return (
    <AppText style={{ color: colors.danger, fontWeight: '700' }}>{t('apkHashMismatch')}</AppText>
  );
}
