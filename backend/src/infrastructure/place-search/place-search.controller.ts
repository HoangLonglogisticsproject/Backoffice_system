import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../core/identity/api/auth.guard';
import { PlaceSearchService } from './place-search.service';
import type { PlaceSuggestion, ResolvedPlace } from './goong.client';

/**
 * Finding a place, served from our own origin.
 *
 * ★ PROXIED BECAUSE THE KEY CANNOT GO TO THE BROWSER. The upstream authorises
 * by an `api_key` query parameter, so a page that called it directly would ship
 * the credential to everybody who opened the page — and anybody reading it
 * could spend the whole month's allowance in an afternoon. This is not a CORS
 * workaround; it is the only place the key can live.
 *
 * Two more reasons the sibling `/vn-provinces` gives, and they hold here too:
 * one shared cache means the office spends one allowance instead of one per
 * dispatcher, and it keeps this client talking to `/api` and nothing else.
 *
 * ★ AUTHENTICATED, NOT PERMISSIONED. The DATA is ordinary; the ALLOWANCE is
 * not. `AuthGuard` keeps this from becoming an open proxy that strangers spend
 * our quota through. Beyond that there is nothing to gate: whoever may open the
 * location form may search for an address, and a `trip.*` permission here would
 * only mean a form somebody can open with a search box they cannot use.
 */

/**
 * ★ THREE CHARACTERS BEFORE WE WILL BUY AN ANSWER. One or two letters match
 * half of Vietnam, so the list is useless AND it is the most expensive list to
 * ask for — every dispatcher's first two keystrokes, every time. The client
 * already waits for three; this is the server refusing to be talked out of it.
 */
const queryS = z.object({
  q: z.string().trim().min(3, 'Type at least three characters.').max(200),
});

/**
 * Their id for a place, echoed straight back to them.
 *
 * ★ BOUNDED AND ALPHANUMERIC BECAUSE IT IS INTERPOLATED INTO A URL. It is not
 * ours to shape and we never read it, so the check is not "is this a real id"
 * — it is "this cannot be a path or a query". Not `UuidParam`: these are the
 * upstream's identifiers, not ours.
 */
const placeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,200}$/, 'A place id is 1-200 letters, digits, dashes or underscores.');

@Controller()
export class PlaceSearchController {
  constructor(private readonly places: PlaceSearchService) {}

  /** What to offer somebody who has typed part of an address. */
  @Get('places')
  @UseGuards(AuthGuard)
  async suggest(
    @Query(new ZodValidationPipe(queryS)) query: { q: string },
  ): Promise<PlaceSuggestion[]> {
    return this.places.suggest(query.q);
  }

  /**
   * The point behind an address as it was WRITTEN, with nobody picking a row.
   *
   * ★ ITS OWN TOP-LEVEL PATH, NOT `places/geocode`. That would be caught by
   * `places/:placeId` below — Nest matches in declaration order, and a literal
   * segment sitting under a parameter route is the kind of collision that works
   * until somebody reorders the file.
   *
   * ★ `200` WITH A `null` BODY WHEN NOTHING MATCHES, NOT `404`. An address that
   * cannot be placed is an ordinary outcome of typing half of one — the client
   * shows "not located yet" and moves on. A 404 would put an error in a console
   * for something that is not an error.
   */
  @Get('geocode')
  @UseGuards(AuthGuard)
  async geocode(
    @Query(new ZodValidationPipe(queryS)) query: { q: string },
  ): Promise<ResolvedPlace | null> {
    return this.places.geocode(query.q);
  }

  /**
   * The coordinates behind one chosen suggestion.
   *
   * ★ A SECOND ROUND TRIP, ON PURPOSE. The suggestion list carries no point,
   * and resolving all eight so the browser could pick one would be eight
   * lookups to discard seven — against an allowance counted in requests.
   */
  @Get('places/:placeId')
  @UseGuards(AuthGuard)
  async resolve(
    @Param('placeId', new ZodValidationPipe(placeIdSchema)) placeId: string,
  ): Promise<ResolvedPlace> {
    return this.places.resolve(placeId);
  }
}
