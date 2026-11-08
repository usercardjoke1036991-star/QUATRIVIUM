import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './AppText';
import { AppIcon, type IconName } from './icons';

export type HomeRoom =
  | 'alta'
  | 'wallet'
  | 'credit'
  | 'loans'
  | 'bonuses'
  | 'canje'
  | 'donate'
  | 'network'
  | 'people'
  | 'pool'
  | 'reserva'
  | 'racha'
  | 'admin'
  | 'history'
  | 'ranks'
  | 'fame';

interface HubTile {
  id: HomeRoom;
  title: string;
  lead: string;
  icon: IconName;
  locked?: boolean;
}

interface HomeHubProps {
  tiles: HubTile[];
  onOpen: (room: HomeRoom) => void;
}

export const HomeHub: React.FC<HomeHubProps> = ({ tiles, onOpen }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <TouchableOpacity
          key={tile.id}
          onPress={() => onOpen(tile.id)}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={tile.locked ? `${tile.title}. ${tile.lead}` : tile.title}
        >
          <View style={styles.iconRow}>
            <AppIcon name={tile.icon} size={22} color={colors.primary} />
            {tile.locked ? <AppIcon name="lock" size={16} color={colors.warnText} /> : null}
          </View>
          <AppText style={[styles.title, { color: colors.text }]}>{tile.title}</AppText>
          <AppText style={[styles.lead, { color: colors.textMuted }]}>{tile.lead}</AppText>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '47.5%',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 132,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  lead: {
    fontSize: 12,
    lineHeight: 16,
  },
});
