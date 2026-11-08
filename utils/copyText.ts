import { Share } from 'react-native';

export async function copyText(text: string): Promise<'copied' | 'shared' | 'failed'> {
  const value = String(text || '').trim();
  if (!value) return 'failed';
  try {
    const expoClipboard = require('expo-clipboard') as {
      setStringAsync?: (next: string) => Promise<void>;
    };
    if (expoClipboard.setStringAsync) {
      await expoClipboard.setStringAsync(value);
      return 'copied';
    }
  } catch {
    // El módulo nativo puede no estar en este build.
  }
  try {
    const { Clipboard } = require('react-native') as {
      Clipboard?: { setString?: (next: string) => void };
    };
    if (Clipboard?.setString) {
      Clipboard.setString(value);
      return 'copied';
    }
  } catch {
    // Clipboard ya no viene en RN 0.81.
  }
  try {
    await Share.share({ message: value });
    return 'shared';
  } catch {
    return 'failed';
  }
}
