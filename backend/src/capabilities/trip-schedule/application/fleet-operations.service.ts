import { Injectable } from '@nestjs/common';
import { businessToday } from '../../../common/pagination/date-range-page-query.dto';
import { summaryOf, type FleetBoard } from '../domain/fleet-operations';
import { FleetOperationsRepository } from '../persistence/fleet-operations.repository';

/**
 * "Điều hành xe": every lorry's day, read in one statement.
 *
 * ★ TODAY IS THE SERVER'S BUSINESS DAY (Asia/Ho_Chi_Minh), and it matters even
 * when another day is asked for: only today carries the still-open work from
 * before it (`turnWorksOn`). Any other day shows what was scheduled on it or
 * ran on it, read as of now.
 */
@Injectable()
export class FleetOperationsService {
  constructor(private readonly fleet: FleetOperationsRepository) {}

  /** `serverNow` is the server's clock; tests pin it, nothing else passes one. */
  async board(input: { day?: string; withMoney: boolean }, serverNow = new Date()): Promise<FleetBoard> {
    const today = businessToday(serverNow);
    const businessDate = input.day ?? today;
    const vehicles = await this.fleet.days({ day: businessDate, today, withMoney: input.withMoney });
    return { businessDate, withMoney: input.withMoney, summary: summaryOf(vehicles), vehicles };
  }
}
