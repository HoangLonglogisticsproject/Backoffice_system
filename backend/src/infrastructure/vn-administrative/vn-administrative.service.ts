import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { VnAdministrativeClient, type AdministrativeUnit } from './vn-administrative.client';

/**
 * The administrative units, cached, so one office spends one request.
 *
 * ★ STALE BEATS EMPTY, AND THAT IS THE WHOLE DESIGN. Vietnam's provinces change
 * roughly once a generation — the 2025 reform was the first in decades. A list
 * that is a day out of date is still correct; an empty dropdown is a dispatcher
 * who cannot file the place they are looking at. So the TTL decides when to go
 * and ASK again, never when to throw away what we have: if the refresh fails,
 * the previous answer is served and the failure is logged, not raised.
 *
 * ★ AN ENTRY IS ONLY EVER REPLACED BY A GOOD ONE. There is no path that writes
 * an empty list or a partial one into the cache, so "we have an answer" and
 * "the answer is usable" cannot come apart.
 *
 * ★ IN-MEMORY IS THE RIGHT SIZE. One process, a few dozen kilobytes, and a
 * restart costs exactly one upstream request. Redis for this would be a second
 * thing to run, monitor and fail.
 */

/** How long an answer is trusted before the next reader triggers a refresh. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  units: AdministrativeUnit[];
  fetchedAt: number;
}

@Injectable()
export class VnAdministrativeService {
  private readonly logger = new Logger(VnAdministrativeService.name);

  /** Keyed by what was asked for: `'provinces'`, or a province code. */
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Refreshes in flight, keyed the same way.
   *
   * ★ SO A COLD START UNDER LOAD MAKES ONE REQUEST, NOT ONE PER CALLER. Ten
   * dispatchers opening the dialog at nine o'clock would otherwise be ten
   * identical calls into a service that rate-limits by IP — and ours is one IP.
   * Everybody waits on the same promise.
   */
  private readonly inFlight = new Map<string, Promise<AdministrativeUnit[]>>();

  constructor(private readonly upstream: VnAdministrativeClient) {}

  listProvinces(): Promise<AdministrativeUnit[]> {
    return this.cached('provinces', () => this.upstream.listProvinces());
  }

  listDistricts(provinceCode: string): Promise<AdministrativeUnit[]> {
    // Prefixed so a code can never collide with the provinces key, or with a
    // district code that happens to equal a province code — they are separate
    // numbering spaces and both are just digits.
    return this.cached(`districts:${provinceCode}`, () =>
      this.upstream.listDistricts(provinceCode),
    );
  }

  listWards(districtCode: string): Promise<AdministrativeUnit[]> {
    return this.cached(`wards:${districtCode}`, () => this.upstream.listWards(districtCode));
  }

  private async cached(
    key: string,
    load: () => Promise<AdministrativeUnit[]>,
  ): Promise<AdministrativeUnit[]> {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.fetchedAt < TTL_MS) return entry.units;

    const pending = this.inFlight.get(key) ?? this.refresh(key, load);

    try {
      return await pending;
    } catch (error) {
      // ★ THE FAILURE IS ONLY FATAL WHEN THERE IS NOTHING TO FALL BACK ON.
      // An expired entry is still a correct list of provinces.
      if (entry) {
        this.logger.warn(`Serving stale ${key}: ${(error as Error).message}`);
        return entry.units;
      }
      throw new ServiceUnavailableException(
        'The administrative-units service is not reachable, and nothing has been loaded from it yet. Try again shortly.',
      );
    }
  }

  private refresh(
    key: string,
    load: () => Promise<AdministrativeUnit[]>,
  ): Promise<AdministrativeUnit[]> {
    const pending = load()
      .then((units) => {
        // An upstream that answers `[]` is answering wrongly — there are 34
        // provinces and every province has wards. Caching that would hide the
        // fault behind a working-looking empty dropdown until the TTL expired.
        if (units.length === 0) throw new Error(`The service returned no ${key}.`);
        this.cache.set(key, { units, fetchedAt: Date.now() });
        return units;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, pending);
    return pending;
  }
}
