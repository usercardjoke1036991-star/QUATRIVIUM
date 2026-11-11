import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import {
  deviceNeedsNotice,
  readDeviceGuard,
  retryDeviceBinding,
  type DeviceGuard,
} from '../utils/deviceSecret';
import { AppText } from './AppText';

function guardKey(
  guard: DeviceGuard,
  retry: string
):
  | 'lockDeviceOpen'
  | 'lockDeviceNoLock'
  | 'lockDeviceRepair'
  | 'lockDeviceKeyReset'
  | 'lockDeviceSecretLost'
  | 'lockDeviceAuth'
  | '' {
  if (guard === 'bound') return '';
  if (guard === 'open') return retry === 'no-lock' ? 'lockDeviceNoLock' : 'lockDeviceOpen';
  if (guard === 'repair') return 'lockDeviceRepair';
  if (guard === 'reset') return 'lockDeviceKeyReset';
  if (guard === 'lost') return 'lockDeviceSecretLost';
  return 'lockDeviceAuth';
}

/** Aviso de cuenta real: el secreto no está atado al bloqueo, o la llave del teléfono ya no sirve. */
export const DeviceGuardNotice: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [key, setKey] = useState<ReturnType<typeof guardKey>>('');

  const refresh = useCallback(async () => {
    const live = await deviceNeedsNotice();
    let guard = await readDeviceGuard();
    if (!live && (guard === 'open' || guard === 'repair')) {
      setKey('');
      return;
    }
    let retry = '';
    if (guard === 'open') {
      retry = await retryDeviceBinding();
      if (retry === 'bound') {
        setKey('');
        return;
      }
      guard = await readDeviceGuard();
    }
    setKey(guardKey(guard, retry));
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!key) return null;
  return (
    <View style={styles.box}>
      <AppText style={[styles.text, { color: colors.text }]}>{t(key)}</AppText>
      {key === 'lockDeviceOpen' || key === 'lockDeviceNoLock' ? (
        <TouchableOpacity onPress={() => void refresh()} style={styles.button}>
          <AppText style={styles.buttonText}>{t('lockDeviceRetry')}</AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { marginBottom: 12 },
  text: { fontSize: 13, lineHeight: 18 },
  button: { marginTop: 8, alignSelf: 'flex-start' },
  buttonText: { fontSize: 13, fontWeight: '700' },
});
