import { z } from 'zod';
import { isoDate } from '../../../common/pagination/date-range-page-query.dto';
import type { RecordTripFuelCommand } from '../application/fuel-transaction.service';
import { FUEL_EVIDENCE_TYPES, MAX_EVIDENCE_PER_TRANSACTION } from '../domain/fuel-evidence';
import { FUEL_FACT_KEYS, type FuelFactsInput } from '../domain/fuel-transaction';
import { isRecordableLiters } from '../domain/vehicle-fuel';

/**
 * The bodies of the two record commands. Unknown keys are stripped: a vehicle
 * cost's lorry, day and readings are the cost's, so a body naming them on that
 * route has them dropped rather than believed.
 *
 * Facts arrive as typed (the service normalises spelling); a fact a body does
 * not send is left alone — there is no way to send "clear this".
 */
const evidence = z
  .array(
    z.object({
      id: z.string().uuid(),
      type: z.enum(FUEL_EVIDENCE_TYPES).optional(),
      /** Read off the image by a person (a Timemark stamp) — never EXIF. */
      capturedAt: z.coerce.date().optional(),
    }),
  )
  .max(MAX_EVIDENCE_PER_TRANSACTION)
  .default([])
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Each image may be listed once.');

const facts = {
  occurredAt: z.coerce.date().optional(),
  driverUserId: z.string().uuid().optional(),
  vendorName: z.string().max(400).optional(),
  vendorTaxCode: z.string().max(40).optional(),
  documentSeries: z.string().max(60).optional(),
  documentNumber: z.string().max(80).optional(),
};

const bringsSomething = (body: { evidence: unknown[] } & FuelFactsInput & { vehicleId?: string }) =>
  body.evidence.length > 0 || body.vehicleId !== undefined || FUEL_FACT_KEYS.some((key) => body[key] !== undefined);

const NOTHING = 'Send at least one image or one fact.';

export const recordOnVehicleCostSchema = z.object({ evidence, ...facts }).refine(bringsSomething, NOTHING);

export const recordOnTripCostSchema = z
  .object({
    evidence,
    ...facts,
    vehicleId: z.string().uuid().optional(),
    businessDate: isoDate,
    liters: z.string().trim().refine(isRecordableLiters, 'Expected a positive number of liters, e.g. "45.50".').optional(),
    odometerKm: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .refine(bringsSomething, NOTHING);

export type RecordOnVehicleCostBody = z.infer<typeof recordOnVehicleCostSchema>;
export type RecordOnTripCostBody = z.infer<typeof recordOnTripCostSchema>;

/** A trip fill's readings are facts — added once each — so they travel with the facts. */
export const toTripCommand = (body: RecordOnTripCostBody): RecordTripFuelCommand => {
  const { evidence: images, vehicleId, businessDate, ...facts } = body;
  return { facts, evidence: images, vehicleId, businessDate };
};

export const retireSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type RetireBody = z.infer<typeof retireSchema>;
