import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AVATAR_PRESETS, clampAvatarId, type UserProfile } from '../services/userProfile';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import { AppIcon } from './icons';
import { RankFrame, rankFrameOuterSize } from './RankFrame';

interface ProfileAvatarProps {
  profile?: UserProfile | null;
  wallet?: string;
  size?: number;
  onPress?: () => void;
  badge?: boolean;
  accessibilityLabel?: string;
  level?: number;
  frameLevel?: number;
  rankName?: string;
  showRankLabel?: boolean;
  publicView?: boolean;
}

const FACEBOOK_BG = '#E4E6EB';
const FACEBOOK_FG = '#B0B3B8';

export const AnonymousFace: React.FC<{ size: number; avatarId?: number; square?: boolean }> = ({
  size,
  avatarId,
  square = false,
}) => {
  const preset = AVATAR_PRESETS[clampAvatarId(avatarId)];
  const bg = preset?.bg || FACEBOOK_BG;
  const fg = preset?.fg || FACEBOOK_FG;
  const radius = square ? Math.max(3, Math.round(size * 0.08)) : size / 2;
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
        },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="9.1" r="4.15" fill={fg} />
        <Path d="M3.8 21.4c.5-4.8 3.6-7.3 8.2-7.3s7.7 2.5 8.2 7.3" fill={fg} />
      </Svg>
    </View>
  );
};

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  profile,
  size = 44,
  onPress,
  badge = false,
  accessibilityLabel,
  level,
  frameLevel,
  rankName,
  showRankLabel,
  publicView = false,
}) => {
  const publicPhoto =
    profile?.publicPhoto && /^data:image\//i.test(profile.publicPhoto) ? profile.publicPhoto : '';
  const sharedPhoto =
    publicView && profile?.photoUri && /^data:image\//i.test(profile.photoUri)
      ? profile.photoUri
      : '';
  const localPhoto =
    !publicView && profile?.photoUri && !/^https?:/i.test(profile.photoUri) ? profile.photoUri : '';
  const photoUri = publicView ? publicPhoto || sharedPhoto : publicPhoto || localPhoto;
  const wornLevel = frameLevel || level;
  const rank = wornLevel ? getRankForLevel(wornLevel) : null;
  const caption = rank && rankName ? formatRankLabel(rank, rankName) : '';
  const showCaption = showRankLabel ?? size >= 36;
  const outer = rank ? rankFrameOuterSize(size, rank.level) : size;
  const outerH = outer + (showCaption && caption ? 14 : 0);

  const photoRadius = rank ? Math.max(3, Math.round(size * 0.08)) : size / 2;
  const photo = photoUri ? (
    <Image
      key={`${photoUri}-${profile?.updatedAt || 0}`}
      source={{ uri: photoUri }}
      style={{ width: size, height: size, borderRadius: photoRadius }}
    />
  ) : (
    <AnonymousFace size={size} avatarId={profile?.avatarId} square={Boolean(rank)} />
  );

  const framed = rank ? (
    <View style={{ width: outer, height: outerH, overflow: 'visible' }}>
      <RankFrame level={rank.level} size={size} label={caption} showLabel={showCaption}>
        {photo}
      </RankFrame>
      {badge ? (
        <View style={styles.badge}>
          <AppIcon name="gear" size={10} color="#fff" />
        </View>
      ) : null}
    </View>
  ) : (
    <View style={{ width: size, height: size, overflow: 'visible' }}>
      {photo}
      {badge ? (
        <View style={styles.badge}>
          <AppIcon name="gear" size={10} color="#fff" />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return framed;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ overflow: 'visible', width: rank ? outer : size, height: rank ? outerH : size }}
    >
      {framed}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#146C2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 2,
  },
});
