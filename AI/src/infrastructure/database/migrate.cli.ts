/**
 * Standalone migration entry point: `npm run migrate`.
 *
 * A deploy step, not a boot step — same reasoning as the backend's. Run it as
 * `ai_migrator`; the runtime never holds that credential.
 *
 * Only the two variables a migration needs are validated here. The service
 * secrets are required to SERVE, not to migrate, and a migration step that
 * refused to run without a bearer secret would be a step that fails for a
 * reason unrelated to the schema.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MigrationRunner } from './migration-runner';
import { envSchema } from '../../config/env.schema';

loadEnv();

async function main(): Promise<void> {
  const parsed = envSchema.pick({ DATABASE_URL: true, DB_SCHEMA: true }).safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const pool = new Pool({ connectionString: parsed.data.DATABASE_URL });

  try {
    const runner = new MigrationRunner(pool, join(process.cwd(), 'migrations'), parsed.data.DB_SCHEMA);
    const { applied, skipped } = await runner.run();
    console.log(
      `Migrations (schema ${parsed.data.DB_SCHEMA}): ${applied.length} applied, ${skipped.length} already up to date.`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
