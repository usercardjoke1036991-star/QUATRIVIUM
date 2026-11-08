import React, { useCallback, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { legalDocsFor, type LegalSection } from '../i18n/legalCopy';
import { useTheme } from '../theme/ThemeContext';
import { hasReadToEnd } from '../utils/legalConsent';
import { AppText } from './AppText';

export type LegalDocFilter = 'all' | 'privacy' | 'terms';

type Props = {
  mode: 'gate' | 'read';
  doc?: LegalDocFilter;
  onAccept?: () => void;
};

function asSections(value: unknown): LegalSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is LegalSection =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as LegalSection).title === 'string' &&
      typeof (item as LegalSection).body === 'string'
  );
}

function padIndex(index: number): string {
  return index < 9 ? `0${index + 1}` : String(index + 1);
}

export const LegalDocuments: React.FC<Props> = ({ mode, doc = 'all', onAccept }) => {
  const { t, lang, rtl } = useI18n();
  const { colors } = useTheme();
  const copy = legalDocsFor(lang);
  const align = rtl ? ('right' as const) : ('left' as const);
  const [layoutH, setLayoutH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const finished = mode === 'read' || hasReadToEnd(layoutH, contentH, offsetY);
  const showPrivacy = doc === 'all' || doc === 'privacy';
  const showTerms = doc === 'all' || doc === 'terms';

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setLayoutH(e.nativeEvent.layout.height);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffsetY(e.nativeEvent.contentOffset.y);
    setLayoutH(e.nativeEvent.layoutMeasurement.height);
    setContentH(e.nativeEvent.contentSize.height);
  }, []);

  const renderSections = (title: string, items: unknown) => (
    <View style={styles.chapter}>
      <AppText style={[styles.chapterTitle, { color: colors.text, textAlign: align }]}>
        {title}
      </AppText>
      <View
        style={[
          styles.chapterRule,
          { backgroundColor: colors.primary, alignSelf: rtl ? 'flex-end' : 'flex-start' },
        ]}
      />
      {asSections(items).map((item, index) => (
        <View key={`${title}-${item.title}`} style={styles.section}>
          <AppText style={[styles.kicker, { color: colors.primary, textAlign: align }]}>
            {padIndex(index)}
          </AppText>
          <AppText style={[styles.heading, { color: colors.text, textAlign: align }]}>
            {item.title}
          </AppText>
          <AppText selectable style={[styles.body, { color: colors.text, textAlign: align }]}>
            {item.body}
          </AppText>
        </View>
      ))}
    </View>
  );

  const body = (
    <>
      {mode === 'gate' ? (
        <AppText style={[styles.lead, { color: colors.textMuted, textAlign: align }]}>
          {t('legalLead')}
        </AppText>
      ) : null}
      {showPrivacy ? renderSections(t('legalPrivacy'), copy.privacy) : null}
      {showTerms ? renderSections(t('legalTerms'), copy.terms) : null}
    </>
  );

  if (mode === 'read') {
    return <View>{body}</View>;
  }

  return (
    <View style={styles.fill}>
      <ScrollView
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => setContentH(h)}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      >
        {body}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        {!finished ? (
          <AppText style={[styles.hint, { color: colors.textMuted, textAlign: 'center' }]}>
            {t('legalMustRead')}
          </AppText>
        ) : null}
        <TouchableOpacity
          onPress={() => {
            if (!finished || !onAccept) return;
            onAccept();
          }}
          disabled={!finished}
          style={[styles.accept, { backgroundColor: finished ? colors.primary : colors.border }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !finished }}
          accessibilityLabel={t('legalAccept')}
        >
          <AppText
            style={[styles.acceptText, { color: finished ? colors.onPrimary : colors.textMuted }]}
          >
            {t('legalAccept')}
          </AppText>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 32,
  },
  lead: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 22,
  },
  chapter: {
    marginBottom: 28,
  },
  chapterTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  chapterRule: {
    height: 1,
    width: 48,
    marginBottom: 18,
    opacity: 0.85,
  },
  section: {
    marginBottom: 22,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  accept: {
    borderRadius: 4,
    paddingVertical: 15,
    alignItems: 'center',
  },
  acceptText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
