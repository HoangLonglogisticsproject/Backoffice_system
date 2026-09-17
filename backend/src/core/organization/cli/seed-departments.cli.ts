/**
 * Development fixture: the three business units authorization is about.
 *
 *   npm run dev:seed-departments
 *
 * Creates — or brings back to the fixture — one unit per `DepartmentFunction`,
 * so a local deployment has somewhere to put a sales, an accounting and a
 * dispatch account and test `trip.*` against real rows (DL-109 / DL-110).
 * Idempotent: a unit found under the slug is left alone when its name and
 * function already match, otherwise both are set in one transaction; nothing
 * is deleted or archived.
 *
 * ★ DEVELOPMENT ONLY, AND IT SAYS SO ITSELF. It refuses to run when
 * `NODE_ENV=production` (read through `AppConfig`, the one validated door).
 * Which production rows are Sales is a fact only an administrator knows; that
 * is why 0032 seeds nothing and why the production path is `PATCH
 * /departments/:id` — see ADR-0005. This file is the same decision for a
 * throwaway database, where guessing is fine because nothing is at stake.
 *
 * A CLI rather than a migration for the reason `create-user.cli.ts` gives:
 * a department is data, not schema, and a fixture baked into a migration
 * would ship to every deployment.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { AppConfig } from '../../../config/app.config';
import { DepartmentService } from '../application/department.service';
import type { Department, DepartmentFunction } from '../domain/department.entity';
import { DepartmentRepository } from '../persistence/department.repository';

export interface SeedUnit {
  slug: string;
  name: string;
  function: DepartmentFunction;
}

/** One unit per function. Slugs are the function names; names are the business's terms. */
export const DEV_DEPARTMENTS: readonly SeedUnit[] = [
  { slug: 'sales', name: 'Sales', function: 'sales' },
  { slug: 'accounting', name: 'Kế toán', function: 'accounting' },
  { slug: 'dispatch', name: 'Điều phối', function: 'dispatch' },
];

export type SeedAction = 'create' | 'update' | 'keep';

/**
 * What to do for one wanted unit given what the database already holds.
 * A fixture owns its rows: a unit found under the slug is brought back to the
 * name and function listed above, in one transaction, and otherwise left
 * alone. Pure, so the idempotency rule can be tested without a database.
 */
export function plan(existing: Department | null, wanted: SeedUnit): SeedAction {
  if (!existing) return 'create';
  if (existing.function !== wanted.function || existing.name !== wanted.name) return 'update';
  return 'keep';
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    if (app.get(AppConfig).isProduction) {
      console.error('dev:seed-departments refuses to run with NODE_ENV=production.');
      console.error('Production units are classified by an administrator: PATCH /departments/:id { "function": … }.');
      process.exitCode = 1;
      return;
    }

    const departments = app.get(DepartmentService);
    const repository = app.get(DepartmentRepository);

    for (const wanted of DEV_DEPARTMENTS) {
      const existing = await repository.findBySlug(wanted.slug);
      const action = plan(existing, wanted);

      let row: Department;
      if (existing === null) {
        row = await departments.create(wanted);
      } else if (action === 'update') {
        row = await departments.update(existing.id, { name: wanted.name, function: wanted.function });
      } else {
        row = existing;
      }

      console.log(`${action.padEnd(12)} ${row.slug.padEnd(11)} ${row.name.padEnd(12)} function=${row.function} status=${row.status} id=${row.id}`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only when this file IS the command being run — importing `plan` from the
// spec must not boot Nest.
if (require.main === module) {
  void main();
}
