import React from 'react';
import {
  Text as RNText,
  TextInput as RNInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import { remapAndroidTextStyle } from '../theme/androidText';

export const AppText = React.forwardRef<RNText, TextProps>((props, ref) => {
  const { style, maxFontSizeMultiplier, ...rest } = props;
  return (
    <RNText
      ref={ref}
      allowFontScaling={false}
      {...rest}
      style={remapAndroidTextStyle(style)}
      maxFontSizeMultiplier={1}
    />
  );
});
AppText.displayName = 'AppText';

export const AppTextInput = React.forwardRef<RNInput, TextInputProps>((props, ref) => {
  const { style, maxFontSizeMultiplier, ...rest } = props;
  return (
    <RNInput
      ref={ref}
      allowFontScaling={false}
      {...rest}
      style={remapAndroidTextStyle(style)}
      maxFontSizeMultiplier={1}
    />
  );
});
AppTextInput.displayName = 'AppTextInput';
