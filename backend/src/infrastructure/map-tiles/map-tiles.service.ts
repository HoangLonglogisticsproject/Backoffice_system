import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MapTilesClient, type TileImage, type TileStyle } from './map-tiles.client';

/**
 * Tiles, cached, so one office costs one fetch of each square.
 *
 * ★ THE CACHE IS WHAT MAKES PROXYING DEFENSIBLE. Routing tiles through this
 * process moved a cost that used to be the browser's onto a 1 CPU / 2 GB box:
 * opening the location dialog asks for twenty-odd squares at once, and ten
 * dispatchers filing places at the same port ask for the SAME twenty-odd.
 * Uncached that is two hundred upstream fetches for twenty answers — against
 * donated infrastructure today and against a metered allowance the moment
 * `MAP_TILES_KEY` is set. Same argument `PlaceSearchService` makes about a
 * monthly request count, with a second party's goodwill in place of money.
 *
 * ★ BOUNDED BY BYTES, NOT BY COUNT, BECAUSE TILES ARE NOT ONE SIZE. Open water
 * compresses to under a hundred bytes and a dense junction runs past forty
 * kilobytes — a thousand-entry limit would therefore be anywhere between
 * 100 KB and 40 MB of a 2 GB machine, which is not a limit anybody can reason
 * about. A byte budget is the same ceiling whatever gets cached.
 *
 * ★ NO TTL, AND THAT IS DELIBERATE. A tile is immutable for practical purposes
 * — a road that was redrawn last week still gets a lorry to the gate — and the
 * eviction that matters here is pressure, not age. The browser is told a
 * finite `max-age` separately, which is where freshness actually belongs:
 * that one expires per viewer, this one is about not re-fetching the same
 * square for the eleventh dispatcher.
 *
 * ★ IN-MEMORY IS THE RIGHT SIZE, for the reason the sibling service gives: one
 * process, a bounded slice of RAM, and a restart costs a handful of fetches.
 * Redis for this would be a second thing to run, monitor and fail.
 */

/**
 * How much RAM the tile cache may hold.
 *
 * Twenty-four megabytes is roughly a thousand typical city tiles — comfortably
 * the whole area a dispatch office actually looks at, which is a handful of
 * ports and industrial parks, and a rounding error against the 2 GB the VPS
 * has. Deliberately a constant and not an environment variable: nobody has a
 * reason to tune this per deployment, and a knob nobody turns is a knob to
 * explain forever.
 */
const CACHE_BUDGET_BYTES = 24 * 1024 * 1024;

@Injectable()
export class MapTilesService {
  private readonly logger = new Logger(MapTilesService.name);

  /**
   * ★ A PLAIN `Map` IS AN LRU HERE BECAUSE ITS ITERATION ORDER IS INSERTION
   * ORDER, which the language guarantees. `keys().next()` is therefore the
   * least recently inserted entry, and `get` re-inserts what it finds to make
   * that least recently USED. No dependency for forty lines of bookkeeping.
   */
  private readonly tiles = new Map<string, TileImage>();

  /** Running total of `tiles`, so the budget costs no walk of the map. */
  private bytes = 0;

  /**
   * Fetches in flight, so a cold cache under load makes ONE upstream call per
   * square. Ten dispatchers opening the dialog at nine o'clock would otherwise
   * be ten identical requests for every tile on screen; everybody waits on the
   * same promise.
   */
  private readonly inFlight = new Map<string, Promise<TileImage>>();

  constructor(private readonly upstream: MapTilesClient) {}

  /** What the page must draw in the corner, and how far it may zoom. */
  style(): TileStyle {
    return this.upstream.style();
  }

  /**
   * One tile — from memory, from a fetch already running, or from upstream.
   *
   * ★ A FAILURE IS NOT CACHED, UNLIKE AN EMPTY SUGGESTION LIST NEXT DOOR. The
   * difference is what the answer means: "no place matches `qwerty`" is a
   * correct answer worth keeping, whereas "the provider did not respond" is the
   * absence of one. Caching it would turn a ten-second blip into an area of the
   * map that stays grey until a restart.
   */
  async tile(z: number, x: number, y: number): Promise<TileImage> {
    const key = `${z}/${x}/${y}`;

    const hit = this.tiles.get(key);
    if (hit) {
      // Re-inserted so it becomes the most recently used rather than staying
      // where it was first put — this is the whole of the "R" in LRU.
      this.tiles.delete(key);
      this.tiles.set(key, hit);
      return hit;
    }

    const running = this.inFlight.get(key);
    if (running) return running;

    const load = this.upstream
      .fetch(z, x, y)
      .then((image) => {
        this.remember(key, image);
        return image;
      })
      .catch((error: Error) => {
        // ★ TRANSLATED HERE, NOT IN THE CONTROLLER. Everything that can go
        // wrong upstream — refused, timed out, answered HTML — is one fact to
        // the browser: this square is not available right now. Leaflet retries
        // on its own as the operator pans, and `LocationMap` says so once
        // rather than per tile.
        this.logger.warn(`Map tile ${key} unavailable: ${error.message}`);
        throw new ServiceUnavailableException('The map tiles are not available right now.');
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, load);
    return load;
  }

  /** Keep a tile, evicting the coldest ones until the budget is respected. */
  private remember(key: string, image: TileImage): void {
    this.tiles.set(key, image);
    this.bytes += image.body.byteLength;

    while (this.bytes > CACHE_BUDGET_BYTES) {
      const coldest = this.tiles.keys().next();
      // Defensive only in the arithmetic sense: an empty map cannot be over
      // budget, so this guard exists to make the loop provably terminate rather
      // than because it is reachable.
      if (coldest.done) break;

      const evicted = this.tiles.get(coldest.value);
      this.tiles.delete(coldest.value);
      this.bytes -= evicted?.body.byteLength ?? 0;
    }
  }
}
