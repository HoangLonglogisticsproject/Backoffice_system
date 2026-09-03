import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { optionalPoint } from '../domain/trip-location';
import type { TripCustomer, TripLocation, TripVehicle } from '../domain/trip-schedule';
import {
  TripCustomerRepository,
  TripLocationRepository,
  type TripLocationValues,
  TripVehicleRepository,
} from '../persistence/trip-catalogue.repository';

/**
 * The two catalogues the dispatch board points at.
 *
 * No transaction is opened anywhere in this file, and that is not an omission.
 * Every operation here is a single statement against a single table; wrapping
 * one statement in a transaction buys nothing and suggests to the next reader
 * that something atomic is happening.
 *
 * WHO MAY DO WHAT is settled before any of this runs: `trip.create` for adding
 * a row, `trip.write` for correcting or retiring one. The asymmetry is the
 * point — a dispatcher must be able to add the customer they are looking at
 * right now, but renaming a customer changes what every past trip appears to
 * say, and that is administration.
 */
@Injectable()
export class TripCatalogueService {
  constructor(
    private readonly vehicles: TripVehicleRepository,
    private readonly customers: TripCustomerRepository,
    private readonly locations: TripLocationRepository,
  ) {}

  // ------------------------------------------------------------- vehicles ----

  listVehicles(includeArchived: boolean): Promise<TripVehicle[]> {
    return this.vehicles.list(includeArchived);
  }

  /**
   * Adds a truck.
   *
   * The duplicate is refused twice over: once here with a message that names
   * the existing row's spelling, and once by `uq_trip_vehicle_plate` if two
   * dispatchers race. The pre-check exists for the message, not for the
   * correctness — the index is what actually holds.
   */
  async createVehicle(input: {
    plate: string;
    note?: string | null;
    createdBy: string;
  }): Promise<TripVehicle> {
    const plate = requireText(input.plate, 'A vehicle needs a plate.');

    const clash = await this.findVehicleByKey(plate);
    if (clash) {
      throw new ConflictError(
        `That vehicle is already in the catalogue, as “${clash.plate}”.`,
      );
    }

    return this.vehicles.create({ plate, note: trimOrNull(input.note), createdBy: input.createdBy });
  }

  async updateVehicle(
    id: string,
    input: { plate?: string; note?: string | null },
  ): Promise<TripVehicle> {
    const current = await this.vehicles.findById(id);
    if (!current) throw new NotFoundError('Vehicle not found.');
    if (current.status !== 'active') {
      throw new ConflictError('That vehicle has been retired and cannot be edited.');
    }

    const plate =
      input.plate === undefined ? current.plate : requireText(input.plate, 'A vehicle needs a plate.');
    const note = 'note' in input ? trimOrNull(input.note) : current.note;

    const clash = await this.findVehicleByKey(plate);
    if (clash && clash.id !== id) {
      throw new ConflictError(
        `Another vehicle in the catalogue is already “${clash.plate}”.`,
      );
    }

    const updated = await this.vehicles.update(id, { plate, note });
    if (!updated) throw new NotFoundError('Vehicle not found.');
    return updated;
  }

  /**
   * Retires a truck.
   *
   * Trips that name it keep naming it — that is the whole reason this is not a
   * delete. What changes is that it stops being offered when somebody enters
   * tomorrow's board.
   */
  async archiveVehicle(id: string): Promise<TripVehicle> {
    const archived = await this.vehicles.archive(id);
    if (!archived) throw new NotFoundError('Vehicle not found.');
    return archived;
  }

  // ------------------------------------------------------------ customers ----

  listCustomers(includeArchived: boolean): Promise<TripCustomer[]> {
    return this.customers.list(includeArchived);
  }

  async createCustomer(input: {
    name: string;
    note?: string | null;
    createdBy: string;
  }): Promise<TripCustomer> {
    const name = requireText(input.name, 'A customer needs a name.');

    const clash = await this.findCustomerByKey(name);
    if (clash) {
      throw new ConflictError(`That customer is already in the catalogue, as “${clash.name}”.`);
    }

    return this.customers.create({ name, note: trimOrNull(input.note), createdBy: input.createdBy });
  }

  async updateCustomer(
    id: string,
    input: { name?: string; note?: string | null },
  ): Promise<TripCustomer> {
    const current = await this.customers.findById(id);
    if (!current) throw new NotFoundError('Customer not found.');
    if (current.status !== 'active') {
      throw new ConflictError('That customer has been retired and cannot be edited.');
    }

    const name =
      input.name === undefined ? current.name : requireText(input.name, 'A customer needs a name.');
    const note = 'note' in input ? trimOrNull(input.note) : current.note;

    const clash = await this.findCustomerByKey(name);
    if (clash && clash.id !== id) {
      throw new ConflictError(`Another customer in the catalogue is already “${clash.name}”.`);
    }

    const updated = await this.customers.update(id, { name, note });
    if (!updated) throw new NotFoundError('Customer not found.');
    return updated;
  }

  async archiveCustomer(id: string): Promise<TripCustomer> {
    const archived = await this.customers.archive(id);
    if (!archived) throw new NotFoundError('Customer not found.');
    return archived;
  }

  // ------------------------------------------------------------ locations ----

  /**
   * ★ EVERY METHOD TAKES THE CUSTOMER FROM THE ROUTE AND HOLDS THE LOCATION TO
   * IT. A location id under the wrong customer is answered "not found" —
   * exactly as a missing one — so a caller holding an id learns nothing
   * about another customer's places. There is no list that spans customers.
   */

  async listLocations(customerId: string, includeArchived: boolean): Promise<TripLocation[]> {
    await this.requireCustomer(customerId);
    return this.locations.listByCustomer(customerId, includeArchived);
  }

  async createLocation(
    customerId: string,
    input: LocationInput & { createdBy: string },
  ): Promise<TripLocation> {
    const customer = await this.requireCustomer(customerId);
    if (customer.status !== 'active') {
      throw new ConflictError('That customer has been retired; add no places to it.');
    }

    const values = locationValues(input);
    const clash = await this.findLocationByKey(customerId, values.name);
    if (clash) {
      throw new ConflictError(`This customer already has that place, as “${clash.name}”.`);
    }

    return this.locations.create({ ...values, customerId, createdBy: input.createdBy });
  }

  async updateLocation(
    customerId: string,
    id: string,
    input: Partial<LocationInput>,
  ): Promise<TripLocation> {
    const current = await this.requireLocation(customerId, id);
    if (current.status !== 'active') {
      throw new ConflictError('That location has been archived and cannot be edited.');
    }

    // A patch: an absent key keeps the row's value, a present one replaces it
    // — including `null` to clear a contact, a note, or the coordinates.
    const values = locationValues({
      name: input.name === undefined ? current.name : input.name,
      address: input.address === undefined ? current.address : input.address,
      contact: 'contact' in input ? input.contact : current.contact,
      note: 'note' in input ? input.note : current.note,
      latitude: 'latitude' in input ? input.latitude : current.latitude,
      longitude: 'longitude' in input ? input.longitude : current.longitude,
    });

    const clash = await this.findLocationByKey(customerId, values.name);
    if (clash && clash.id !== id) {
      throw new ConflictError(`This customer already has another place named “${clash.name}”.`);
    }

    const updated = await this.locations.update(id, customerId, values);
    if (!updated) throw new NotFoundError('Location not found.');
    return updated;
  }

  async archiveLocation(customerId: string, id: string): Promise<TripLocation> {
    await this.requireLocation(customerId, id);
    const archived = await this.locations.archive(id, customerId);
    if (!archived) throw new ConflictError('That location has already been archived.');
    return archived;
  }

  private async requireCustomer(customerId: string): Promise<TripCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError('Customer not found.');
    return customer;
  }

  /** The location, only if it is this customer's. Otherwise: not found. */
  private async requireLocation(customerId: string, id: string): Promise<TripLocation> {
    const location = await this.locations.findById(id);
    if (!location || location.customerId !== customerId) {
      throw new NotFoundError('Location not found.');
    }
    return location;
  }

  /** Same normalisation as `name_key` in 0022 — and, as for the plate, only for a better message. */
  private async findLocationByKey(
    customerId: string,
    name: string,
  ): Promise<TripLocation | undefined> {
    const key = nameKey(name);
    const rows = await this.locations.listByCustomer(customerId, false);
    return rows.find((row) => nameKey(row.name) === key);
  }

  // ---------------------------------------------------------------------------

  /**
   * Finds an active row whose plate matches the way the DATABASE matches.
   *
   * ★ THE NORMALISATION IS DUPLICATED HERE ON PURPOSE, AND IT MUST STAY IN STEP
   * WITH `plate_key` IN 0011. This is only ever used to produce a better error
   * message; if it drifts, the worst outcome is a generic conflict from the
   * index instead of a specific one naming the existing spelling. The index is
   * what enforces uniqueness, never this.
   *
   * The catalogue is small enough to filter in memory — a fleet, not a ledger —
   * so this costs one list read rather than a query per lookup.
   */
  private async findVehicleByKey(plate: string): Promise<TripVehicle | undefined> {
    const key = vehicleKey(plate);
    return (await this.vehicles.list(false)).find((row) => vehicleKey(row.plate) === key);
  }

  private async findCustomerByKey(name: string): Promise<TripCustomer | undefined> {
    const key = customerKey(name);
    return (await this.customers.list(false)).find((row) => customerKey(row.name) === key);
  }
}

/** Mirrors `plate_key`: everything but letters and digits, upper-cased. */
const vehicleKey = (plate: string): string => plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Mirrors `name_key`: runs of whitespace collapsed, trimmed, upper-cased. */
const customerKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toUpperCase();

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * A name that is only whitespace is not a name.
 *
 * The zod schema in the controller trims and rejects the empty string, so this
 * is a backstop for a caller that is not an HTTP request. The database says the
 * same thing a third time with a CHECK — and that one reaches a client as a
 * 500, which is why the check is repeated here where it can be a 422.
 */
const requireText = (value: string, message: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') throw new ValidationError(message);
  return trimmed;
};

/** What a caller may say about a place. */
export interface LocationInput {
  name: string;
  address: string;
  contact?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Trims, requires the two texts, and refuses half a point or one off the
 * planet with a sentence — the CHECK in 0022 says it again without one.
 */
const locationValues = (input: LocationInput): TripLocationValues => {
  const point = optionalPoint(input.latitude, input.longitude);
  if (!point.ok) {
    throw new ValidationError(
      point.reason === 'HALF_A_POINT'
        ? 'A location needs both a latitude and a longitude, or neither.'
        : 'Those coordinates are not a place on Earth.',
      { latitude: point.reason },
    );
  }
  return {
    name: requireText(input.name, 'A location needs a name.'),
    address: requireText(input.address, 'A location needs an address.'),
    contact: trimOrNull(input.contact),
    note: trimOrNull(input.note),
    latitude: point.latitude,
    longitude: point.longitude,
  };
};

/** `upper(trim(regexp_replace(name, '\s+', ' ', 'g')))`, as 0011 and 0022 compute it. */
const nameKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toUpperCase();
