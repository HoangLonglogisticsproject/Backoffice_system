import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/domain.error';
import type { BookingExport } from '../domain/booking-export';
import { BookingExportRepository } from '../persistence/booking-export.repository';

/**
 * "Tải booking PNG" — the data behind it. Read-only: no write, no audit row,
 * no file kept; the image itself is drawn in the browser.
 *
 * ★ IT TAKES NO AUTHORIZATION, ON PURPOSE. The document is the same for every
 * caller allowed to read the trip, so there is nothing for a role to change.
 */
@Injectable()
export class BookingExportService {
  constructor(private readonly bookings: BookingExportRepository) {}

  /** Same 404 as `GET /trip-schedules/:id` — unknown and archived alike. */
  async find(tripId: string): Promise<BookingExport> {
    const booking = await this.bookings.find(tripId);
    if (!booking) throw new NotFoundError('Trip not found.');
    return booking;
  }
}
