import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ApprovalsPage from './ApprovalsPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const useSession = vi.fn();
const fetchDepartmentMembershipRequests = vi.fn();
const fetchDepartmentAccountInvitations = vi.fn();
const createUser = vi.fn();
const requestAccountInvitation = vi.fn();
const fetchDepartments = vi.fn();
const assignDepartmentHead = vi.fn();
const useMyDepartments = vi.fn();
const fetchPendingMembershipRequests = vi.fn();
const fetchEmployeeRoster = vi.fn();
const approveMembershipRequest = vi.fn();
const rejectMembershipRequest = vi.fn();
const fetchPendingAccountInvitations = vi.fn();
const approveAccountInvitation = vi.fn();
const rejectAccountInvitation = vi.fn();

vi.mock('@/api/membership-request', () => ({
  fetchPendingMembershipRequests: (...a: unknown[]) => fetchPendingMembershipRequests(...a),
  fetchDepartmentMembershipRequests: (...a: unknown[]) => fetchDepartmentMembershipRequests(...a),
  approveMembershipRequest: (...a: unknown[]) => approveMembershipRequest(...a),
  rejectMembershipRequest: (...a: unknown[]) => rejectMembershipRequest(...a),
}));
vi.mock('@/api/account-invitation', () => ({
  fetchPendingAccountInvitations: (...a: unknown[]) => fetchPendingAccountInvitations(...a),
  fetchDepartmentAccountInvitations: (...a: unknown[]) => fetchDepartmentAccountInvitations(...a),
  approveAccountInvitation: (...a: unknown[]) => approveAccountInvitation(...a),
  rejectAccountInvitation: (...a: unknown[]) => rejectAccountInvitation(...a),
  requestAccountInvitation: (...a: unknown[]) => requestAccountInvitation(...a),
}));
vi.mock('@/api/users', () => ({
  createUser: (...a: unknown[]) => createUser(...a),
}));
vi.mock('@/api/membership', () => ({
  fetchEmployeeRoster: (...a: unknown[]) => fetchEmployeeRoster(...a),
}));
vi.mock('@/api/department', () => ({
  fetchDepartments: (...a: unknown[]) => fetchDepartments(...a),
}));
vi.mock('@/api/department-head', () => ({
  assignDepartmentHead: (...a: unknown[]) => assignDepartmentHead(...a),
}));
vi.mock('@/hooks/useMyDepartments', () => ({
  useMyDepartments: () => useMyDepartments(),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const DEPARTMENT = 'd0000000-0000-4000-8000-000000000000';

/**
 * A session as `GET /authorization/me` actually returns it.
 *
 * `can` mirrors the server's own answer — `permissions` is the list the endpoint
 * sends, and `can()` is a membership test over it. Faking the two independently
 * would let a spec assert a combination the server cannot produce.
 */
const session = (
  role: 'SUPERADMIN' | 'DEPARTMENT_HEAD' | 'MEMBER',
  permissions: string[],
  departmentIds: string[] = [],
) => ({
  state: {
    status: 'ready' as const,
    authorization: { userId: 'me', username: 'me', role, departmentIds, permissions },
  },
  loading: false,
  can: (permission: string) => permissions.includes(permission),
});

const SUPERADMIN = () =>
  session('SUPERADMIN', [
    'unit.read',
    'unit.write',
    'unit.member.read',
    'unit.member.write',
    'role.assign',
    'user.write',
  ]);
const HEAD = () => session('DEPARTMENT_HEAD', ['unit.read', 'unit.member.read'], [DEPARTMENT]);
const MEMBER = () => session('MEMBER', ['unit.read']);

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
  email: 'newcomer@hoanglonglti.com',
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

// The roster links each person to their detail page, so the tree needs a
// router. `MemoryRouter` keeps the assertions about content, not navigation.
const renderPage = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ApprovalsPage />
      </LanguageProvider>
    </MemoryRouter>,
  );

const openInvitations = async () => {
  fireEvent.click(screen.getByRole('button', { name: /lời mời|invitation/i }));
  await screen.findByText('newcomer@hoanglonglti.com');
};

describe('ApprovalsPage', () => {
  beforeEach(() => {
    useSession.mockReset().mockReturnValue(SUPERADMIN());
    fetchDepartmentMembershipRequests.mockReset().mockResolvedValue(page([REQUEST]));
    fetchDepartmentAccountInvitations.mockReset().mockResolvedValue(page([INVITATION]));
    createUser.mockReset().mockResolvedValue({ id: 'created-user-id' });
    requestAccountInvitation.mockReset().mockResolvedValue({});
    fetchDepartments.mockReset().mockResolvedValue([
      {
        id: DEPARTMENT,
        slug: 'sales',
        name: 'Sales',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    assignDepartmentHead.mockReset().mockResolvedValue({});
    useMyDepartments.mockReset().mockReturnValue({ departments: [], loading: false });
    fetchEmployeeRoster.mockReset().mockResolvedValue(page([]));
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
      // ★ THE FULL ADDRESS, because that is what `POST /auth/login` takes as
      // `subject`. It used to show the local part under "Tên đăng nhập", and
      // an approver reading that out loud sent people to a login that could
      // only fail. Scoped to the dialog: the address is also in the table
      // behind it, and an unscoped query would pass on the wrong element.
      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText('newcomer@hoanglonglti.com')).toBeInTheDocument();
      expect(dialog.getByText('Email đăng nhập')).toBeInTheDocument();
      // And it says plainly that this is the only showing.
      expect(screen.getByText(/không có cách nào đọc lại|nothing can read it back/i)).toBeInTheDocument();
      // The approver sent no password of their own.
      expect(approveAccountInvitation).toHaveBeenCalledWith(INVITATION.id);
    });

    it('never hands over the bare local part as if it were the credential', async () => {
      renderPage();
      await openInvitations();

      fireEvent.click(screen.getByRole('button', { name: /^duyệt$|^approve$/i }));
      fireEvent.click(lastConfirmButton());
      await screen.findByText(SECRET);

      // `username` is still in the response — it is the DISPLAY projection —
      // but `newcomer` alone signs nobody in, so this screen must not offer it
      // as something to type. And the old label must not come back.
      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.queryByText('newcomer')).not.toBeInTheDocument();
      expect(dialog.queryByText(/tên đăng nhập|^username$/i)).not.toBeInTheDocument();
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

  describe('both queues get the same shell', () => {
    // The two queues share one presentational component now. These pin the
    // parts that must stay identical, so a change to the shell cannot quietly
    // fix one queue and break the other.
    it('renders its own columns plus the shared actions column', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      // Membership requests: four of its own, then Actions.
      let headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toHaveLength(5);
      expect(headers[headers.length - 1]).toMatch(/thao tác|action/i);

      await openInvitations();

      // Invitations: three of its own, then the same Actions column.
      headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toHaveLength(4);
      expect(headers[headers.length - 1]).toMatch(/thao tác|action/i);
    });

    it('gives both queues working cursor controls', async () => {
      // hasMore true so Next is live, and the page-size control is present.
      fetchPendingMembershipRequests.mockResolvedValue({
        items: [REQUEST],
        nextCursor: 'CURSOR',
        hasMore: true,
      });
      fetchPendingAccountInvitations.mockResolvedValue({
        items: [INVITATION],
        nextCursor: 'CURSOR',
        hasMore: true,
      });

      renderPage();
      await screen.findByText('Moved Person');
      expect(screen.getByRole('button', { name: /sau|next/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /trước|previous/i })).toBeDisabled();

      await openInvitations();
      expect(screen.getByRole('button', { name: /sau|next/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /trước|previous/i })).toBeDisabled();
    });

    it('sends each queue to its OWN repository, never the other', async () => {
      renderPage();
      await screen.findByText('Moved Person');
      expect(fetchPendingMembershipRequests).toHaveBeenCalled();
      expect(fetchPendingAccountInvitations).not.toHaveBeenCalled();

      await openInvitations();
      expect(fetchPendingAccountInvitations).toHaveBeenCalled();
    });

    it('rejects through the right repository for each queue', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      fireEvent.click(screen.getByRole('button', { name: /^từ chối$|^reject$/i }));
      const confirms = screen.getAllByRole('button', { name: /^từ chối$|^reject$/i });
      fireEvent.click(confirms[confirms.length - 1]);

      await waitFor(() => expect(rejectMembershipRequest).toHaveBeenCalledWith(REQUEST.id, undefined));
      expect(rejectAccountInvitation).not.toHaveBeenCalled();
    });

    it('shows the empty state per queue, with its own wording', async () => {
      fetchPendingAccountInvitations.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      renderPage();
      await screen.findByText('Moved Person');
      fireEvent.click(screen.getByRole('button', { name: /lời mời|invitation/i }));

      expect(
        await screen.findByText(/không có lời mời|no pending invitations/i),
      ).toBeInTheDocument();
    });
  });

  it('renders a 403 as a normal answer rather than an error', async () => {
    const { ApiError } = await import('@/utils/errors');
    fetchPendingMembershipRequests.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));

    renderPage();

    // A head reaching the global queue is refused by design. `findByText` is
    // the right query here: this is waiting for text to APPEAR after an async
    // read settles, which is exactly what it does.
    expect(await screen.findByText(/không có quyền|not permitted/i)).toBeInTheDocument();
  });

  /**
   * ROLE VISIBILITY — and every line of it is a RENDER HINT, not a control.
   *
   * The server re-decides on every request and answers 403 regardless of what
   * was drawn here (§13). What these pin is that nobody is offered an action
   * whose only possible outcome is a refusal.
   */
  describe('who is offered what', () => {
    it('offers a SUPERADMIN direct create, and both decisions', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      expect(screen.getByRole('button', { name: /thêm nhân viên/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^duyệt$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^từ chối$/i })).toBeInTheDocument();
    });

    it('keeps the two tabs whoever is looking', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      expect(screen.getByRole('button', { name: 'Yêu cầu nhân sự' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lời mời tài khoản' })).toBeInTheDocument();
    });

    it('offers a DEPARTMENT_HEAD the request action, never direct create', async () => {
      useSession.mockReturnValue(HEAD());
      renderPage();
      await screen.findByText('Moved Person');

      // ★ `POST /users` needs `user.write`, which is GLOBAL-only. A head who
      // could create accounts could create one for themselves.
      expect(screen.queryByRole('button', { name: /thêm nhân viên/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /đề nghị mở tài khoản/i })).toBeInTheDocument();
    });

    it('offers a DEPARTMENT_HEAD no decision at all — not even on their own request', async () => {
      useSession.mockReturnValue(HEAD());
      renderPage();
      await screen.findByText('Moved Person');

      // Deciding needs a global-only permission AND the database refuses
      // `decided_by = requested_by`. Two layers, both saying no.
      expect(screen.queryByRole('button', { name: /^duyệt$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();
    });

    it('offers a MEMBER nothing', async () => {
      useSession.mockReturnValue(MEMBER());
      // A MEMBER is neither global nor a head, so the page routes them to the
      // GLOBAL queue — and the backend answers that with 403 for a plain member
      // (`membership-request.security.spec.ts`: "cannot read requests,
      // anywhere"). The default `beforeEach` resolves it with a row instead,
      // which is a state this role can never actually reach.
      const { ApiError } = await import('@/utils/errors');
      fetchPendingMembershipRequests.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));

      renderPage();

      // ⚠ WAIT FOR THE QUEUE TO SETTLE FIRST, and assert afterwards.
      //
      // `waitFor(() => expect(...).not.toBeInTheDocument())` passed on its FIRST
      // tick — the button was absent because the read had not come back yet, not
      // because the role forbids it. The assertion could never fail, so it was
      // not testing anything. The refusal text only renders once the read has
      // settled, so awaiting it is what makes the checks below observe the final
      // state rather than the loading one.
      expect(await screen.findByText(/không có quyền|not permitted/i)).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /thêm nhân viên/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /đề nghị mở tài khoản/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^duyệt$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();
    });
  });

  /**
   * ★ A HEAD READS THE DEPARTMENT-SCOPED ENDPOINTS, NOT THE GLOBAL ONES.
   *
   * The global queues answer 403 to a head, including for requests they raised
   * themselves. Pointing them there would render "not permitted" on the one
   * screen that is supposed to show them their own pending request.
   */
  describe('a head watching their own department', () => {
    beforeEach(() => useSession.mockReturnValue(HEAD()));

    it('reads the department queue and never the global one', async () => {
      renderPage();

      await waitFor(() =>
        expect(fetchDepartmentMembershipRequests).toHaveBeenCalledWith(
          DEPARTMENT,
          expect.anything(),
        ),
      );
      expect(fetchPendingMembershipRequests).not.toHaveBeenCalled();
    });

    it('reads the department invitations on the second tab', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Lời mời tài khoản' }));

      await waitFor(() =>
        expect(fetchDepartmentAccountInvitations).toHaveBeenCalledWith(
          DEPARTMENT,
          expect.anything(),
        ),
      );
      expect(fetchPendingAccountInvitations).not.toHaveBeenCalled();
    });

    it('shows the decision state, because these lists are history', async () => {
      fetchDepartmentAccountInvitations.mockResolvedValue(page([INVITATION]));
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Lời mời tài khoản' }));

      expect(await screen.findByText('newcomer@hoanglonglti.com')).toBeInTheDocument();
      expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    });

    it('re-reads after a request is submitted, without a page reload', async () => {
      useMyDepartments.mockReturnValue({
        departments: [
          {
            id: DEPARTMENT,
            slug: 'sales',
            name: 'Sales',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        loading: false,
      });
      renderPage();
      await waitFor(() => expect(fetchDepartmentMembershipRequests).toHaveBeenCalled());
      const before = fetchDepartmentMembershipRequests.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: /đề nghị mở tài khoản/i }));
      await screen.findByRole('option', { name: 'Sales' });
      fireEvent.change(screen.getByLabelText('Phòng ban *'), { target: { value: DEPARTMENT } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nuna' } });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị/i }));

      await waitFor(() =>
        expect(requestAccountInvitation).toHaveBeenCalledWith(DEPARTMENT, 'nuna@hoanglonglti.com'),
      );
      // The row is now pending on the server; the list has to say so.
      await waitFor(() =>
        expect(fetchDepartmentMembershipRequests.mock.calls.length).toBeGreaterThan(before),
      );
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Đã gửi đề nghị mở tài khoản');
      expect(status).toHaveTextContent('nuna@hoanglonglti.com');
    });
  });

  /** SUPERADMIN direct create, from the approvals area. */
  describe('creating an employee outright', () => {
    it('asks which department, because this screen has none in scope', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      fireEvent.click(screen.getByRole('button', { name: /thêm nhân viên/i }));

      expect(await screen.findByLabelText('Phòng ban *')).toBeInTheDocument();
      expect(screen.getByLabelText('Chức vụ *')).toBeInTheDocument();
      expect(screen.getByLabelText('Mật khẩu tạm *')).toBeInTheDocument();
    });

    it('creates the account and says so, without reloading', async () => {
      renderPage();
      await screen.findByText('Moved Person');

      fireEvent.click(screen.getByRole('button', { name: /thêm nhân viên/i }));
      await screen.findByRole('option', { name: 'Sales' });

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.change(screen.getByLabelText('Phòng ban *'), { target: { value: DEPARTMENT } });
      fireEvent.click(screen.getByRole('button', { name: /^lưu nhân viên$/i }));

      await waitFor(() =>
        expect(createUser).toHaveBeenCalledWith({
          displayName: 'New Comer',
          email: 'uyen@hoanglonglti.com',
          initialPassword: 'a temporary handover',
          departmentId: DEPARTMENT,
        }),
      );
      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('Đã tạo tài khoản nhân viên');
      // ★ THE ADDRESS THEY WILL SIGN IN WITH. The administrator typed `uyen`;
      // `POST /auth/login` takes `uyen@hoanglonglti.com` as `subject`, and the
      // approval dialog already carries a note about where that gap led once.
      expect(status).toHaveTextContent('uyen@hoanglonglti.com');

      // ⚠ AND NOT THE PASSWORD. The notice interpolates data the administrator
      // typed into the page; the address belongs there and the credential does
      // not, on screen or anywhere the browser keeps things.
      expect(document.body.innerHTML).not.toContain('a temporary handover');
      expect(storageEntries(localStorage)).not.toContain('a temporary handover');
      expect(storageEntries(sessionStorage)).not.toContain('a temporary handover');
      expect(window.location.href).not.toContain('a temporary handover');
    });

    it('shows the server’s refusal and keeps the dialog open', async () => {
      const { ApiError } = await import('@/utils/errors');
      createUser.mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'That identity is already registered.'),
      );
      renderPage();
      await screen.findByText('Moved Person');

      fireEvent.click(screen.getByRole('button', { name: /thêm nhân viên/i }));
      await screen.findByRole('option', { name: 'Sales' });

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.change(screen.getByLabelText('Phòng ban *'), { target: { value: DEPARTMENT } });
      fireEvent.click(screen.getByRole('button', { name: /^lưu nhân viên$/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That identity is already registered.',
      );
      // Still open, still holding what was typed.
      expect(screen.getByLabelText('Email *')).toHaveValue('uyen');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
  /**
   * ★ THE GLOBAL EMPLOYEE ROSTER — a third tab, and deliberately NOT a third
   * queue. The other two hold things awaiting a decision and offer Approve and
   * Reject; this one holds people and offers nothing. Sharing a screen is not
   * sharing a meaning.
   */
  describe('the employee management tab', () => {
    const rosterRow = (over: Record<string, unknown> = {}) => ({
      id: 'mem-1',
      user: { id: 'user-1', displayName: 'Lê Gia Minh Phú' },
      department: { id: 'dep-sales', name: 'Sales' },
      role: 'MEMBER',
      membershipStatus: 'active',
      accountStatus: 'active',
      joinedAt: '2026-08-26T03:00:00.000Z',
      endedAt: null,
      ...over,
    });

    const openRoster = async () => {
      fireEvent.click(screen.getByRole('button', { name: /quản lý nhân viên/i }));
      // `findAll`, because one person legitimately appears on more than one row
      // — an ended membership beside an active one is two lines of history.
      await screen.findAllByText('Lê Gia Minh Phú');
    };

    beforeEach(() => {
      useSession.mockReturnValue(SUPERADMIN());
      fetchEmployeeRoster.mockResolvedValue(
        page([
          rosterRow(),
          rosterRow({
            id: 'mem-2',
            user: { id: 'user-2', displayName: 'Nguyễn Văn A' },
            role: 'DEPARTMENT_HEAD',
            joinedAt: '2026-08-20T03:00:00.000Z',
          }),
          rosterRow({
            id: 'mem-3',
            user: { id: 'user-3', displayName: 'Trần Văn B' },
            department: { id: 'dep-ops', name: 'Vận hành' },
            joinedAt: '2026-08-18T03:00:00.000Z',
          }),
        ]),
      );
    });

    it('offers the tab to a SUPERADMIN', () => {
      renderPage();

      expect(screen.getByRole('button', { name: /quản lý nhân viên/i })).toBeInTheDocument();
    });

    /**
     * ⚠ `GET /memberships` is authorized WITHOUT a department, which only a
     * global caller survives. Offering a head the tab would be offering a 403.
     */
    it('does not offer it to a DEPARTMENT_HEAD', () => {
      useSession.mockReturnValue(HEAD());
      renderPage();

      expect(screen.queryByRole('button', { name: /quản lý nhân viên/i })).not.toBeInTheDocument();
    });

    it('does not offer it to a MEMBER', () => {
      useSession.mockReturnValue(MEMBER());
      renderPage();

      expect(screen.queryByRole('button', { name: /quản lý nhân viên/i })).not.toBeInTheDocument();
    });

    it('reads the GLOBAL endpoint once, not one call per department', async () => {
      renderPage();
      await openRoster();

      expect(fetchEmployeeRoster).toHaveBeenCalledTimes(1);
      // Active is the default view, asked for explicitly.
      expect(fetchEmployeeRoster).toHaveBeenCalledWith(expect.anything(), 'active');
      // ★ NO FAN-OUT: the department-scoped roster is never touched here.
      expect(fetchDepartmentMembershipRequests).not.toHaveBeenCalled();
    });

    it('draws the six columns, department included', async () => {
      renderPage();
      await openRoster();

      const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
      expect(headers).toEqual([
        '#',
        'Nhân viên',
        'Phòng ban',
        'Vị trí',
        'Trạng thái',
        'Ngày vào phòng',
      ]);
    });

    /** ★ GLOBAL MEANS GLOBAL: more than one department on one page. */
    it('shows employees from every department at once', async () => {
      renderPage();
      await openRoster();

      expect(screen.getByText('Trần Văn B')).toBeInTheDocument();
      expect(screen.getAllByText('Sales')).toHaveLength(2);
      expect(screen.getByText('Vận hành')).toBeInTheDocument();
    });

    it('maps each row from the response — position, status and joined date', async () => {
      renderPage();
      await openRoster();

      const rows = screen.getAllByRole('row');
      expect(within(rows[1]!).getByText('Nhân viên')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('Đang làm việc')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('26/8/2026')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('Trưởng phòng')).toBeInTheDocument();
      expect(within(rows[3]!).getByText('18/8/2026')).toBeInTheDocument();
    });

    /**
     * ★ THE FILTER IS SERVER-SIDE. Asking for people who have left must reach
     * the query — hiding rows the server already sent would page wrongly and
     * misreport how many there are.
     */
    it('asks the server for ended memberships rather than filtering in the browser', async () => {
      renderPage();
      await openRoster();

      fireEvent.change(screen.getByLabelText(/lọc theo trạng thái/i), {
        target: { value: 'ended' },
      });

      await waitFor(() =>
        expect(fetchEmployeeRoster).toHaveBeenLastCalledWith(expect.anything(), 'ended'),
      );
    });

    it('asks for both when the filter is cleared', async () => {
      renderPage();
      await openRoster();

      fireEvent.change(screen.getByLabelText(/lọc theo trạng thái/i), {
        target: { value: 'all' },
      });

      // `undefined`, not a magic "all" value the server would have to know.
      await waitFor(() =>
        expect(fetchEmployeeRoster).toHaveBeenLastCalledWith(expect.anything(), undefined),
      );
    });

    it('offers no decision on a roster row — it is not an approval queue', async () => {
      renderPage();
      await openRoster();

      expect(screen.queryByRole('button', { name: /^duyệt$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^từ chối$/i })).not.toBeInTheDocument();
    });

    it('keeps one identity when a person holds an ended and an active membership', async () => {
      fetchEmployeeRoster.mockResolvedValue(
        page([
          rosterRow({
            id: 'mem-sales',
            membershipStatus: 'ended',
            department: { id: 'dep-sales', name: 'Sales' },
          }),
          rosterRow({
            id: 'mem-ops',
            membershipStatus: 'active',
            department: { id: 'dep-ops', name: 'Vận hành' },
          }),
        ]),
      );
      renderPage();
      await openRoster();

      // Two lines of history for ONE employee — not two employees.
      expect(screen.getAllByText('Lê Gia Minh Phú')).toHaveLength(2);
      // Scoped to the rows: the status filter's own <option> list carries the
      // same two words, and matching those would prove nothing about the table.
      const rows = screen.getAllByRole('row');
      expect(within(rows[1]!).getByText('Đã nghỉ việc')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('Sales')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('Đang làm việc')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('Vận hành')).toBeInTheDocument();
    });
  });

});
