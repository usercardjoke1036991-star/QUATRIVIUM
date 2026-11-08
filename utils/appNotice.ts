import { Alert, Platform, ToastAndroid, type AlertButton } from 'react-native';

/** En Android un Alert detrás de un Modal (AppWindow) no se ve. El toast sí. */
export function showNotice(title: string, message: string, buttons?: AlertButton[]): void {
  const text = [title, message].filter(Boolean).join('. ').trim();
  if (Platform.OS === 'android' && text) {
    ToastAndroid.show(text.slice(0, 140), ToastAndroid.LONG);
  }
  Alert.alert(title, message, buttons);
}
