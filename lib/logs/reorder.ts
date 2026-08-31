export function changedReorderRange<T extends { id: string }>(before: T[], ordered: T[]) {
  if (before.length !== ordered.length) return { before, ordered };
  let start = 0;
  while (start < before.length && before[start].id === ordered[start].id) start += 1;
  if (start === before.length) return { before: [] as T[], ordered: [] as T[] };
  let end = before.length - 1;
  while (end > start && before[end].id === ordered[end].id) end -= 1;
  return { before: before.slice(start, end + 1), ordered: ordered.slice(start, end + 1) };
}
