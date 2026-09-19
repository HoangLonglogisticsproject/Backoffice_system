/**
 * PORT for persistence — the backend's, copied. `core/` depends on it,
 * `infrastructure/database` satisfies it, and neither names `pg`.
 */
export interface DatabaseQuery {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database extends DatabaseQuery {
  /** Runs `work` in a transaction, committing on return and rolling back on throw. */
  transaction<T>(work: (tx: DatabaseQuery) => Promise<T>): Promise<T>;
}

export const DATABASE = Symbol('DATABASE');
