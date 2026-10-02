import { useState } from 'react';

/**
 * One trip of the page, held by ID — for the detail panel, and for the dispatch
 * panel opened from a row.
 *
 * ★ THE ROW IS RE-DERIVED FROM THE PAGE ON EVERY RENDER. Every write re-reads
 * the board, so holding the object clicked would keep showing the trip as it
 * was before the change until the panel was closed and reopened.
 *
 * ★ AND WHEN THE ROW LEAVES THE PAGE, THE ANSWER IS `null` — it does NOT fall
 * back to the object clicked. Crewing a trip from "chờ phân công" moves it out
 * of that filter; completing one moves it to Lịch sử chuyến. The clicked object
 * is exactly the state the dispatcher has just made untrue. `useOffsetPages`
 * keeps the previous page across a refetch, so an empty find means the row has
 * really gone, not that it is reloading.
 */
export function useSelectedBooking<T extends { id: string }>(items: readonly T[]) {
  const [id, setId] = useState<string | null>(null);
  const selected = id === null ? null : (items.find((item) => item.id === id) ?? null);
  return { selected, select: setId, clear: () => setId(null) };
}
