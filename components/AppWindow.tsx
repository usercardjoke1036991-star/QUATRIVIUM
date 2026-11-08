import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './AppText';
import { BusyMark } from './BusyLogo';

interface AppWindowProps {
  visible: boolean;
  title: string;
  lead?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Hueco bajo el campo para que el botón que va justo debajo (Aportar) quede sobre el teclado. */
const FIELD_CLEARANCE = 96;

type Measurable = {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

function asMeasurable(value: unknown): Measurable | null {
  if (!value || typeof value !== 'object' || !('measureInWindow' in value)) return null;
  const measure = (value as Measurable).measureInWindow;
  return typeof measure === 'function' ? (value as Measurable) : null;
}

export const AppWindow: React.FC<AppWindowProps> = ({
  visible,
  title,
  lead,
  onClose,
  children,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollHeight = Math.max(240, windowHeight - insets.top - insets.bottom - (lead ? 132 : 96));
  const scrollRef = useRef<ScrollView>(null);
  const frameRef = useRef<View>(null);
  const scrollY = useRef(0);
  const [keyboardPad, setKeyboardPad] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardPad(0);
      return undefined;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const revealFocused = (keyboardHeight: number) => {
      const focused = asMeasurable(TextInput.State.currentlyFocusedInput());
      const frame = frameRef.current;
      if (!focused?.measureInWindow || !frame) return;
      frame.measureInWindow((_frameX, frameY, _frameW, frameH) => {
        focused.measureInWindow?.((_inputX, inputY, _inputW, inputH) => {
          const visibleBottom = frameY + frameH - keyboardHeight;
          const delta = inputY + inputH + FIELD_CLEARANCE - visibleBottom;
          if (delta <= 8) return;
          scrollRef.current?.scrollTo({
            y: Math.max(0, scrollY.current + delta),
            animated: true,
          });
        });
      });
    };
    const show = Keyboard.addListener(showEvent, (event) => {
      const height = event.endCoordinates?.height || 0;
      setKeyboardPad(height);
      setTimeout(() => revealFocused(height), 80);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardPad(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('settingsBack')}
          >
            <AppText style={[styles.back, { color: colors.primary }]}>{t('settingsBack')}</AppText>
          </TouchableOpacity>
          <AppText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </AppText>
          <View style={styles.spacer} />
        </View>
        {lead ? <AppText style={[styles.lead, { color: colors.textMuted }]}>{lead}</AppText> : null}
        <View ref={frameRef} style={[styles.scroll, { height: scrollHeight }]}>
          <ScrollView
            ref={scrollRef}
            style={[styles.scroll, { height: scrollHeight }]}
            scrollEnabled
            persistentScrollbar
            keyboardShouldPersistTaps="always"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.body,
              keyboardPad > 0 ? { paddingBottom: 24 + keyboardPad } : null,
            ]}
            showsVerticalScrollIndicator
            nestedScrollEnabled
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollY.current = event.nativeEvent.contentOffset.y;
            }}
          >
            {children}
          </ScrollView>
        </View>
        <BusyMark />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 8,
  },
  back: {
    fontSize: 15,
    fontWeight: '600',
    width: 72,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  spacer: {
    width: 72,
  },
  lead: {
    paddingHorizontal: 20,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 96,
    gap: 14,
  },
});
