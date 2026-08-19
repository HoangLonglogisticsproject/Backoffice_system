import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/http/apiError';
import { loginErrorMessage } from './loginErrorMessage';

/**
 * Pins the sign-in error mapping, character for character.
 *
 * This exists because the mapping was extracted out of a `catch` block to bring
 * the submit handler's cognitive complexity down. A refactor of branching logic
 * that nobody checks is a refactor that quietly changes a sentence somebody
 * reads at the worst moment — so every string below is the one that shipped
 * before the extraction.
 */
describe('loginErrorMessage', () => {
  it('401 says nothing about whether the account exists', () => {
    expect(loginErrorMessage(new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials.'))).toBe(
      'Email hoặc mật khẩu không đúng.',
    );
  });

  it('429 with Retry-After rounds UP to whole minutes', () => {
    // 898 s → 14.96 min → "15 phút". Rounding down would tell somebody to come
    // back before the throttle has actually released.
    expect(
      loginErrorMessage(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many.', undefined, 898)),
    ).toBe('Bạn đã thử quá nhiều lần. Vui lòng đợi 15 phút.');

    expect(
      loginErrorMessage(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many.', undefined, 61)),
    ).toBe('Bạn đã thử quá nhiều lần. Vui lòng đợi 2 phút.');
  });

  it('429 without Retry-After falls back to the vaguer sentence', () => {
    expect(loginErrorMessage(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many.'))).toBe(
      'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.',
    );
  });

  it('422 asks for valid input', () => {
    expect(
      loginErrorMessage(new ApiError(422, 'VALIDATION_FAILED', 'Request failed validation.')),
    ).toBe('Vui lòng nhập email và mật khẩu hợp lệ.');
  });

  it('status 0 distinguishes "never reached the server" from a refusal', () => {
    expect(loginErrorMessage(new ApiError(0, undefined, 'Request failed.'))).toBe(
      'Không kết nối được tới máy chủ.',
    );
  });

  it('any other ApiError shows the server`s own message', () => {
    expect(loginErrorMessage(new ApiError(500, undefined, 'Internal server error'))).toBe(
      'Internal server error',
    );
    expect(loginErrorMessage(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.'))).toBe(
      'You are not allowed to do that.',
    );
  });

  it('a non-ApiError never passed through transport, so it is a generic fault', () => {
    expect(loginErrorMessage(new Error('boom'))).toBe('Đã xảy ra lỗi không mong muốn.');
    expect(loginErrorMessage('a string')).toBe('Đã xảy ra lỗi không mong muốn.');
    expect(loginErrorMessage(undefined)).toBe('Đã xảy ra lỗi không mong muốn.');
  });

  it('branches on status, never on message text (§11)', () => {
    // Same status, wildly different wording: the decision must not move.
    const a = new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials.');
    const b = new ApiError(401, 'UNAUTHORIZED', 'completely different wording');

    expect(loginErrorMessage(a)).toBe(loginErrorMessage(b));
  });
});
