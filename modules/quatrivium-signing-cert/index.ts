import { requireOptionalNativeModule } from 'expo-modules-core';

type SigningCertModule = {
  getSha256?: () => Promise<string>;
};

/** Huella SHA-256 del certificado con el que está firmada esta instalación. Null si no hay módulo nativo. */
export async function readSigningCertSha256(): Promise<string | null> {
  try {
    const native = requireOptionalNativeModule<SigningCertModule>('QuatriviumSigningCert');
    const value = native?.getSha256 ? await native.getSha256() : '';
    const hex = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^0x/, '');
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  } catch {
    return null;
  }
}
