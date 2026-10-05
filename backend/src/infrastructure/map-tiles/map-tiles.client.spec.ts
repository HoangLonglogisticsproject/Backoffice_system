import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MapTilesClient } from './map-tiles.client';
import type { Env } from '../../config/env.schema';

/**
 * The boundary: which URL is asked for, and what is believed when it answers.
 *
 * ★ THE URL IS THE WHOLE POINT OF THIS CLASS. The map went grey in production
 * because the browser could not reach the tile server, and the repair is that
 * this process asks instead. If the substitution is wrong the symptom is
 * identical to the bug being fixed — a grey square — so the template is pinned
 * here rather than discovered on a deploy.
 *
 * ★ AND THE KEY IS THE OTHER HALF. It travels in a query string, so it must be
 * substituted when there is one, escaped, and never reach a log line.
 */

const TEMPLATE = 'https://tiles.example/maps/{z}/{x}/{y}.png?key={key}';

const configWith = (overrides: Partial<Record<keyof Env, unknown>> = {}) =>
  ({
    get: (name: keyof Env) => {
      const values: Partial<Record<keyof Env, unknown>> = {
        MAP_TILES_URL: TEMPLATE,
        MAP_TILES_KEY: 'sekrit-key',
        MAP_TILES_ATTRIBUTION: '&copy; Somebody',
        MAP_TILES_MAX_ZOOM: 20,
        ...overrides,
      };
      return values[name];
    },
  }) as unknown as ConfigService<Env, true>;

/**
 * Whatever the network is made to answer. The returned array collects the URLs
 * it was asked for — asserting on that rather than on `mock.calls[0][0]` keeps
 * "what did it request" readable and survives `noUncheckedIndexedAccess`.
 */
const answering = (
  init: { ok?: boolean; status?: number; contentType?: string; body?: Buffer } = {},
): string[] => {
  const asked: string[] = [];
  global.fetch = (async (url: string) => {
    asked.push(url);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: () => init.contentType ?? 'image/png' },
      // `Uint8Array.from` copies into a fresh ArrayBuffer. `Buffer#buffer` would
      // hand back Node's shared pool — kilobytes of unrelated allocations with
      // the tile sitting at an offset — and the assertion on the bytes would
      // fail for a reason that has nothing to do with this class.
      arrayBuffer: async () => Uint8Array.from(init.body ?? Buffer.from([1, 2, 3])).buffer,
    };
  }) as unknown as typeof fetch;
  return asked;
};

describe('MapTilesClient', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('★ substitutes z, x, y and the key into the configured template', async () => {
    const asked = answering();

    await new MapTilesClient(configWith()).fetch(16, 52_464, 30_810);

    expect(asked).toEqual(['https://tiles.example/maps/16/52464/30810.png?key=sekrit-key']);
  });

  it('★ escapes the key, so one containing & cannot truncate the request', async () => {
    const asked = answering();

    await new MapTilesClient(configWith({ MAP_TILES_KEY: 'a&b=c' })).fetch(1, 0, 0);

    expect(asked[0]).toContain('key=a%26b%3Dc');
  });

  it('leaves {key} empty when none is configured — the default provider wants none', async () => {
    const asked = answering();

    await new MapTilesClient(configWith({ MAP_TILES_KEY: '  ' })).fetch(1, 0, 0);

    expect(asked[0]).toBe('https://tiles.example/maps/1/0/0.png?key=');
  });

  it('returns the bytes and the upstream content type, not a type guessed from the route', async () => {
    answering({ contentType: 'image/webp; charset=binary', body: Buffer.from([9, 9]) });

    const tile = await new MapTilesClient(configWith()).fetch(2, 1, 1);

    expect(tile.contentType).toBe('image/webp');
    expect(Buffer.from(tile.body)).toEqual(Buffer.from([9, 9]));
  });

  it('★ refuses a non-image body rather than replaying somebody else’s markup onto this origin', async () => {
    answering({ contentType: 'text/html' });

    await expect(new MapTilesClient(configWith()).fetch(2, 1, 1)).rejects.toThrow(
      /not an image/i,
    );
  });

  it('refuses a failed status', async () => {
    answering({ ok: false, status: 429 });

    await expect(new MapTilesClient(configWith()).fetch(2, 1, 1)).rejects.toThrow(/429/);
  });

  it('★ never writes the key to a log, on any failure path', async () => {
    answering({ ok: false, status: 403 });

    await expect(new MapTilesClient(configWith()).fetch(2, 1, 1)).rejects.toThrow();

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('sekrit-key');
    expect(logged).toContain('https://tiles.example/maps/2/1/1.png');
  });

  it('serves the attribution and max zoom the deployment configured', () => {
    expect(new MapTilesClient(configWith()).style()).toEqual({
      attribution: '&copy; Somebody',
      maxZoom: 20,
    });
  });
});
