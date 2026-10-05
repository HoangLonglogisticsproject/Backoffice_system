import { API_BASE_URL, httpClient } from './client';

/**
 * The map's tiles, from our own API rather than from the tile server.
 *
 * ★ THIS IS WHY THE MAP WENT GREY IN PRODUCTION AND NOWHERE ELSE. Leaflet was
 * initialising perfectly — zoom controls, the 300 m circle and the pin all drew
 * — and only the tile images were missing. The bundle was correct, the Leaflet
 * stylesheet was correct, and there was no Content-Security-Policy; the
 * browser simply could not complete a request to `tile.openstreetmap.org`,
 * while the same request from a developer's machine returned a 38 KB tile.
 *
 * Asking which network did it is the wrong question — an ISP, a captive
 * network and a tile server declining an office's shared egress address all
 * fail identically and are all outside this codebase. The page already talks to
 * its own origin for everything else, and a tile that arrives on that same
 * connection cannot be blocked separately from the application around it. So
 * the tile URL is ours and the server fetches the real one, the same shape
 * `placeSearch.ts` uses — there for a key, here for reachability.
 */

/** What the server says about the tiles it is about to serve. */
export interface TileStyle {
  /**
   * ⚠ A LICENCE TERM, RENDERED AS HTML BY LEAFLET'S ATTRIBUTION CONTROL.
   * OpenStreetMap's data is ODbL and naming the contributors is the condition
   * of drawing it. It is SERVED rather than written here because the provider
   * is a server-side setting: a copy compiled into this bundle would keep
   * crediting OpenStreetMap on the day a deployment started paying somebody
   * else.
   */
  attribution: string;
  /** How far the configured provider actually has imagery. */
  maxZoom: number;
}

/**
 * The template Leaflet interpolates per tile.
 *
 * ★ NOT A PATH THROUGH `httpClient`. Leaflet creates its own `<img>` elements,
 * so this has to be a string it can fill in — which is also why `API_BASE_URL`
 * is exported rather than this file rebuilding the same expression and drifting
 * from it. The cookie still travels: an image request is same-origin in
 * production, and same-site between `:4200` and `:3000` in development.
 */
export const TILE_URL_TEMPLATE = `${API_BASE_URL}/tiles/{z}/{x}/{y}`;

/**
 * What the map must credit, and how far it may zoom.
 *
 * ★ THE CALLER MUST HAVE A FALLBACK, AND IT MUST NOT BLOCK THE MAP. If this
 * request fails the tiles may still be fine — they are separate requests — so
 * refusing to draw anything would turn a missing caption into a missing map.
 * `LocationMap` holds the defaults for that reason.
 */
export async function fetchTileStyle(): Promise<TileStyle> {
  const { data } = await httpClient.get<TileStyle>('/tiles/meta');
  return data;
}
