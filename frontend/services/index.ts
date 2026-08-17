/*
 * @bo/services — reusable frontend infrastructure.
 *
 * Angular-aware, business-free: authorization, the plugin composition
 * mechanism, and the branding contract. Feature data access lives in
 * `features/<name>/data-access/`.
 */
export * from './access/rules/scope';
export * from './access/rules/unit-access';
export * from './access/rules/record-access';
export * from './access/access.service';
export * from './access/access.guards';
export * from './access/can.directive';

export * from './composition/capability.model';
export * from './composition/capability.registry';
export * from './composition/workspace.model';
export * from './composition/workspace.registry';
// Render whatever the registry holds. They read the registry and take a scope,
// so they are composition, not generic UI — a reusable component must not know
// what a Role is.
export * from './composition/widget-host/widget-host';
export * from './composition/lazy-widget/lazy-widget';

export * from './branding';
