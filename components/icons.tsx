import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Rect, Polyline, Text as SvgText, Polygon } from 'react-native-svg';

export type IconName =
  | 'gear'
  | 'wallet'
  | 'id'
  | 'chart'
  | 'bank'
  | 'people'
  | 'pool'
  | 'bell'
  | 'history'
  | 'shield'
  | 'share'
  | 'plug'
  | 'unplug'
  | 'deposit'
  | 'globe'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'unlock'
  | 'info'
  | 'check'
  | 'pay'
  | 'refresh'
  | 'save'
  | 'phone'
  | 'withdraw'
  | 'star'
  | 'warning'
  | 'user'
  | 'contrast'
  | 'copy'
  | 'eye'
  | 'eyeOff'
  | 'close'
  | 'search';

interface AppIconProps {
  name: IconName;
  size?: number;
  color?: string;
}

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export const AppIcon: React.FC<AppIconProps> = ({ name, size = 22, color = '#146C2E' }) => {
  const s = stroke(color);

  switch (name) {
    case 'gear':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="3.2" {...s} />
          <Path
            d="M12 3.5l1.2 2.2 2.4-.4 1.2 2.2 2.2 1.2-.4 2.4 2.2 1.2-2.2 1.2.4 2.4-2.2 1.2-1.2 2.2-2.4-.4L12 20.5l-1.2-2.2-2.4.4-1.2-2.2-2.2-1.2.4-2.4L3.2 12l2.2-1.2-.4-2.4 2.2-1.2 1.2-2.2 2.4.4L12 3.5z"
            {...s}
          />
        </Svg>
      );
    case 'wallet':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="3.5" y="6" width="17" height="12.5" rx="2.2" {...s} />
          <Path d="M3.5 9.5h17" {...s} />
          <Circle cx="16.2" cy="13.4" r="1.1" fill={color} />
        </Svg>
      );
    case 'id':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="3.5" y="5" width="17" height="14" rx="2" {...s} />
          <Circle cx="9" cy="11" r="2" {...s} />
          <Path d="M6.5 16c.6-1.4 1.7-2.2 3.5-2.2S12.9 14.6 13.5 16" {...s} />
          <Path d="M14.5 10h4M14.5 13h4" {...s} />
        </Svg>
      );
    case 'chart':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 19V5" {...s} />
          <Path d="M4 19h16" {...s} />
          <Polyline points="7,15 11,10 14,12.5 19,7" {...s} />
        </Svg>
      );
    case 'bank':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 10h16v9H4z" {...s} />
          <Path d="M3 10l9-6 9 6" {...s} />
          <Path d="M8 19v-6M12 19v-6M16 19v-6" {...s} />
        </Svg>
      );
    case 'people':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="9" cy="8.5" r="2.4" {...s} />
          <Path d="M4.5 18c.5-2.6 2.3-4 4.5-4s4 1.4 4.5 4" {...s} />
          <Circle cx="16.5" cy="9" r="2" {...s} />
          <Path d="M14.2 18c.3-1.8 1.5-3 3.3-3 1.2 0 2.2.5 2.8 1.4" {...s} />
        </Svg>
      );
    case 'pool':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3.8c2.8 3.4 7 7.1 7 11.1A7 7 0 115 14.9C5 10.9 9.2 7.2 12 3.8z" {...s} />
        </Svg>
      );
    case 'bell':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M6 16V11a6 6 0 1112 0v5l1.5 2H4.5L6 16z" {...s} />
          <Path d="M10 20a2 2 0 004 0" {...s} />
        </Svg>
      );
    case 'history':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="8" {...s} />
          <Path d="M12 8v4.5l3 1.7" {...s} />
        </Svg>
      );
    case 'shield':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3.5l8 3v6.2c0 4.3-3.2 7.3-8 8.8-4.8-1.5-8-4.5-8-8.8V6.5l8-3z" {...s} />
        </Svg>
      );
    case 'share':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="6.5" cy="12" r="2.2" {...s} />
          <Circle cx="17" cy="6.5" r="2.2" {...s} />
          <Circle cx="17" cy="17.5" r="2.2" {...s} />
          <Path d="M8.5 11.2l6.2-3.4M8.6 12.9l6.1 3.3" {...s} />
        </Svg>
      );
    case 'plug':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M8 8V4M16 8V4" {...s} />
          <Path d="M7 8h10v5a5 5 0 01-10 0V8z" {...s} />
          <Path d="M12 18v3" {...s} />
        </Svg>
      );
    case 'unplug':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M8 7V3M16 7V3" {...s} />
          <Path d="M7 7h10v4.5" {...s} />
          <Path d="M5 19l14-14" {...s} />
        </Svg>
      );
    case 'deposit':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4v10" {...s} />
          <Path d="M8 10l4 4 4-4" {...s} />
          <Path d="M5 18h14" {...s} />
        </Svg>
      );
    case 'globe':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="8" {...s} />
          <Path
            d="M4 12h16M12 4c2.4 2.4 3.6 5.1 3.6 8s-1.2 5.6-3.6 8c-2.4-2.4-3.6-5.1-3.6-8s1.2-5.6 3.6-8z"
            {...s}
          />
        </Svg>
      );
    case 'sun':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="4" {...s} />
          <Path
            d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6"
            {...s}
          />
        </Svg>
      );
    case 'moon':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M15.5 4.8A7.5 7.5 0 1019 15.2 6 6 0 0115.5 4.8z" {...s} />
        </Svg>
      );
    case 'lock':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="6" y="11" width="12" height="9" rx="2" {...s} />
          <Path d="M8.5 11V8a3.5 3.5 0 017 0v3" {...s} />
        </Svg>
      );
    case 'unlock':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="6" y="11" width="12" height="9" rx="2" {...s} />
          <Path d="M8.5 11V8a3.5 3.5 0 016.8-1.2" {...s} />
        </Svg>
      );
    case 'info':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="8" {...s} />
          <Path d="M12 11v5" {...s} />
          <Circle cx="12" cy="8.2" r="0.9" fill={color} />
        </Svg>
      );
    case 'check':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="8" {...s} />
          <Path d="M8.5 12.2l2.4 2.4 4.6-5.2" {...s} />
        </Svg>
      );
    case 'pay':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="3.5" y="7" width="17" height="10.5" rx="2" {...s} />
          <Circle cx="12" cy="12.2" r="2.1" {...s} />
          <Path d="M6.2 10h1.6M16.2 14.5h1.6" {...s} />
        </Svg>
      );
    case 'refresh':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M20 12a8 8 0 11-2.4-5.7" {...s} />
          <Path d="M20 6.5V12h-5.5" {...s} />
        </Svg>
      );
    case 'save':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M5 5h11.5L19 7.5V19H5V5z" {...s} />
          <Path d="M8 5v5h8V5M8 19v-6h8v6" {...s} />
        </Svg>
      );
    case 'phone':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="7.5" y="3.5" width="9" height="17" rx="2" {...s} />
          <Path d="M10.5 18.5h3" {...s} />
        </Svg>
      );
    case 'withdraw':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 20V10" {...s} />
          <Path d="M8 14l4-4 4 4" {...s} />
          <Path d="M5 6h14" {...s} />
        </Svg>
      );
    case 'star':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M12 4.5l2.1 4.4 4.8.6-3.5 3.4.9 4.8L12 15.6 7.7 17.7l.9-4.8-3.5-3.4 4.8-.6L12 4.5z"
            {...s}
          />
        </Svg>
      );
    case 'warning':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4.5L21 19H3L12 4.5z" {...s} />
          <Path d="M12 10v4.2" {...s} />
          <Circle cx="12" cy="16.6" r="0.8" fill={color} />
        </Svg>
      );
    case 'user':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="8.5" r="2.8" {...s} />
          <Path d="M6 18.5c.7-3 2.8-4.6 6-4.6s5.3 1.6 6 4.6" {...s} />
        </Svg>
      );
    case 'contrast':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="8" {...s} />
          <Path d="M12 4a8 8 0 000 16V4z" fill={color} />
        </Svg>
      );
    case 'copy':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="8" y="8" width="11" height="12" rx="1.8" {...s} />
          <Path d="M6 16V5.8A1.8 1.8 0 017.8 4H16" {...s} />
        </Svg>
      );
    case 'eye':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z" {...s} />
          <Circle cx="12" cy="12" r="2.4" {...s} />
        </Svg>
      );
    case 'eyeOff':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M3.5 12s3.2-6 8.5-6c2 0 3.8.7 5.3 1.7" {...s} />
          <Path d="M20.5 12s-1.2 2.2-3.3 3.9M4 5l16 14" {...s} />
          <Circle cx="12" cy="12" r="2.4" {...s} />
        </Svg>
      );
    case 'close':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M7 7l10 10M17 7L7 17" {...s} />
        </Svg>
      );
    case 'search':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="10.5" cy="10.5" r="5.2" {...s} />
          <Path d="M14.6 14.6L19 19" {...s} />
        </Svg>
      );
    default:
      return null;
  }
};

interface TokenLogoProps {
  symbol: string;
  size?: number;
}

export const TokenLogo: React.FC<TokenLogoProps> = ({ symbol, size = 20 }) => {
  if (symbol === 'LUSD' || symbol === 'USDT') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="11" fill="#26A17B" />
        <Path d="M8 8h8M12 8v9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <Path d="M8.3 12.6h7.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </Svg>
    );
  }
  if (symbol === 'ETH') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="11" fill="#627EEA" />
        <Polygon points="12,4.5 16.5,12 12,14.6 7.5,12" fill="#fff" />
        <Polygon points="12,15.8 16.5,13.2 12,19.5 7.5,13.2" fill="#E0E7FF" />
      </Svg>
    );
  }
  if (symbol === 'USDC') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="11" fill="#2775CA" />
        <Circle cx="12" cy="12" r="6.2" stroke="#fff" strokeWidth="1.6" fill="none" />
        <Path
          d="M12 8.4v7.2M10.2 10.2h2.4c1.1 0 1.8.7 1.8 1.8s-.7 1.8-1.8 1.8H10.2"
          stroke="#fff"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    );
  }
  if (symbol === 'DAI') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Polygon points="12,2.5 21.5,12 12,21.5 2.5,12" fill="#F5AC37" />
        <Path
          d="M9 8.5h3.2c2.3 0 3.8 1.4 3.8 3.5S14.5 15.5 12.2 15.5H9V8.5z"
          stroke="#fff"
          strokeWidth="1.5"
          fill="none"
        />
      </Svg>
    );
  }
  if (symbol === 'FDUSD') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="11" fill="#111111" />
        <Path
          d="M8.2 8.2h7.6M8.2 12h5.6M8.2 8.2v7.6"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  if (symbol === 'BNB') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Polygon points="12,3 21,12 12,21 3,12" fill="#F0B90B" />
        <Polygon points="12,7.2 16.8,12 12,16.8 7.2,12" fill="#fff" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="11" fill="#146C2E" />
      <SvgText x="12" y="16" fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle">
        {symbol.slice(0, 1)}
      </SvgText>
    </Svg>
  );
};

interface IconBadgeProps {
  name: IconName;
  color: string;
  background: string;
  size?: number;
}

export const IconBadge: React.FC<IconBadgeProps> = ({ name, color, background, size = 36 }) => (
  <View
    style={[
      styles.badge,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
    ]}
  >
    <AppIcon name={name} size={Math.round(size * 0.55)} color={color} />
  </View>
);

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
