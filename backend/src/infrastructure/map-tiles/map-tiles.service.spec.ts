import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { MapTilesService } from './map-tiles.service';
import type { MapTilesClient, TileImage } from './map-tiles.client';

/**
 * The cache, which is what makes proxying tiles defensible at all.
 *
 * ★ WITHOUT IT THIS CHANGE WOULD HAVE MOVED A COST ONTO A 1 CPU BOX. Opening
 * the location dialog asks for twenty-odd squares, and ten dispatchers filing
 * places at the same port ask for the SAME twenty-odd. So the three properties
 * under test are the three that keep the volume honest: a repeat is free, a
 * stampede is one fetch, and nothing grows without bound.
 *
 * ★ AND A FAILURE MUST NOT STICK. Caching "the provider did not answer" would
 * turn a ten-second blip into an area of the map that stays grey until somebody
 * restarts the process — which is the original bug wearing a different hat.
 */

const tileOf = (bytes: number): TileImage => ({
  body: Buffer.alloc(bytes, 7),
  contentType: 'image/png',
});

/** A client whose fetches are counted and resolved on demand. */
const clientFetching = (impl: () => Promise<TileImage>) => {
  const fetch = jest.fn(impl);
  return {
    client: { fetch, style: () => ({ attribution: 'x', maxZoom: 19 }) } as unknown as MapTilesClient,
    fetch,
  };
};

describe('MapTilesService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('★ fetches a square once and serves every later ask from memory', async () => {
    const { client, fetch } = clientFetching(async () => tileOf(64));
    const tiles = new MapTilesService(client);

    await tiles.tile(16, 1, 1);
    await tiles.tile(16, 1, 1);
    await tiles.tile(16, 1, 1);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('★ a stampede on a cold cache is ONE fetch, not one per caller', async () => {
    let release: (tile: TileImage) => void = () => undefined;
    const { client, fetch } = clientFetching(
      () =>
        new Promise<TileImage>((resolve) => {
          release = resolve;
        }),
    );
    const tiles = new MapTilesService(client);

    const waiting = Promise.all([tiles.tile(16, 2, 2), tiles.tile(16, 2, 2), tiles.tile(16, 2, 2)]);
    release(tileOf(32));

    expect(await waiting).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct squares apart — the key is the whole z/x/y', async () => {
    const { client, fetch } = clientFetching(async () => tileOf(64));
    const tiles = new MapTilesService(client);

    await tiles.tile(16, 1, 1);
    await tiles.tile(16, 1, 2);
    await tiles.tile(15, 1, 1);

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('★ does not cache a failure — a blip must not grey out an area until restart', async () => {
    let fail = true;
    const { client, fetch } = clientFetching(async () => {
      if (fail) throw new Error('upstream down');
      return tileOf(16);
    });
    const tiles = new MapTilesService(client);

    await expect(tiles.tile(16, 3, 3)).rejects.toBeInstanceOf(ServiceUnavailableException);

    fail = false;
    await expect(tiles.tile(16, 3, 3)).resolves.toMatchObject({ contentType: 'image/png' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('★ evicts the coldest squares once the byte budget is passed, so RAM is bounded', async () => {
    // Six megabytes a tile: five of them pass the 24 MB budget, which no real
    // tile would do — the point is the arithmetic, not the size.
    const { client, fetch } = clientFetching(async () => tileOf(6 * 1024 * 1024));
    const tiles = new MapTilesService(client);

    for (let x = 0; x < 5; x += 1) await tiles.tile(16, x, 0);

    // The first square was the coldest when the budget was passed, so it is gone
    // and has to be fetched again; the most recent one is still held.
    await tiles.tile(16, 0, 0);
    expect(fetch).toHaveBeenCalledTimes(6);

    await tiles.tile(16, 4, 0);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('★ a read refreshes recency, or the cache would be first-in-first-out wearing an LRU name', async () => {
    const { client, fetch } = clientFetching(async () => tileOf(6 * 1024 * 1024));
    const tiles = new MapTilesService(client);

    for (let x = 0; x < 4; x += 1) await tiles.tile(16, x, 0);
    // Touch the oldest so it is no longer the one to evict...
    await tiles.tile(16, 0, 0);
    expect(fetch).toHaveBeenCalledTimes(4);

    // ...then push past the budget. The square touched above must survive, and
    // the one after it must not.
    await tiles.tile(16, 4, 0);

    await tiles.tile(16, 0, 0);
    expect(fetch).toHaveBeenCalledTimes(5);

    await tiles.tile(16, 1, 0);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
