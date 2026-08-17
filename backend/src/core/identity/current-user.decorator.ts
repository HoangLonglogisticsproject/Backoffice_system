import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { SessionUser } from './session.service';

/** Set by AuthGuard. Nothing else may write it. */
export const REQUEST_USER = 'boCurrentUser';

/**
 * `@CurrentUser() user: SessionUser` in a handler.
 *
 * Only ever populated behind `AuthGuard`, so a handler that asks for it and
 * forgets the guard gets `undefined` rather than a silently anonymous request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined =>
    context.switchToHttp().getRequest()[REQUEST_USER],
);
