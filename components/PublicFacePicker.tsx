import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AVATAR_PRESETS, clampAvatarId } from '../services/userProfile';
import { useTheme } from '../theme/ThemeContext';
import { AnonymousFace } from './ProfileAvatar';

interface PublicFacePickerProps {
  value: number;
  locked?: boolean;
  onChange: (avatarId: number) => void;
}

export const PublicFacePicker: React.FC<PublicFacePickerProps> = ({
  value,
  locked = false,
  onChange,
}) => {
  const { colors } = useTheme();
  const selected = clampAvatarId(value);

  return (
    <View style={styles.grid}>
      {AVATAR_PRESETS.map((preset) => {
        const active = preset.id === selected;
        return (
          <TouchableOpacity
            key={preset.id}
            disabled={locked}
            onPress={() => onChange(preset.id)}
            style={[
              styles.cell,
              { borderColor: active ? colors.primary : colors.border },
              active && { backgroundColor: colors.chip },
              locked && styles.locked,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: locked }}
          >
            <AnonymousFace size={48} avatarId={preset.id} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  cell: {
    width: '22%',
    minWidth: 64,
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    opacity: 0.85,
  },
});
