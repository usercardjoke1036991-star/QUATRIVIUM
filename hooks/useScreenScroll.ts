import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Hueco bajo el campo para que el botón de debajo quede sobre el teclado. */
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

/** Altura real de un scroll de pantalla, y subida del campo enfocado. */
export function useScreenScroll(active: boolean, headerReserve = 96) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollHeight = Math.max(240, windowHeight - insets.top - insets.bottom - headerReserve);
  const scrollRef = useRef<ScrollView>(null);
  const frameRef = useRef<View>(null);
  const scrollY = useRef(0);
  const [keyboardPad, setKeyboardPad] = useState(0);

  useEffect(() => {
    if (!active) {
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
  }, [active]);

  return { scrollHeight, scrollRef, frameRef, scrollY, keyboardPad };
}
