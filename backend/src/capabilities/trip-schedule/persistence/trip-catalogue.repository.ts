import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { CatalogueStatus, TripCustomer, TripVehicle } from '../domain/trip-schedule';

/**
 * SQL for the two catalogues behind the dispatch board.
 *
 * ★ TWO CLASSES WITH THE SAME SHAPE, AND NOT ONE GENERIC ONE.
 *
 * The obvious refactor is a single repository taking a table name. That table
 * name would have to be interpolated into the SQL string, and a repository that
 * builds SQL from a variable is a repository whose safety depends on every
 * future caller passing a constant. The duplication here is eleven lines of
 * literal SQL twice; the alternative is a pattern that has to be re-audited
 * every time somebody touches it. The row mappers and the conflict translation
 * ARE shared, because those are the parts where a divergence would be a bug
 * rather than a difference.
 */

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface VehicleRow {
  id: string;
  plate: string;
  note: string | null;
  status: CatalogueStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface CustomerRow extends Omit<VehicleRow, 'plate'> {
  name: string;
}

const VEHICLE_COLUMNS = 'id, plate, note, status, created_by, created_at, updated_at';
const CUSTOMER_COLUMNS = 'id, name, note, status, created_by, created_at, updated_at';

const toVehicle = (row: VehicleRow): TripVehicle => ({
  id: row.id,
  plate: row.plate,
  note: row.note,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toCustomer = (row: CustomerRow): TripCustomer => ({
  id: row.id,
  name: row.name,
  note: row.note,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Turns the partial unique index into the answer a client can act on.
 *
 * The service checks for a duplicate before writing, and this still has to
 * exist: two dispatchers adding the same new customer in the same instant both
 * pass the check and one loses at the index. Without this translation that
 * loser gets a 500 for a situation the API has a perfectly good 409 for.
 */
const asConflict = (error: unknown, message: string): never => {
  if (isUniqueViolation(error)) throw new ConflictError(message);
  throw error;
};

@Injectable()
export class TripVehicleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The whole catalogue, ordered by plate.
   *
   * Deliberately NOT paginated, for the reason ADR-0002 §4 gives for
   * `GET /departments`: it is bounded small — a fleet, not a ledger — and it
   * sorts by a MUTABLE column, so a cursor over it could skip or repeat rows
   * through no fault of the reader. Archived rows are excluded unless asked
   * for, because the only screen that wants them is the one that un-archives.
   */
  async list(
    includeArchived: boolean,
    executor: DatabaseQuery = this.db,
  ): Promise<TripVehicle[]> {
    const rows = await executor.query<VehicleRow>(
      includeArchived
        ? `SELECT ${VEHICLE_COLUMNS} FROM trip_vehicles ORDER BY status ASC, plate ASC`
        : `SELECT ${VEHICLE_COLUMNS} FROM trip_vehicles WHERE status = 'active' ORDER BY plate ASC`,
    );
    return rows.map(toVehicle);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripVehicle | null> {
    const rows = await executor.query<VehicleRow>(
      `SELECT ${VEHICLE_COLUMNS} FROM trip_vehicles WHERE id = $1`,
      [id],
    );
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async create(
    input: { plate: string; note: string | null; createdBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<TripVehicle> {
    try {
      const rows = await executor.query<VehicleRow>(
        `INSERT INTO trip_vehicles (plate, note, created_by)
         VALUES ($1, $2, $3)
         RETURNING ${VEHICLE_COLUMNS}`,
        [input.plate, input.note, input.createdBy],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO trip_vehicles returned no row');

      return toVehicle(row);
    } catch (error) {
      return asConflict(error, 'That vehicle is already in the catalogue.');
    }
  }

  async update(
    id: string,
    values: { plate: string; note: string | null },
    executor: DatabaseQuery = this.db,
  ): Promise<TripVehicle | null> {
    try {
      const rows = await executor.query<VehicleRow>(
        `UPDATE trip_vehicles
            SET plate = $2, note = $3
          WHERE id = $1 AND status = 'active'
          RETURNING ${VEHICLE_COLUMNS}`,
        [id, values.plate, values.note],
      );
      return rows[0] ? toVehicle(rows[0]) : null;
    } catch (error) {
      return asConflict(error, 'Another vehicle in the catalogue already has that plate.');
    }
  }

  /**
   * Retires a vehicle without destroying the trips that name it.
   *
   * `WHERE status = 'active'` makes a second archive a no-op the service turns
   * into a 404, rather than a silent rewrite of a row that was already retired.
   */
  async archive(id: string, executor: DatabaseQuery = this.db): Promise<TripVehicle | null> {
    const rows = await executor.query<VehicleRow>(
      `UPDATE trip_vehicles
          SET status = 'archived'
        WHERE id = $1 AND status = 'active'
        RETURNING ${VEHICLE_COLUMNS}`,
      [id],
    );
    return rows[0] ? toVehicle(rows[0]) : null;
  }
}

@Injectable()
export class TripCustomerRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    includeArchived: boolean,
    executor: DatabaseQuery = this.db,
  ): Promise<TripCustomer[]> {
    const rows = await executor.query<CustomerRow>(
      includeArchived
        ? `SELECT ${CUSTOMER_COLUMNS} FROM trip_customers ORDER BY status ASC, name ASC`
        : `SELECT ${CUSTOMER_COLUMNS} FROM trip_customers WHERE status = 'active' ORDER BY name ASC`,
    );
    return rows.map(toCustomer);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripCustomer | null> {
    const rows = await executor.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM trip_customers WHERE id = $1`,
      [id],
    );
    return rows[0] ? toCustomer(rows[0]) : null;
  }

  async create(
    input: { name: string; note: string | null; createdBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<TripCustomer> {
    try {
      const rows = await executor.query<CustomerRow>(
        `INSERT INTO trip_customers (name, note, created_by)
         VALUES ($1, $2, $3)
         RETURNING ${CUSTOMER_COLUMNS}`,
        [input.name, input.note, input.createdBy],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO trip_customers returned no row');

      return toCustomer(row);
    } catch (error) {
      return asConflict(error, 'That customer is already in the catalogue.');
    }
  }

  async update(
    id: string,
    values: { name: string; note: string | null },
    executor: DatabaseQuery = this.db,
  ): Promise<TripCustomer | null> {
    try {
      const rows = await executor.query<CustomerRow>(
        `UPDATE trip_customers
            SET name = $2, note = $3
          WHERE id = $1 AND status = 'active'
          RETURNING ${CUSTOMER_COLUMNS}`,
        [id, values.name, values.note],
      );
      return rows[0] ? toCustomer(rows[0]) : null;
    } catch (error) {
      return asConflict(error, 'Another customer in the catalogue already has that name.');
    }
  }

  async archive(id: string, executor: DatabaseQuery = this.db): Promise<TripCustomer | null> {
    const rows = await executor.query<CustomerRow>(
      `UPDATE trip_customers
          SET status = 'archived'
        WHERE id = $1 AND status = 'active'
        RETURNING ${CUSTOMER_COLUMNS}`,
      [id],
    );
    return rows[0] ? toCustomer(rows[0]) : null;
  }
}
