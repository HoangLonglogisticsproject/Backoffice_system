import { lazy, Suspense } from 'react';

/**
 * React Query's inspector, off the page until somebody asks for it.
 *
 * ★ IT WAS COSTING 1.3 MB ON EVERY LOAD, IN DEVELOPMENT, ON EVERY SCREEN.
 * `@tanstack/query-devtools` lazy-loads its own panel, but the trigger mounts
 * with the app, so the panel came down immediately — measured in the network
 * trace as a 1,358 kB script on the LOGIN page, which has no queries on it at
 * all. It never reached production (the package's production entry is a stub,
 * confirmed against `dist/`), so this was purely a tax on the people building
 * the thing.
 *
 * ★ A FLAG, NOT A REMOVAL. The inspector is genuinely useful when a cache
 * question comes up, so it stays one line away:
 *
 *     localStorage.setItem('bo:devtools', 'on')   // then reload
 *     localStorage.removeItem('bo:devtools')      // and it is gone again
 *
 * Read once at module load rather than watched: turning it on is a deliberate
 * act followed by a reload, and a listener here would be machinery for a case
 * nobody has.
 *
 * ⚠ `import.meta.env.DEV` IS THE OUTER GATE, AND IT IS A BUILD-TIME CONSTANT.
 * Rolldown folds `false && …` away, so neither the flag nor the dynamic import
 * survives into a production bundle — a browser with the key set cannot summon
 * the inspector on the deployed app.
 */
const Panel = lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  })),
);

/** `localStorage` throws outright when site data is blocked. */
const asked = (): boolean => {
  try {
    return globalThis.localStorage?.getItem('bo:devtools') === 'on';
  } catch {
    return false;
  }
};

const enabled = import.meta.env.DEV && asked();

export function QueryDevtools() {
  if (!enabled) return null;

  return (
    <Suspense fallback={null}>
      <Panel initialIsOpen={false} />
    </Suspense>
  );
}
