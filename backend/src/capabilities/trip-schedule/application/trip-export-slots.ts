import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_CONCURRENT, ExportBusyError } from '../domain/trip-export';

/**
 * How many Excel exports this process is running — and the refusal of one more.
 *
 * ★ REFUSED, NEVER QUEUED. A queue would hold a request open while the edge
 * proxy's 15 s budget runs out, and turn a clear "try again" into a timeout.
 *
 * ★ THE CHECK AND THE COUNT SHARE ONE SYNCHRONOUS FRAME — no `await` between
 * reading `running` and raising it — so two requests arriving together are
 * handled one after the other in full (the same rule as `NotificationStream`).
 *
 * The caller holds its slot until its response is CLOSED — sent in full, or
 * the connection dropped — so the limit covers building and sending the file,
 * not only the read.
 */
@Injectable()
export class TripExportSlots {
  private running = 0;

  /** Takes a slot or throws `ExportBusyError`. Returns its release — idempotent. */
  acquire(): () => void {
    if (this.running >= EXPORT_MAX_CONCURRENT) throw new ExportBusyError();
    this.running += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
    };
  }

  /** For the specs and the logs: slots in use right now. */
  get inUse(): number {
    return this.running;
  }
}
