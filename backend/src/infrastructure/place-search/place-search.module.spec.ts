import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../common/types/database.port';
import { PASSWORD_HASHER } from '../../core/identity/domain/password-hasher.port';
import { PlaceSearchController } from './place-search.controller';
import { PlaceSearchModule } from './place-search.module';
import { PlaceSearchService } from './place-search.service';

/**
 * Stands in for the `@Global()` modules the running app registers before
 * anything else: `ConfigModule` (`ConfigService`, `AppConfig`),
 * `DatabaseModule` (`DATABASE`) and `AuthModule` (`PASSWORD_HASHER`).
 *
 * `IdentityModule` brings its repositories and its authentication service
 * along, and those inject both. Nothing in this spec calls either — the point
 * is that the graph RESOLVES — so each is bound to something that throws if
 * anybody tries.
 */
@Global()
@Module({
  providers: [
    {
      // A host that cannot resolve and a key that is not a key, so a request
      // would fail loudly rather than reach the real service.
      provide: ConfigService,
      useValue: { get: () => 'https://example.invalid' },
    },
    { provide: AppConfig, useValue: {} },
    {
      provide: DATABASE,
      useValue: {
        query: () => {
          throw new Error('This spec resolves the graph; it must not query.');
        },
      },
    },
    {
      provide: PASSWORD_HASHER,
      useValue: {
        hash: () => {
          throw new Error('This spec resolves the graph; it must not hash.');
        },
        verify: () => {
          throw new Error('This spec resolves the graph; it must not hash.');
        },
      },
    },
  ],
  exports: [ConfigService, AppConfig, DATABASE, PASSWORD_HASHER],
})
class StubGlobalsModule {}

/**
 * That the module's dependency graph RESOLVES.
 *
 * ★ THE SAME GAP THAT ONCE COST A BOOT, CHECKED BEFORE IT CAN HAPPEN AGAIN.
 * The controller declares `AuthGuard`; a guard is instantiated inside the
 * module that USES it, and `AuthGuard` needs `SessionService`. TypeScript
 * cannot see that — guards arrive through a decorator, not a constructor — and
 * the unit specs instantiate these classes directly, so they never build a
 * graph at all. `VnAdministrativeModule` shipped without `imports:
 * [IdentityModule]` for exactly this reason and only failed when somebody
 * started the server.
 */
describe('PlaceSearchModule', () => {
  it('★ resolves every dependency its controller and guards declare', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubGlobalsModule, PlaceSearchModule],
    }).compile();

    expect(moduleRef.get(PlaceSearchController)).toBeInstanceOf(PlaceSearchController);
    expect(moduleRef.get(PlaceSearchService)).toBeInstanceOf(PlaceSearchService);

    await moduleRef.close();
  });
});
