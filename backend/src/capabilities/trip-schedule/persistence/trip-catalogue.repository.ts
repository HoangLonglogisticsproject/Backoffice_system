import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  CatalogueStatus,
  TripCustomer,
  TripLocation,
  TripLocationListing,
  TripVehicle,
} from '../domain/trip-schedule';
import type { VehicleOwnership } from '../domain/trip-execution';

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
  ownership: VehicleOwnership | null;
  carrier_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface CustomerRow extends Omit<VehicleRow, 'plate' | 'ownership' | 'carrier_id'> {
  name: string;
}

const VEHICLE_COLUMNS =
  'id, plate, note, status, ownership, carrier_id, created_by, created_at, updated_at';
const CUSTOMER_COLUMNS = 'id, name, note, status, created_by, created_at, updated_at';

const toVehicle = (row: VehicleRow): TripVehicle => ({
  id: row.id,
  plate: row.plate,
  note: row.note,
  status: row.status,
  ownership: row.ownership,
  carrierId: row.carrier_id,
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

// ------------------------------------------------------------- locations ----

interface LocationRow {
  id: string;
  /** `null` for a shared place. 0030 made the column nullable. */
  customer_id: string | null;
  name: string;
  address: string;
  contact: string | null;
  note: string | null;
  province_code: string | null;
  province: string | null;
  district_code: string | null;
  district: string | null;
  ward_code: string | null;
  ward: string | null;
  latitude: number | null;
  longitude: number | null;
  status: 'active' | 'archived';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/** A listing row carries the owner's name, resolved by the join. */
interface LocationListingRow extends LocationRow {
  customer_name: string | null;
}

const LOCATION_COLUMNS =
  'id, customer_id, name, address, contact, note, ' +
  'province_code, province, district_code, district, ward_code, ward, ' +
  'latitude, longitude, status, created_by, created_at, updated_at';

/** The same list, qualified — the catalogue read joins a second table. */
const LOCATION_COLUMNS_QUALIFIED = LOCATION_COLUMNS.split(', ')
  .map((column) => `l.${column}`)
  .join(', ');

const toLocation = (row: LocationRow): TripLocation => ({
  id: row.id,
  customerId: row.customer_id,
  name: row.name,
  address: row.address,
  contact: row.contact,
  note: row.note,
  provinceCode: row.province_code,
  province: row.province,
  districtCode: row.district_code,
  district: row.district,
  wardCode: row.ward_code,
  ward: row.ward,
  latitude: row.latitude,
  longitude: row.longitude,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toListing = (row: LocationListingRow): TripLocationListing => ({
  ...toLocation(row),
  customerName: row.customer_name,
});

/** What a location row may hold. Coordinates already validated as a pair. */
export interface TripLocationValues {
  name: string;
  address: string;
  contact: string | null;
  note: string | null;
  provinceCode: string | null;
  province: string | null;
  districtCode: string | null;
  district: string | null;
  wardCode: string | null;
  ward: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Every column a caller may set, as `[field on the object, column in the table]`.
 *
 * ★ THE TWO NAMES ARE BOTH WRITTEN DOWN BECAUSE THEY DIFFER. `provinceCode` is
 * the field; `province_code` is the column. Deriving one from the other by
 * case conversion would work until the first column that does not follow the
 * rule, and would fail silently in SQL rather than in TypeScript.
 *
 * ★ AND THE ORDER IS THE CONTRACT. `settableValues` returns values in exactly
 * this order; the INSERT and both UPDATEs number their placeholders from it.
 * Everything that has to agree is counted from this one array, so nothing can
 * drift out of step with anything else.
 */
const SETTABLE = [
  ['name', 'name'],
  ['address', 'address'],
  ['contact', 'contact'],
  ['note', 'note'],
  ['provinceCode', 'province_code'],
  ['province', 'province'],
  ['districtCode', 'district_code'],
  ['district', 'district'],
  ['wardCode', 'ward_code'],
  ['ward', 'ward'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
] as const satisfies ReadonlyArray<readonly [keyof TripLocationValues, string]>;

const setClause = (firstPlaceholder: number): string =>
  SETTABLE.map(([, column], index) => `${column} = $${firstPlaceholder + index}`).join(', ');

const SETTABLE_COLUMNS = setClause(3);
const SETTABLE_COLUMNS_BY_ID = setClause(2);

/**
 * The same list again for the INSERT, and generated for the same reason.
 *
 * ★ THIS WAS A REAL BUG, NOT A TIDINESS EXERCISE. The column list and the
 * `VALUES ($1, $2, …)` list were written out by hand; adding `province_code`
 * and `ward_code` grew the columns to twelve and left the placeholders at
 * eleven, and PostgreSQL answered every attempt to add a place with
 * `INSERT has more target columns than expressions`. Two lists that must agree
 * and are maintained separately WILL disagree. Counted from one array, they
 * cannot.
 *
 * `customer_id` leads and `created_by` trails because neither is settable
 * afterwards: one decides which population the row joins, the other is
 * provenance.
 */
const INSERT_COLUMNS = SETTABLE.map(([, column]) => column).join(', ');
const INSERT_PLACEHOLDERS = Array.from(
  // +2 for the customer and the author bracketing the settable columns.
  { length: SETTABLE.length + 2 },
  (_, index) => `$${index + 1}`,
).join(', ');

const settableValues = (values: TripLocationValues): unknown[] =>
  SETTABLE.map(([field]) => values[field]);

/**
 * Places: a customer's, and the company's own.
 *
 * ★ EVERY READ AND WRITE THAT TAKES A CUSTOMER FILTERS ON IT IN SQL. `findById`
 * is the one exception, and the service pairs its answer with the customer on
 * the route before doing anything — a location under the wrong customer is
 * answered as not found, never as forbidden.
 *
 * ★ THE `*ById` WRITES CARRY NO CUSTOMER, AND THAT IS DELIBERATE. They serve
 * the catalogue screen, which edits a row it has already been shown and whose
 * owner it does not need to restate. An id is unique; the pairing check exists
 * to stop a caller REACHING a row through another customer's path, which is a
 * property of the per-customer routes rather than of the row.
 */
@Injectable()
export class TripLocationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Every place, shared ones first, for the catalogue screen.
   *
   * Not paginated, for the reason the vehicle list gives: bounded small and
   * sorted by a mutable column. `customer_name` comes from a LEFT JOIN so a
   * shared row survives it with a NULL rather than being dropped.
   */
  async listAll(
    includeArchived: boolean,
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocationListing[]> {
    const rows = await executor.query<LocationListingRow>(
      `SELECT ${LOCATION_COLUMNS_QUALIFIED}, c.name AS customer_name
         FROM trip_locations l
         LEFT JOIN trip_customers c ON c.id = l.customer_id
        ${includeArchived ? '' : "WHERE l.status = 'active'"}
        ORDER BY ${includeArchived ? 'l.status ASC,' : ''}
                 -- Shared places lead: they are the ones typed most often, and
                 -- NULLS FIRST says so rather than leaving it to collation.
                 l.customer_id IS NOT NULL ASC,
                 c.name ASC NULLS FIRST,
                 l.name ASC`,
    );
    return rows.map(toListing);
  }

  async listByCustomer(
    customerId: string,
    includeArchived: boolean,
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocation[]> {
    const rows = await executor.query<LocationRow>(
      includeArchived
        ? `SELECT ${LOCATION_COLUMNS} FROM trip_locations
            WHERE customer_id = $1 ORDER BY status ASC, name ASC`
        : `SELECT ${LOCATION_COLUMNS} FROM trip_locations
            WHERE customer_id = $1 AND status = 'active' ORDER BY name ASC`,
      [customerId],
    );
    return rows.map(toLocation);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripLocation | null> {
    const rows = await executor.query<LocationRow>(
      `SELECT ${LOCATION_COLUMNS} FROM trip_locations WHERE id = $1`,
      [id],
    );
    return rows[0] ? toLocation(rows[0]) : null;
  }

  /** `customerId: null` writes a SHARED place. See 0030. */
  async create(
    input: TripLocationValues & { customerId: string | null; createdBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocation> {
    try {
      const rows = await executor.query<LocationRow>(
        `INSERT INTO trip_locations (customer_id, ${INSERT_COLUMNS}, created_by)
         VALUES (${INSERT_PLACEHOLDERS})
         RETURNING ${LOCATION_COLUMNS}`,
        [input.customerId, ...settableValues(input), input.createdBy],
      );
      const row = rows[0];
      if (!row) throw new Error('INSERT INTO trip_locations returned no row');
      return toLocation(row);
    } catch (error) {
      return asConflict(
        error,
        input.customerId === null
          ? 'A shared location with that name already exists.'
          : 'That customer already has a location with that name.',
      );
    }
  }

  /** Overwrites every settable column of a live row under its customer. */
  async update(
    id: string,
    customerId: string,
    values: TripLocationValues,
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocation | null> {
    try {
      const rows = await executor.query<LocationRow>(
        `UPDATE trip_locations
            SET ${SETTABLE_COLUMNS}
          WHERE id = $1 AND customer_id = $2 AND status = 'active'
          RETURNING ${LOCATION_COLUMNS}`,
        [id, customerId, ...settableValues(values)],
      );
      return rows[0] ? toLocation(rows[0]) : null;
    } catch (error) {
      return asConflict(error, 'That customer already has another location with that name.');
    }
  }

  /** The same write, reached by id alone — the catalogue screen's edit. */
  async updateById(
    id: string,
    values: TripLocationValues,
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocation | null> {
    try {
      const rows = await executor.query<LocationRow>(
        `UPDATE trip_locations
            SET ${SETTABLE_COLUMNS_BY_ID}
          WHERE id = $1 AND status = 'active'
          RETURNING ${LOCATION_COLUMNS}`,
        [id, ...settableValues(values)],
      );
      return rows[0] ? toLocation(rows[0]) : null;
    } catch (error) {
      return asConflict(error, 'Another location already has that name.');
    }
  }

  async archive(
    id: string,
    customerId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<TripLocation | null> {
    const rows = await executor.query<LocationRow>(
      `UPDATE trip_locations
          SET status = 'archived'
        WHERE id = $1 AND customer_id = $2 AND status = 'active'
        RETURNING ${LOCATION_COLUMNS}`,
      [id, customerId],
    );
    return rows[0] ? toLocation(rows[0]) : null;
  }

  async archiveById(id: string, executor: DatabaseQuery = this.db): Promise<TripLocation | null> {
    const rows = await executor.query<LocationRow>(
      `UPDATE trip_locations
          SET status = 'archived'
        WHERE id = $1 AND status = 'active'
        RETURNING ${LOCATION_COLUMNS}`,
      [id],
    );
    return rows[0] ? toLocation(rows[0]) : null;
  }
}
