import type { PodiumPlace } from '../utils/fameRankings';

export interface PodiumStyle {
  place: PodiumPlace;
  metal: string;
  dark: string;
  light: string;
  ink: string;
}

/** Medallas de ranking. No reutilizan el metal ni las gemas de los marcos de nivel. */
export const PODIUM_STYLE: Record<PodiumPlace, PodiumStyle> = {
  1: {
    place: 1,
    metal: '#C9A227',
    dark: '#5C4310',
    light: '#F8E7A0',
    ink: '#3D2C08',
  },
  2: {
    place: 2,
    metal: '#8E9AA8',
    dark: '#3A4450',
    light: '#E8EEF4',
    ink: '#24303A',
  },
  3: {
    place: 3,
    metal: '#B45A2A',
    dark: '#5A2A12',
    light: '#F0C19A',
    ink: '#3A1A0A',
  },
};
