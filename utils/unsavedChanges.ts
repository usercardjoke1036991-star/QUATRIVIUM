/** True if the draft differs from what is already persisted. */
export function hasUnsavedChanges<T>(draft: T, saved: T): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}
