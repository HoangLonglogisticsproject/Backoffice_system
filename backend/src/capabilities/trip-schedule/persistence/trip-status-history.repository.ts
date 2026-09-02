import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { TripStatus } from '../domain/trip-schedule';
import type { TripStatusChange } from '../domain/trip-status-history';

/**
 * Every move a trip has made along the board, and who moved it.
 *
 * ★ WHY THIS TABLE EXISTS AT ALL. 0011 gave `trip_schedules` a status and no
 * memory of it. A trip that reads `needs_confirmation` this morning and
 * `awaiting_vehicle` this afternoon carries no trace of the change, who made it,
 * or whether it had ever been marked done — which is the one question that
 * matters once "done" becomes permanent.
 *
 * ★ INSERT-ONLY, AND THE DATABASE AGREES. There is no update method and no
 * delete method here, and 0017 puts a trigger behind that so the absence is a
 * guarantee rather than a habit. A history that can be rewritten answers
 * nothing.
 *
 * ⚠ EVERY WRITE TAKES AN `executor`, WITH NO DEFAULT. That is deliberate and it
 * is the whole point of this class: recording a transition outside the
 * transaction that performed it would allow the status to move and the history
 * to be lost, which is exactly the failure this table was added to prevent. A
 * caller has to have a transaction in hand before it can record anything.
 */
@Injectable()
export class TripStatusHistoryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records one transition.
   *
   * `from` is `null` only for the row written when a trip is created, which has
   * no previous value. Anything else is a real move and names both ends.
   */
  async record(
    input: {
      tripId: string;
      from: TripStatus | null;
      to: TripStatus;
      reason: string | null;
      changedBy: string;
    },
    executor: DatabaseQuery,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO trip_status_history (trip_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.tripId, input.from, input.to, input.reason, input.changedBy],
    );
  }

  /**
   * A trip's board history, newest first.
   *
   * Not paginated, for the reason ADR-0002 §4 gives: one trip's transitions are
   * bounded small — a handful over a day or two.
   */
  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripStatusChange[]> {
    const rows = await executor.query<{
      id: string;
      from_status: TripStatus | null;
      to_status: TripStatus;
      reason: string | null;
      changed_by: string;
      changed_by_display_name: string;
      changed_at: Date;
    }>(
      `SELECT h.id, h.from_status, h.to_status, h.reason, h.changed_by, h.changed_at,
              u.display_name AS changed_by_display_name
         FROM trip_status_history h
         JOIN users u ON u.id = h.changed_by
        WHERE h.trip_id = $1
        ORDER BY h.changed_at DESC, h.id DESC`,
      [tripId],
    );

    return rows.map((row) => ({
      id: row.id,
      from: row.from_status,
      to: row.to_status,
      reason: row.reason,
      changedBy: row.changed_by,
      changedByUser: { id: row.changed_by, displayName: row.changed_by_display_name },
      changedAt: row.changed_at,
    }));
  }
}
