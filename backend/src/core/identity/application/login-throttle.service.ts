import { Injectable } from '@nestjs/common';

/**
 * Brute-force and CPU-exhaustion protection for the login endpoint.
 *
 * Two things are being defended, and they need different keys:
 *
 *   guessing   many attempts against ONE account  → key on the subject
 *   exhaustion many attempts from ONE source      → key on the IP
 *
 * The second matters more than it looks. Every login attempt costs ~100 ms of
 * memory-hard scrypt by design, including the failures — so without a limit,
 * spraying nonsense at this endpoint turns our own password hardening into a
 * denial-of-service amplifier. That is the specific attack this exists to stop.
 *
 * ⚠ IN-MEMORY, PER PROCESS. With more than one replica an attacker gets N
 * times the budget, and a restart clears the counters. Acceptable for the
 * single-instance deployment this foundation targets; anything larger needs a
 * shared store or an edge rate limiter, and that is a deliberate deferral, not
 * an oversight. Marked `production hardening required` in the report.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Per account. Low: a real person does not miss ten times in a row. */
const MAX_PER_SUBJECT = 10;

/** Per source. Higher, because an office shares one NAT address. */
const MAX_PER_IP = 30;

/** Keeps the map from growing without bound on a long-running process. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;

interface Attempts {
  count: number;
  /** Start of the current window; the whole entry resets when it lapses. */
  since: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds until the caller may try again. Only set when blocked. */
  retryAfterSeconds?: number;
}

@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, Attempts>();
  private lastSweep = Date.now();

  /**
   * Called BEFORE any database work or hashing, so a blocked caller costs
   * nothing. Checking afterwards would defeat the point.
   */
  check(input: { ip: string; subject: string }, now: number = Date.now()): ThrottleDecision {
    this.sweep(now);

    for (const [key, limit] of this.keysFor(input)) {
      const entry = this.attempts.get(key);
      if (!entry || now - entry.since >= WINDOW_MS) continue;

      if (entry.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((entry.since + WINDOW_MS - now) / 1000),
        };
      }
    }

    return { allowed: true };
  }

  /** Records a failure against both keys. */
  recordFailure(input: { ip: string; subject: string }, now: number = Date.now()): void {
    for (const [key] of this.keysFor(input)) {
      const entry = this.attempts.get(key);

      if (!entry || now - entry.since >= WINDOW_MS) {
        this.attempts.set(key, { count: 1, since: now });
      } else {
        entry.count += 1;
      }
    }
  }

  /**
   * Clears the SUBJECT counter on success, but deliberately not the IP one.
   *
   * Otherwise an attacker who owns one valid account could reset their own IP
   * budget between bursts and spray the rest for free.
   */
  recordSuccess(input: { ip: string; subject: string }): void {
    this.attempts.delete(subjectKey(input.subject));
  }

  private keysFor(input: { ip: string; subject: string }): Array<[string, number]> {
    return [
      [subjectKey(input.subject), MAX_PER_SUBJECT],
      [`ip:${input.ip}`, MAX_PER_IP],
    ];
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;

    for (const [key, entry] of this.attempts) {
      if (now - entry.since >= WINDOW_MS) this.attempts.delete(key);
    }
  }
}

const subjectKey = (subject: string): string => `subject:${subject.trim().toLowerCase()}`;
