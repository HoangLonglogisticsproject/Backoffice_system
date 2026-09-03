import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Post,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
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

  /**
   * The live channel: server-sent events, on the session cookie.
   *
   * ★ DECLARED BEFORE `:notificationId`, and the order is load-bearing — Nest
   * matches in declaration order and `UuidParam` would otherwise refuse the
   * word "stream" as an id.
   *
   * `X-Accel-Buffering: no` tells nginx to pass each event through as it is
   * written rather than holding the response until it ends, which for a stream
   * is never. Nest sends `Cache-Control: no-cache` itself.
   */
  @Sse('stream')
  @UseGuards(AuthGuard)
  stream(
    @CurrentUser() actor: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Observable<MessageEvent> {
    response.setHeader('X-Accel-Buffering', 'no');
    return this.notifications.streamFor(actor.id);
  }

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
