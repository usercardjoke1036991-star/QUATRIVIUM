import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { ADMIN_SEATS, ADMIN_TIMELOCK_HOURS } from '../utils/sovereignSurface';
import { formatAddress } from '../utils/formatters';
import { AppText } from './AppText';

interface AdminStatusReadoutProps {
  paused: boolean;
  admins: string[];
}

/** Estado de gobierno, solo lectura. Las acciones viven en el panel y exigen billetera admin. */
export function AdminStatusReadout({ paused, admins }: AdminStatusReadoutProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const seats = Array.from({ length: ADMIN_SEATS }, (_, index) => admins[index] || '');
  return (
    <View style={styles.box}>
      <AppText style={{ color: colors.text }}>{t('adminStatusLead')}</AppText>
      <AppText style={{ color: colors.textMuted }}>
        {paused ? t('adminPauseOn') : t('adminPauseOff')}
      </AppText>
      <AppText style={{ color: colors.textMuted }}>
        {t('adminTimelockHours', { hours: String(ADMIN_TIMELOCK_HOURS) })}
      </AppText>
      {seats.map((seat, index) => (
        <AppText key={`admin-${index + 1}`} style={{ color: colors.text }}>
          {`${index + 1}. ${seat ? formatAddress(seat) : '—'}`}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, marginBottom: 12 },
});
