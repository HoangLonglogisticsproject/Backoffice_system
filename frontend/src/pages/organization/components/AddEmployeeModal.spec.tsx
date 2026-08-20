import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddEmployeeModal } from './AddEmployeeModal';
import { LanguageProvider } from '@/contexts/LanguageContext';

const createUser = vi.fn();
const requestAccountInvitation = vi.fn();
const can = vi.fn();

vi.mock('@/lib/api/users.repository', () => ({
  createUser: (...args: unknown[]) => createUser(...args),
}));
vi.mock('@/lib/api/account-invitation.repository', () => ({
  requestAccountInvitation: (...args: unknown[]) => requestAccountInvitation(...args),
}));
vi.mock('@/lib/session/SessionProvider', () => ({
  useSession: () => ({ can }),
}));

const DEPARTMENT = '7ce2630e-0000-4000-8000-000000000000';

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

describe('AddEmployeeModal', () => {
  beforeEach(() => {
    createUser.mockReset().mockResolvedValue({});
    requestAccountInvitation.mockReset().mockResolvedValue({});
    can.mockReset();
  });

  describe('a global administrator creating directly', () => {
    beforeEach(() => can.mockReturnValue(true));

    it('asks for exactly the four fields the contract defines', () => {
      renderModal();

      expect(screen.getByLabelText('Họ và tên *')).toBeInTheDocument();
      expect(screen.getByLabelText('Email *')).toBeInTheDocument();
      const password = screen.getByLabelText('Mật khẩu khởi tạo');
      expect(password).toBeInTheDocument();
      // The TEMPORARY floor, not the permanent 12 — and never the browser's
      // saved credential for the administrator themselves.
      expect(password).toHaveAttribute('minLength', '8');
      expect(password).toHaveAttribute('autoComplete', 'new-password');
      // The department comes from the route, so there is nothing to choose.
      expect(screen.queryByLabelText(/phòng ban|department/i)).not.toBeInTheDocument();
    });

    it('offers NO role selector — POST /users has no role field', () => {
      renderModal();

      expect(screen.queryByLabelText(/role|vai trò|chức vụ/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/superadmin|department_head/i)).not.toBeInTheDocument();
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
      fireEvent.change(screen.getByLabelText('Email *'), {
        target: { value: 'new@hoanglong.test' },
      });
      fireEvent.change(screen.getByLabelText('Mật khẩu khởi tạo'), {
        target: { value: 'a temporary handover' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu|save/i }));

      await waitFor(() =>
        expect(createUser).toHaveBeenCalledWith({
          displayName: 'New Comer',
          email: 'new@hoanglong.test',
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
    expect(screen.queryByLabelText('Mật khẩu khởi tạo')).not.toBeInTheDocument();
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

    it('raises an invitation rather than creating an account', async () => {
      renderModal();

      fireEvent.change(screen.getByLabelText('Email *'), {
        target: { value: 'colleague@hoanglong.test' },
      });
      fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

      await waitFor(() =>
        expect(requestAccountInvitation).toHaveBeenCalledWith(
          DEPARTMENT,
          'colleague@hoanglong.test',
        ),
      );
      expect(createUser).not.toHaveBeenCalled();
    });
  });

  it('shows the server’s refusal rather than guessing at one', async () => {
    can.mockReturnValue(false);
    const { ApiError } = await import('@/lib/http/apiError');
    requestAccountInvitation.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'That address already has an account.'),
    );

    renderModal();
    fireEvent.change(screen.getByLabelText('Email *'), {
      target: { value: 'taken@hoanglong.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /gửi đề nghị|submit request/i }));

    // The server knows about duplicates and domain allowlists; this form does not.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That address already has an account.'),
    );
  });
});
