/**
 * PORT for reading a secret from whatever the process is attached to.
 *
 * Lives in `common/types` for the same reason `database.port.ts` does: it is a
 * contract with no implementation and no owner. A CLI in `core/` depends on it,
 * `infrastructure/tty` satisfies it, and neither has to know the other exists.
 *
 * This port is what lets the terminal handling — raw mode, ANSI escape
 * sequences, control bytes — live in `infrastructure/` where technical concerns
 * belong, WITHOUT `core/` importing infrastructure. That import is forbidden by
 * `B2`, and the rule is not bureaucracy: a core module that reaches into
 * infrastructure cannot be reused by a deployment that reads its secrets from
 * somewhere else.
 *
 * Deliberately says nothing about terminals. "Read a secret without revealing
 * it" is the whole contract; whether that means raw mode, a piped stdin or a
 * secrets manager is the adapter's business.
 */
export interface SecretReader {
  /**
   * Prompts and returns what was typed, without echoing it.
   *
   * Rejects if the caller cancels. Never returns a partially typed value.
   */
  readSecret(prompt: string): Promise<string>;
}

export const SECRET_READER = Symbol('SECRET_READER');
