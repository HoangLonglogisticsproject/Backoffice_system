/**
 * ★ A TAB THAT WAS OPEN ACROSS A DEPLOY, CLICKING EXPORT.
 *
 * One module in this app is loaded on demand — `xlsx`, from
 * `utils/export/tripScheduleWorkbook.ts`, which the build emits as its own
 * `assets/xlsx-<hash>.js`. That hash changes with every build, so the moment a
 * new deployment is promoted the filename the OLD index.html remembers stops
 * existing: the request 404s, the SPA rewrite answers it with index.html, and
 * the dynamic import rejects on HTML where JavaScript was expected.
 *
 * Nothing else on the page breaks, and that is precisely the problem — the
 * user sees one button that silently does nothing, with no hint that a reload
 * is the fix. This is the "why do I have to clear my cache" report.
 *
 * Vite raises `vite:preloadError` for exactly this case. Reloading fetches the
 * current index.html, and with it a chunk name that exists.
 *
 * ★ ONE RELOAD, KEYED TO THE URL. If the chunk is still missing afterwards —
 * a genuinely broken deployment rather than a stale tab — the second failure is
 * left to throw. A reload loop is a white screen that never settles and hides
 * the real fault, which is strictly worse than the button that did nothing.
 *
 * ★ `preventDefault()` ONLY ON THE ATTEMPT WE ANSWER. It suppresses the error
 * Vite would otherwise throw; suppressing it on the give-up path would swallow
 * the one signal that says the deployment itself is wrong.
 *
 * ponytail: sessionStorage, not a module-level boolean. The flag has to survive
 * the reload it causes, which is the one thing a variable cannot do.
 */
const KEY = 'bo:reload-for-stale-chunk';

/** Extracted from `main.tsx` so the give-up branch is reachable from a test. */
export function handleStaleChunk(event: Event, win: Window = window): void {
  // ★ THE FLAG IS WRITTEN BEFORE ANYTHING IS SUPPRESSED. A browser with site
  // data blocked throws here, and a page that cannot remember it already
  // reloaded must not reload at all — that is the loop this exists to avoid.
  // Failing before `preventDefault()` also means the error still surfaces,
  // rather than being swallowed by a recovery that then declines to recover.
  try {
    if (win.sessionStorage.getItem(KEY) === win.location.href) return;
    win.sessionStorage.setItem(KEY, win.location.href);
  } catch {
    return;
  }

  event.preventDefault();
  win.location.reload();
}

export function registerStaleChunkReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', handleStaleChunk);
}
