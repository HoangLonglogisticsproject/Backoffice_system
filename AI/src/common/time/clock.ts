/**
 * Where "now" comes from.
 *
 * ★ A PORT, BECAUSE EVERY DETECTOR RULE IS A COMPARISON AGAINST NOW. "Two
 * hours before pickup" and "twelve hours since submission" cannot be tested
 * at a boundary if the rule reads the wall clock itself: the case would pass
 * or fail depending on when it ran. Injecting the clock makes
 * `pickup_at - now === exactly 2h` a case somebody can write.
 *
 * Deliberately one method. A scheduler needs timers too, but timers are the
 * scheduler's business and live there — putting them here would make every
 * detector's dependency drag a timer API it never calls.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

/** The real one. The only implementation in `src/` that reads the wall clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock that stands still, and moves when a test says so. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(instant: Date): void {
    this.current = instant;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
