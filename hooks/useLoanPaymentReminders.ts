import { useEffect, useMemo } from 'react';
import type { UserInfo } from './useWeb3Balances';
import {
  getInstallmentWindows,
  upcomingReminderTriggers,
  visibleDebtReminder,
  type DebtReminderKind,
} from '../utils/debtReminders';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { useI18n } from '../i18n/LanguageContext';

const CHANNEL_ID = 'quatrivium-debt';

async function syncScheduledReminders(
  triggers: { kind: DebtReminderKind; at: number }[],
  bodies: Record<DebtReminderKind, string>
) {
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Notifications.setNotificationChannelAsync) {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: `${APP_DISPLAY_NAME} pagos`,
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 180],
        sound: undefined,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return;

    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();
    for (const trigger of triggers) {
      const fireAt = trigger.at * 1000;
      if (!Number.isFinite(fireAt) || fireAt <= now) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: APP_DISPLAY_NAME,
          body: bodies[trigger.kind],
          sound: undefined,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
          channelId: CHANNEL_ID,
        },
      });
    }
  } catch {
    // Sin módulo nativo el aviso en pantalla sigue activo.
  }
}

export function useLoanPaymentReminders(userInfo: UserInfo): DebtReminderKind | null {
  const { t } = useI18n();
  const windows = useMemo(() => {
    const loan = userInfo.activeLoan;
    if (!loan || !userInfo.hasActiveLoan) return null;
    return getInstallmentWindows({
      loanStart: userInfo.userProgress.ultimoPrestamoTimestamp,
      loanDue: loan.vencimiento,
      nextInstallmentDue: loan.proximaCuota || loan.vencimiento,
      installments: loan.cuotasTotales || 1,
    });
  }, [userInfo.activeLoan, userInfo.hasActiveLoan, userInfo.userProgress.ultimoPrestamoTimestamp]);

  const kind = visibleDebtReminder(windows);

  useEffect(() => {
    const triggers = upcomingReminderTriggers(windows);
    syncScheduledReminders(triggers, {
      mid: t('debtReminderMid'),
      cutoff: t('debtReminderCutoff'),
    }).catch(() => {});
  }, [t, windows]);

  return kind;
}
