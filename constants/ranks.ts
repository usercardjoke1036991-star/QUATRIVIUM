import { MAX_LOAN_LEVEL } from './loanTiers';

export type RankNameKey =
  | 'rankBronze'
  | 'rankSilver'
  | 'rankGold'
  | 'rankAmber'
  | 'rankPearl'
  | 'rankJade'
  | 'rankEmerald'
  | 'rankSapphire'
  | 'rankRuby'
  | 'rankPlatinum'
  | 'rankDiamond'
  | 'rankMaster';

export type RankFamily =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'amber'
  | 'pearl'
  | 'jade'
  | 'emerald'
  | 'sapphire'
  | 'ruby'
  | 'platinum'
  | 'diamond'
  | 'master';

export interface RankStyle {
  family: RankFamily;
  level: number;
  nameKey: RankNameKey;
  metal: string;
  dark: string;
  light: string;
  tint: string;
  text: string;
  division: 0 | 1 | 2;
}

/** Color mineral real de cada gema del catálogo. Ningún tono se reutiliza. */
const FAMILY_STYLE: Record<RankFamily, Omit<RankStyle, 'level' | 'division'>> = {
  bronze: {
    family: 'bronze',
    nameKey: 'rankBronze',
    metal: '#9B1B30',
    dark: '#4A0A12',
    light: '#E85A6C',
    tint: '#FAD6DA',
    text: '#4A0A12',
  },
  silver: {
    family: 'silver',
    nameKey: 'rankSilver',
    metal: '#3DB7E0',
    dark: '#0A4A68',
    light: '#A8E8F8',
    tint: '#DFF6FC',
    text: '#0A3A50',
  },
  gold: {
    family: 'gold',
    nameKey: 'rankGold',
    metal: '#E8B923',
    dark: '#8A5A00',
    light: '#FFE08A',
    tint: '#FFF4CC',
    text: '#6B4500',
  },
  amber: {
    family: 'amber',
    nameKey: 'rankAmber',
    metal: '#2EA8DC',
    dark: '#0A4A70',
    light: '#8FD4F5',
    tint: '#D6F0FB',
    text: '#083A58',
  },
  pearl: {
    family: 'pearl',
    nameKey: 'rankPearl',
    metal: '#2EC4B6',
    dark: '#0A5A52',
    light: '#8EEDE4',
    tint: '#D4F7F4',
    text: '#084840',
  },
  jade: {
    family: 'jade',
    nameKey: 'rankJade',
    metal: '#A8C832',
    dark: '#4A6210',
    light: '#D4EC7A',
    tint: '#F0F8D0',
    text: '#3A4E0C',
  },
  emerald: {
    family: 'emerald',
    nameKey: 'rankEmerald',
    metal: '#00A86B',
    dark: '#013D24',
    light: '#5EE0A0',
    tint: '#D4F3E4',
    text: '#012816',
  },
  sapphire: {
    family: 'sapphire',
    nameKey: 'rankSapphire',
    metal: '#1E5AFF',
    dark: '#0A2A6E',
    light: '#8BB4FF',
    tint: '#DCE8FF',
    text: '#081F52',
  },
  ruby: {
    family: 'ruby',
    nameKey: 'rankRuby',
    metal: '#E0113A',
    dark: '#6B0018',
    light: '#FF6B86',
    tint: '#FAD6DA',
    text: '#5A0014',
  },
  platinum: {
    family: 'platinum',
    nameKey: 'rankPlatinum',
    metal: '#C8C8C6',
    dark: '#2A2A2A',
    light: '#F2F2F0',
    tint: '#EDEDEB',
    text: '#1A1A1A',
  },
  diamond: {
    family: 'diamond',
    nameKey: 'rankDiamond',
    metal: '#D6EEF5',
    dark: '#5A6E78',
    light: '#FFFFFF',
    tint: '#F4FBFD',
    text: '#3D4F58',
  },
  master: {
    family: 'master',
    nameKey: 'rankMaster',
    metal: '#9B4EC8',
    dark: '#4A1F7A',
    light: '#E0C8F5',
    tint: '#F3E8FF',
    text: '#3B1463',
  },
};

export const FAMILY_BANDS: Array<{ family: RankFamily; from: number; to: number }> = [
  { family: 'bronze', from: 1, to: 83 },
  { family: 'silver', from: 84, to: 166 },
  { family: 'gold', from: 167, to: 249 },
  { family: 'amber', from: 250, to: 332 },
  { family: 'pearl', from: 333, to: 415 },
  { family: 'jade', from: 416, to: 498 },
  { family: 'emerald', from: 499, to: 581 },
  { family: 'sapphire', from: 582, to: 664 },
  { family: 'ruby', from: 665, to: 747 },
  { family: 'platinum', from: 748, to: 830 },
  { family: 'diamond', from: 831, to: 913 },
  { family: 'master', from: 914, to: 1000 },
];

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.replace('#', '');
  if (raw.length < 6) return null;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((value) => Number.isFinite(value))) return null;
  return { r, g, b };
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const left = parseRgb(a);
  const right = parseRgb(b);
  if (!left || !right) return a;
  const k = Math.max(0, Math.min(1, t));
  return toHex(
    left.r + (right.r - left.r) * k,
    left.g + (right.g - left.g) * k,
    left.b + (right.b - left.b) * k
  );
}

/** Sube el croma para que el metal se vea nítido, no grisáceo. */
export function saturateHex(hex: string, factor = 1.4): string {
  const rgb = parseRgb(hex);
  if (!rgb) return hex;
  const avg = (rgb.r + rgb.g + rgb.b) / 3;
  return toHex(
    avg + (rgb.r - avg) * factor,
    avg + (rgb.g - avg) * factor,
    avg + (rgb.b - avg) * factor
  );
}

/** Pinta el emblema con el mineral y conserva el relieve (luma, no suma 3x). */
export function colorizeTextureFilters(hex: string): Array<{
  name: 'feColorMatrix';
  type: 'matrix';
  values: string;
}> {
  const rgb = parseRgb(saturateHex(hex, 1.72));
  if (!rgb) return [];
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const lift = 0.14;
  return [
    {
      name: 'feColorMatrix',
      type: 'matrix',
      values: `${0.2126 * r} ${0.7152 * r} ${0.0722 * r} 0 ${lift * r} ${0.2126 * g} ${0.7152 * g} ${0.0722 * g} 0 ${lift * g} ${0.2126 * b} ${0.7152 * b} ${0.0722 * b} 0 ${lift * b} 0 0 0 1 0`,
    },
  ];
}

/** Foto real de la gema incrustada, según el catálogo de piedras. */
export const RANK_GEM_ASSET: Record<
  RankFamily,
  | 'garnet'
  | 'aquamarine'
  | 'citrine'
  | 'topaz'
  | 'tourmaline'
  | 'peridot'
  | 'emerald'
  | 'sapphire'
  | 'ruby'
  | 'onyx'
  | 'diamond'
  | 'amethyst'
> = {
  bronze: 'garnet',
  silver: 'aquamarine',
  gold: 'citrine',
  amber: 'topaz',
  pearl: 'tourmaline',
  jade: 'peridot',
  emerald: 'emerald',
  sapphire: 'sapphire',
  ruby: 'ruby',
  platinum: 'onyx',
  diamond: 'diamond',
  master: 'amethyst',
};

/** Textura 3D original del emblema. El color del rango lo da el tinte mineral + la piedra. */
export const RANK_MEDAL_ASSET: Record<RankFamily, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10> = {
  bronze: 1,
  silver: 3,
  gold: 5,
  amber: 2,
  pearl: 4,
  jade: 6,
  emerald: 6,
  sapphire: 8,
  ruby: 1,
  platinum: 3,
  diamond: 9,
  master: 10,
};

export function clampLoanLevel(level: number): number {
  return Math.min(MAX_LOAN_LEVEL, Math.max(1, Math.floor(level) || 1));
}

export function getRankForLevel(level: number): RankStyle {
  const clamped = clampLoanLevel(level);
  const band =
    FAMILY_BANDS.find((item) => clamped >= item.from && clamped <= item.to) || FAMILY_BANDS[0];
  const span = band.to - band.from + 1;
  const third = Math.max(1, Math.floor(span / 3));
  const offset = clamped - band.from;
  const division: RankStyle['division'] = offset >= third * 2 ? 2 : offset >= third ? 1 : 0;
  return {
    ...FAMILY_STYLE[band.family],
    level: clamped,
    division,
  };
}

export function rankFamilyIndex(family: RankFamily): number {
  const index = FAMILY_BANDS.findIndex((item) => item.family === family);
  return index < 0 ? 0 : index;
}

export function romanDivision(division: RankStyle['division']): string {
  if (division === 2) return 'III';
  if (division === 1) return 'II';
  return 'I';
}

/** I, II y III en el color vivo de la piedra. Nunca se mezcla con el tono oscuro. */
export function rankDivisionTint(rank: RankStyle): string {
  const paint = saturateHex(mixHex(rank.metal, rank.light, 0.22), 1.58);
  if (rank.division >= 2) return saturateHex(mixHex(rank.metal, rank.light, 0.5), 1.62);
  if (rank.division >= 1) return saturateHex(mixHex(rank.metal, rank.light, 0.34), 1.6);
  return paint;
}

export function formatRankLabel(rank: RankStyle, name: string): string {
  return `${name} ${romanDivision(rank.division)} · ${rank.level}`;
}

export const RANK_LADDER = FAMILY_BANDS.map((band) => getRankForLevel(band.from));

/** I, II y III de cada piedra, para la vitrina de marcos. */
export function rankGalleryRow(family: RankFamily): RankStyle[] {
  const band = FAMILY_BANDS.find((item) => item.family === family) || FAMILY_BANDS[0];
  const span = band.to - band.from + 1;
  const third = Math.max(1, Math.floor(span / 3));
  return [
    getRankForLevel(band.from),
    getRankForLevel(Math.min(band.to, band.from + third)),
    getRankForLevel(Math.min(band.to, band.from + third * 2)),
  ];
}

export const RANK_GALLERY = FAMILY_BANDS.map((band) => rankGalleryRow(band.family));
