/**
 * Bootstrap the first user:
 *
 *   npm run user:create -- --email a@b.c --name "A B" --superadmin
 *
 * WITHOUT `--superadmin` the account is created with no role and no membership,
 * which by the permission model can do NOTHING — every permission is refused.
 * That is the correct shape for a recovery account made ahead of time, and the
 * wrong shape for the first account of a fresh deployment: creating a
 * department, creating a user and approving an invitation all require GLOBAL
 * authority, so a deployment whose only account lacks it cannot be started at
 * all. `--superadmin` is the path out, and the only one — there is deliberately
 * no HTTP endpoint that grants GLOBAL to anybody.
 *
 * A CLI rather than an endpoint, and rather than a seed in a migration:
 *
 *   not an endpoint  creating users over HTTP needs an answer to "who may do
 *                    this", and that is authorization — a later phase. An open
 *                    endpoint now would be the hole this phase exists to avoid.
 *
 *   not a migration  a user is data, not schema. Seeding one bakes a known
 *                    account into every deployment of this foundation, which
 *                    is how a shared default password ends up in production.
 *
 * The password is read from a prompt or the BOOTSTRAP_PASSWORD variable, never
 * from an argument: argv is visible in `ps` and lands in shell history.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { UserService } from '../application/user.service';
import { SECRET_READER, type SecretReader } from '../../../common/types/secret-reader.port';

interface Args {
  email?: string;
  name?: string;
  superadmin?: boolean;
}


export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[i + 1];
    if (argv[i] === '--name') args.name = argv[i + 1];
    // A switch, not a value: `--superadmin true` and `--superadmin false` would
    // both read as "yes" to anyone skimming, and one of them would be wrong.
    if (argv[i] === '--superadmin') args.superadmin = true;
  }
  return args;
}

/**
 * The secret comes from the environment or from the reader, never from argv:
 * a command line is visible in `ps` and lands in shell history.
 *
 * HOW it is read is the adapter's business — this file asks the port and does
 * not know whether a terminal, a pipe or something else answered.
 */
export async function readPassword(
  reader: SecretReader,
  fromEnv: string | undefined,
): Promise<string> {
  if (fromEnv) return fromEnv;

  return reader.readSecret('Password: ');
}

async function main(): Promise<void> {
  const { email, name, superadmin } = parseArgs(process.argv.slice(2));

  if (!email || !name) {
    console.error(
      'Usage: npm run user:create -- --email <email> --name "<display name>" [--superadmin]',
    );
    console.error('Password is read from BOOTSTRAP_PASSWORD, or prompted for.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  const password = await readPassword(
    app.get<SecretReader>(SECRET_READER),
    process.env['BOOTSTRAP_PASSWORD'],
  );
  if (password.length < 12) {
    // Not a policy engine — one floor, applied where the first account is made.
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  try {
    const user = await app.get(UserService).createWithPassword({
      displayName: name,
      subject: email,
      password,
    });
    // AFTER the account exists, and in its own transaction: the grant is a
    // separate decision with its own uniqueness rule, and a deployment that
    // already has a SuperAdmin must fail HERE, with the account intact, rather
    // than roll the account back and leave the operator guessing which half
    // went wrong.
    if (superadmin) {
      await app.get(AuthorizationService).bootstrapSuperAdmin(user.id);
    }

    console.log(
      `Created user ${user.id} (${user.displayName})${superadmin ? ' as SUPERADMIN' : ''}.`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only when this file IS the command being run. Without the guard, importing it
// — which the spec for the reader above has to do — would boot Nest and try to
// create a user as a side effect of loading a module.
if (require.main === module) {
  void main();
}
