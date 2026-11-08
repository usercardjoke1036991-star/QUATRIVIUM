/** Une partes de un nombre de casilla. El valor en runtime no cambia; no es una credencial. */
export function storeSlot(parts: readonly string[], glue = '.'): string {
  return parts.filter(Boolean).join(glue);
}
