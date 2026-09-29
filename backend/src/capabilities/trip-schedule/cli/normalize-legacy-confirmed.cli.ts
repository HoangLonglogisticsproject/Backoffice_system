/**
 * Legacy `confirmed` trips → `finished`, through the canonical closure.
 *
 *   npm run trips:normalize-confirmed                                      # DRY RUN (default)
 *   npm run trips:normalize-confirmed -- --apply --by <email> --ids <id,…>  # writes those ids
 *
 * In a built image: `node dist/capabilities/trip-schedule/cli/normalize-legacy-confirmed.cli.js …`
 *
 * ★ READ-ONLY UNLESS TOLD EXACTLY WHAT TO WRITE. The dry run runs in a READ
 * ONLY transaction and classifies every stored `confirmed` trip (ELIGIBLE,
 * CONFLICT_PENDING_COMPLETION, SKIPPED_ARCHIVED). Applying needs `--apply`, the
 * email of the person doing it — who must hold `trip.complete.review` — and the
 * ids approved from the dry run; each is re-checked under its lock and left
 * untouched if it is no longer eligible.
 *
 * Not a migration, on purpose: migrations run on every deploy, and this waits
 * for a person to read the dry run first.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { can } from '../../../core/authorization/domain/authorization.context';
import { LegacyConfirmedNormalization } from '../application/legacy-confirmed-normalization';
import { parseNormalizationArgs } from './normalize-legacy-confirmed.args';

const print = (value: unknown): void => console.log(JSON.stringify(value, null, 2));

async function main(): Promise<void> {
  const args = parseNormalizationArgs(process.argv.slice(2));
  if (args.mode === 'invalid') {
    console.error(args.reason);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get<Database>(DATABASE);
    const normalization = app.get(LegacyConfirmedNormalization);

    if (args.mode === 'dry-run') {
      const plan = await db.transaction(async (tx) => {
        await tx.query('SET TRANSACTION READ ONLY');
        return normalization.plan(tx);
      });
      print({ mode: 'dry-run', ...plan });
      return;
    }

    const [author] = await db.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN identities i ON i.user_id = u.id
        WHERE i.subject = $1 AND u.status = 'active'`,
      [args.by],
    );
    const context = author ? await app.get(AuthorizationService).loadContext(author.id) : null;
    if (!author || !context || !can(context, 'trip.complete.review')) {
      console.error(`${args.by} is not an active account allowed to complete trips (trip.complete.review).`);
      process.exitCode = 1;
      return;
    }

    const results = await normalization.apply(args.ids, author.id);
    const summary: Record<string, number> = {};
    for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
    print({ mode: 'apply', by: args.by, summary, results });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
