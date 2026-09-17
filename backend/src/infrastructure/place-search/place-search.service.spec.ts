import { ServiceUnavailableException } from '@nestjs/common';
import { PlaceSearchService } from './place-search.service';
import type { GoongClient, PlaceSuggestion, ResolvedPlace } from './goong.client';
import type { NominatimClient } from './nominatim.client';

/**
 * The cache, which is the only part of this feature with a decision in it.
 *
 * ★ WHAT IS BEING PINNED IS THE BILL AND THE BEHAVIOUR UNDER FAILURE. Anybody
 * can pass a list through. The questions worth a test are: does an office of
 * ten dispatchers typing the same port name spend ten requests against a
 * monthly allowance, and what does somebody see when the service is down.
 */

const CAT_LAI: PlaceSuggestion = { id: 'p1', primary: 'Cảng Cát Lái', secondary: 'Phường Cát Lái' };
const POINT: ResolvedPlace = { address: 'Cảng Cát Lái', latitude: 10.7668, longitude: 106.7955 };
/** What the keyless fallback answers, so the two are never confused in a test. */
const FREE_POINT: ResolvedPlace = { address: 'Cang Cat Lai', latitude: 10.7, longitude: 106.79 };

/**
 * A stand-in whose answers each test sets.
 *
 * `configured` decides which geocoder the service reaches for, so the fallback
 * is selected by the same condition production uses rather than by a flag only
 * the tests know about.
 */
const upstreamThat = (
  suggest: (input: string) => Promise<PlaceSuggestion[]>,
  resolve: (id: string) => Promise<ResolvedPlace> = async () => POINT,
  options: { configured?: boolean; geocode?: (address: string) => Promise<ResolvedPlace | null> } = {},
) => {
  const suggestFn = jest.fn(suggest);
  const resolveFn = jest.fn(resolve);
  const geocodeFn = jest.fn(options.geocode ?? (async () => POINT));
  const freeGeocodeFn = jest.fn(async (): Promise<ResolvedPlace | null> => FREE_POINT);
  return {
    client: {
      suggest: suggestFn,
      resolve: resolveFn,
      geocode: geocodeFn,
      configured: () => options.configured ?? true,
    } as unknown as GoongClient,
    free: { geocode: freeGeocodeFn } as unknown as NominatimClient,
    suggest: suggestFn,
    resolve: resolveFn,
    geocode: geocodeFn,
    freeGeocode: freeGeocodeFn,
  };
};

describe('PlaceSearchService', () => {
  it('serves the cached answer and does not buy it twice', async () => {
    const { client, free, suggest } = upstreamThat(async () => [CAT_LAI]);
    const service = new PlaceSearchService(client, free);

    expect(await service.suggest('cát lái')).toEqual([CAT_LAI]);
    expect(await service.suggest('cát lái')).toEqual([CAT_LAI]);

    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('★ the same phrase spaced or cased differently is ONE purchase', async () => {
    const { client, free, suggest } = upstreamThat(async () => [CAT_LAI]);
    const service = new PlaceSearchService(client, free);

    await service.suggest('Cát Lái');
    await service.suggest('  cát   lái  ');
    await service.suggest('CÁT LÁI');

    // Three dispatchers asking one question. The allowance is counted in
    // requests, so this is money, not tidiness.
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('★ but diacritics are NOT folded — they are a different question', async () => {
    const { client, free, suggest } = upstreamThat(async () => [CAT_LAI]);
    const service = new PlaceSearchService(client, free);

    await service.suggest('cát lái');
    await service.suggest('cat lai');

    // This upstream answers differently for the two, so folding them would
    // serve one answer under both keys and quietly return the wrong list.
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it('★ caches an empty list, because "nothing matches that" is a real answer', async () => {
    const { client, free, suggest } = upstreamThat(async () => []);
    const service = new PlaceSearchService(client, free);

    expect(await service.suggest('qwertyuiop')).toEqual([]);
    expect(await service.suggest('qwertyuiop')).toEqual([]);

    // Deliberately the opposite of the provinces cache, which refuses to store
    // an empty list: there, `[]` means the upstream is wrong. Here it means the
    // phrase matches nothing, and re-buying that every keystroke is the waste
    // this class exists to stop.
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('★ ten simultaneous cold callers make ONE upstream request', async () => {
    let release: (units: PlaceSuggestion[]) => void = () => {};
    const pending = new Promise<PlaceSuggestion[]>((resolve) => {
      release = resolve;
    });
    const { client, free, suggest } = upstreamThat(() => pending);
    const service = new PlaceSearchService(client, free);

    const callers = Array.from({ length: 10 }, () => service.suggest('cát lái'));
    release([CAT_LAI]);

    expect(await Promise.all(callers)).toEqual(Array.from({ length: 10 }, () => [CAT_LAI]));
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('★ keeps serving the cached list when the upstream has since died', async () => {
    let alive = true;
    const { client, free } = upstreamThat(async () => {
      if (!alive) throw new Error('ECONNREFUSED');
      return [CAT_LAI];
    });
    const service = new PlaceSearchService(client, free);

    await service.suggest('cát lái');
    alive = false;

    // Age the entry rather than waiting an hour: the rule under test is
    // "expired means ASK again", not "expired means throw away".
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);

    expect(await service.suggest('cát lái')).toEqual([CAT_LAI]);

    jest.restoreAllMocks();
  });

  it('★ refuses with 503 only when nothing has ever been loaded', async () => {
    const { client, free } = upstreamThat(async () => {
      throw new Error('Place search is not configured on this deployment.');
    });
    const service = new PlaceSearchService(client, free);

    // The message has to point somewhere useful: the form can still be saved,
    // and the map pin still works without this service at all.
    await expect(service.suggest('cát lái')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keys resolved places by id, so one place is never served as another', async () => {
    const points: Record<string, ResolvedPlace> = {
      p1: POINT,
      p2: { address: 'KCN Sóng Thần', latitude: 10.8904, longitude: 106.7503 },
    };
    const { client, free, resolve } = upstreamThat(
      async () => [],
      async (id) => points[id] as ResolvedPlace,
    );
    const service = new PlaceSearchService(client, free);

    expect(await service.resolve('p1')).toEqual(points['p1']);
    expect(await service.resolve('p2')).toEqual(points['p2']);
    expect(await service.resolve('p1')).toEqual(points['p1']);

    // Two places, two purchases, and the repeat is free.
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('★ a place id can never collide with a search phrase', async () => {
    const { client, free, suggest, resolve } = upstreamThat(
      async () => [CAT_LAI],
      async () => POINT,
    );
    const service = new PlaceSearchService(client, free);

    // A phrase and an id are separate namespaces that are both just text. The
    // key space says so rather than leaving it to luck.
    await service.suggest('p1');
    await service.resolve('p1');

    expect(suggest).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  /**
   * Turning a WRITTEN address into a point — the path that asks nobody to pick
   * a row, and therefore the one that makes "fill in the address and the
   * position appears" true.
   */
  describe('geocoding a typed address', () => {
    it('uses the keyed provider when there is a key', async () => {
      const { client, free, geocode, freeGeocode } = upstreamThat(async () => []);
      const service = new PlaceSearchService(client, free);

      expect(await service.geocode('72 Lê Thánh Tôn')).toEqual(POINT);
      expect(geocode).toHaveBeenCalledWith('72 Lê Thánh Tôn');
      expect(freeGeocode).not.toHaveBeenCalled();
    });

    it('★ falls back to the keyless one when no key is configured', async () => {
      const { client, free, geocode, freeGeocode } = upstreamThat(async () => [], undefined, {
        configured: false,
      });
      const service = new PlaceSearchService(client, free);

      // The point of the fallback: a deployment with nothing configured can
      // still locate a place by typing its address. A key upgrades the answer;
      // it is not what makes the feature exist.
      expect(await service.geocode('72 Lê Thánh Tôn')).toEqual(FREE_POINT);
      expect(geocode).not.toHaveBeenCalled();
      expect(freeGeocode).toHaveBeenCalledWith('72 Lê Thánh Tôn');
    });

    it('★ caches "no match", because half-written addresses are typed all day', async () => {
      const { client, free, geocode } = upstreamThat(async () => [], undefined, {
        geocode: async () => null,
      });
      const service = new PlaceSearchService(client, free);

      expect(await service.geocode('số 10')).toBeNull();
      expect(await service.geocode('số 10')).toBeNull();

      // `null` is an ANSWER. Re-asking a paid-for or rate-limited service the
      // same unanswerable question on every keystroke is the waste this class
      // exists to stop.
      expect(geocode).toHaveBeenCalledTimes(1);
    });

    it('a geocoded address can never collide with a suggestion phrase', async () => {
      const { client, free, suggest, geocode } = upstreamThat(async () => [CAT_LAI]);
      const service = new PlaceSearchService(client, free);

      await service.suggest('cát lái');
      await service.geocode('cát lái');

      // Same text, two different questions, two cache namespaces.
      expect(suggest).toHaveBeenCalledTimes(1);
      expect(geocode).toHaveBeenCalledTimes(1);
    });
  });
});
