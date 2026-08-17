/*
 * @bo/components navigation — the navigation surface in its three
 * compositions: full sidebar, icon rail, mobile drawer.
 *
 * All three are the same component. `rail` and `open` pick the composition;
 * the DOM and the state stay one, which is why a group left open in the
 * sidebar is still open in the drawer.
 *
 * It takes a NavigationModel and knows nothing else — see navigation.model.ts.
 */
export * from './navigation.model';
export * from './navigation-sidebar/navigation-sidebar';
