let held = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function setPickerActive(active: boolean) {
  if (active) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    held = true;
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    held = false;
    timer = null;
  }, 1500);
}

export function isPickerHeld() {
  return held;
}
