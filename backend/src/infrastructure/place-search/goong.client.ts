import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';

/**
 * Finding a place by typing its address, from somebody else's server.
 *
 * ★ THE ONLY FILE THAT KNOWS THE UPSTREAM EXISTS. Everything above this works
 * in `PlaceSuggestion` and `ResolvedPlace` — our shapes, not theirs. The same
 * discipline `VnAdministrativeClient` keeps, and the reason swapping the
 * provider was a one-directory change rather than a rewrite.
 *
 * ★ WHY GOONG AND NOT OPENSTREETMAP, WHICH IS WHAT THE MAP USES. Measured, not
 * assumed. Nominatim answers NOTHING for `Cảng Cát Lái` and answers correctly
 * for `Cang Cat Lai` — it cannot be typed the way Vietnamese is typed — and it
 * has no house number on numbered side streets (`105 Đường số 10` returns the
 * street and stops), which is where warehouses are. Goong carries Vietnamese
 * address data down to the house number and takes the diacritics as written.
 *
 * The map is a different problem with a different answer: OpenStreetMap tiles
 * draw perfectly well and cost nothing, so `LocationMap` uses them and this
 * quota is spent only on searching.
 *
 * ★ THE KEY IS A SERVER KEY AND NEVER LEAVES THIS PROCESS. The browser asks
 * `/places`; it never learns who answers. That is a real improvement on what
 * this replaced — the Google browser key shipped inside the bundle and was
 * defended only by an HTTP-referrer rule.
 *
 * ★ TWO CALLS, NOT ONE, BECAUSE THE SUGGESTIONS CARRY NO COORDINATES.
 * `/Place/AutoComplete` answers with names and ids while somebody types;
 * `/Place/Detail` turns the ONE id they chose into a point. Asking for detail
 * per suggestion would be ten lookups to throw nine away, against a monthly
 * allowance.
 *
 * ★ THE RESPONSE IS PARSED, NOT TRUSTED. Zod turns a proxy's HTML, an error
 * object and a shape that moved last week into one refusal at the boundary,
 * rather than an `undefined` that reaches a dropdown.
 */

/** One row in the suggestion list, as the rest of this codebase sees it. */
export interface PlaceSuggestion {
  /** Their id for the place. Opaque to us; it only ever goes back to them. */
  id: string;
  /** The bold line: `Vincom Center Đồng Khởi`. */
  primary: string;
  /** The quiet line under it: `72 Lê Thánh Tôn, Phường Sài Gòn…`. */
  secondary: string;
}

/** One chosen place, with the thing we actually came for. */
export interface ResolvedPlace {
  /** Their tidy form of the address. `null` when they did not say. */
  address: string | null;
  latitude: number;
  longitude: number;
}

/**
 * ★ `.passthrough()` EVERYWHERE, AND THAT IS THE INTENT. These responses carry
 * `types`, `score`, `plus_code`, `terms`, `matched_substrings` and more, none
 * of which this deployment wants. Naming what we need and ignoring the rest
 * means a field they ADD never breaks us, while a field they REMOVE does —
 * which is the right way round.
 *
 * ★ `structured_formatting` IS OPTIONAL AND `description` IS NOT. The two-line
 * split is a nicety; the one-line description is what every prediction has.
 * So the fallback below is not defensive coding, it is the actual contract.
 */
const predictionSchema = z
  .object({
    place_id: z.string().min(1),
    description: z.string(),
    structured_formatting: z
      .object({ main_text: z.string(), secondary_text: z.string() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const autoCompleteSchema = z.object({ predictions: z.array(predictionSchema) }).passthrough();

/**
 * ★ `lat`/`lng` ARE JSON NUMBERS HERE AND STAY NUMBERS ALL THE WAY DOWN — into
 * `optionalPoint`, into a `DOUBLE PRECISION` column, into the haversine that
 * decides whether a driver is at the gate. `z.number()` rather than a coercion,
 * because a coordinate that arrived as a string is a shape change worth failing
 * on, not something to paper over: `Number('')` is `0`, and `0,0` is a real
 * place in the Atlantic that a lorry will never reach.
 */
const placeShape = z
  .object({
    formatted_address: z.string().optional(),
    geometry: z
      .object({ location: z.object({ lat: z.number(), lng: z.number() }).passthrough() })
      .passthrough(),
  })
  .passthrough();

const detailSchema = z.object({ result: placeShape }).passthrough();

/**
 * Forward geocoding: one written address in, candidates out.
 *
 * ★ `results`, PLURAL, WHERE DETAIL ANSWERS `result`. Same shape inside, and
 * an empty array is a valid answer — "nothing here matches what was typed" is
 * information, not a failure.
 */
const geocodeSchema = z.object({ results: z.array(placeShape) }).passthrough();

/**
 * How they say no: `{"error":{"code":"API_KEY_INVALID","message":"…"}}`, with
 * an HTTP status to match. Parsed so the log names the cause — a bad key and a
 * spent quota are different mornings for whoever is on call.
 */
const upstreamErrorSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string().optional() }).passthrough() })
  .passthrough();

/** Longer than this call has ever needed, short enough to fail while somebody is still looking. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Enough to choose from, few enough that the list does not become its own problem. */
const SUGGESTION_LIMIT = 8;

@Injectable()
export class GoongClient {
  private readonly logger = new Logger(GoongClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Whether this deployment can search at all.
   *
   * ★ NOT HAVING A KEY IS A CONFIGURATION, NOT A FAULT. The map is
   * OpenStreetMap and needs none, so a deployment without this one still
   * locates places by pin — searching is the shortcut, not the only way in.
   * Asked before every call so the refusal is one sentence about setup rather
   * than a round trip that comes back 403.
   */
  configured(): boolean {
    return this.config.get('GOONG_API_KEY', { infer: true }).trim() !== '';
  }

  /** What to offer somebody who has typed part of an address. */
  async suggest(input: string): Promise<PlaceSuggestion[]> {
    const answer = await this.get('/Place/AutoComplete', autoCompleteSchema, {
      input,
      limit: String(SUGGESTION_LIMIT),
    });

    return answer.predictions.map((prediction) => ({
      id: prediction.place_id,
      // Without the structured split, the whole description is the name and
      // there is no second line — better than inventing one by cutting the
      // string at a comma and hoping.
      primary: prediction.structured_formatting?.main_text ?? prediction.description,
      secondary: prediction.structured_formatting?.secondary_text ?? '',
    }));
  }

  /** The point behind the one suggestion somebody chose. */
  async resolve(placeId: string): Promise<ResolvedPlace> {
    const answer = await this.get('/Place/Detail', detailSchema, { place_id: placeId });
    const { location } = answer.result.geometry;

    return {
      address: answer.result.formatted_address ?? null,
      latitude: location.lat,
      longitude: location.lng,
    };
  }

  /**
   * One written address in, its point out — or nothing.
   *
   * ★ THIS IS THE PATH THAT NEEDS NO PICKING. `suggest`/`resolve` ask the
   * operator to choose a row; this takes what they already typed. It is what
   * makes "fill in the address and the position appears" true, and it is why it
   * returns `null` rather than throwing on no match: an address nobody can
   * place is an ordinary outcome, not an error to put in front of somebody.
   *
   * ★ THE FIRST CANDIDATE, NOT A LIST. Nothing upstream can choose between
   * candidates for the operator, and the form has a map for correcting a point
   * that landed in the wrong corner of a site. Offering five and asking them to
   * pick would be `suggest` again, with worse rows.
   */
  async geocode(address: string): Promise<ResolvedPlace | null> {
    const answer = await this.get('/geocode', geocodeSchema, { address });
    const best = answer.results[0];
    if (!best) return null;

    return {
      address: best.formatted_address ?? null,
      latitude: best.geometry.location.lat,
      longitude: best.geometry.location.lng,
    };
  }

  /**
   * One call, parsed or refused.
   *
   * ★ NODE'S OWN `fetch`, NO HTTP CLIENT — Node 24 ships it globally, and a
   * dependency added for two GETs is a dependency to keep patched forever.
   *
   * ★ THE KEY GOES IN VIA `URLSearchParams`, NOT BY STRING CONCATENATION, so
   * it and the operator's free text are both escaped by something that knows
   * the rules. An address with a `&` in it would otherwise truncate the query.
   *
   * Every failure leaves as a thrown Error and the caller above decides what to
   * do — and what it decides is "serve the cache".
   */
  private async get<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string>,
  ): Promise<T> {
    const apiKey = this.config.get('GOONG_API_KEY', { infer: true }).trim();
    if (apiKey === '') {
      // Refused here rather than sent, because an empty `api_key` buys a 403
      // and a log line that reads like a revoked credential — sending somebody
      // to the console to check a key that was never set.
      throw new Error('Place search is not configured on this deployment.');
    }

    const base = this.config.get('GOONG_API_URL', { infer: true });
    const query = new URLSearchParams({ ...params, api_key: apiKey });
    const url = `${base}${path}?${query.toString()}`;

    // ★ THE KEY IS STRIPPED BEFORE ANYTHING IS LOGGED. A warning line is the
    // easiest place for a credential to escape into a log aggregator that
    // outlives it.
    const safeUrl = `${base}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Place search unreachable at ${safeUrl}: ${(error as Error).message}`);
      throw new Error('The place-search service did not respond.');
    }

    const body: unknown = await response.json().catch(() => null);

    // ★ CHECKED BEFORE `response.ok`, BECAUSE THE CODE IS THE USEFUL HALF.
    // "answered 403" sends somebody to check the network; "API_KEY_INVALID"
    // sends them to the console, which is where the problem is.
    const failure = upstreamErrorSchema.safeParse(body);
    if (failure.success) {
      this.logger.warn(`Place search refused ${safeUrl}: ${failure.data.error.code}`);
      throw new Error(`The place-search service refused the request (${failure.data.error.code}).`);
    }

    if (!response.ok) {
      this.logger.warn(`Place search answered ${response.status} for ${safeUrl}`);
      throw new Error(`The place-search service answered ${response.status}.`);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Place search answered an unexpected shape for ${safeUrl}`);
      throw new Error('The place-search service answered an unexpected shape.');
    }

    return parsed.data;
  }
}
