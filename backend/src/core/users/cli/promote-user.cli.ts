/**
 * Move GLOBAL authority onto an account that can actually log in:
 *
 *   npm run user:promote -- --email admin@example.com
 *
 * ★ THE SITUATION THIS EXISTS FOR, because it is not an everyday one. Handing
 * the SuperAdmin role on is normally `PATCH /role-assignments/superadmin`,
 * performed by the holder. That path is unreachable when the holder CANNOT act
 * — the assignment sits on a user row with no identity, or on a disabled
 * account, or on one whose password is lost. `role.assign` is then held only by
 * somebody who can never call it, and the deployment has no administrator at
 * all while `uq_single_active_superadmin` refuses to let a second one be
 * created. `npm run user:create -- --superadmin` fails with a conflict, which
 * is correct and is also a dead end.
 *
 * So this is the recovery hatch, and it is deliberately OFFLINE for the same
 * reason `--superadmin` is: granting global authority over HTTP would need an
 * answer to "who may do this", and every answer is the hole the permission
 * model exists to avoid. Reaching the database is the authorisation.
 *
 * ⚠ IT REVOKES THE CURRENT HOLDER. There is at most one SuperAdmin, so
 * promoting somebody is always a transfer, and it is one transaction: revoke,
 * grant, cut the old holder's sessions. Both halves are recorded as
 * `'bootstrap'` with no actor — an audit reader must not find this written down
 * as though a person performed it.
 *
 * It does NOT touch passwords, does not create accounts, and refuses an email
 * it cannot find rather than creating one: an operator who mistypes here should
 * get an error, not a second empty administrator.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { IdentityRepository } from '../../identity/persistence/identity.repository';
import { LOCAL_PROVIDER } from '../domain/user.entity';

interface Args {
  email?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[i + 1];
  }
  return args;
}

async function main(): Promise<void> {
  const { email } = parseArgs(process.argv.slice(2));

  if (!email) {
    console.error('Usage: npm run user:promote -- --email <email>');
    console.error('Moves the SuperAdmin assignment onto that account, revoking the current one.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    // Addressed by LOGIN, not by user id, and that is the point of the command:
    // the row that must end up holding the role is the one somebody can sign in
    // as. A user id would happily accept the unreachable row all over again.
    const found = await app.get(IdentityRepository).findWithUserBySubject(LOCAL_PROVIDER, email);

    if (!found) {
      console.error(`No account signs in with ${email}.`);
      process.exitCode = 1;
      return;
    }

    // A disabled account is refused: promoting one produces an administrator
    // who is still refused at login, which is the situation being repaired.
    if (found.user.status !== 'active') {
      console.error(`${email} is ${found.user.status}. Re-enable it before promoting it.`);
      process.exitCode = 1;
      return;
    }

    await app.get(AuthorizationService).bootstrapTransferSuperAdmin(found.user.id);

    console.log(`${found.user.displayName} <${email}> is now the SUPERADMIN.`);
    console.log('Any existing session of the previous holder has been revoked.');
    // The permission list a browser is holding was read at login and is cached
    // for the life of the tab, so the new authority is invisible until then.
    console.log('Sign out and back in for the change to reach a browser already open.');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Guarded so the spec can import `parseArgs` without booting Nest.
if (require.main === module) {
  void main();
}
