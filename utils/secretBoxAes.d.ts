export function sealAesGcmV2(plaintext: string, wrapKeyHex: string): string;
export function openAesGcmV2(
  parsed: { iv: string; ct: string; tag: string },
  wrapKeyHex: string
): string;
