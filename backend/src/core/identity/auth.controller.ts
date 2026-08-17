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
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AppConfig } from '../../config/app.config';
import { AuthenticationService } from './authentication.service';
import { AuthGuard, sessionTokenFrom } from './auth.guard';
import { LoginInput, loginSchema } from './auth.dto';
import { CsrfGuard } from './csrf.guard';
import { CurrentUser } from './current-user.decorator';
import {
  SESSION_COOKIE,
  clearSessionCookieOptions,
  sessionCookieOptions,
} from './session.cookie';
import type { SessionUser } from './session.service';

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
}
