import { beforeEach, describe, expect, it, vi } from 'vitest';

const success = vi.fn();
const failure = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => failure(...args),
  },
}));

const { notifyApiError, notifyError, notifySuccess, setToastLanguage } = await import('./toast');
const { ApiError } = await import('./errors');

/**
 * The receipt every mutation hook raises, and the one thing that can go wrong
 * with it: saying it in the language nobody on this screen reads.
 */
describe('notifySuccess', () => {
  beforeEach(() => {
    success.mockClear();
    failure.mockClear();
    setToastLanguage('vi');
  });

  it('speaks the language the interface is set to', () => {
    notifySuccess('toastSignedIn');
    expect(success).toHaveBeenCalledWith('Đăng nhập thành công', { duration: 4000 });

    setToastLanguage('en');
    notifySuccess('toastSignedIn');
    expect(success).toHaveBeenLastCalledWith('Signed in', { duration: 4000 });
  });

  /**
   * ★ THE DEFAULT IS VIETNAMESE, WITHOUT A PROVIDER. Toasts are raised from
   * mutation callbacks, which run whether or not `LanguageProvider` ever pushed
   * a choice in — a hook mounted in a test, or a write that lands during the
   * first render. An unset language must not mean an English toast on a
   * Vietnamese screen.
   */
  it('falls back to Vietnamese when nothing has chosen', async () => {
    // A FRESH module, so this reads the initial value rather than whatever the
    // test above left behind.
    vi.resetModules();
    const fresh = await import('./toast');

    fresh.notifySuccess('toastTripStatusUpdated');
    expect(success).toHaveBeenCalledWith('Đã cập nhật trạng thái chuyến', { duration: 4000 });
  });

  it('passes a description through only when there is one', () => {
    notifySuccess('toastDriverAssigned', { description: 'Nguyễn Văn A' });
    expect(success).toHaveBeenCalledWith('Đã phân công tài xế', {
      duration: 4000,
      description: 'Nguyễn Văn A',
    });

    success.mockClear();
    notifySuccess('toastDriverAssigned');
    expect(success).toHaveBeenCalledWith('Đã phân công tài xế', { duration: 4000 });
  });

  /**
   * ★ THE BUTTON'S LABEL IS TRANSLATED, THE CALLBACK IS NOT TOUCHED. And a toast
   * carrying a button stays longer than one that only says something — it has to
   * be noticed and clicked, not just read.
   */
  it('translates the action label and lengthens the toast that carries it', () => {
    const onClick = vi.fn();
    notifySuccess('toastTripStatusUpdated', {
      description: 'Chờ xe → Cần xác nhận',
      action: { labelKey: 'undo', onClick },
    });

    expect(success).toHaveBeenCalledWith('Đã cập nhật trạng thái chuyến', {
      duration: 10_000,
      description: 'Chờ xe → Cần xác nhận',
      action: { label: 'Hoàn tác', onClick },
    });
  });
});

/**
 * The failure side, where the interesting decision is WHOSE WORDS get shown.
 */
describe('notifyError', () => {
  beforeEach(() => {
    failure.mockClear();
    setToastLanguage('vi');
  });

  it('translates a mapped failure and leaves it up longer than a receipt', () => {
    notifyError('assignConflict');
    expect(failure).toHaveBeenCalledWith(expect.any(String), { duration: 8000 });
    expect(failure.mock.calls[0][0]).not.toBe('assignConflict'); // resolved, not the raw key
  });
});

describe('notifyApiError', () => {
  beforeEach(() => {
    failure.mockClear();
    setToastLanguage('vi');
  });

  /**
   * ★ THE SERVER KNOWS THINGS THIS CLIENT CANNOT RECONSTRUCT — that the trip was
   * archived, that the account stopped being a driver — so when it has spoken,
   * its sentence is the one shown.
   */
  it('shows what the server said', () => {
    notifyApiError(new ApiError(409, 'CONFLICT', 'Chuyến này vừa được đóng.'), 'saveFailed');
    expect(failure).toHaveBeenCalledWith('Chuyến này vừa được đóng.', { duration: 8000 });
  });

  /**
   * ⚠ STATUS 0 IS NOT THE SERVER TALKING. `client.ts` uses it for a request that
   * never arrived, and its message is English scaffolding no user should read.
   */
  it('falls back to the translated sentence when the request never landed', () => {
    notifyApiError(new ApiError(0, undefined, 'Unexpected error.'), 'saveFailed');
    expect(failure).toHaveBeenCalledWith('Không lưu được.', { duration: 8000 });
  });

  it('falls back for anything that is not an API error at all', () => {
    notifyApiError(new TypeError('x.map is not a function'), 'saveFailed');
    expect(failure).toHaveBeenCalledWith('Không lưu được.', { duration: 8000 });
  });
});
