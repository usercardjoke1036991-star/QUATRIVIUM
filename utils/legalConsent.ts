import { storeSlot } from './storeSlot';

export const LEGAL_VERSION = '2026-09-30.1';
export const LEGAL_STORAGE_KEY = storeSlot(['quatrivium', 'legalAccepted']);

export type LegalRecord = {
  version: string;
  at: string;
};

export type BootLegalScreen = 'language' | 'legal' | 'app';

export function parseLegalRecord(raw: string | null | undefined): LegalRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as LegalRecord;
    if (!data || typeof data.version !== 'string' || typeof data.at !== 'string') return null;
    if (!data.version.trim() || !data.at.trim()) return null;
    return { version: data.version, at: data.at };
  } catch {
    return null;
  }
}

export function isCurrentLegalAccepted(
  record: LegalRecord | null | undefined,
  version: string = LEGAL_VERSION
): boolean {
  return Boolean(record && record.version === version && record.at);
}

export function makeLegalRecord(at: string, version: string = LEGAL_VERSION): LegalRecord {
  return { version, at };
}

/** Idioma primero. Políticas después. Luego el alta. */
export function nextBootLegalScreen(langChosen: boolean, legalAccepted: boolean): BootLegalScreen {
  if (!langChosen) return 'language';
  if (!legalAccepted) return 'legal';
  return 'app';
}

/** El botón Aceptar solo si el usuario llegó al final del texto. */
export function hasReadToEnd(
  layoutHeight: number,
  contentHeight: number,
  offsetY: number
): boolean {
  const view = Number(layoutHeight) || 0;
  const content = Number(contentHeight) || 0;
  const y = Number(offsetY) || 0;
  if (view <= 0) return false;
  if (content <= view + 8) return true;
  return y + view >= content - 48;
}
