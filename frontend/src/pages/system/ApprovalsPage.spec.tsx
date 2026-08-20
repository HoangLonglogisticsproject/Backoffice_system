import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApprovalsPage from './ApprovalsPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const fetchPendingMembershipRequests = vi.fn();
const approveMembershipRequest = vi.fn();
const rejectMembershipRequest = vi.fn();
const fetchPendingAccountInvitations = vi.fn();
const approveAccountInvitation = vi.fn();
const rejectAccountInvitation = vi.fn();

vi.mock('@/lib/api/membership-request.repository', () => ({
  fetchPendingMembershipRequests: (...a: unknown[]) => fetchPendingMembershipRequests(...a),
  approveMembershipRequest: (...a: unknown[]) => approveMembershipRequest(...a),
  rejectMembershipRequest: (...a: unknown[]) => rejectMembershipRequest(...a),
}));
vi.mock('@/lib/api/account-invitation.repository', () => ({
  fetchPendingAccountInvitations: (...a: unknown[]) => fetchPendingAccountInvitations(...a),
  approveAccountInvitation: (...a: unknown[]) => approveAccountInvitation(...a),
  rejectAccountInvitation: (...a: unknown[]) => rejectAccountInvitation(...a),
}));
vi.mock('@/lib/session/SessionProvider', () => ({
  useSession: () => ({ state: { status: 'ready' }, loading: false }),
}));

const SECRET = 'Xy7-generated_by_the_server-9Za';

const REQUEST = {
  id: 'f6d42eed-0000-4000-8000-000000000000',
  departmentId: 'dep',
  targetDepartmentId: null,
  targetUserId: 'u1',
  targetUser: { id: 'u1', displayName: 'Moved Person' },
  action: 'REMOVE_MEMBER',
  status: 'pending',
  requestedBy: 'u2',
  requestedByUser: { id: 'u2', displayName: 'Head Person' },
  requestedAt: '2026-08-18T08:34:23.633Z',
  decidedBy: null,
  decidedAt: null,
  reason: null,
};

const INVITATION = {
  id: 'a1b2c3d4-0000-4000-8000-000000000000',
  departmentId: 'dep',
  email: 'newcomer@hoanglong.test',
  status: 'pending',
  requestedBy: 'u2',
  requestedByUser: { id: 'u2', displayName: 'Head Person' },
  requestedAt: '2026-08-18T08:34:23.633Z',
  decidedBy: null,
  decidedAt: null,
  reason: null,
  createdUserId: null,
};

const page = <T,>(items: T[]) => ({ items, nextCursor: null, hasMore: false });

/** Every key AND value the store actually holds, via the Storage API. */
const storageEntries = (store: Storage): string[] => {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === null) continue;
    out.push(key, store.getItem(key) ?? '');
  }
  return out;
};

const lastConfirmButton = (): HTMLElement => {
  const buttons = screen.getAllByRole('button', { name: /^duyệt$|^approve$/i });
  // The row button and the dialog button share a label; the dialog is last.
  return buttons[buttons.length - 1];
};

const renderPage = () =>
  render(
    <LanguageProvider>
      <ApprovalsPage />
    </LanguageProvider>,
  );

const openInvitations = async () => {
  fireEvent.click(screen.getByRole('button', { name: /lời mời|invitation/i }));
  await screen.findByText('newcomer@hoanglong.test');
};

describe('ApprovalsPage', () => {
  beforeEach(() => {
    fetchPendingMembershipRequests.mockReset().mockResolvedValue(page([REQUEST]));
    fetchPendingAccountInvitations.mockReset().mockResolvedValue(page([INVITATION]));
    approveMembershipRequest.mockReset().mockResolvedValue({});
    rejectMembershipRequest.mockReset().mockResolvedValue({});
    approveAccountInvitation.mockReset().mockResolvedValue({
      invitation: { ...INVITATION, status: 'approved' },
      username: 'newcomer',
      temporaryPassword: SECRET,
    });
    rejectAccountInvitation.mockReset().mockResolvedValue({});
  });

  it('shows people by name, never by UUID', async () => {
    renderPage();

    expect(await screen.findByText('Moved Person')).toBeInTheDocument();
    expect(screen.getByText('Head Person')).toBeInTheDocument();
    expect(screen.queryByText(REQUEST.targetUserId)).not.toBeInTheDocument();
  });

  it('confirms before deciding, and sends no actor', async () => {
    renderPage();
    await screen.findByText('Moved Person');

    fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
    // A decision is not one misplaced click away.
    expect(screen.getByText(/xác nhận duyệt|confirm approval/i)).toBeInTheDocument();

    fireEvent.click(lastConfirmButton());

    await waitFor(() => expect(approveMembershipRequest).toHaveBeenCalledWith(REQUEST.id));
    // Who decided comes from the cookie. Nothing here names an actor.
    expect(approveMembershipRequest.mock.calls[0]).toHaveLength(1);
  });

  describe('the one-time temporary credential', () => {
    it('NEVER offers a password field on the approval form', async () => {
      renderPage();
      await openInvitations();

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));

      // ★ The server generates the credential. A field here would imply the
      // approver sets it, and whatever they typed would be discarded.
      expect(screen.queryByLabelText(/mật khẩu|password/i)).not.toBeInTheDocument();
      expect(document.querySelector('input[type="password"]')).toBeNull();
    });

    it('reveals what the server generated, exactly once', async () => {
      renderPage();
      await openInvitations();

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());

      expect(await screen.findByText(SECRET)).toBeInTheDocument();
      expect(screen.getByText('newcomer')).toBeInTheDocument();
      // And it says plainly that this is the only showing.
      expect(screen.getByText(/không có cách nào đọc lại|nothing can read it back/i)).toBeInTheDocument();
      // The approver sent no password of their own.
      expect(approveAccountInvitation).toHaveBeenCalledWith(INVITATION.id);
    });

    it('CANNOT be revealed a second time once dismissed', async () => {
      renderPage();
      await openInvitations();

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());
      await screen.findByText(SECRET);

      fireEvent.click(screen.getByRole('button', { name: /xong|done/i }));

      // Gone from the document, and there is no control anywhere that brings
      // it back — the value exists nowhere else, on either side of the wire.
      await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /xem lại|reveal|show again/i })).toBeNull();
      expect(document.body.innerHTML).not.toContain(SECRET);
    });

    it('does not persist the credential anywhere the browser keeps things', async () => {
      renderPage();
      await openInvitations();

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());
      await screen.findByText(SECRET);

      // Enumerated, not stringified: `JSON.stringify(localStorage)` serialises
      // own enumerable properties, which is NOT how the Storage API exposes
      // entries — it can return `{}` for a populated store and pass whatever
      // was written.
      expect(storageEntries(localStorage)).not.toContain(SECRET);
      expect(storageEntries(sessionStorage)).not.toContain(SECRET);
      expect(window.location.href).not.toContain(SECRET);
      expect(document.title).not.toContain(SECRET);
    });
  });

  describe('copying the credential', () => {
    const revealSecret = async () => {
      renderPage();
      await openInvitations();
      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());
      await screen.findByText(SECRET);
    };

    const setClipboard = (value: unknown) =>
      Object.defineProperty(navigator, 'clipboard', {
        value,
        configurable: true,
        writable: true,
      });

    it('says Copied only after the write actually resolves', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      await revealSecret();

      fireEvent.click(screen.getByRole('button', { name: /sao chép|^copy$/i }));

      expect(await screen.findByRole('button', { name: /đã sao chép|copied/i })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(SECRET);
    });

    it('does NOT say Copied when the write rejects', async () => {
      setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
      await revealSecret();

      fireEvent.click(screen.getByRole('button', { name: /sao chép|^copy$/i }));

      // Telling somebody they hold a credential they do not is the worst
      // possible thing to be wrong about here — it cannot be recovered.
      expect(await screen.findByRole('alert')).toHaveTextContent(/không sao chép được|copy failed/i);
      expect(screen.queryByRole('button', { name: /đã sao chép|copied/i })).not.toBeInTheDocument();
    });

    it('does NOT say Copied when the Clipboard API is absent', async () => {
      setClipboard(undefined);
      await revealSecret();

      fireEvent.click(screen.getByRole('button', { name: /sao chép|^copy$/i }));

      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: /đã sao chép|copied/i })).not.toBeInTheDocument();
    });

    it('does not carry Copied over to the NEXT credential', async () => {
      setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
      await revealSecret();

      fireEvent.click(screen.getByRole('button', { name: /sao chép|^copy$/i }));
      await screen.findByRole('button', { name: /đã sao chép|copied/i });
      fireEvent.click(screen.getByRole('button', { name: /xong|done/i }));

      // A second approval issues a different secret. The button must not open
      // already claiming it was copied.
      const NEXT = 'a-completely-different-secret';
      approveAccountInvitation.mockResolvedValue({
        invitation: { ...INVITATION, status: 'approved' },
        username: 'second',
        temporaryPassword: NEXT,
      });

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());
      await screen.findByText(NEXT);

      expect(screen.getByRole('button', { name: /sao chép|^copy$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /đã sao chép|copied/i })).not.toBeInTheDocument();
    });
  });

  it('renders a 403 as a normal answer rather than an error', async () => {
    const { ApiError } = await import('@/lib/http/apiError');
    fetchPendingMembershipRequests.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));

    renderPage();

    // A head reaching the global queue is refused by design.
    await waitFor(() =>
      expect(screen.getByText(/không có quyền|not permitted/i)).toBeInTheDocument(),
    );
  });
});
