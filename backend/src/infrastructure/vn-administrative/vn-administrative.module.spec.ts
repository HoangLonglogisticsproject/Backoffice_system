import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../common/types/database.port';
import { PASSWORD_HASHER } from '../../core/identity/domain/password-hasher.port';
import { VnAdministrativeController } from './vn-administrative.controller';
import { VnAdministrativeModule } from './vn-administrative.module';
import { VnAdministrativeService } from './vn-administrative.service';

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
      // The one value anything here actually reads. A host that cannot resolve,
      // so a request would fail loudly rather than reach the real service.
      provide: ConfigService,
      useValue: { get: () => 'https://example.invalid/api' },
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
 * ★ THIS EXISTS BECAUSE NOTHING ELSE CHECKED IT, AND THE GAP COST A BOOT.
 * The module shipped without `imports: [IdentityModule]`; the controller
 * declares `AuthGuard`, a guard is instantiated inside the module that USES it,
 * and `AuthGuard` needs `SessionService`. TypeScript cannot see that — guards
 * arrive through a decorator, not a constructor — and the unit specs
 * instantiate the service directly, so they never built a graph at all. The
 * failure appeared only when somebody started the server:
 *
 *     UnknownDependenciesException: Nest can't resolve dependencies of the
 *     AuthGuard (?). ... available in the VnAdministrativeModule module.
 *
 * ★ AND IT COMPILES THIS MODULE, NOT THE APPLICATION. `AppModule` pulls in
 * configuration and a database pool; this suite is meant to run on a machine
 * with neither, which is the same reason `health.controller.spec` walks
 * `AppModule`'s metadata statically instead of booting it. One module with its
 * real imports is enough to catch the whole class of wiring mistake.
 */
describe('VnAdministrativeModule', () => {
  it('★ resolves every dependency its controller and guards declare', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubGlobalsModule, VnAdministrativeModule],
    }).compile();

    expect(moduleRef.get(VnAdministrativeController)).toBeInstanceOf(VnAdministrativeController);
    expect(moduleRef.get(VnAdministrativeService)).toBeInstanceOf(VnAdministrativeService);

    await moduleRef.close();
  });
});
