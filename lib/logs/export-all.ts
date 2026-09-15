export const EXPORT_PAGE_SIZE = 1_000;

type RangeResult<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

/** Fetches every row explicitly; hosted PostgREST projects commonly cap one response at 1,000 rows. */
export async function fetchAllByRange<T>(fetchRange: (from: number, to: number) => RangeResult<T>) {
  const rows: T[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await fetchRange(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) return { data: rows, error: null };
  }
}
