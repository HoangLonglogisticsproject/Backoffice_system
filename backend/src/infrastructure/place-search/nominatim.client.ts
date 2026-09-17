import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import type { ResolvedPlace } from './goong.client';

/**
 * Turning a written address into a point, using OpenStreetMap, for free.
 *
 * ★ WHY A SECOND GEOCODER EXISTS AT ALL. The primary one needs a key, and a
 * deployment without that key could not locate a place by typing its address —
 * only by dragging a pin. This one needs nothing, so "type the address and the
 * position appears" is true out of the box and simply gets BETTER when a key is
 * configured. It is the fallback, never the preference.
 *
 * ★ AND ITS LIMITS ARE MEASURED, NOT GUESSED, WHICH IS WHY IT IS THE FALLBACK.
 * Asked on 2026-09-17:
 *
 *   `Cảng Cát Lái`    →  NOTHING. Diacritics as Vietnamese is actually typed
 *                        return an empty list.
 *   `Cang Cat Lai`    →  Cảng Cát Lái, 10.7668 / 106.7955. Correct.
 *   `105 Duong so 10` →  the street, no house number.
 *   `72 Le Thanh Ton` →  the building, WITH the house number.
 *
 * So: strip the diacritics before asking — that is the whole of the first
 * problem — and accept that numbered side streets resolve to the street rather
 * than the door. At a 300 m geofence a street-level point is usually inside the
 * yard already, and the map pin exists for when it is not.
 *
 * ★ ONE REQUEST PER SECOND, ENFORCED HERE. The public instance's usage policy
 * sets an absolute ceiling for the whole application and asks callers to
 * identify themselves. A queue in this file is the only place that can hold the
 * whole office to it — per-browser politeness cannot.
 */

/**
 * Their row. `lat`/`lon` arrive as STRINGS here, unlike the primary provider's
 * numbers — coerced once, at this boundary, and never again above it.
 */
const rowSchema = z
  .object({
    lat: z.string(),
    lon: z.string(),
    display_name: z.string().optional(),
  })
  .passthrough();

const rowsSchema = z.array(rowSchema);

const REQUEST_TIMEOUT_MS = 8_000;

/** The policy's ceiling, plus a margin for clock jitter. */
const MIN_INTERVAL_MS = 1_100;

/**
 * ★ DIACRITICS OFF, BECAUSE THE INDEX CANNOT MATCH THEM. Measured above: the
 * same query answers correctly without them and not at all with them. `đ`/`Đ`
 * need their own line — they are not a base letter plus a combining mark, so
 * NFD leaves them whole.
 */
const stripDiacritics = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

@Injectable()
export class NominatimClient {
  private readonly logger = new Logger(NominatimClient.name);

  /** When the next request may leave. Shared by every caller in this process. */
  private nextSlot = 0;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** The point behind a written address, or nothing when it matches none. */
  async geocode(address: string): Promise<ResolvedPlace | null> {
    const base = this.config.get('NOMINATIM_API_URL', { infer: true });
    const query = new URLSearchParams({
      q: stripDiacritics(address),
      // Vietnam only. Without it "Cat Lai" has matched places on other
      // continents, which is how a lorry gets sent to a point in Nigeria.
      countrycodes: 'vn',
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
    });
    const url = `${base}/search?${query.toString()}`;

    await this.waitForSlot();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          // The policy requires an identifiable caller. An anonymous one is
          // blocked, and rightly — this is somebody else's server.
          'user-agent': this.config.get('NOMINATIM_USER_AGENT', { infer: true }),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`OpenStreetMap geocoder unreachable: ${(error as Error).message}`);
      throw new Error('The place-search service did not respond.');
    }

    if (!response.ok) {
      this.logger.warn(`OpenStreetMap geocoder answered ${response.status}`);
      throw new Error(`The place-search service answered ${response.status}.`);
    }

    const parsed = rowsSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.warn('OpenStreetMap geocoder answered an unexpected shape');
      throw new Error('The place-search service answered an unexpected shape.');
    }

    const best = parsed.data[0];
    if (!best) return null;

    const latitude = Number(best.lat);
    const longitude = Number(best.lon);
    // A coordinate that will not parse is a shape change, not a place. Letting
    // `NaN` through would reach `optionalPoint` and be refused there with a
    // message about the operator's input rather than about this feed.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      this.logger.warn('OpenStreetMap geocoder answered a coordinate that is not a number');
      throw new Error('The place-search service answered an unexpected shape.');
    }

    return { address: best.display_name ?? null, latitude, longitude };
  }

  /**
   * Holds the caller until this process's next permitted second.
   *
   * ★ A CHAIN, NOT A SLEEP. Each caller claims the next slot before waiting, so
   * ten arriving at once leave one second apart instead of all deciding the
   * same instant is free.
   */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + MIN_INTERVAL_MS;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}
