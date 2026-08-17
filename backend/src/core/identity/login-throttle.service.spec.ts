import { LoginThrottleService } from './login-throttle.service';

/**
 * The attack this defends against is not only password guessing.
 *
 * Every login attempt costs ~100 ms of memory-hard scrypt BY DESIGN, failures
 * included — so without a limit, spraying nonsense turns our own password
 * hardening into a CPU and memory exhaustion amplifier. The per-IP budget is
 * what stops that, and it matters even for subjects that do not exist.
 */
describe('LoginThrottleService', () => {
  const WINDOW = 15 * 60 * 1000;
  let throttle: LoginThrottleService;

  beforeEach(() => {
    throttle = new LoginThrottleService();
  });

  const attempt = { ip: '203.0.113.9', subject: 'a@example.com' };

  it('allows a first attempt', () => {
    expect(throttle.check(attempt).allowed).toBe(true);
  });

  it('blocks one account after repeated failures', () => {
    for (let i = 0; i < 10; i += 1) throttle.recordFailure(attempt);

    const decision = throttle.check(attempt);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks one source spraying MANY different subjects', () => {
    // The exhaustion case: every subject is different, so a per-account limit
    // alone would never trigger and each attempt would still cost 100 ms.
    for (let i = 0; i < 30; i += 1) {
      throttle.recordFailure({ ip: attempt.ip, subject: `victim-${i}@example.com` });
    }

    expect(throttle.check({ ip: attempt.ip, subject: 'fresh@example.com' }).allowed).toBe(false);
  });

  it('does not punish a different source for someone else’s failures', () => {
    for (let i = 0; i < 30; i += 1) {
      throttle.recordFailure({ ip: '198.51.100.1', subject: `x-${i}@example.com` });
    }

    expect(throttle.check({ ip: '203.0.113.9', subject: 'someone@example.com' }).allowed).toBe(true);
  });

  it('clears the account counter on a successful login', () => {
    for (let i = 0; i < 9; i += 1) throttle.recordFailure(attempt);
    throttle.recordSuccess(attempt);

    for (let i = 0; i < 9; i += 1) throttle.recordFailure(attempt);
    expect(throttle.check(attempt).allowed).toBe(true);
  });

  it('does NOT clear the source counter on success', () => {
    // Otherwise an attacker holding one valid account could reset their own IP
    // budget between bursts and spray the rest for free.
    for (let i = 0; i < 30; i += 1) {
      throttle.recordFailure({ ip: attempt.ip, subject: `v-${i}@example.com` });
    }
    throttle.recordSuccess(attempt);

    expect(throttle.check({ ip: attempt.ip, subject: 'other@example.com' }).allowed).toBe(false);
  });

  it('lets the window lapse', () => {
    const start = Date.now();
    for (let i = 0; i < 10; i += 1) throttle.recordFailure(attempt, start);

    expect(throttle.check(attempt, start + WINDOW - 1).allowed).toBe(false);
    expect(throttle.check(attempt, start + WINDOW + 1).allowed).toBe(true);
  });

  it('treats a subject case-insensitively, so casing does not buy a fresh budget', () => {
    for (let i = 0; i < 10; i += 1) {
      throttle.recordFailure({ ip: attempt.ip, subject: 'A@Example.COM' });
    }

    expect(throttle.check({ ip: attempt.ip, subject: 'a@example.com' }).allowed).toBe(false);
  });

  it('does not grow without bound on a long-running process', () => {
    const start = Date.now();
    for (let i = 0; i < 500; i += 1) {
      throttle.recordFailure({ ip: `10.0.0.${i % 255}`, subject: `u${i}@example.com` }, start);
    }

    // A sweep runs on the next check past the interval; lapsed entries go.
    throttle.check(attempt, start + WINDOW + 1);

    const size = (throttle as unknown as { attempts: Map<string, unknown> }).attempts.size;
    expect(size).toBeLessThan(10);
  });
});
