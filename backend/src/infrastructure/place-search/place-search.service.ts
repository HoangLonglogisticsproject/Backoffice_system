import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GoongClient, type PlaceSuggestion, type ResolvedPlace } from './goong.client';
import { NominatimClient } from './nominatim.client';

/**
 * Place search, cached, so one office spends one allowance.
 *
 * ★ THE CACHE IS THE BUDGET, NOT AN OPTIMISATION. The upstream's free tier is
 * a monthly REQUEST COUNT, spent by everybody behind the office NAT together.
 * Ten dispatchers filing places at the same port type the same few words all
 * day; uncached, that is ten times the bill for one answer. This is the same
 * argument `VnAdministrativeService` makes about a rate limit, with money in
 * place of a 429.
 *
 * ★ STALE BEATS EMPTY. A suggestion list from this morning is still a correct
 * suggestion list. So the TTL decides when to ASK again, never when to throw
 * away what we have: a failed refresh serves the previous answer and logs the
 * failure rather than raising it.
 *
 * ★ TWO TTLs, BECAUSE THE TWO ANSWERS AGE DIFFERENTLY. What the upstream
 * SUGGESTS for a phrase shifts as its index changes; where a chosen place IS
 * does not move at all. Caching both for an hour would re-buy coordinates
 * nobody needed re-bought.
 *
 * ★ IN-MEMORY IS THE RIGHT SIZE. One process, a few hundred kilobytes, and a
 * restart costs a handful of upstream calls. Redis for this would be a second
 * thing to run, monitor and fail.
 */

/** How long a suggestion list is trusted. Short: it is a live index. */
const SUGGEST_TTL_MS = 60 * 60 * 1000;

/** How long a resolved point is trusted. Long: a warehouse does not move. */
const RESOLVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

/**
 * The key a phrase is cached under.
 *
 * ★ SO "Cat Lai", "cat  lai" AND "  Cat Lai " ARE ONE ENTRY. They are one
 * question, and three dispatchers spacing a phrase differently must not be
 * three purchases. Case and runs of whitespace are the two ways the same typed
 * phrase differs; diacritics are NOT folded, because the upstream answers
 * differently for them and folding would cache one answer under both.
 */
const phraseKey = (input: string): string => input.trim().toLowerCase().replace(/\s+/g, ' ');

@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);

  private readonly suggestions = new Map<string, CacheEntry<PlaceSuggestion[]>>();
  private readonly resolved = new Map<string, CacheEntry<ResolvedPlace>>();
  private readonly geocoded = new Map<string, CacheEntry<ResolvedPlace | null>>();

  /**
   * Lookups in flight, so a cold cache under load makes ONE upstream call.
   *
   * Ten dispatchers opening the dialog at nine o'clock would otherwise be ten
   * identical purchases. Everybody waits on the same promise.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly upstream: GoongClient,
    private readonly free: NominatimClient,
  ) {}

  /**
   * The point behind a written address — the path that needs nobody to pick.
   *
   * ★ THE KEYED PROVIDER WHEN THERE IS ONE, THE FREE ONE OTHERWISE. Both answer
   * in `ResolvedPlace`, so nothing above this line knows which replied. The
   * choice is made per call rather than at boot, so adding a key takes effect on
   * the next restart without a second code path existing anywhere above.
   *
   * ★ `null` IS AN ANSWER, AND IT IS CACHED. "Nothing matches what was typed" is
   * ordinary — half-written addresses are typed all day — and re-asking a
   * paid-for or rate-limited service the same unanswerable question is exactly
   * the waste this class exists to stop.
   */
  geocode(address: string): Promise<ResolvedPlace | null> {
    const key = phraseKey(address);
    return this.cached(this.geocoded, `geocode:${key}`, key, RESOLVE_TTL_MS, () =>
      this.upstream.configured() ? this.upstream.geocode(address) : this.free.geocode(address),
    );
  }

  suggest(input: string): Promise<PlaceSuggestion[]> {
    const key = phraseKey(input);
    return this.cached(this.suggestions, `suggest:${key}`, key, SUGGEST_TTL_MS, () =>
      this.upstream.suggest(input),
    );
  }

  resolve(placeId: string): Promise<ResolvedPlace> {
    return this.cached(this.resolved, `resolve:${placeId}`, placeId, RESOLVE_TTL_MS, () =>
      this.upstream.resolve(placeId),
    );
  }

  /**
   * ★ AN EMPTY SUGGESTION LIST IS CACHED, AND A MISSING PROVINCE LIST IS NOT.
   * The difference is worth stating because the sibling service does the
   * opposite. "No place matches `qwerty`" is a correct and useful answer, and
   * re-buying it every keystroke is exactly the waste this class exists to
   * stop. `[]` from a list of Vietnam's provinces would instead be the upstream
   * being wrong, which is why that one refuses to cache it.
   */
  private async cached<T>(
    store: Map<string, CacheEntry<T>>,
    lockKey: string,
    storeKey: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const entry = store.get(storeKey);
    if (entry && Date.now() - entry.fetchedAt < ttlMs) return entry.value;

    const pending =
      (this.inFlight.get(lockKey) as Promise<T> | undefined) ??
      this.refresh(store, lockKey, storeKey, load);

    try {
      return await pending;
    } catch (error) {
      // ★ ONLY FATAL WHEN THERE IS NOTHING TO FALL BACK ON. An expired answer
      // is still an answer, and a dispatcher with a stale list can still file
      // the place in front of them.
      if (entry) {
        this.logger.warn(`Serving stale ${lockKey}: ${(error as Error).message}`);
        return entry.value;
      }
      throw new ServiceUnavailableException(
        'The place-search service is not reachable. Enter the coordinates by hand, or try again shortly.',
      );
    }
  }

  private refresh<T>(
    store: Map<string, CacheEntry<T>>,
    lockKey: string,
    storeKey: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const pending = load()
      .then((value) => {
        store.set(storeKey, { value, fetchedAt: Date.now() });
        return value;
      })
      .finally(() => this.inFlight.delete(lockKey));

    this.inFlight.set(lockKey, pending);
    return pending;
  }
}
