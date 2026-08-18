import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { AppConfig } from '../../../config/app.config';
import { AuthenticationService } from '../application/authentication.service';
import { AuthGuard, sessionTokenFrom } from './auth.guard';
import { ChangePasswordInput, changePasswordSchema, LoginInput, loginSchema } from './auth.dto';
import { CsrfGuard } from './csrf.guard';
import { CurrentUser } from './current-user.decorator';
import {
  SESSION_COOKIE,
  clearSessionCookieOptions,
  sessionCookieOptions,
} from './session.cookie';
import type { SessionUser } from '../application/session.service';

/**
 * Three endpoints, which is all identity needs.
 *
 * The session token is never in a response body. It leaves only as an HttpOnly
 * cookie, so no client is able — or tempted — to put it in `localStorage`,
 * where any XSS could read it.
 *
 * There is deliberately no user CRUD here: creating users over HTTP requires
 * deciding who is allowed to, and authorization is a later phase. Until then
 * the bootstrap CLI is the only way to create one.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthenticationService,
    private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: SessionUser; expiresAt: string }> {
    const { session, user } = await this.auth.login(body.subject, body.password, ip);

    response.cookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions({ expiresAt: session.expiresAt, secure: this.config.isProduction }),
    );

    // Expiry is returned so a client can warn before it lapses. The token is
    // not, and must not be.
    return { user, expiresAt: session.expiresAt.toISOString() };
  }

  @Post('logout')
  @UseGuards(CsrfGuard, AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = sessionTokenFrom(request);

    // Server side FIRST. Clearing the cookie alone would leave a token that
    // still works for anyone who captured it.
    if (token) await this.auth.logout(token);

    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(this.config.isProduction));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  /**
   * ChangePassword — and the only route a temporary credential may use besides
   * `me` and `logout`.
   *
   * NO PERMISSION IS DECLARED, deliberately. `PermissionGuard` refuses every
   * caller whose credential is still temporary, so a route behind it would lock
   * exactly the people who need this one. Guarding with `AuthGuard` alone is
   * what makes the change-password screen reachable from the state that
   * requires it.
   *
   * Every session dies here, including this one — see the service. The client
   * must log in again with the new password.
   */
  @Post('password')
  @UseGuards(CsrfGuard, AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword({
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    // The cookie now names a revoked session. Clearing it stops the browser
    // from presenting a token that can only ever be refused.
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(this.config.isProduction));
  }
}
