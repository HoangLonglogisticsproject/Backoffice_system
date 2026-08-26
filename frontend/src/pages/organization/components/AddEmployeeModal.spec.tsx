import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AddEmployeeModal } from './AddEmployeeModal';
import { LanguageProvider } from '@/contexts/LanguageContext';

const createUser = vi.fn();
const requestAccountInvitation = vi.fn();
const fetchDepartments = vi.fn();
const assignDepartmentHead = vi.fn();
const useMyDepartments = vi.fn();
const can = vi.fn();

vi.mock('@/api/users', () => ({
  createUser: (...args: unknown[]) => createUser(...args),
}));
vi.mock('@/api/account-invitation', () => ({
  requestAccountInvitation: (...args: unknown[]) => requestAccountInvitation(...args),
}));
vi.mock('@/api/department', () => ({
  fetchDepartments: (...args: unknown[]) => fetchDepartments(...args),
}));
vi.mock('@/api/department-head', () => ({
  assignDepartmentHead: (...args: unknown[]) => assignDepartmentHead(...args),
}));
vi.mock('@/hooks/useMyDepartments', () => ({
  useMyDepartments: () => useMyDepartments(),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => ({ can }),
}));

const DEPARTMENT = '7ce2630e-0000-4000-8000-000000000000';
const OTHER_DEPARTMENT = '9aa1f0c4-0000-4000-8000-000000000000';

const active = (id: string, name: string) => ({
  id,
  slug: name.toLowerCase(),
  name,
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * ONE BUTTON, TWO WORKFLOWS — and the difference is the whole point.
 *
 * A global administrator issues an account outright, credential included. A
 * head proposes a colleague by address and issues nothing. Rendering the same
 * form for both would tell a head they were setting a password the API will
 * never read.
 */
const renderModal = () =>
  render(
    <LanguageProvider>
      <AddEmployeeModal
        isOpen
        departmentId={DEPARTMENT}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    </LanguageProvider>,
  );

/**
 * The same dialog opened from a screen that has NO department in scope — the
 * approvals area. The picker appears only here.
 */
const renderModalWithoutDepartment = () =>
  render(
    <LanguageProvider>
      <AddEmployeeModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />
    </LanguageProvider>,
  );

describe('AddEmployeeModal', () => {
  beforeEach(() => {
    createUser.mockReset().mockResolvedValue({ id: 'created-user-id' });
    requestAccountInvitation.mockReset().mockResolvedValue({});
    fetchDepartments
      .mockReset()
      .mockResolvedValue([active(DEPARTMENT, 'Sales'), active(OTHER_DEPARTMENT, 'Operations')]);
    assignDepartmentHead.mockReset().mockResolvedValue({});
    useMyDepartments.mockReset().mockReturnValue({ departments: [], loading: false });
    can.mockReset();
  });

  describe('a global administrator creating directly', () => {
    beforeEach(() => can.mockReturnValue(true));

    it('asks for exactly the four fields the contract defines', () => {
      renderModal();

      expect(screen.getByLabelText('Họ và tên *')).toBeInTheDocument();
      expect(screen.getByLabelText('Email *')).toBeInTheDocument();
      const password = screen.getByLabelText('Mật khẩu tạm *');
      expect(password).toBeInTheDocument();
      // The TEMPORARY floor, not the permanent 12 — and never the browser's
      // saved credential for the administrator themselves.
      expect(password).toHaveAttribute('minLength', '8');
      expect(password).toHaveAttribute('autoComplete', 'new-password');
      // The department comes from the route, so there is nothing to choose.
      expect(screen.queryByLabelText(/phòng ban|department/i)).not.toBeInTheDocument();
    });

    /**
     * ★ THE ROLE IS OFFERED, AND IT IS NOT A FIELD ON `POST /users`.
     *
     * This spec used to assert the opposite, and it was right about the request
     * body: `createUserSchema` has no role. What changed is that the role is now
     * written the only way the backend can write it — `POST /departments/:id/head`
     * — so the select is backed by a real endpoint rather than by a column that
     * does not exist. The body assertion below still pins the original point.
     */
    it('offers only the two roles the backend can actually record', () => {
      renderModal();

      const role = screen.getByLabelText('Chức vụ *');
      expect(role).toBeInTheDocument();
      expect(
        Array.from(role.querySelectorAll('option')).map((option) => option.getAttribute('value')),
      ).toEqual(['MEMBER', 'DEPARTMENT_HEAD']);
      // GLOBAL is granted by the bootstrap CLI and by no HTTP route at all.
      expect(screen.queryByText(/superadmin/i)).not.toBeInTheDocument();
    });

    it('never puts the role in the create body — POST /users has no role field', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.change(screen.getByLabelText('Chức vụ *'), {
        target: { value: 'DEPARTMENT_HEAD' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      await waitFor(() => expect(createUser).toHaveBeenCalled());
      expect(Object.keys(createUser.mock.calls[0][0] as object).sort()).toEqual([
        'departmentId',
        'displayName',
        'email',
        'initialPassword',
      ]);
    });

    it('appoints a head with the id the create call returned, after it returns', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Head' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.change(screen.getByLabelText('Chức vụ *'), {
        target: { value: 'DEPARTMENT_HEAD' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      // Invariant #6: the appointment needs an ACTIVE MEMBERSHIP, which only
      // exists once provisioning has committed. The order is not a preference.
      await waitFor(() =>
        expect(assignDepartmentHead).toHaveBeenCalledWith(DEPARTMENT, 'created-user-id'),
      );
    });

    it('leaves MEMBER alone — the absence of an assignment is not a call', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      await waitFor(() => expect(createUser).toHaveBeenCalled());
      expect(assignDepartmentHead).not.toHaveBeenCalled();
    });

    it('hides the temporary password behind a toggle, and reveals it on request', () => {
      renderModal();

      const password = screen.getByLabelText('Mật khẩu tạm *');
      expect(password).toHaveAttribute('type', 'password');

      fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
      expect(screen.getByLabelText('Mật khẩu tạm *')).toHaveAttribute('type', 'text');

      fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
      expect(screen.getByLabelText('Mật khẩu tạm *')).toHaveAttribute('type', 'password');
    });

    it('offers no employee code or job title, because nothing stores them', () => {
      renderModal();

      expect(screen.queryByLabelText(/mã nhân viên|employee code/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/chức danh|job title/i)).not.toBeInTheDocument();
    });

    it('sends the department from the route, not from the form', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), {
        target: { value: 'New Comer' },
      });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      await waitFor(() =>
        expect(createUser).toHaveBeenCalledWith({
          displayName: 'New Comer',
          // The local part typed, the company domain appended.
          email: 'uyen@hoanglonglti.com',
          initialPassword: 'a temporary handover',
          departmentId: DEPARTMENT,
        }),
      );
      expect(requestAccountInvitation).not.toHaveBeenCalled();
    });
  });

  it('chooses the workflow from `can("user.write")`, not from anything local', () => {
    can.mockReturnValue(true);
    const { unmount } = renderModal();
    expect(can).toHaveBeenCalledWith('user.write');
    unmount();

    can.mockClear().mockReturnValue(false);
    renderModal();
    expect(can).toHaveBeenCalledWith('user.write');
    // The capability is the ONLY input: same props, different form.
    expect(screen.queryByLabelText('Mật khẩu tạm *')).not.toBeInTheDocument();
  });

  describe('a head proposing a colleague', () => {
    beforeEach(() => can.mockReturnValue(false));

    it('asks for an email and nothing else', () => {
      renderModal();

      expect(screen.getByLabelText('Email *')).toBeInTheDocument();
      // ★ No password: a head does not issue credentials, and the API would
      // ignore anything typed here.
      expect(screen.queryByLabelText(/mật khẩu|password/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Họ và tên *')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/phòng ban|department/i)).not.toBeInTheDocument();
    });

    /**
     * ★ AND IT SAYS SO, rather than leaving the missing field to be read as an
     * oversight.
     *
     * `account_invitations` has no role column and approval reads nothing off
     * the row but the address and the department, so there is no step at which
     * a role a head typed could survive. A head who assumes otherwise hands
     * over an account and waits for authority that is never coming.
     */
    it('offers no chức vụ, and says the request carries none', () => {
      renderModal();

      expect(screen.queryByLabelText('Chức vụ *')).not.toBeInTheDocument();
      expect(screen.getByText(/KHÔNG mang chức vụ/)).toBeInTheDocument();
    });

    it('raises an invitation rather than creating an account', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nuna' } });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      await waitFor(() =>
        expect(requestAccountInvitation).toHaveBeenCalledWith(DEPARTMENT, 'nuna@hoanglonglti.com'),
      );
      expect(createUser).not.toHaveBeenCalled();
    });
  });

  it('shows the server’s refusal rather than guessing at one', async () => {
    can.mockReturnValue(false);
    const { ApiError } = await import('@/utils/errors');
    requestAccountInvitation.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'That address already has an account.'),
    );

    renderModal();
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'taken' } });
    fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

    // The server knows about duplicates and domain allowlists; this form does not.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That address already has an account.'),
    );
  });

  /**
   * THE COMPANY DOMAIN IS THE FIELD, not something anybody types.
   *
   * Every employee account is `<local-part>@hoanglonglti.com`. What is asserted
   * here is that the form asks for the local part, shows the domain, and builds
   * the address — and that the server still gets to refuse whatever it builds.
   */
  describe('the company email field', () => {
    it('shows the fixed domain beside the input, and offers no way to change it', () => {
      can.mockReturnValue(true);
      renderModal();

      expect(screen.getByText('@hoanglonglti.com')).toBeInTheDocument();
      // Drawn, not editable: a control whose only legal value is fixed is not a
      // choice, it is decoration that can go wrong.
      expect(screen.getByText('@hoanglonglti.com').tagName).toBe('SPAN');
      expect(screen.queryByDisplayValue(/hoanglongti\.com/)).not.toBeInTheDocument();
    });

    it('shows the domain in the head workflow too', () => {
      can.mockReturnValue(false);
      renderModal();

      expect(screen.getByText('@hoanglonglti.com')).toBeInTheDocument();
    });

    it('unwraps a pasted full address rather than doubling the domain', async () => {
      can.mockReturnValue(false);
      renderModal();

      fireEvent.change(screen.getByLabelText('Email *'), {
        target: { value: 'uyen@hoanglonglti.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      await waitFor(() =>
        expect(requestAccountInvitation).toHaveBeenCalledWith(DEPARTMENT, 'uyen@hoanglonglti.com'),
      );
    });

    it('refuses an outside domain without asking the server', async () => {
      can.mockReturnValue(false);
      renderModal();

      fireEvent.change(screen.getByLabelText('Email *'), {
        target: { value: 'uyen@gmail.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Vui lòng nhập email công ty hợp lệ.',
      );
      expect(requestAccountInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['whitespace only', '   '],
      ['a space inside', 'uyen sales'],
      ['a stray @', 'uy@en'],
    ])('refuses %s and sends nothing', async (_label, typed) => {
      can.mockReturnValue(false);
      renderModal();

      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Vui lòng nhập email công ty hợp lệ.',
      );
      expect(requestAccountInvitation).not.toHaveBeenCalled();
    });

    it('leaves the empty case to the browser, which is what `required` is for', () => {
      can.mockReturnValue(false);
      renderModal();

      expect(screen.getByLabelText('Email *')).toBeRequired();
    });
  });

  /**
   * ★ PARTIAL SUCCESS, AND THE ONLY STATE IN THIS DIALOG THAT CANNOT BE RETRIED
   * FROM THE TOP.
   *
   * `POST /users` and `POST /departments/:id/head` are two calls; the backend
   * has no route that does both, which is a confirmed contract rather than an
   * oversight. When the first succeeds and the second fails, the account is
   * REAL — and the form still holds the address that now owns it.
   *
   * The bug this suite pins: pressing the button again used to send a second
   * `POST /users`, which can only ever answer 409, leaving the appointment
   * unreachable from this screen. The created id is kept instead, and every
   * route back into the dialog appoints rather than creates.
   */
  describe('an appointment that failed after the account was created', () => {
    const CONFLICT = () =>
      import('@/utils/errors').then(
        ({ ApiError }) => new ApiError(409, 'CONFLICT', 'That department already has a head.'),
      );

    const onClose = vi.fn();
    const onCreated = vi.fn();

    const fillAndCreateAHead = async () => {
      can.mockReturnValue(true);
      render(
        <LanguageProvider>
          <AddEmployeeModal
            isOpen
            departmentId={DEPARTMENT}
            onClose={onClose}
            onCreated={onCreated}
          />
        </LanguageProvider>,
      );

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Head' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.change(screen.getByLabelText('Chức vụ *'), {
        target: { value: 'DEPARTMENT_HEAD' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu nhân viên/i }));
    };

    const retryButton = () => screen.getByRole('button', { name: 'Thử bổ nhiệm lại' });

    beforeEach(() => {
      onClose.mockReset();
      onCreated.mockReset();
    });

    it('creates then appoints, in that order, when both succeed', async () => {
      await fillAndCreateAHead();

      await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
      // Invariant #6: the appointment needs an ACTIVE MEMBERSHIP, which exists
      // only once provisioning has committed.
      expect(assignDepartmentHead).toHaveBeenCalledWith(DEPARTMENT, 'created-user-id');
      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith('created', 'uyen@hoanglonglti.com'),
      );
      expect(onClose).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Thử bổ nhiệm lại' })).not.toBeInTheDocument();
    });

    it('keeps the account, the error and a retry action when the appointment fails', async () => {
      assignDepartmentHead.mockRejectedValue(await CONFLICT());
      await fillAndCreateAHead();

      // Two calls, two outcomes, and the message must not merge them: reporting
      // "could not create the account" would send somebody to create it again.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Đã tạo tài khoản nhưng chưa bổ nhiệm được trưởng phòng');
      expect(alert).toHaveTextContent('That department already has a head.');

      expect(retryButton()).toBeInTheDocument();
      // Nothing was reset and nothing was closed — the account exists, so the
      // message has to stay on screen long enough to be read.
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('locks the form, because nothing in it can change the retry', async () => {
      assignDepartmentHead.mockRejectedValue(await CONFLICT());
      await fillAndCreateAHead();
      await screen.findByRole('alert');

      // The retry appoints the id that was captured; a department changed here
      // afterwards would be silently ignored.
      expect(screen.getByLabelText('Email *')).toBeDisabled();
      expect(screen.getByLabelText('Chức vụ *')).toBeDisabled();
      expect(screen.getByLabelText('Mật khẩu tạm *')).toBeDisabled();
      // And "Cancel" is no longer true — there is nothing left to cancel, only
      // something left to finish. Scoped to the footer: the dialog's own X
      // carries the same accessible name.
      const footer = retryButton().parentElement as HTMLElement;
      expect(within(footer).getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hủy bỏ' })).not.toBeInTheDocument();
    });

    it('★ RETRY APPOINTS AND NEVER CREATES A SECOND ACCOUNT', async () => {
      assignDepartmentHead.mockRejectedValueOnce(await CONFLICT()).mockResolvedValue({});
      await fillAndCreateAHead();
      await screen.findByRole('alert');
      expect(createUser).toHaveBeenCalledTimes(1);

      fireEvent.click(retryButton());

      await waitFor(() => expect(assignDepartmentHead).toHaveBeenCalledTimes(2));
      // THE ASSERTION THIS WHOLE SUITE EXISTS FOR.
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(assignDepartmentHead).toHaveBeenLastCalledWith(DEPARTMENT, 'created-user-id');
    });

    it('finishes the normal success flow once the retry succeeds', async () => {
      assignDepartmentHead.mockRejectedValueOnce(await CONFLICT()).mockResolvedValue({});
      await fillAndCreateAHead();
      await screen.findByRole('alert');

      fireEvent.click(retryButton());

      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith('created', 'uyen@hoanglonglti.com'),
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('holds the same account when the retry fails again', async () => {
      assignDepartmentHead.mockRejectedValue(await CONFLICT());
      await fillAndCreateAHead();
      await screen.findByRole('alert');

      fireEvent.click(retryButton());
      await waitFor(() => expect(assignDepartmentHead).toHaveBeenCalledTimes(2));

      // Same id, still no second create, still retryable.
      expect(assignDepartmentHead).toHaveBeenLastCalledWith(DEPARTMENT, 'created-user-id');
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(retryButton()).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Đã tạo tài khoản nhưng chưa bổ nhiệm được trưởng phòng',
      );
      expect(onCreated).not.toHaveBeenCalled();
    });

    it('routes the ENTER key to the retry too, not to a second create', async () => {
      assignDepartmentHead.mockRejectedValueOnce(await CONFLICT()).mockResolvedValue({});
      await fillAndCreateAHead();
      await screen.findByRole('alert');

      // `disabled` never sees an Enter keypress in a text field, so the guard
      // cannot live on the button alone.
      fireEvent.submit(document.getElementById('add-employee-form') as HTMLFormElement);

      await waitFor(() => expect(assignDepartmentHead).toHaveBeenCalledTimes(2));
      expect(createUser).toHaveBeenCalledTimes(1);
    });

    it('puts neither the account id nor the password anywhere the browser keeps things', async () => {
      assignDepartmentHead.mockRejectedValue(await CONFLICT());
      await fillAndCreateAHead();
      await screen.findByRole('alert');

      for (const secret of ['created-user-id', 'a temporary handover']) {
        expect(window.location.href).not.toContain(secret);
        expect(localStorage.getItem('createdUserId')).toBeNull();
        expect(JSON.stringify(Object.keys(sessionStorage))).not.toContain(secret);
      }
      // The password is still in its own field and nowhere else on the page.
      expect(screen.getByLabelText('Mật khẩu tạm *')).toHaveAttribute('type', 'password');
    });
  });

  /**
   * THE DEPARTMENT COMES FROM THE ROUTE WHEN THERE IS ONE, and is asked for
   * when there is not.
   *
   * ★ AND IT IS READ FROM A DIFFERENT ENDPOINT PER ROLE, because only one of
   * them answers 200. A head has no departments list at all — `GET /departments`
   * is checked without a route scope and is global-only — so asking it for them
   * would be a guaranteed 403 rendered as an empty menu.
   */
  describe('choosing a department', () => {
    it('does not ask when the route already said which one', () => {
      can.mockReturnValue(true);
      renderModal();

      expect(screen.queryByLabelText('Phòng ban *')).not.toBeInTheDocument();
      // And nothing is read, because nothing is being chosen.
      expect(fetchDepartments).not.toHaveBeenCalled();
    });

    it('offers the whole list to a global administrator', async () => {
      can.mockReturnValue(true);
      renderModalWithoutDepartment();

      const picker = await screen.findByLabelText('Phòng ban *');
      // `findByRole` IS the wait — `waitFor` wrapped around a `getBy` retries a
      // throwing query to prove presence, which is the one thing `findBy` is for.
      await screen.findByRole('option', { name: 'Sales' });
      expect(screen.getByRole('option', { name: 'Operations' })).toBeInTheDocument();
      expect(picker).toBeRequired();
    });

    it('drops an archived department rather than offering a guaranteed 409', async () => {
      can.mockReturnValue(true);
      fetchDepartments.mockResolvedValue([
        active(DEPARTMENT, 'Sales'),
        { ...active(OTHER_DEPARTMENT, 'Closed Unit'), status: 'archived' },
      ]);
      renderModalWithoutDepartment();

      await screen.findByRole('option', { name: 'Sales' });
      expect(screen.queryByRole('option', { name: 'Closed Unit' })).not.toBeInTheDocument();
    });

    it('offers a head ONLY the unit their session names, and never the global list', async () => {
      can.mockReturnValue(false);
      useMyDepartments.mockReturnValue({
        departments: [active(DEPARTMENT, 'Sales')],
        loading: false,
      });
      renderModalWithoutDepartment();

      await screen.findByRole('option', { name: 'Sales' });
      expect(screen.queryByRole('option', { name: 'Operations' })).not.toBeInTheDocument();
      // ★ The global list is never even asked for.
      expect(fetchDepartments).not.toHaveBeenCalled();
    });

    it('sends the chosen department, not one it invented', async () => {
      can.mockReturnValue(false);
      useMyDepartments.mockReturnValue({
        departments: [active(DEPARTMENT, 'Sales')],
        loading: false,
      });
      renderModalWithoutDepartment();

      await screen.findByRole('option', { name: 'Sales' });
      fireEvent.change(screen.getByLabelText('Phòng ban *'), { target: { value: DEPARTMENT } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nuna' } });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      await waitFor(() =>
        expect(requestAccountInvitation).toHaveBeenCalledWith(DEPARTMENT, 'nuna@hoanglonglti.com'),
      );
    });

    it('says so when the caller leads nothing, instead of an empty menu', async () => {
      can.mockReturnValue(false);
      useMyDepartments.mockReturnValue({ departments: [], loading: false });
      renderModalWithoutDepartment();

      expect(await screen.findByText('Tài khoản của bạn không phụ trách phòng ban nào.'))
        .toBeInTheDocument();
      expect(screen.getByLabelText('Phòng ban *')).toBeDisabled();
    });

    it('reports a failed read rather than pretending there are no departments', async () => {
      can.mockReturnValue(true);
      fetchDepartments.mockRejectedValue(new Error('offline'));
      renderModalWithoutDepartment();

      expect(await screen.findByText('Không tải được danh sách phòng ban.')).toBeInTheDocument();
    });

    /**
     * ★ THE PLATFORM ANSWERS THIS ONE. `required` on a native <select> whose
     * placeholder option has an empty value blocks submission before any
     * handler runs — which is why the field is a native select and not a
     * div-with-a-listbox-role that has to re-implement it.
     *
     * The component keeps its own guard anyway: the id goes into a URL path,
     * and a value that reaches a request must never depend on the browser
     * having been the one to check it.
     */
    it('refuses to submit with no department chosen', async () => {
      can.mockReturnValue(true);
      renderModalWithoutDepartment();

      await screen.findByRole('option', { name: 'Sales' });
      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      const picker = screen.getByLabelText('Phòng ban *') as HTMLSelectElement;
      expect(picker).toBeRequired();
      expect(picker.checkValidity()).toBe(false);
      expect(createUser).not.toHaveBeenCalled();
    });
  });

  /**
   * ⚠ CREATING AN ACCOUNT IS NOT IDEMPOTENT. A second call answers 409 on the
   * duplicate address, and whoever clicked twice sees a failure for work that
   * succeeded.
   */
  describe('submitting once', () => {
    it('ignores a second submit while the first is still in flight', async () => {
      can.mockReturnValue(true);
      let release: (value: unknown) => void = () => {};
      createUser.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });

      const form = document.getElementById('add-employee-form') as HTMLFormElement;
      // Submitting the FORM, not clicking the button: `disabled` never sees an
      // Enter keypress in a text field, which is the way this actually happens.
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);

      release({ id: 'created-user-id' });
      await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
    });

    it('disables both footer buttons while in flight', async () => {
      can.mockReturnValue(true);
      let release: (value: unknown) => void = () => {};
      createUser.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      renderModal();

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.submit(document.getElementById('add-employee-form') as HTMLFormElement);

      expect(await screen.findByRole('button', { name: /đang tạo/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /hủy bỏ/i })).toBeDisabled();
      release({ id: 'created-user-id' });
    });
  });

  /** The dialog closes on SUCCESS and only on success. */
  describe('closing', () => {
    it('closes and reports the outcome once the server agreed', async () => {
      can.mockReturnValue(true);
      const onClose = vi.fn();
      const onCreated = vi.fn();
      render(
        <LanguageProvider>
          <AddEmployeeModal
            isOpen
            departmentId={DEPARTMENT}
            onClose={onClose}
            onCreated={onCreated}
          />
        </LanguageProvider>,
      );

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      // ★ THE FULL ADDRESS, not the local part that was typed. `POST /auth/login`
      // takes the whole thing as `subject`, so whatever confirms the outcome has
      // to be able to show what the new person will actually type.
      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith('created', 'uyen@hoanglonglti.com'),
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('keeps what was typed when the server refused', async () => {
      can.mockReturnValue(true);
      const { ApiError } = await import('@/utils/errors');
      createUser.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Already registered.'));
      const onClose = vi.fn();
      const onCreated = vi.fn();
      render(
        <LanguageProvider>
          <AddEmployeeModal
            isOpen
            departmentId={DEPARTMENT}
            onClose={onClose}
            onCreated={onCreated}
          />
        </LanguageProvider>,
      );

      fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'New Comer' } });
      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'uyen' } });
      fireEvent.change(screen.getByLabelText('Mật khẩu tạm *'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      await screen.findByRole('alert');
      expect(onClose).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
      // A 409 on the address must not cost somebody the rest of the form.
      expect(screen.getByLabelText('Họ và tên *')).toHaveValue('New Comer');
      expect(screen.getByLabelText('Email *')).toHaveValue('uyen');
    });

    it('reports a head request as `requested`, not as `created`', async () => {
      can.mockReturnValue(false);
      const onCreated = vi.fn();
      render(
        <LanguageProvider>
          <AddEmployeeModal
            isOpen
            departmentId={DEPARTMENT}
            onClose={vi.fn()}
            onCreated={onCreated}
          />
        </LanguageProvider>,
      );

      fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nuna' } });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      // The two outcomes read differently to the person who did it: one issued
      // a credential, the other asked somebody else to.
      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith('requested', 'nuna@hoanglonglti.com'),
      );
    });
  });
  /**
   * ⚠ REGRESSION: ONE CHARACTER PER CLICK.
   *
   * `Modal` listed `onClose` in its focus-trap effect's dependencies. Every
   * caller passes a fresh arrow, so any state change inside an open dialog tore
   * the effect down — restoring focus to whatever opened the dialog — and set it
   * up again, focusing the dialog element. A controlled input re-renders on each
   * keystroke, so each character moved focus off the field being typed into.
   *
   * The input was never remounted: `sameNode` below is what says so, and it is
   * why the fix belongs in the effect's dependencies rather than in an
   * `onChange` that puts focus back.
   */
  describe('typing into it', () => {
    beforeEach(() => can.mockReturnValue(true));

    /** Types one character at a time, checking the field after each. */
    const typeInto = (label: string, word: string) => {
      const field = screen.getByLabelText(label);
      field.focus();
      expect(document.activeElement).toBe(field);

      let typed = '';
      for (const character of word) {
        typed += character;
        fireEvent.change(field, { target: { value: typed } });

        const afterKeystroke = screen.getByLabelText(label);
        // Same DOM node: a re-render, never a remount. If this ever fails the
        // cause is a different one and the fix below is the wrong fix.
        expect(afterKeystroke).toBe(field);
        expect(afterKeystroke).toHaveValue(typed);
        expect(document.activeElement).toBe(field);
      }
    };

    it('keeps focus on the name field across consecutive characters', () => {
      renderModal();
      typeInto('Họ và tên *', 'Le Van Long');
    });

    it('keeps focus on the email local part across consecutive characters', () => {
      renderModal();
      typeInto('Email *', 'levanlong');
    });

    it('keeps focus on the temporary password across consecutive characters', () => {
      renderModal();
      typeInto('Mật khẩu tạm *', 'a temporary handover');
    });

    it('keeps focus while a head types the one field their form has', () => {
      can.mockReturnValue(false);
      renderModal();
      typeInto('Email *', 'nuna');
    });

    it('holds every other field when a select changes', () => {
      renderModal();
      typeInto('Họ và tên *', 'Le');
      typeInto('Email *', 'le');
      typeInto('Mật khẩu tạm *', 'a temporary handover');

      const role = screen.getByLabelText('Chức vụ *');
      fireEvent.change(role, { target: { value: 'DEPARTMENT_HEAD' } });

      // The select keeps its own choice, and nothing typed before it is lost.
      expect(role).toHaveValue('DEPARTMENT_HEAD');
      expect(screen.getByLabelText('Họ và tên *')).toHaveValue('Le');
      expect(screen.getByLabelText('Email *')).toHaveValue('le');
      expect(screen.getByLabelText('Mật khẩu tạm *')).toHaveValue('a temporary handover');
    });

    it('keeps focus on the department picker while it is being used', async () => {
      renderModalWithoutDepartment();

      const picker = await screen.findByLabelText('Phòng ban *');
      picker.focus();
      fireEvent.change(picker, { target: { value: OTHER_DEPARTMENT } });

      expect(picker).toHaveValue(OTHER_DEPARTMENT);
      expect(document.activeElement).toBe(picker);
    });
  });
});
