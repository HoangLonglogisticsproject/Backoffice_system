/*
 * @bo/components — reusable UI. Knows tokens, accessibility and interaction;
 * knows no customer, no department, no capability, no business word at all.
 *
 * Three groups, and the split is about what a developer is looking for:
 *   ui/         things the user acts on or reads
 *   feedback/   things that report state — empty, loading, progress
 *   navigation/ the navigation surface, in its three compositions
 *
 * Global stylesheet entry for the controls native elements wear as classes:
 *   @use 'controls' as *;
 */

// --- ui ---------------------------------------------------------------------
// Controls are directives on native elements, not wrappers: <button> and
// <input> already own their semantics, focus behaviour and form participation.
export * from './ui/button/button';
export * from './ui/icon-button/icon-button';
export * from './ui/input/input';
export * from './ui/select/select';

export * from './ui/icon/icon';
export * from './ui/icon/icon.paths';
export * from './ui/card/card';
export * from './ui/badge/badge';
export * from './ui/avatar/avatar';
export * from './ui/data-table/data-table';
export * from './ui/page-header/page-header';
export * from './ui/section-header/section-header';
export * from './ui/sparkline/sparkline';
export * from './ui/stat-card/stat-card';

// --- feedback ---------------------------------------------------------------
export * from './feedback/empty-state/empty-state';
export * from './feedback/skeleton/skeleton';
export * from './feedback/progress-bar/progress-bar';
export * from './feedback/radial/radial';

// --- navigation -------------------------------------------------------------
export * from './navigation';

// --- pipes ------------------------------------------------------------------
export * from './pipes/format.pipe';
