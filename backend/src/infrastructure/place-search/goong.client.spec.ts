import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoongClient } from './goong.client';
import type { Env } from '../../config/env.schema';

/**
 * The boundary: what is asked for, and what is believed when it answers.
 *
 * ★ THIS IS THE ONE PLACE THE UPSTREAM'S SHAPE IS PINNED. Everything above
 * works in `PlaceSuggestion` / `ResolvedPlace`, so if this file misreads the
 * feed nothing else notices — an empty dropdown in front of a dispatcher is
 * the first symptom.
 *
 * ★ AND THE KEY IS HALF OF WHAT IS UNDER TEST. It is a credential travelling
 * in a query string: it must always be sent, and it must never reach a log.
 */

const BASE = 'https://places.example';
const KEY = 'sekrit-key';

const configWith = (apiKey: string) =>
  ({
    get: (name: keyof Env) => (name === 'GOONG_API_KEY' ? apiKey : BASE),
  }) as unknown as ConfigService<Env, true>;

const config = configWith(KEY);

/**
 * Whatever the network is made to answer. The returned array collects the URLs
 * it was asked for — asserting on that rather than on `mock.calls[0][0]` keeps
 * "what did it request" readable and survives `noUncheckedIndexedAccess`.
 */
const answering = (body: unknown, init: { ok?: boolean; status?: number } = {}): string[] => {
  const asked: string[] = [];
  global.fetch = (async (url: string) => {
    asked.push(url);
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
  }) as unknown as typeof fetch;
  return asked;
};

/** The query string of the one call that was made, as readable pairs. */
const paramsOf = (asked: string[]): Record<string, string> =>
  Object.fromEntries(new URL(asked[0] ?? '').searchParams);

const prediction = (placeId: string, main: string, secondary: string) => ({
  place_id: placeId,
  description: `${main}, ${secondary}`,
  structured_formatting: { main_text: main, secondary_text: secondary },
  // The noise they also send, present so `.passthrough()` is actually exercised.
  types: ['establishment'],
  score: 0.9,
  reference: 'ref',
});

describe('GoongClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('suggesting', () => {
    it('asks the autocomplete path, with the key and the typed text', async () => {
      const asked = answering({
        predictions: [prediction('p1', 'Vincom Center Đồng Khởi', '72 Lê Thánh Tôn')],
        status: 'OK',
      });

      const units = await new GoongClient(config).suggest('72 Lê Thánh Tôn');

      expect(asked[0]).toContain(`${BASE}/Place/AutoComplete?`);
      expect(paramsOf(asked)).toEqual({
        input: '72 Lê Thánh Tôn',
        limit: '8',
        api_key: KEY,
      });
      // `toEqual` checks the keys exactly: `types`, `score` and `reference`
      // are dropped rather than travelling on into a dropdown.
      expect(units).toEqual([
        { id: 'p1', primary: 'Vincom Center Đồng Khởi', secondary: '72 Lê Thánh Tôn' },
      ]);
    });

    it('★ sends the diacritics as typed, because this upstream wants them', async () => {
      const asked = answering({ predictions: [prediction('p1', 'Cảng Cát Lái', 'Phường Cát Lái')] });

      await new GoongClient(config).suggest('Cảng Cát Lái');

      // The measured reason this provider was chosen: the OpenStreetMap
      // geocoder answers NOTHING for this string and needs it stripped to
      // "Cang Cat Lai". Stripping here would be a bug, so it is pinned.
      expect(paramsOf(asked)['input']).toBe('Cảng Cát Lái');
    });

    it('falls back to the whole description when there is no structured split', async () => {
      answering({ predictions: [{ place_id: 'p2', description: 'Kho A, Dĩ An' }] });

      // Not defensive coding: `structured_formatting` is genuinely optional,
      // and cutting the description at a comma to invent two lines would be
      // guessing where the name ends.
      expect(await new GoongClient(config).suggest('kho a')).toEqual([
        { id: 'p2', primary: 'Kho A, Dĩ An', secondary: '' },
      ]);
    });

    it('an empty list is an answer, not a failure', async () => {
      answering({ predictions: [] });

      // "Nothing matches that" is correct and useful. The service caches it,
      // which is the whole point — re-buying it every keystroke is the waste.
      await expect(new GoongClient(config).suggest('qwertyuiop')).resolves.toEqual([]);
    });
  });

  describe('resolving', () => {
    it('★ asks for the detail of ONE place and returns the point', async () => {
      const asked = answering({
        result: {
          place_id: 'p1',
          formatted_address: '72 Lê Thánh Tôn, Phường Sài Gòn, Thành phố Hồ Chí Minh',
          geometry: { location: { lat: 10.7787, lng: 106.7018 } },
          name: 'Vincom Center Đồng Khởi',
        },
        status: 'OK',
      });

      const place = await new GoongClient(config).resolve('p1');

      expect(asked[0]).toContain(`${BASE}/Place/Detail?`);
      expect(paramsOf(asked)).toEqual({ place_id: 'p1', api_key: KEY });
      expect(place).toEqual({
        address: '72 Lê Thánh Tôn, Phường Sài Gòn, Thành phố Hồ Chí Minh',
        latitude: 10.7787,
        longitude: 106.7018,
      });
    });

    it('reports no address rather than an empty one when they did not say', async () => {
      answering({ result: { geometry: { location: { lat: 10.7, lng: 106.7 } } } });

      // `null` is "they did not say"; `''` would overwrite whatever the
      // operator had typed with nothing.
      expect((await new GoongClient(config).resolve('p3')).address).toBeNull();
    });

    it('★ refuses a coordinate that arrived as a string', async () => {
      answering({ result: { geometry: { location: { lat: '10.7', lng: '106.7' } } } });

      // `z.number()`, never a coercion. `Number('')` is 0, and 0,0 is a real
      // place in the Atlantic that no lorry will ever reach — a geofence
      // measured against it fails every driver with no hint why.
      await expect(new GoongClient(config).resolve('p4')).rejects.toThrow(/unexpected shape/i);
    });
  });

  describe('what it will not do', () => {
    it('★ does not call out at all when no key is configured', async () => {
      const asked = answering({ predictions: [] });

      await expect(new GoongClient(configWith('   ')).suggest('cát lái')).rejects.toThrow(
        /not configured/i,
      );
      // Sending an empty key buys a 403 and a log line that reads like a
      // revoked credential, sending somebody to check a key never set.
      expect(asked).toEqual([]);
    });

    it('reports whether it can search, so the screen can say so', () => {
      expect(new GoongClient(config).configured()).toBe(true);
      expect(new GoongClient(configWith('')).configured()).toBe(false);
    });

    it('★ names the upstream error CODE, which is the useful half', async () => {
      answering(
        { error: { code: 'API_KEY_INVALID', message: 'An invalid api_key was supplied.' } },
        { ok: false, status: 403 },
      );

      // "answered 403" sends somebody to check the network. "API_KEY_INVALID"
      // sends them to the console, which is where the problem is.
      await expect(new GoongClient(config).suggest('cát lái')).rejects.toThrow(/API_KEY_INVALID/);
    });

    it('refuses a plain non-2xx that carries no error object', async () => {
      answering(null, { ok: false, status: 502 });

      await expect(new GoongClient(config).suggest('cát lái')).rejects.toThrow(/502/);
    });

    it('refuses a body that is not the shape it asked for', async () => {
      answering({ something: 'else' });

      await expect(new GoongClient(config).suggest('cát lái')).rejects.toThrow(/unexpected shape/i);
    });

    it('reports an unreachable host as one sentence, not somebody else’s stack', async () => {
      global.fetch = (async () => {
        throw new Error('ECONNREFUSED 10.0.0.1:443');
      }) as unknown as typeof fetch;

      await expect(new GoongClient(config).suggest('cát lái')).rejects.toThrow(/did not respond/i);
    });

    it('★ never puts the key in a log line', async () => {
      // Spied on the base class: the logger is an instance field, so there is
      // no per-client object to reach before the client exists.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      answering(null, { ok: false, status: 502 });

      await new GoongClient(config).suggest('cát lái').catch(() => undefined);

      // A warning is the easiest place for a credential to escape into a log
      // aggregator that outlives it.
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).not.toContain(KEY);
      expect(logged).toContain('/Place/AutoComplete');
    });
  });
});
