import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';

/**
 * Vietnam's administrative units, from somebody else's server.
 *
 * ★ THE ONLY FILE THAT KNOWS THE UPSTREAM EXISTS. Everything above this works
 * with `{ code, name }` — our shape, not theirs. When that service renames a
 * field, disappears, or is swapped for another, this file changes and nothing
 * else does. Same discipline the frontend keeps around Google Maps.
 *
 * ★ TWO LEVELS, BECAUSE VIETNAM HAS TWO. On 1 July 2025 the 63 tỉnh/thành were
 * merged into 34 and the quận/huyện rung was ABOLISHED outright: a ward now
 * hangs directly off a province. `…/api/v2` serves that structure and this
 * reads it. `…/api/v1` still serves the pre-reform three-tier one, which is why
 * `VN_ADMIN_API_URL` must not be pointed there — `listWards` reads `wards` off
 * a province, and a v1 province carries `districts` instead.
 *
 * ⚠ WHAT THAT MEANS FOR ROWS FILED BEFORE THE SWITCH. A location saved under
 * the old hierarchy kept a province that may no longer exist ("Tỉnh Bình
 * Dương") and a district that certainly does not ("Quận 7"). Nothing here
 * rewrites them, and nothing needs to: these fields are DESCRIPTIVE — a trip
 * snapshots its `address`, the geofence measures coordinates — so a stale one
 * is a label a person still recognises, not a broken reference. Re-picking the
 * province on the location form is what migrates a row, and the form clears the
 * old district when that happens so no row ends up half-new.
 *
 * ★ THE RESPONSE IS PARSED, NOT TRUSTED. A free public API with no contract
 * behind it can answer with HTML from a proxy, an error object, or a shape it
 * changed last week. Zod turns all of those into one refusal at the boundary
 * instead of an `undefined` that reaches a dropdown.
 */

/** One unit, as the rest of this codebase sees it. */
export interface AdministrativeUnit {
  /** The state-issued code — the identity. `"01"`, `"09877"`. */
  code: string;
  /** `Thành phố Hà Nội`, `Xã An Khánh`. The label, which can be renamed. */
  name: string;
}

/**
 * Their shape, named as they send it.
 *
 * ★ `code` ARRIVES AS A NUMBER AND LEAVES AS A STRING. `provinces.open-api.vn`
 * sends `"code": 760`; every layer above treats a code as text — it goes into a
 * URL, a `TEXT` column and a `<SelectItem value>`. Coercing once here is the
 * whole of the conversion, and `z.number()` rather than `z.coerce.string()`
 * because a code that stopped being a number is a shape change worth failing on.
 *
 * `.passthrough()` is the intent: the responses carry `division_type`,
 * `codename`, `phone_code` and the nested children, none of which this
 * deployment wants. Listing what we need and ignoring the rest means a field
 * they ADD never breaks us, while a field they REMOVE does — the right way
 * round.
 */
const unitSchema = z.object({ code: z.number(), name: z.string().min(1) }).passthrough();

const unitsSchema = z.array(unitSchema);

/**
 * ★ THE WARDS COME WRAPPED IN THEIR PROVINCE, NOT AS A BARE LIST. Asking for
 * one province at `depth=2` answers with the PROVINCE, carrying `wards`. So
 * this reads one field out of one object rather than parsing an array.
 *
 * ⚠ AND IT IS `wards`, WHICH IS ALSO THE VERSION CHECK. The same path on
 * `…/api/v1` answers with `districts` and no `wards` at all, so a deployment
 * misconfigured back to v1 fails HERE, at the boundary, with "an unexpected
 * shape" — rather than silently serving an empty ward list.
 */
const withWardsSchema = z.object({ wards: unitsSchema }).passthrough();

type Unit = z.infer<typeof unitSchema>;

const asUnits = (rows: Unit[]): AdministrativeUnit[] =>
  dedupe(rows.map((row) => ({ code: String(row.code), name: row.name })));

/**
 * The same unit listed twice, dropped.
 *
 * ★ MEASURED, NOT DEFENSIVE. On 2026-09-11 the upstream returned 56 rows across
 * the 34 provinces that repeat BOTH the code and the name — Hồ Chí Minh sends
 * "Phường Tân Uyên" four times under one code. Those are noise and this removes
 * them; a screen rendering them produced duplicate React keys and an operator
 * choosing between four identical options.
 *
 * ⚠ AND IT DOES NOT MERGE CODES THAT DISAGREE, WHICH IS THE IMPORTANT HALF.
 * Four codes in the same snapshot carry DIFFERENT names — HCM `27118` is
 * "Phường An Hội Đông", "Phường An Hội Tây" AND "Phường An Khánh". Those are
 * three real wards behind one code, so `ward_code` is NOT a unique identity in
 * this source and nothing here may pretend otherwise: all three are kept, and
 * what identifies a ward downstream is the code AND the name together.
 */
const dedupe = (units: AdministrativeUnit[]): AdministrativeUnit[] => {
  const seen = new Set<string>();
  return units.filter((unit) => {
    const key = `${unit.code}|${unit.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * ★ A TIMEOUT, BECAUSE A REQUEST WITH NO CEILING IS AN OUTAGE WITH NO CEILING.
 * `fetch` waits forever by default; a slow upstream would hold a dispatcher's
 * dialog open with a spinner for as long as it liked. Eight seconds is far
 * longer than this call has ever needed and short enough that the failure is
 * reported while somebody is still looking at the screen.
 */
const REQUEST_TIMEOUT_MS = 8_000;

@Injectable()
export class VnAdministrativeClient {
  private readonly logger = new Logger(VnAdministrativeClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** The 34 tỉnh/thành as they stand after the 2025 merger. */
  async listProvinces(): Promise<AdministrativeUnit[]> {
    return asUnits(await this.get('/p/', unitsSchema));
  }

  /**
   * The phường/xã of one PROVINCE — there is no rung between the two any more.
   *
   * ★ `depth=2`, WHICH IS NOW THE WHOLE TREE. Under the old hierarchy this was
   * the middle of three calls and `depth=3` was the thing to avoid; two-tier,
   * `depth=2` IS a province and everything under it. One call per province,
   * behind a 24-hour cache.
   *
   * ⚠ IT IS A BIGGER ANSWER THAN THE OLD ONE — Hồ Chí Minh returns 168 wards in
   * a single response where it used to return 22 districts. Still tens of
   * kilobytes, still once a day, and the alternative was two round trips for
   * the same data.
   */
  async listWards(provinceCode: string): Promise<AdministrativeUnit[]> {
    const province = await this.get(
      `/p/${encodeURIComponent(provinceCode)}?depth=2`,
      withWardsSchema,
    );
    return asUnits(province.wards);
  }

  /**
   * One call, parsed or refused.
   *
   * ★ NODE'S OWN `fetch`, NO HTTP CLIENT. Node 24 ships it globally, this is
   * the only outbound call in the process, and a dependency added for two GETs
   * is a dependency to keep patched forever.
   *
   * Every failure — a non-2xx, a body that is not JSON, a shape that does not
   * parse, a timeout — leaves as a thrown Error. The caller above decides what
   * to do about it, and what it decides is "serve the cache".
   */
  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.config.get('VN_ADMIN_API_URL', { infer: true })}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A DNS failure, a refused connection, or the timeout above. The URL is
      // logged because "which host" is the first question when this fires; the
      // message is not, because it is somebody else's and may be anything.
      this.logger.warn(`Administrative units unreachable at ${url}: ${(error as Error).message}`);
      throw new Error('The administrative-units service did not respond.');
    }

    if (!response.ok) {
      this.logger.warn(`Administrative units answered ${response.status} for ${url}`);
      throw new Error(`The administrative-units service answered ${response.status}.`);
    }

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.warn(`Administrative units answered an unexpected shape for ${url}`);
      throw new Error('The administrative-units service answered an unexpected shape.');
    }

    return parsed.data;
  }
}
