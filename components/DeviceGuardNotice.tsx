import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { armDeviceRetry, refreshDeviceNotice, type DeviceNoticeKey } from '../utils/deviceSecret';
import { AppText } from './AppText';

/** Aviso de cuenta real. No lee el secreto: eso pediría la huella en cada activación. */
export const DeviceGuardNotice: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [key, setKey] = useState<DeviceNoticeKey>('');

  const refresh = useCallback(async () => {
    setKey(await refreshDeviceNotice());
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
        <TouchableOpacity
          onPress={() => {
            void armDeviceRetry().then((state) => {
              if (state === 'no-lock') setKey('lockDeviceNoLock');
            });
          }}
          style={styles.button}
        >
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
