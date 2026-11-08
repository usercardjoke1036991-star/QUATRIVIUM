import React, { useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { AppIcon } from './icons';
import { AppTextInput } from './AppText';

interface SecretInputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  startVisible?: boolean;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

export const SecretInput: React.FC<SecretInputProps> = ({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  keyboardType,
  maxLength,
  autoCapitalize = 'none',
  editable = true,
  startVisible = false,
  style,
  containerStyle,
}) => {
  const [visible, setVisible] = useState(startVisible);
  const { t } = useI18n();
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.inputBg, borderColor: colors.inputBorder },
        containerStyle,
      ]}
    >
      <AppTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor ?? colors.textMuted}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="password"
        secureTextEntry={!visible}
        editable={editable}
        style={[styles.input, { color: colors.text }, style]}
      />
      {value ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t('clearField')}
          style={styles.icon}
        >
          <AppIcon name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        onPress={() => setVisible((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={visible ? t('hideSecret') : t('showSecret')}
        style={styles.icon}
      >
        <AppIcon name={visible ? 'eyeOff' : 'eye'} size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 10,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  icon: {
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
});
