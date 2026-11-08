export type BiometricKind = 'fingerprint' | 'facial' | 'iris';

export type BiometricBlockReason = 'ok' | 'native-missing' | 'no-hardware' | 'not-enrolled';

export interface BiometricProbe {
  hasHardware: boolean;
  enrolled: boolean;
  enrolledLevel: number;
  types: number[];
}

export interface BiometricAvailability {
  available: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  kinds: BiometricKind[];
  reason: BiometricBlockReason;
}

export const BIOMETRIC_TYPE_FINGERPRINT = 1;
export const BIOMETRIC_TYPE_FACIAL = 2;
export const BIOMETRIC_TYPE_IRIS = 3;
export const ENROLLED_LEVEL_BIOMETRIC_WEAK = 2;

export function kindsFromTypes(types: number[]): BiometricKind[] {
  const kinds: BiometricKind[] = [];
  if (types.includes(BIOMETRIC_TYPE_FINGERPRINT)) kinds.push('fingerprint');
  if (types.includes(BIOMETRIC_TYPE_FACIAL)) kinds.push('facial');
  if (types.includes(BIOMETRIC_TYPE_IRIS)) kinds.push('iris');
  return kinds;
}

export function resolveBiometricAvailability(probe: BiometricProbe): BiometricAvailability {
  const kinds = kindsFromTypes(Array.isArray(probe.types) ? probe.types : []);
  const hasHardware = Boolean(probe.hasHardware) || kinds.length > 0;
  const enrolled =
    Boolean(probe.enrolled) ||
    (hasHardware && Number(probe.enrolledLevel || 0) >= ENROLLED_LEVEL_BIOMETRIC_WEAK);
  if (!hasHardware) {
    return { available: false, hasHardware: false, enrolled: false, kinds, reason: 'no-hardware' };
  }
  if (!enrolled) {
    return { available: false, hasHardware: true, enrolled: false, kinds, reason: 'not-enrolled' };
  }
  return { available: true, hasHardware: true, enrolled: true, kinds, reason: 'ok' };
}
