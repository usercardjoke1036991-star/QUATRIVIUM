import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { formatCountdownClock } from '../utils/formatters';
import { graceMoraPhase, graceMoraSeconds, paymentDueAt } from '../utils/graceClock';
import { AppText } from './AppText';

export const GraceMoraClock: React.FC<{
  hasActiveLoan: boolean;
  vencimiento?: number;
  proximaCuota?: number;
  isFounder?: boolean;
}> = ({ hasActiveLoan, vencimiento, proximaCuota, isFounder }) => {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const dueAt = paymentDueAt({ vencimiento, proximaCuota });
  const phase = graceMoraPhase({ hasActiveLoan, dueAt, isFounder }, now);
  if (phase === 'none') return null;

  const seconds = graceMoraSeconds(phase, dueAt, now);
  const title = phase === 'grace' ? t('graceClockTitle') : t('moraClockTitle');
  const lead = phase === 'grace' ? t('graceClockLead') : t('moraClockLead');

  return (
    <View
      style={styles.box}
      accessibilityRole="text"
      accessibilityLabel={`${title} ${formatCountdownClock(seconds)}`}
    >
      <AppText style={styles.title}>{title}</AppText>
      <AppText style={styles.clock}>{formatCountdownClock(seconds)}</AppText>
      <AppText style={styles.lead}>{lead}</AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#B42318',
    backgroundColor: '#FEF3F2',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  title: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  clock: {
    color: '#B42318',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 6,
  },
  lead: {
    color: '#912018',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
});
