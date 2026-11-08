import React from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useAppMode } from '../wallet/AppModeContext';
import { isContractConfigured, type AppMode } from '../constants/rpcConfig';
import { AppText } from './AppText';

export const ModeToggle: React.FC = () => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { mode, setMode } = useAppMode();
  const liveReady = isContractConfigured('mainnet');

  const choose = (next: AppMode) => {
    if (next === mode) return;
    Alert.alert(
      t('accountWorldSwitchTitle'),
      next === 'demo' ? t('appModeSwitchDemo') : t('appModeSwitchLive'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('accountWorldOpen'),
          onPress: () => {
            void setMode(next).then((ok) => {
              if (!ok) {
                Alert.alert(
                  t('error'),
                  next === 'live' ? t('appModeNeedLive') : t('appModeNeedDemo')
                );
              }
            });
          },
        },
      ]
    );
  };

  const Card = ({ world, title, tag }: { world: AppMode; title: string; tag: string }) => {
    const active = mode === world;
    const accent =
      world === 'demo' ? colors.warnText : liveReady ? colors.success : colors.warnText;
    return (
      <TouchableOpacity
        onPress={() => choose(world)}
        style={[
          styles.card,
          {
            borderColor: active ? accent : colors.border,
            backgroundColor: active ? colors.surface : colors.chip,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}. ${active ? t('accountWorldActive') : t('accountWorldOpen')}`}
      >
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <View style={styles.body}>
          <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>
          <AppText style={[styles.tag, { color: accent }]}>{tag}</AppText>
        </View>
        <AppText style={[styles.status, { color: active ? accent : colors.textMuted }]}>
          {active ? t('accountWorldActive') : t('accountWorldOpen')}
        </AppText>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <AppText style={[styles.intro, { color: colors.textMuted }]}>{t('appModeLead')}</AppText>
      <Card world="demo" title={t('accountWorldDemo')} tag={t('accountWorldDemoTag')} />
      <Card
        world="live"
        title={t('accountWorldLive')}
        tag={liveReady ? t('accountWorldLiveTag') : t('accountWorldLivePendingTag')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 10,
    paddingRight: 12,
  },
  accent: {
    width: 6,
    alignSelf: 'stretch',
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  tag: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
  },
});
