/**
 * PORT for persistence.
 *
 * Lives in `common/types` because it is a contract with no implementation and
 * no owner: `core/` modules depend on it, `infrastructure/database` satisfies
 * it, and neither has to know the other exists.
 *
 * Deliberately does NOT expose `pg` types. A `PoolClient` in this signature
 * would put the driver in every core module's import graph, and swapping the
 * driver would then be a change to the foundation instead of to one adapter.
 *
 * Deliberately NOT a repository abstraction either. This is the smallest thing
 * that lets a module write its own SQL — a generic `Repository<T>` would only
 * be a worse query builder with fewer capabilities.
 */
export interface DatabaseQuery {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database extends DatabaseQuery {
  /**
   * Runs `work` in a transaction, committing on return and rolling back on
   * throw.
   *
   * A callback rather than begin/commit handles, so a caller cannot leak a
   * connection by forgetting to release it — the failure that quietly drains
   * a pool under load.
   */
  transaction<T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T>;
}

export const DATABASE = Symbol('DATABASE');
