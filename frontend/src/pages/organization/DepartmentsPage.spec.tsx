import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DepartmentsPage from './DepartmentsPage';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ApiError } from '@/utils/errors';
import type { Department, EmployeeRosterRow } from '@/types/organization';

const fetchDepartments = vi.fn();
const createDepartment = vi.fn();
const updateDepartment = vi.fn();
const fetchEmployeeRoster = vi.fn();
const transferMember = vi.fn();
const assignDepartmentHead = vi.fn();
const revokeDepartmentHead = vi.fn();
const notifySuccess = vi.fn();
const notifyApiError = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/department', () => ({
  fetchDepartments: (...a: unknown[]) => fetchDepartments(...a),
  createDepartment: (...a: unknown[]) => createDepartment(...a),
  updateDepartment: (...a: unknown[]) => updateDepartment(...a),
}));
vi.mock('@/api/membership', () => ({
  fetchEmployeeRoster: (...a: unknown[]) => fetchEmployeeRoster(...a),
  transferMember: (...a: unknown[]) => transferMember(...a),
}));
vi.mock('@/api/department-head', () => ({
  assignDepartmentHead: (...a: unknown[]) => assignDepartmentHead(...a),
  revokeDepartmentHead: (...a: unknown[]) => revokeDepartmentHead(...a),
}));
vi.mock('@/utils/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/toast')>()),
  notifySuccess: (...a: unknown[]) => notifySuccess(...a),
  notifyApiError: (...a: unknown[]) => notifyApiError(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));
// The "add a new employee" dialog is its own, already-tested screen; here it
// only has to be reachable from the unit.
vi.mock('./components/AddEmployeeModal', () => ({
  AddEmployeeModal: ({ departmentId }: { departmentId: string }) => (
    <div data-testid="add-employee-modal">{departmentId}</div>
  ),
}));

const SUPERADMIN = ['unit.read', 'unit.write', 'unit.member.read', 'unit.member.write', 'role.assign', 'user.write'];

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: { userId: 'u1', username: 'root', role: 'SUPERADMIN', departmentIds: [], permissions },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const department = (over: Partial<Department> = {}): Department => ({
  id: 'd-sales',
  slug: 'sales',
  name: 'Phòng Sales',
  status: 'active',
  function: 'sales',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const member = (over: Partial<EmployeeRosterRow> & { id: string }): EmployeeRosterRow => ({
  user: { id: `user-${over.id}`, displayName: `Person ${over.id}` },
  department: { id: 'd-sales', name: 'Phòng Sales' },
  role: 'MEMBER',
  membershipStatus: 'active',
  accountStatus: 'active',
  joinedAt: '2026-08-01T00:00:00.000Z',
  endedAt: null,
  ...over,
});

const page = (items: EmployeeRosterRow[]) => ({ items, nextCursor: null, hasMore: false });

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/organization/departments']}>
        <LanguageProvider>
          <DepartmentsPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Base UI comboboxes commit on pointerup — see AdminAreaFields.spec. */
const choose = async (label: string, option: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.pointerDown(box);
  fireEvent.mouseDown(box);
  fireEvent.click(box);
  fireEvent.change(box, { target: { value: option.slice(0, 6) } });
  const chosen = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(chosen);
  fireEvent.pointerUp(chosen);
  fireEvent.click(chosen);
};

const openCreate = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm phòng' }));
  return {
    slug: screen.getByLabelText('Slug *'),
    name: screen.getByLabelText('Tên phòng *'),
    fn: screen.getByLabelText('Chức năng nghiệp vụ'),
    save: () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' })),
  };
};

describe('DepartmentsPage', () => {
  beforeEach(() => {
    fetchDepartments.mockReset().mockResolvedValue([
      department(),
      department({ id: 'd-hr', slug: 'hr', name: 'Nhân sự', function: null }),
    ]);
    fetchEmployeeRoster.mockReset().mockResolvedValue(
      page([
        member({ id: 'a', role: 'DEPARTMENT_HEAD' }),
        member({ id: 'b' }),
        member({ id: 'c', department: { id: 'd-hr', name: 'Nhân sự' } }),
      ]),
    );
    createDepartment.mockReset().mockResolvedValue(department({ id: 'd-new', slug: 'cs', name: 'CS' }));
    updateDepartment.mockReset().mockResolvedValue(department({ name: 'Kinh doanh' }));
    transferMember.mockReset().mockResolvedValue({});
    assignDepartmentHead.mockReset().mockResolvedValue({});
    revokeDepartmentHead.mockReset().mockResolvedValue({});
    notifySuccess.mockReset();
    notifyApiError.mockReset();
    useSession.mockReset().mockReturnValue(session(SUPERADMIN));
  });

  describe('the directory', () => {
    it('★ joins the units to the roster: function, head and member count on one row', async () => {
      renderPage();

      const row = (await screen.findByText('Phòng Sales')).closest('tr') as HTMLElement;
      expect(within(row).getByText('Person a')).toBeInTheDocument();
      expect(within(row).getByText('2')).toBeInTheDocument();
      expect(within(row).getByText('Sales')).toBeInTheDocument();

      const hr = screen.getByText('Nhân sự').closest('tr') as HTMLElement;
      expect(within(hr).getByText('Không phân loại')).toBeInTheDocument();
      expect(within(hr).getByText('—')).toBeInTheDocument();
      expect(within(hr).getByText('1')).toBeInTheDocument();
    });

    it('follows the roster to its last page', async () => {
      fetchEmployeeRoster
        .mockResolvedValueOnce({ items: [member({ id: 'a' })], nextCursor: 'c2', hasMore: true })
        .mockResolvedValueOnce(page([member({ id: 'b' })]));
      renderPage();

      const row = (await screen.findByText('Phòng Sales')).closest('tr') as HTMLElement;
      await waitFor(() => expect(within(row).getByText('2')).toBeInTheDocument());
      expect(fetchEmployeeRoster).toHaveBeenLastCalledWith({ limit: 200, cursor: 'c2' }, 'active');
    });

    it('says it is loading, then that there is nothing', async () => {
      fetchDepartments.mockResolvedValue([]);
      fetchEmployeeRoster.mockResolvedValue(page([]));
      renderPage();

      expect(screen.getByText('Đang tải…')).toBeInTheDocument();
      expect(await screen.findByText('Chưa có phòng ban nào.')).toBeInTheDocument();
    });

    it('★ renders a 403 as a state, with no add button for a caller without unit.write', async () => {
      useSession.mockReturnValue(session(['unit.read']));
      fetchDepartments.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      fetchEmployeeRoster.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      renderPage();

      expect(await screen.findByText('Không có quyền')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Thêm phòng' })).toBeNull();
    });

    it('renders any other failure as an error, not a blank table', async () => {
      fetchDepartments.mockRejectedValue(new ApiError(500, undefined, 'boom'));
      renderPage();

      expect(await screen.findByText('Không tải được dữ liệu.')).toBeInTheDocument();
    });
  });

  describe('creating a unit', () => {
    it('★ sends slug, name and the chosen function, then re-reads the directory', async () => {
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: 'cs' } });
      fireEvent.change(form.name, { target: { value: 'Customer Service' } });
      fireEvent.change(form.fn, { target: { value: 'customer_service' } });
      form.save();

      await waitFor(() =>
        expect(createDepartment).toHaveBeenCalledWith({
          slug: 'cs',
          name: 'Customer Service',
          function: 'customer_service',
        }),
      );
      expect(notifySuccess).toHaveBeenCalledWith('departmentCreated');
      await waitFor(() => expect(fetchDepartments).toHaveBeenCalledTimes(2));
      expect(screen.queryByLabelText('Slug *')).toBeNull();
    });

    it('sends function: null for an ordinary unit', async () => {
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: 'hr' } });
      fireEvent.change(form.name, { target: { value: 'Nhân sự' } });
      form.save();

      await waitFor(() =>
        expect(createDepartment).toHaveBeenCalledWith({ slug: 'hr', name: 'Nhân sự', function: null }),
      );
    });

    it('offers exactly the four functions and "not classified"', async () => {
      renderPage();
      const form = await openCreate();

      expect(within(form.fn).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual([
        '',
        'sales',
        'accounting',
        'dispatch',
        'customer_service',
      ]);
    });

    it('refuses a blank slug or name before any request', async () => {
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: '   ' } });
      fireEvent.submit(form.slug.closest('form') as HTMLFormElement);

      expect(await screen.findAllByText('Bắt buộc.')).toHaveLength(2);
      expect(createDepartment).not.toHaveBeenCalled();
    });

    it('★ shows the server’s field errors and message on a 422', async () => {
      createDepartment.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'Validation failed.', { slug: 'Slug đã được dùng.' }),
      );
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: 'sales' } });
      fireEvent.change(form.name, { target: { value: 'X' } });
      form.save();

      expect(await screen.findByText('Slug đã được dùng.')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Validation failed.');
      // The dialog stays open with what was typed.
      expect(screen.getByLabelText('Slug *')).toHaveValue('sales');
    });

    it('★ shows a 403 in the dialog rather than closing it', async () => {
      createDepartment.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.'));
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: 'x' } });
      fireEvent.change(form.name, { target: { value: 'X' } });
      form.save();

      expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do that.');
      expect(notifySuccess).not.toHaveBeenCalled();
    });

    it('disables the form while the request is out, so a second press cannot double-create', async () => {
      let release: (value: Department) => void = () => {};
      createDepartment.mockReturnValue(new Promise<Department>((resolve) => (release = resolve)));
      renderPage();
      const form = await openCreate();

      fireEvent.change(form.slug, { target: { value: 'x' } });
      fireEvent.change(form.name, { target: { value: 'X' } });
      form.save();

      expect(await screen.findByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
      expect(form.name).toBeDisabled();
      fireEvent.submit(form.slug.closest('form') as HTMLFormElement);
      expect(createDepartment).toHaveBeenCalledTimes(1);

      release(department({ id: 'd-x' }));
      await waitFor(() => expect(screen.queryByLabelText('Slug *')).toBeNull());
    });
  });

  describe('editing a unit', () => {
    const openEdit = async () => {
      const row = (await screen.findByText('Phòng Sales')).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Sửa' }));
    };

    it('★ seeds from the row, keeps the slug read-only, and patches name and function', async () => {
      renderPage();
      await openEdit();

      const slug = screen.getByLabelText('Slug *');
      expect(slug).toHaveValue('sales');
      expect(slug).toHaveAttribute('readonly');
      expect(screen.getByLabelText('Chức năng nghiệp vụ')).toHaveValue('sales');

      fireEvent.change(screen.getByLabelText('Tên phòng *'), { target: { value: 'Kinh doanh' } });
      fireEvent.change(screen.getByLabelText('Chức năng nghiệp vụ'), { target: { value: 'accounting' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(updateDepartment).toHaveBeenCalledWith('d-sales', { name: 'Kinh doanh', function: 'accounting' }),
      );
      expect(notifySuccess).toHaveBeenCalledWith('departmentUpdated');
      await waitFor(() => expect(fetchDepartments).toHaveBeenCalledTimes(2));
    });

    it('clears the function with an explicit null', async () => {
      renderPage();
      await openEdit();

      fireEvent.change(screen.getByLabelText('Chức năng nghiệp vụ'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(updateDepartment).toHaveBeenCalledWith('d-sales', { name: 'Phòng Sales', function: null }),
      );
    });

    it('offers no edit control without unit.write', async () => {
      useSession.mockReturnValue(session(['unit.read', 'unit.member.read']));
      renderPage();
      const row = (await screen.findByText('Phòng Sales')).closest('tr') as HTMLElement;

      expect(within(row).queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(within(row).getByRole('button', { name: 'Xem' })).toBeInTheDocument();
    });
  });

  describe('the unit’s people', () => {
    const openDetail = async () => {
      const row = (await screen.findByText('Phòng Sales')).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Xem' }));
      return screen.getByRole('dialog');
    };

    it('shows the head, the members and the slug', async () => {
      renderPage();
      const dialog = await openDetail();

      // The head is named once in the head section and once in the roster.
      expect(within(dialog).getAllByText('Person a')).toHaveLength(2);
      expect(within(dialog).getByText('Person b')).toBeInTheDocument();
      expect(within(dialog).queryByText('Person c')).toBeNull();
      expect(within(dialog).getByText('Thành viên (2)')).toBeInTheDocument();
    });

    it('★ moves somebody in through the transfer route, and re-reads', async () => {
      renderPage();
      await openDetail();

      await choose('Nhân viên cần chuyển', 'Person c — Nhân sự');
      fireEvent.click(screen.getByRole('button', { name: 'Chuyển vào phòng' }));

      await waitFor(() => expect(transferMember).toHaveBeenCalledWith('d-sales', 'user-c'));
      expect(notifySuccess).toHaveBeenCalledWith('memberTransferred');
      await waitFor(() => expect(fetchEmployeeRoster).toHaveBeenCalledTimes(2));
    });

    it('surfaces the server’s refusal of a transfer', async () => {
      transferMember.mockRejectedValue(new ApiError(409, 'CONFLICT', 'That department is archived.'));
      renderPage();
      await openDetail();

      await choose('Nhân viên cần chuyển', 'Person c — Nhân sự');
      fireEvent.click(screen.getByRole('button', { name: 'Chuyển vào phòng' }));

      await waitFor(() => expect(notifyApiError).toHaveBeenCalled());
      expect(notifySuccess).not.toHaveBeenCalled();
    });

    it('reaches the existing add-employee dialog for this unit', async () => {
      renderPage();
      await openDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
      expect(screen.getByTestId('add-employee-modal')).toHaveTextContent('d-sales');
    });

    it('offers no transfer, no appointment and no add without the keys', async () => {
      useSession.mockReturnValue(session(['unit.read', 'unit.member.read']));
      renderPage();
      const dialog = await openDetail();

      expect(within(dialog).queryByLabelText('Nhân viên cần chuyển')).toBeNull();
      expect(within(dialog).queryByLabelText('Thành viên bổ nhiệm')).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Thêm nhân viên' })).toBeNull();
    });
  });

  describe('the head', () => {
    const openDetail = async (name = 'Phòng Sales') => {
      const row = (await screen.findByText(name)).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Xem' }));
    };

    it('★ appoints a member where nobody holds it — one POST, no DELETE', async () => {
      renderPage();
      await openDetail('Nhân sự');

      await choose('Thành viên bổ nhiệm', 'Person c');
      fireEvent.click(screen.getByRole('button', { name: 'Bổ nhiệm' }));

      await waitFor(() => expect(assignDepartmentHead).toHaveBeenCalledWith('d-hr', 'user-c'));
      expect(revokeDepartmentHead).not.toHaveBeenCalled();
      expect(notifySuccess).toHaveBeenCalledWith('headAssigned');
      await waitFor(() => expect(fetchEmployeeRoster).toHaveBeenCalledTimes(2));
    });

    it('★ replaces a head as DELETE then POST — the order the unique index demands', async () => {
      renderPage();
      await openDetail();

      await choose('Thành viên bổ nhiệm', 'Person b');
      fireEvent.click(screen.getByRole('button', { name: 'Thay trưởng phòng' }));

      await waitFor(() => expect(assignDepartmentHead).toHaveBeenCalledWith('d-sales', 'user-b'));
      expect(revokeDepartmentHead).toHaveBeenCalledWith('d-sales');
      expect(revokeDepartmentHead.mock.invocationCallOrder[0]).toBeLessThan(
        assignDepartmentHead.mock.invocationCallOrder[0] as number,
      );
    });

    it('does not offer the sitting head as a candidate for their own seat', async () => {
      renderPage();
      await openDetail();

      const box = screen.getByLabelText('Thành viên bổ nhiệm');
      fireEvent.pointerDown(box);
      fireEvent.mouseDown(box);
      fireEvent.click(box);
      expect(await screen.findByRole('option', { name: 'Person b' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Person a' })).toBeNull();
    });

    it('revokes the head, and re-reads', async () => {
      renderPage();
      await openDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Bãi nhiệm' }));

      await waitFor(() => expect(revokeDepartmentHead).toHaveBeenCalledWith('d-sales'));
      expect(assignDepartmentHead).not.toHaveBeenCalled();
      expect(notifySuccess).toHaveBeenCalledWith('headRevoked');
      await waitFor(() => expect(fetchEmployeeRoster).toHaveBeenCalledTimes(2));
    });

    it('★ shows the server’s refusal — the invariant is the database’s, not the form’s', async () => {
      assignDepartmentHead.mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'That person is not an active member of this department.'),
      );
      renderPage();
      await openDetail('Nhân sự');

      await choose('Thành viên bổ nhiệm', 'Person c');
      fireEvent.click(screen.getByRole('button', { name: 'Bổ nhiệm' }));

      await waitFor(() => expect(notifyApiError).toHaveBeenCalled());
      expect(notifySuccess).not.toHaveBeenCalled();
    });
  });
});
