import { Controller, Get, Header, Param, StreamableFile, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../core/identity/api/auth.guard';
import { MapTilesService } from './map-tiles.service';
import type { TileStyle } from './map-tiles.client';

/**
 * The map's tiles, served from our own origin.
 *
 * ★ PROXIED BECAUSE THE BROWSER COULD NOT REACH THE TILE SERVER — not to hide a
 * key, which is what `/places` next door exists for. `MapTilesClient` carries
 * the measurement; the short version is that production drew a correct, fully
 * initialised Leaflet map with every tile missing, while the same tile URL
 * answered normally from a developer's machine. A page that already talks to
 * this origin for everything else cannot have its map blocked separately from
 * the rest of the application.
 *
 * ★ AUTHENTICATED, SAME ARGUMENT AS `/places`, DIFFERENT NOUN. There is nothing
 * secret about a picture of a road. What `AuthGuard` protects is the CAPACITY:
 * without it this is an open tile proxy on a 1 CPU box, and strangers would
 * spend somebody else's bandwidth and this deployment's allowance through it.
 * Whoever may open the location dialog may see the map in it, so there is no
 * `trip.*` permission to add beyond that.
 *
 * ⚠ A GET WITH NO CSRF HEADER, AND IT HAS TO STAY THAT WAY. These URLs are
 * fetched by `<img>` elements that Leaflet creates, and an image tag cannot set
 * `X-Requested-With`. The session cookie travels on its own because this is
 * same-origin — which is the entire reason the proxy in front of it forwards
 * `/api` to this process rather than the browser calling the provider.
 */

/**
 * One tile's address, checked as a whole rather than per segment.
 *
 * ★ `x` AND `y` ARE BOUNDED BY `z`, WHICH IS WHY THIS IS ONE SCHEMA AND NOT
 * THREE PIPES. A tile grid at zoom `z` is 2^z squares on a side, so `x` at zoom
 * 3 may be 7 and at zoom 16 may be 65535 — a fixed ceiling would either refuse
 * valid tiles at high zoom or wave through nonsense at low zoom. Both are worth
 * refusing: these numbers are interpolated into the provider's URL, and the
 * narrowest check that is still correct is the one to make.
 *
 * ★ COERCED, BECAUSE A ROUTE PARAMETER IS ALWAYS A STRING. `.int()` after the
 * coercion is what rejects `1.5` and `1e3`; `Number('')` is `0`, so the
 * emptiness has to be refused by the regex-free route matcher above, which it
 * is — Nest does not match an empty segment.
 *
 * ★ 22 IS THE HARD CEILING, NOT `MAP_TILES_MAX_ZOOM`. The configured value is
 * what the CLIENT is told it may ask for; this is what the process will accept
 * at all, so a provider configured generously cannot be turned into a request
 * for zoom 400. Leaflet never asks beyond what `/tiles/meta` told it.
 */
const tileParams = z
  .object({
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .refine(({ z: zoom, x, y }) => x < 2 ** zoom && y < 2 ** zoom, {
    message: 'The tile coordinates are outside the grid for that zoom level.',
  });

/**
 * How long a browser may keep a tile without asking again.
 *
 * ★ LONG, BECAUSE THE ALTERNATIVE IS PAYING FOR THE SAME SQUARE EVERY TIME THE
 * DIALOG OPENS. A dispatcher files a dozen places at the same port in a
 * morning, and without this each one re-fetches the same tiles through this
 * process. Thirty days matches what `PlaceSearchService` already decided about
 * a resolved point, for the same reason: a warehouse does not move, and neither
 * does the road to it.
 *
 * `immutable` is deliberately NOT set. It would also suppress the revalidation
 * a reload normally forces, and a tile that renders wrongly would then be
 * unfixable from the operator's side — a month is already long enough to be
 * generous with.
 */
const BROWSER_CACHE_SECONDS = 30 * 24 * 60 * 60;

@Controller('tiles')
export class MapTilesController {
  constructor(private readonly tiles: MapTilesService) {}

  /**
   * What the page must draw in the corner, and how far it may zoom.
   *
   * ★ DECLARED BEFORE THE TILE ROUTE. They cannot actually collide — this is
   * two path segments and that one is four — but the sibling controller was
   * bitten by exactly this shape and says so in a comment, and a literal
   * segment living above a parameterised route is the convention that survives
   * somebody reordering the file.
   *
   * ★ IT IS A LICENCE TERM TRAVELLING AS DATA. The attribution is the condition
   * of using the tiles, and it changes with the provider. Serving it means a
   * deployment that switches to a keyed provider credits the right one without
   * a frontend release.
   */
  @Get('meta')
  @UseGuards(AuthGuard)
  meta(): TileStyle {
    return this.tiles.style();
  }

  /**
   * One tile.
   *
   * ★ `StreamableFile` RATHER THAN A RETURNED `Buffer`, because Nest serialises
   * what a handler returns as JSON — a PNG would arrive as a base64-ish object
   * and render as a broken image. `StreamableFile` is handled natively, so this
   * needs no `@Res` and Nest stays in charge of the response.
   *
   * ★ THE CONTENT TYPE IS THE UPSTREAM'S, NOT A GUESS FROM THE ROUTE. The
   * template may point at a provider serving WebP or JPEG; the client has
   * already refused anything that is not an image, so this is the real type of
   * the bytes being forwarded and not a claim about them.
   */
  @Get(':z/:x/:y')
  @UseGuards(AuthGuard)
  // `private`: a tile is not user-specific, but the response travels behind a
  // session cookie and a shared cache keyed only on the URL would be a cache
  // that serves it to somebody who has not got one.
  @Header('Cache-Control', `private, max-age=${BROWSER_CACHE_SECONDS}`)
  async tile(
    @Param(new ZodValidationPipe(tileParams)) params: { z: number; x: number; y: number },
  ): Promise<StreamableFile> {
    const image = await this.tiles.tile(params.z, params.x, params.y);

    return new StreamableFile(image.body, {
      type: image.contentType,
      length: image.body.byteLength,
    });
  }
}
