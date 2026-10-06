import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { NotificationService } from '../application/notification.service';
import type { Notification } from '../domain/notification';

/**
 * A person's own notifications, and nothing else.
 *
 * ★ EVERY ROUTE IS SCOPED BY THE SESSION, AND NONE TAKES A USER. There is no
 * `?userId=`, no `:userId`, no body field naming a recipient — the only person
 * whose rows these routes can touch is the one the cookie resolved to. A
 * caller holding another person's notification id is answered as if the id
 * did not exist.
 *
 * ★ `AuthGuard` ALONE, AND NO PERMISSION. No tier in the permission model can
 * say "your own rows"; the query says it. These routes expose nothing
 * operational — a type, a trip id, a day, a reason — so the provisioning gate
 * the other guards apply is not repeated here: a half-provisioned account
 * learns that it has been assigned something, and then still has to change its
 * password before it can open it.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @UseGuards(AuthGuard)
  async listMine(
    @CurrentUser() actor: SessionUser,
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    return this.notifications.listMine(actor.id);
  }

  /*
   * ⚠ THE LIVE CHANNEL IS NOT HERE ANY MORE (CEO 2026-10-06). `GET
   * /notifications/stream` was a server-sent-events route on this controller
   * until the realtime transport moved to WebSocket; it now lives in
   * `NotificationGateway`, which authenticates its own handshake. What stays on
   * this controller is what it always was: a person's own rows, over HTTP.
   *
   * This note is not nostalgia — a client built against the old route gets a
   * 404 with no explanation, and this is where somebody will look for one.
   */

  @Post(':notificationId/read')
  @UseGuards(AuthGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('notificationId', UuidParam) notificationId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<Notification> {
    return this.notifications.markRead(actor.id, notificationId);
  }
}
