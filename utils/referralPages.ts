export const REFERRAL_PAGE_SIZE = 8;

export function referralPageCount(total: number, pageSize = REFERRAL_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const size = Math.max(1, pageSize);
  return Math.ceil(total / size);
}

export function clampReferralPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages);
}

export function sliceReferralPage<T>(items: T[], page: number, pageSize = REFERRAL_PAGE_SIZE): T[] {
  const list = Array.isArray(items) ? items : [];
  const totalPages = referralPageCount(list.length, pageSize);
  if (!totalPages) return [];
  const safe = clampReferralPage(page, totalPages);
  const size = Math.max(1, pageSize);
  const start = (safe - 1) * size;
  return list.slice(start, start + size);
}

export function visibleReferralPages(current: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 0) return [];
  const page = clampReferralPage(current, totalPages);
  if (totalPages <= 11) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const picked = new Set([1, totalPages]);
  for (let next = page - 2; next <= page + 2; next += 1) {
    if (next >= 1 && next <= totalPages) picked.add(next);
  }
  const sorted = [...picked].sort((left, right) => left - right);
  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push('gap');
    out.push(value);
    previous = value;
  }
  return out;
}
