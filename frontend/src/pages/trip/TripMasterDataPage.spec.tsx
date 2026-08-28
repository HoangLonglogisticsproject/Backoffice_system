import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TripMasterDataPage from './TripMasterDataPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const fetchTripVehicles = vi.fn();
const fetchTripCustomers = vi.fn();
const createTripVehicle = vi.fn();
const createTripCustomer = vi.fn();
const updateTripVehicle = vi.fn();
const updateTripCustomer = vi.fn();
const archiveTripVehicle = vi.fn();
const archiveTripCustomer = vi.fn();
const useSession = vi.fn();

vi.mock('@/api/tripCatalogue', () => ({
  fetchTripVehicles: (...a: unknown[]) => fetchTripVehicles(...a),
  fetchTripCustomers: (...a: unknown[]) => fetchTripCustomers(...a),
  createTripVehicle: (...a: unknown[]) => createTripVehicle(...a),
  createTripCustomer: (...a: unknown[]) => createTripCustomer(...a),
  updateTripVehicle: (...a: unknown[]) => updateTripVehicle(...a),
  updateTripCustomer: (...a: unknown[]) => updateTripCustomer(...a),
  archiveTripVehicle: (...a: unknown[]) => archiveTripVehicle(...a),
  archiveTripCustomer: (...a: unknown[]) => archiveTripCustomer(...a),
}));
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: {
      userId: 'u1',
      username: 'dispatch',
      role: 'MEMBER',
      departmentIds: [],
      permissions,
    },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

const vehicle = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  plate: '51D.65233',
  note: null,
  status: 'active',
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'VIỄN ĐẠT',
  note: null,
  status: 'active',
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

/** A fresh cache per test, for the reason `TripSchedulePage.spec` gives. */
const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dispatch/master-data']}>
        <LanguageProvider>
          <TripMasterDataPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** The row's two icon buttons, which carry their label in an `sr-only` span. */
const actionButton = (name: 'Sửa' | 'Lưu trữ') => {
  const found = screen.getAllByRole('button', { name });
  return found[found.length - 1] as HTMLElement;
};

/**
 * The catalogue screen — the only place a misspelt plate can be corrected.
 *
 * ⚠ NONE OF THIS IS AUTHORIZATION. The server re-decides `trip.create` and
 * `trip.write` on every request; these assertions are about which controls are
 * DRAWN and what they send. A hidden button is a courtesy, never a boundary.
 */
describe('TripMasterDataPage', () => {
  beforeEach(() => {
    fetchTripVehicles.mockReset().mockResolvedValue([vehicle()]);
    fetchTripCustomers.mockReset().mockResolvedValue([customer()]);
    createTripVehicle.mockReset().mockResolvedValue(vehicle());
    createTripCustomer.mockReset().mockResolvedValue(customer());
    updateTripVehicle.mockReset().mockResolvedValue(vehicle());
    updateTripCustomer.mockReset().mockResolvedValue(customer());
    archiveTripVehicle.mockReset().mockResolvedValue(vehicle({ status: 'archived' }));
    archiveTripCustomer.mockReset().mockResolvedValue(customer({ status: 'archived' }));
    useSession.mockReset().mockReturnValue(session(['trip.read', 'trip.create', 'trip.write']));
  });

  describe('the two catalogues', () => {
    it('opens on the vehicles, showing the plate as somebody typed it', async () => {
      renderPage();

      // `51D.65233` and not a normalised form: the punctuation is theirs, and
      // only the MATCHING is the server's.
      expect(await screen.findByText('51D.65233')).toBeTruthy();
    });

    it('switches to the customers without re-reading the vehicles', async () => {
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));

      expect(await screen.findByText('VIỄN ĐẠT')).toBeTruthy();
      // Both lists are fetched by one hook on mount, so the tab is a render
      // choice rather than a request.
      expect(fetchTripVehicles).toHaveBeenCalledTimes(1);
    });

    it('★ asks for the archived rows only when the box is ticked', async () => {
      // `includeArchived` is part of the cache key, so the two variants are two
      // reads rather than one list filtered on the client.
      renderPage();
      await waitFor(() => expect(fetchTripVehicles).toHaveBeenCalledWith(false));

      fireEvent.click(screen.getByLabelText('Hiện cả mục đã lưu trữ'));

      await waitFor(() => expect(fetchTripVehicles).toHaveBeenCalledWith(true));
      expect(fetchTripCustomers).toHaveBeenCalledWith(true);
    });

    it('says the catalogue is empty rather than showing a bare table', async () => {
      fetchTripVehicles.mockResolvedValue([]);
      renderPage();

      expect(await screen.findByText('Chưa có xe nào.')).toBeTruthy();
    });
  });

  describe('what each caller is offered', () => {
    it('offers "add" to anybody holding trip.create', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.create']));
      renderPage();

      expect(await screen.findByRole('button', { name: 'Thêm xe' })).toBeTruthy();
    });

    it('★ offers no edit or archive control without trip.write', async () => {
      // Adding is `trip.create` and everybody has it; RENAMING changes what
      // every past trip appears to say, which is why it is not the same tier.
      useSession.mockReturnValue(session(['trip.read', 'trip.create']));
      renderPage();
      await screen.findByText('51D.65233');

      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lưu trữ' })).toBeNull();
      expect(screen.queryByText('Thao tác')).toBeNull();
    });

    it('hides the add button from a caller without trip.create', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();
      await screen.findByText('51D.65233');

      expect(screen.queryByRole('button', { name: 'Thêm xe' })).toBeNull();
    });

    it('renders a 403 as a state, and does not sign anybody out', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchTripVehicles.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      renderPage();

      expect(await screen.findByText('Không có quyền')).toBeTruthy();
    });
  });

  describe('adding a row', () => {
    it('sends the plate and the note, then reloads the list', async () => {
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50H-44266' } });
      fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
        target: { value: 'xe nhà' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H-44266', note: 'xe nhà' }),
      );
    });

    it('stores an untouched note as null rather than as an empty string', async () => {
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50H-44266' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H-44266', note: null }),
      );
    });

    it('★ shows the 409 verbatim, because it names the spelling already there', async () => {
      // The whole value of that message: the user typed `51D 65233` and the
      // fleet already knows the truck as `51D.65233`. A generic "could not
      // save" throws away the only part that tells them which.
      const { ApiError } = await import('@/utils/errors');
      createTripVehicle.mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'That vehicle is already in the catalogue, as “51D.65233”.'),
      );
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '51D 65233' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      expect(
        await screen.findByText('That vehicle is already in the catalogue, as “51D.65233”.'),
      ).toBeTruthy();
    });

    it('adds a CUSTOMER from the customer tab, not a vehicle', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
      await screen.findByText('VIỄN ĐẠT');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm khách hàng' }));
      fireEvent.change(screen.getByLabelText('Tên khách hàng *'), { target: { value: 'WWL' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripCustomer).toHaveBeenCalledWith({ name: 'WWL', note: null }),
      );
      expect(createTripVehicle).not.toHaveBeenCalled();
    });
  });

  describe('correcting a row', () => {
    it('★ titles the dialog "Sửa xe", and seeds it with the stored plate', async () => {
      // It said "Thêm xe" over a form pre-filled with an existing plate, which
      // reads as though saving would add a SECOND row for the same truck — the
      // exact duplicate this catalogue exists to prevent.
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(actionButton('Sửa'));

      expect(await screen.findByRole('heading', { name: 'Sửa xe' })).toBeTruthy();
      expect((screen.getByLabelText('Biển số *') as HTMLInputElement).value).toBe('51D.65233');
    });

    it('sends the correction to the row it was opened on', async () => {
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(actionButton('Sửa'));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '51D-65233' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(updateTripVehicle).toHaveBeenCalledWith('v1', { plate: '51D-65233', note: null }),
      );
    });
  });

  describe('retiring a row', () => {
    it('★ says what archiving is NOT before doing it', async () => {
      // People read "lưu trữ" as a delete and worry that last month's trips
      // lose the plate they were run under. The dialog has to say they do not.
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(actionButton('Lưu trữ'));

      expect(
        await screen.findByText(
          'Lưu trữ xe này? Các chuyến đã chạy vẫn giữ nguyên biển số — xe chỉ không còn được chọn cho chuyến mới.',
        ),
      ).toBeTruthy();
      // Nothing has happened yet — the dialog is a confirmation, not a receipt.
      expect(archiveTripVehicle).not.toHaveBeenCalled();
    });

    it('archives the vehicle on confirmation', async () => {
      renderPage();
      await screen.findByText('51D.65233');

      fireEvent.click(actionButton('Lưu trữ'));
      const [, confirm] = await screen.findAllByRole('button', { name: 'Lưu trữ' });
      fireEvent.click(confirm as HTMLElement);

      await waitFor(() => expect(archiveTripVehicle).toHaveBeenCalledWith('v1'));
    });

    it('archives the CUSTOMER from the customer tab', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
      await screen.findByText('VIỄN ĐẠT');

      fireEvent.click(actionButton('Lưu trữ'));
      const [, confirm] = await screen.findAllByRole('button', { name: 'Lưu trữ' });
      fireEvent.click(confirm as HTMLElement);

      await waitFor(() => expect(archiveTripCustomer).toHaveBeenCalledWith('c1'));
      expect(archiveTripVehicle).not.toHaveBeenCalled();
    });

    it('★ offers neither control on a row that is already retired', async () => {
      // The server answers 409 for both; the buttons are disabled rather than
      // left to produce an error the user could not have predicted.
      fetchTripVehicles.mockResolvedValue([vehicle({ status: 'archived' })]);
      renderPage();
      await screen.findByText('51D.65233');

      expect(screen.getByText('Đã lưu trữ')).toBeTruthy();
      expect((actionButton('Sửa') as HTMLButtonElement).disabled).toBe(true);
      expect((actionButton('Lưu trữ') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
