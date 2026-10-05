import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../common/http/domain-error.filter';
import { AuthGuard } from '../../core/identity/api/auth.guard';
import { SESSION_COOKIE } from '../../core/identity/api/session.cookie';
import { SessionService } from '../../core/identity/application/session.service';
import { MapTilesController } from './map-tiles.controller';
import { MapTilesService } from './map-tiles.service';

/**
 * Tiles over HTTP: a real request, because every risk here is in the wiring.
 *
 * ★ THE ROUTE SHAPE IS THE THING UNDER TEST. `:z/:x/:y` has to match, the
 * coordinates have to survive as numbers, a PNG has to arrive as a PNG rather
 * than as JSON — Nest serialises a returned `Buffer` and the symptom would be a
 * broken image, which is indistinguishable from the production bug this whole
 * change exists to fix. None of that is visible to a unit test of the service.
 *
 * ★ AND THE GUARD IS THE OTHER HALF. Without it this is an open tile proxy on a
 * 1 CPU box that strangers spend this deployment's allowance through. It also
 * has to work for a request carrying NO CSRF header, because Leaflet fetches
 * these with `<img>` elements and an image tag cannot set one.
 */
describe('map tile HTTP', () => {
  const TOKEN = 'a-session-token-value';
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let app: INestApplication;
  let tiles: { tile: jest.Mock; style: jest.Mock };

  beforeEach(async () => {
    tiles = {
      tile: jest.fn().mockResolvedValue({ body: PNG, contentType: 'image/png' }),
      style: jest.fn().mockReturnValue({ attribution: '&copy; Somebody', maxZoom: 19 }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MapTilesController],
      providers: [
        AuthGuard,
        { provide: MapTilesService, useValue: tiles },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              id: '33333333-3333-3333-3333-333333333333',
              displayName: 'Điều Phối',
              status: 'active',
              accountType: 'employee',
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  /** ⚠ NO `X-Requested-With`: an `<img>` cannot set one, and these must still work. */
  const authed = (path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

  it('★ serves the bytes as an image, not as JSON', async () => {
    const response = await authed('/tiles/16/52464/30810');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(Buffer.from(response.body)).toEqual(PNG);
  });

  it('★ passes the coordinates through as numbers', async () => {
    await authed('/tiles/16/52464/30810');

    expect(tiles.tile).toHaveBeenCalledWith(16, 52_464, 30_810);
  });

  it('tells the browser to keep a tile, so the dialog is not re-fetched every time it opens', async () => {
    const response = await authed('/tiles/16/52464/30810');

    // `private`, because the response travels behind a session cookie.
    expect(response.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
  });

  it('serves the attribution and max zoom, which the page needs before it can draw', async () => {
    const response = await authed('/tiles/meta');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ attribution: '&copy; Somebody', maxZoom: 19 });
  });

  it.each(['/tiles/16/52464/30810', '/tiles/meta'])(
    '★ refuses %s with 401 when there is no session — this is not an open proxy',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);

      expect(response.status).toBe(401);
      expect(tiles.tile).not.toHaveBeenCalled();
      expect(tiles.style).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a zoom past the hard ceiling', '/tiles/40/1/1'],
    ['a tile outside the grid for its zoom', '/tiles/1/9/0'],
    ['a fractional coordinate', '/tiles/16/1.5/1'],
    ['a negative coordinate', '/tiles/16/-1/1'],
    ['something that is not a number at all', '/tiles/16/x/1'],
  ])('★ refuses %s before anything is fetched', async (_case, path) => {
    const response = await authed(path);

    // 422, not 400: `ZodValidationPipe` raises the codebase's own
    // `ValidationError` and `DomainErrorFilter` maps that to UNPROCESSABLE_ENTITY
    // everywhere. Asserting the house status rather than the HTTP one keeps this
    // consistent with every other validated route.
    expect(response.status).toBe(422);
    expect(tiles.tile).not.toHaveBeenCalled();
  });
});
