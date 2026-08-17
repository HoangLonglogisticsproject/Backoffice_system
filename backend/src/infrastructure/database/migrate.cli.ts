/**
 * Standalone migration entry point: `npm run migrate`.
 *
 * Deliberately separate from application boot. Running migrations as a side
 * effect of starting the server means every replica races to migrate on every
 * deploy, and a failed migration takes the service down with it. Migrating is
 * a deploy step, not a boot step.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MigrationRunner } from './migration-runner';
import { envSchema } from '../../config/env.schema';

loadEnv();

async function main(): Promise<void> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const pool = new Pool({ connectionString: parsed.data.DATABASE_URL });

  try {
    const runner = new MigrationRunner(pool, join(process.cwd(), 'migrations'));
    const { applied, skipped } = await runner.run();
    console.log(`Migrations: ${applied.length} applied, ${skipped.length} already up to date.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
