let pendingUrl: string | null = null;

export function rememberAppUrl(url?: string | null): void {
  if (url) pendingUrl = url;
}

export function takePendingAppUrl(): string | null {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
}
