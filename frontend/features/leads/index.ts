/*
 * ./features/leads — THG's sales-side business capability.
 *
 * The first library in this workspace that carries tenant vocabulary. Platform
 * libraries stay clean of it; a different company ships its own capability
 * modules and reuses everything under @bo/*.
 */

export * from './domain/potential-customer';
export * from './data-access/potential-customer.repository';
export * from './data-access/fixture-potential-customer.repository';

export * from './ui/customer-vocabulary';
export * from './ui/customer-status.badge';

export * from './potential-customers.capabilities';
