import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangePasswordPage from './ChangePasswordPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const changePassword = vi.fn();
const signOut = vi.fn();
const navigate = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/auth', () => ({
  changePassword: (...args: unknown[]) => changePassword(...args),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

/**
 * FIRST LOGIN, AS THE SERVER DEFINES IT.
 *
 * The state is not a frontend flag. `GET /authorization/me` answers
 * 403 PASSWORD_CHANGE_REQUIRED while the credential is temporary, `useAuth`
 * turns that into `password-change-required`, and this is the only screen that
 * state can use — every other endpoint refuses it (§12).
 */
const firstLogin = () => ({
  state: {
    status: 'password-change-required' as const,
    identity: { id: 'u1', displayName: 'New Comer', status: 'active' as const },
  },
  loading: false,
  signOut,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ChangePasswordPage />
      </LanguageProvider>
    </MemoryRouter>,
  );

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const VALID = 'a brand new passphrase';

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    changePassword.mockReset().mockResolvedValue(undefined);
    signOut.mockReset().mockResolvedValue(undefined);
    navigate.mockReset();
    useSession.mockReset().mockReturnValue(firstLogin());
  });

  it('greets whoever the server says is signed in', () => {
    renderPage();

    expect(screen.getByText(/New Comer/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
  });

  it('sends the current and the new password, and nothing else', async () => {
    renderPage();

    type('Mật khẩu hiện tại', 'the temporary one');
    type('Mật khẩu mới', VALID);
    type('Nhập lại mật khẩu mới', VALID);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    // No user id: who is changing it comes from the session cookie.
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('the temporary one', VALID),
    );
    expect(changePassword.mock.calls[0]).toHaveLength(2);
  });

  it('signs out and returns to login, because every session just died', async () => {
    renderPage();

    type('Mật khẩu hiện tại', 'the temporary one');
    type('Mật khẩu mới', VALID);
    type('Nhập lại mật khẩu mới', VALID);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    // `POST /auth/password` revokes EVERY session including this one (§1), so
    // staying on the page would leave a cookie that can only be refused.
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  /**
   * ★ THE CONFIRMATION IS THE ONLY CHECK THE SERVER CANNOT MAKE.
   *
   * It never sees this field. A typo here becomes a permanent password nobody
   * knows, reached from a temporary credential that is destroyed in the same
   * call — there is no second chance to notice.
   *
   * Both boxes used to be bound to the same state and carried the same `id`, so
   * the third field was a second view of the second one and agreed with itself
   * whatever was typed.
   */
  describe('the confirmation field', () => {
    it('is a field of its own, not a second view of the new password', () => {
      renderPage();

      const next = screen.getByLabelText('Mật khẩu mới');
      const confirm = screen.getByLabelText('Nhập lại mật khẩu mới');
      expect(confirm).not.toBe(next);
      expect(confirm.id).not.toBe(next.id);

      type('Mật khẩu mới', VALID);
      expect(confirm).toHaveValue('');
    });

    it('refuses a mismatch without asking the server', async () => {
      renderPage();

      type('Mật khẩu hiện tại', 'the temporary one');
      type('Mật khẩu mới', VALID);
      type('Nhập lại mật khẩu mới', 'a different passphrase');
      fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Mật khẩu xác nhận không khớp.',
      );
      expect(changePassword).not.toHaveBeenCalled();
    });
  });

  it('refuses a new password under the permanent floor of 12', async () => {
    renderPage();

    type('Mật khẩu hiện tại', 'the temporary one');
    type('Mật khẩu mới', 'short');
    type('Nhập lại mật khẩu mới', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    // 12 is the PERMANENT policy — the one a person chooses for themselves. The
    // temporary credential they are replacing only had to clear 8.
    expect(await screen.findByRole('alert')).toHaveTextContent('ít nhất 12 ký tự');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('says the current password was wrong when the server says 401', async () => {
    const { ApiError } = await import('@/utils/errors');
    changePassword.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));
    renderPage();

    type('Mật khẩu hiện tại', 'the wrong one');
    type('Mật khẩu mới', VALID);
    type('Nhập lại mật khẩu mới', VALID);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng.');
    // Still signed in with the temporary credential — nothing changed.
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the field-level detail a 422 carries', async () => {
    const { ApiError } = await import('@/utils/errors');
    changePassword.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', {
        newPassword: 'Password must be at least 12 characters.',
      }),
    );
    renderPage();

    type('Mật khẩu hiện tại', 'the temporary one');
    type('Mật khẩu mới', VALID);
    type('Nhập lại mật khẩu mới', VALID);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password must be at least 12 characters.',
    );
  });

  /**
   * ⚠ A SECOND CALL CANNOT SUCCEED. The first one revoked the session it
   * authenticated with, so the retry answers 401 — and the person who pressed
   * Enter twice is told their password change failed after it worked.
   */
  it('ignores a second submit while the first is in flight', async () => {
    let release: () => void = () => {};
    changePassword.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    renderPage();

    type('Mật khẩu hiện tại', 'the temporary one');
    type('Mật khẩu mới', VALID);
    type('Nhập lại mật khẩu mới', VALID);

    const form = screen.getByRole('button', { name: 'Đổi mật khẩu' }).closest('form');
    // Submitting the FORM, not clicking: `disabled` never sees an Enter
    // keypress in a text field, which is how this actually happens.
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    release();
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
  });

  it('sends an anonymous visitor to login instead of rendering the form', () => {
    useSession.mockReturnValue({ state: { status: 'anonymous' }, loading: false, signOut });
    renderPage();

    expect(screen.queryByLabelText('Mật khẩu mới')).not.toBeInTheDocument();
  });

  it('renders nothing while the session is still resolving', () => {
    useSession.mockReturnValue({ state: null, loading: true, signOut });
    const { container } = renderPage();

    // "Not asked yet" is not "not signed in". Drawing the form here would ask
    // for a current password before knowing whether one is even needed.
    expect(container).toBeEmptyDOMElement();
  });
});
