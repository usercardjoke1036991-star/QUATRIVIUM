/** Mientras el selector de imágenes está abierto, no pedir la contraseña al volver. */
const PICKER_MAX_MS = 2 * 60 * 1000;
const PICKER_GRACE_MS = 1500;

let held = false;
let heldSinceMono = 0;
let graceUntilMono = 0;

export function setPickerActive(active: boolean, mono = performance.now()) {
  if (active) {
    held = true;
    heldSinceMono = mono;
    graceUntilMono = 0;
    return;
  }
  held = false;
  graceUntilMono = mono + PICKER_GRACE_MS;
}

/** Tras 2 minutos de selector abierto, la excepción caduca y la app puede volver a bloquear. */
export function isPickerHeld(mono = performance.now()) {
  if (held) {
    if (mono - heldSinceMono >= PICKER_MAX_MS) return false;
    return true;
  }
  return graceUntilMono > mono;
}
