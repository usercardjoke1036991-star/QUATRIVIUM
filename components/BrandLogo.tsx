import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const LOGO = require('../assets/logo.png');
const PLATE = '#07150F';

export const BrandLogo: React.FC<{
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}> = ({ size = 36, style, imageStyle }) => {
  const { colors, isDark } = useTheme();
  const radius = Math.round(size * 0.22);
  const inner = Math.round(size * 0.72);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          shadowColor: '#000',
          shadowOpacity: isDark ? 0.45 : 0.16,
          shadowRadius: Math.max(4, size * 0.08),
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.plate,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: PLATE,
            borderColor: isDark ? colors.primary : '#1B6B3A',
          },
        ]}
      >
        <Image
          source={LOGO}
          style={[{ width: inner, height: inner }, imageStyle]}
          resizeMode="contain"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
});
