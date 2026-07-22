import { api } from './api';

type PaginatedPayload<T> = {
  data?: T[];
  pagination?: {
    totalPages?: number;
  };
};

function pageUrl(endpoint: string, page: number, limit: number): string {
  const [path, query = ''] = endpoint.split('?');
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return `${path}?${params.toString()}`;
}

/** Load every page for selectors and client-side tables that must not truncate options. */
export async function fetchAllPages<T>(endpoint: string, limit = 100): Promise<T[]> {
  const first = await api.get<PaginatedPayload<T>>(pageUrl(endpoint, 1, limit));
  const totalPages = Math.max(first.pagination?.totalPages ?? 1, 1);
  if (totalPages === 1) return first.data ?? [];

  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => (
      api.get<PaginatedPayload<T>>(pageUrl(endpoint, index + 2, limit))
    ))
  );
  return [first, ...remaining].flatMap((response) => response.data ?? []);
}
