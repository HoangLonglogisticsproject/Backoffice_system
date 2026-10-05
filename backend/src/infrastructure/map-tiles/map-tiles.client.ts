import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

/**
 * The map's own tiles, fetched by THIS process rather than by the browser.
 *
 * ★ THIS EXISTS BECAUSE THE BROWSER COULD NOT REACH THE TILE SERVER, AND THAT
 * IS A DIFFERENT PROBLEM FROM THE ONE `GoongClient` SOLVES. Place search is
 * proxied so a KEY never reaches the page. Tiles are proxied so a NETWORK never
 * gets a say: measured on production, Leaflet initialised correctly — zoom
 * controls, the 300 m circle and the pin all drew — and every tile image came
 * back empty, leaving the grey `.leaflet-container` background and no error
 * anywhere. The bundle was correct, the stylesheet was correct, there was no
 * Content-Security-Policy; the request to `tile.openstreetmap.org` simply did
 * not complete from the operator's device, while the same request from a
 * developer's machine returned a 38 KB tile.
 *
 * Whether that was the ISP, a captive network or the tile server declining an
 * office's shared egress address does not change the fix and is not worth
 * discovering: the page already talks to this origin for everything else, and a
 * tile that arrives on the same connection as the rest of the application
 * cannot be blocked separately from it.
 *
 * ★ SO THE DEFAULT IS STILL OPENSTREETMAP, AND IT STILL NEEDS NO KEY. Moving
 * the fetch to the server is the whole repair — this process reaches OSM
 * perfectly well. That matters because it means the fix ships and works
 * immediately, with nothing registered and no account opened, instead of
 * waiting on somebody to buy a tile plan.
 *
 * ⚠ AND IT IS A STOPGAP, SAID PLAINLY. OpenStreetMap's tiles are donated
 * infrastructure meant for modest direct use; a server that re-serves them sits
 * further outside that bargain than a browser that fetches them, not closer to
 * it. The cache in `MapTilesService` is what keeps the volume honest meanwhile,
 * and `MAP_TILES_URL` + `MAP_TILES_KEY` are the upgrade: point them at MapTiler
 * or Stadia and nothing above this file changes, exactly as swapping the
 * geocoder was a one-directory change.
 *
 * ★ THE KEY, WHEN THERE IS ONE, NEVER LEAVES THIS PROCESS — same rule as
 * `GoongClient`, and the reason the template carries a `{key}` placeholder
 * rather than this client appending a query parameter whose name it has
 * guessed. MapTiler wants `key`, Stadia wants `api_key`; the template says
 * which, so a new provider is a configuration change and not a code change.
 */

/** What a tile weighs on the wire, and what it is. */
export interface TileImage {
  body: Buffer;
  contentType: string;
}

/**
 * What the CLIENT has to be told about the tiles it is drawing.
 *
 * ★ SERVED, NOT COMPILED INTO THE BUNDLE, BECAUSE THE ATTRIBUTION IS A LICENCE
 * TERM. OpenStreetMap's data is ODbL and naming the contributors is the
 * condition of using it; a commercial provider imposes its own line. With the
 * provider chosen by configuration, a copy of that line inside the frontend
 * would keep crediting OpenStreetMap on the day a deployment started paying
 * somebody else — silently, and wrongly. `LocationMap` had already named this
 * shape as the moment to serve a value from the API rather than copy it, about
 * the geofence radius; this is the same call.
 */
export interface TileStyle {
  /** HTML, rendered by Leaflet's attribution control. */
  attribution: string;
  /** How far the configured provider actually has imagery. */
  maxZoom: number;
}

/**
 * Longer than a tile has ever needed and shorter than somebody will stare at a
 * grey square. Twenty-odd tiles are asked for at once when the dialog opens, so
 * a provider that has stopped answering must fail fast rather than hold twenty
 * sockets open against a 1 CPU box.
 */
const REQUEST_TIMEOUT_MS = 6_000;

/**
 * ⚠ A REAL CONTACT, BECAUSE OPENSTREETMAP'S POLICY REQUIRES ONE AND BLOCKS
 * ANONYMOUS CALLERS. A browser sent its own `User-Agent` for free; a server has
 * to say who it is. Deliberately the same identification `NOMINATIM_USER_AGENT`
 * defaults to — one deployment, one name, so a rate-limit conversation with
 * either service is about the same caller.
 */
const USER_AGENT = 'HoangLongLogistics-Backoffice (https://hoanglonglti.com)';

/**
 * What an image response may claim to be.
 *
 * ★ AN ALLOWLIST, BECAUSE THIS BODY IS REPLAYED TO A BROWSER. An upstream that
 * answers `text/html` is answering with an error page or a captive portal's
 * login form, and forwarding that content type would put somebody else's markup
 * on this origin. Refused as an upstream failure instead, which is what it is.
 */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

@Injectable()
export class MapTilesClient {
  private readonly logger = new Logger(MapTilesClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** What the page must draw in the corner, and how far it may zoom. */
  style(): TileStyle {
    return {
      attribution: this.config.get('MAP_TILES_ATTRIBUTION', { infer: true }),
      maxZoom: this.config.get('MAP_TILES_MAX_ZOOM', { infer: true }),
    };
  }

  /**
   * One tile, or a thrown Error for the service above to turn into a status.
   *
   * ★ THE COORDINATES ARRIVE ALREADY PROVEN — integers, in range for their own
   * zoom — by the controller's schema. That is not belt-and-braces: they are
   * interpolated into a URL, and `{z}/{x}/{y}` carrying anything path-shaped
   * would let a caller choose which path on the provider's host this process
   * fetches.
   */
  async fetch(z: number, x: number, y: number): Promise<TileImage> {
    const url = this.urlFor(z, x, y);

    // ★ THE KEY IS NEVER IN A LOG LINE. Origin plus path drops the query
    // string, which is exactly where the credential lives.
    const safeUrl = `${url.origin}${url.pathname}`;

    let response: Response;
    try {
      response = await fetch(url.href, {
        headers: { accept: 'image/*', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Map tiles unreachable at ${safeUrl}: ${(error as Error).message}`);
      throw new Error('The map-tile service did not respond.');
    }

    if (!response.ok) {
      this.logger.warn(`Map tiles answered ${response.status} for ${safeUrl}`);
      throw new Error(`The map-tile service answered ${response.status}.`);
    }

    // `split(';')` because a content type carries parameters — `image/png` and
    // `image/png; charset=binary` are the same answer, and only one of them
    // matches a bare comparison.
    // `?? ''` because `noUncheckedIndexedAccess` is on: `split` never returns an
    // empty array, but the type system does not know that and a cast would be a
    // worse way to say so.
    const contentType = ((response.headers.get('content-type') ?? '').split(';')[0] ?? '').trim();
    if (!IMAGE_TYPES.includes(contentType)) {
      this.logger.warn(`Map tiles answered ${contentType || 'no content type'} for ${safeUrl}`);
      throw new Error('The map-tile service answered something that is not an image.');
    }

    return { body: Buffer.from(await response.arrayBuffer()), contentType };
  }

  /**
   * The upstream URL for one tile.
   *
   * ★ BUILT BY SUBSTITUTION AND THEN PARSED, so a template edited into nonsense
   * fails here with a message about the template rather than as a `fetch` error
   * that reads like the provider is down. The schema already refuses a template
   * missing `{z}`, `{x}` or `{y}` at boot; this is the second check, on what the
   * substitution actually produced.
   */
  private urlFor(z: number, x: number, y: number): URL {
    const template = this.config.get('MAP_TILES_URL', { infer: true });
    const key = this.config.get('MAP_TILES_KEY', { infer: true }).trim();

    const href = template
      .replaceAll('{z}', String(z))
      .replaceAll('{x}', String(x))
      .replaceAll('{y}', String(y))
      // Encoded, because it lands inside a query string and a key containing an
      // `&` would otherwise truncate the request into a different one.
      .replaceAll('{key}', encodeURIComponent(key));

    try {
      return new URL(href);
    } catch {
      throw new Error('MAP_TILES_URL does not produce a valid URL.');
    }
  }
}
