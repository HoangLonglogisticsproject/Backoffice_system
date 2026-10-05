import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TripMasterDataPage from './TripMasterDataPage';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { currentMonthRange } from '@/utils/format/datetime';

const fetchTripVehicles = vi.fn();
const fetchTripCustomers = vi.fn();
const createTripVehicle = vi.fn();
const createTripCustomer = vi.fn();
const updateTripVehicle = vi.fn();
const updateTripCustomer = vi.fn();
const archiveTripVehicle = vi.fn();
const archiveTripCustomer = vi.fn();
const useSession = vi.fn();
const fetchVehicleCosts = vi.fn();

const fetchTripLocations = vi.fn();
const createTripLocation = vi.fn();
const archiveTripLocation = vi.fn();
const updateTripLocationById = vi.fn();

/**
 * The two administrative dropdowns, stubbed at the hook.
 *
 * They read our own API through react-query, which is a provider this suite
 * has no reason to stand up: what is under test here is the place form, not
 * whether a list of provinces arrives. Stubbed empty, the selects render and
 * stay empty — which is also the real behaviour when the source is down.
 */
vi.mock('@/hooks/useVnAdministrative', () => ({
  useProvinces: () => ({ items: [], loading: false, failed: false }),
  useWards: () => ({ items: [], loading: false, failed: false }),
}));

vi.mock('@/api/tripCatalogue', () => ({
  fetchTripVehicles: (...a: unknown[]) => fetchTripVehicles(...a),
  fetchTripCustomers: (...a: unknown[]) => fetchTripCustomers(...a),
  createTripVehicle: (...a: unknown[]) => createTripVehicle(...a),
  createTripCustomer: (...a: unknown[]) => createTripCustomer(...a),
  updateTripVehicle: (...a: unknown[]) => updateTripVehicle(...a),
  updateTripCustomer: (...a: unknown[]) => updateTripCustomer(...a),
  archiveTripVehicle: (...a: unknown[]) => archiveTripVehicle(...a),
  archiveTripCustomer: (...a: unknown[]) => archiveTripCustomer(...a),
  fetchTripLocations: (...a: unknown[]) => fetchTripLocations(...a),
  createTripLocation: (...a: unknown[]) => createTripLocation(...a),
  updateTripLocationById: (...a: unknown[]) => updateTripLocationById(...a),
  archiveTripLocation: (...a: unknown[]) => archiveTripLocation(...a),
}));
vi.mock('@/api/vehicleCost', () => ({
  fetchVehicleCosts: (...a: unknown[]) => fetchVehicleCosts(...a),
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
  dailyFuelCheckRequired: false,
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
    useSession.mockReset().mockReturnValue(
      session(['trip.read', 'vehicle.create', 'customer.create', 'location.create', 'trip.write']),
    );
  });

  describe('the two catalogues', () => {
    it('★ opens on the vehicles, showing the plate the way every other screen draws it', async () => {
      renderPage();

      // ★ THE ROW IS `formatPlate` OF THE STORED STRING, NOT THE STORED STRING.
      // This screen used to print the column verbatim — "the punctuation is
      // theirs" — and the catalogue was the one place `50AA12333` sat beside
      // `51C-4265` while the board, the driver and the export all agreed. A
      // spelling is not a fact about a lorry: the fixture is stored as
      // `51D.65233` and is read here as the same plate every other site draws.
      expect(await screen.findByText('51D-65233')).toBeTruthy();
    });

    it('switches to the customers without re-reading the vehicles', async () => {
      renderPage();
      await screen.findByText('51D-65233');

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
    it('offers "add vehicle" to a holder of vehicle.create', async () => {
      useSession.mockReturnValue(session(['trip.read', 'vehicle.create']));
      renderPage();

      expect(await screen.findByRole('button', { name: 'Thêm xe' })).toBeTruthy();
    });

    it('★ offers a booker without vehicle.create the customer "add" and not the vehicle one (DL-112)', async () => {
      // A salesperson: files customers, never a lorry. The server refuses the
      // POST regardless; the control is simply not drawn.
      useSession.mockReturnValue(session(['trip.read', 'customer.create', 'location.create']));
      renderPage();
      await screen.findByText('51D-65233');
      expect(screen.queryByRole('button', { name: 'Thêm xe' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
      expect(await screen.findByRole('button', { name: 'Thêm khách hàng' })).toBeTruthy();
    });

    it('★ offers no edit or archive control without trip.write', async () => {
      // Adding is `vehicle.create`; RENAMING changes what every past trip
      // appears to say, which is why it is not the same key.
      useSession.mockReturnValue(session(['trip.read', 'vehicle.create']));
      renderPage();
      await screen.findByText('51D-65233');

      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lưu trữ' })).toBeNull();
      expect(screen.queryByText('Thao tác')).toBeNull();
    });

    it('hides the add button from a caller without trip.create', async () => {
      useSession.mockReturnValue(session(['trip.read']));
      renderPage();
      await screen.findByText('51D-65233');

      expect(screen.queryByRole('button', { name: 'Thêm xe' })).toBeNull();
    });

    it('renders a 403 as a state, and does not sign anybody out', async () => {
      const { ApiError } = await import('@/utils/errors');
      fetchTripVehicles.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not allowed.'));
      renderPage();

      expect(await screen.findByText('Không có quyền')).toBeTruthy();
    });
  });


  /**
   * ★ PLACES LIVE UNDER THEIR CUSTOMER. No tab, no sidebar entry, no global
   * list: the door is the customer's row. What the panel says about each
   * place is the one thing a dispatcher needs before a trip — whether it has
   * been located.
   */
  describe('★ a customer’s places', () => {
    const location = (over: Record<string, unknown> = {}) => ({
      id: 'l1',
      customerId: 'c1',
      name: 'Kho OSC',
      address: 'KCN Sóng Thần',
      contact: null,
      note: null,
      latitude: 10.8,
      longitude: 106.6,
      status: 'active',
      createdBy: 'u9',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      ...over,
    });

    const openPlaces = async (permissions = ['trip.read', 'location.create', 'trip.write']) => {
      useSession.mockReturnValue(session(permissions));
      fetchTripCustomers.mockResolvedValue([customer()]);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Khách hàng' }));
      await screen.findByText('VIỄN ĐẠT');
      fireEvent.click(screen.getByRole('button', { name: 'Địa điểm' }));
      await waitFor(() => expect(fetchTripLocations).toHaveBeenCalledWith('c1', false));
    };

    beforeEach(() => {
      fetchTripLocations.mockReset().mockResolvedValue([]);
      createTripLocation.mockReset();
      archiveTripLocation.mockReset();
    });

    it('★ opens from the customer’s row and asks for that customer’s places only', async () => {
      fetchTripLocations.mockResolvedValue([
        location(),
        location({ id: 'l2', name: 'Nhà máy Bình Dương', latitude: null, longitude: null }),
      ]);
      await openPlaces();

      expect(await screen.findByText('Kho OSC')).toBeInTheDocument();
      expect(screen.getByText('Đã định vị')).toBeInTheDocument();
      expect(screen.getByText('Nhà máy Bình Dương')).toBeInTheDocument();
      expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
      expect(fetchTripLocations).toHaveBeenCalledTimes(1);
    });

    it('says the customer has no places yet', async () => {
      await openPlaces();
      expect(await screen.findByText('Khách hàng chưa có địa điểm.')).toBeInTheDocument();
    });

    it('★ adds a place under that customer, unlocated when no coordinates were typed', async () => {
      createTripLocation.mockResolvedValue(location({ id: 'l9', name: 'Kho mới' }));
      await openPlaces();

      fireEvent.click(await screen.findByRole('button', { name: 'Thêm địa điểm' }));
      fireEvent.change(await screen.findByLabelText('Tên địa điểm'), { target: { value: 'Kho mới' } });
      fireEvent.change(screen.getByLabelText('Địa chỉ'), { target: { value: 'Thủ Dầu Một' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      // ⚠ UNLOCATED, BECAUSE NOBODY LOCATED IT. A free-typed address carries no
      // coordinates; the form says "Chưa định vị" and still saves, because a
      // place is real before anybody has located it. Until somebody picks a
      // suggestion, drops a pin or types the pair, the server refuses a
      // driver's confirmation there as DESTINATION_MISSING.
      await waitFor(() =>
        expect(createTripLocation).toHaveBeenCalledWith('c1', {
          name: 'Kho mới',
          address: 'Thủ Dầu Một',
          contact: null,
          note: null,
          provinceCode: null,
          province: null,
          districtCode: null,
          district: null,
          wardCode: null,
          ward: null,
          latitude: null,
          longitude: null,
        }),
      );
    });

    it('★ keeps an existing place’s coordinates through an edit, though nothing shows them', async () => {
      fetchTripLocations.mockResolvedValue([location({ latitude: 10.8, longitude: 106.6 })]);
      updateTripLocationById.mockResolvedValue(location());
      await openPlaces();
      await screen.findByText('Kho OSC');

      // The pencil INSIDE the places dialog, not the catalogue row behind it.
      const places = within(screen.getByRole('dialog'));
      fireEvent.click(places.getAllByRole('button', { name: 'Sửa' })[0]!);
      fireEvent.change(await screen.findByLabelText('Tên địa điểm'), { target: { value: 'Kho OSC 2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      // Dropping the pair on every correction would un-locate the whole
      // catalogue one typo at a time.
      await waitFor(() =>
        expect(updateTripLocationById).toHaveBeenCalledWith(
          'l1',
          expect.objectContaining({ latitude: 10.8, longitude: 106.6 }),
        ),
      );
    });

    it('archives a place, after asking', async () => {
      fetchTripLocations.mockResolvedValue([location()]);
      archiveTripLocation.mockResolvedValue(location({ status: 'archived' }));
      await openPlaces();
      await screen.findByText('Kho OSC');

      const archives = screen.getAllByRole('button', { name: 'Lưu trữ' });
      fireEvent.click(archives[archives.length - 1]!);
      const confirms = screen.getAllByRole('button', { name: 'Lưu trữ' });
      fireEvent.click(confirms[confirms.length - 1]!);

      await waitFor(() => expect(archiveTripLocation).toHaveBeenCalledWith('c1', 'l1'));
    });


    it('★ sends ONE archive request for a double click, holding both controls while it is in flight', async () => {
      fetchTripLocations.mockResolvedValue([location()]);
      let release!: () => void;
      archiveTripLocation.mockImplementation(() => new Promise((resolve) => { release = () => resolve(location({ status: 'archived' })); }));
      await openPlaces();
      await screen.findByText('Kho OSC');

      const archives = screen.getAllByRole('button', { name: 'Lưu trữ' });
      fireEvent.click(archives[archives.length - 1]!);
      const confirms = screen.getAllByRole('button', { name: 'Lưu trữ' });
      const confirm = confirms[confirms.length - 1]!;
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.click(confirm);

      await waitFor(() => expect(archiveTripLocation).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Hủy bỏ' })).toBeDisabled();

      release();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Đang lưu…' })).toBeNull());
      expect(archiveTripLocation).toHaveBeenCalledTimes(1);
    });

    it('★ offers no "add" under a retired customer, while its places stay readable', async () => {
      fetchTripLocations.mockResolvedValue([location()]);
      useSession.mockReturnValue(session(['trip.read', 'location.create', 'trip.write']));
      fetchTripCustomers.mockResolvedValue([customer({ status: 'archived' })]);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Khách hàng' }));
      await screen.findByText('VIỄN ĐẠT');
      fireEvent.click(screen.getByRole('button', { name: 'Địa điểm' }));

      expect(await screen.findByText('Kho OSC')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Thêm địa điểm' })).toBeNull();
    });

    it('★ shows a reader the places but no way to change them', async () => {
      fetchTripLocations.mockResolvedValue([location()]);
      await openPlaces(['trip.read']);

      expect(await screen.findByText('Kho OSC')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Thêm địa điểm' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    });

    /**
     * ★ READINESS, AND THE FIX BESIDE IT. "Located" means the row has
     * coordinates a driver can be checked against — nothing about any
     * driver's reading. The unlocated row gets the one action that resolves
     * it, for whoever may edit places, and it opens the existing dialog.
     */
    describe('★ location readiness', () => {
      const unlocated = () => location({ id: 'l2', name: 'Nhà máy Bình Dương', latitude: null, longitude: null });

      it('offers "Thiết lập vị trí" on an unlocated place, and opens the existing dialog on that place', async () => {
        fetchTripLocations.mockResolvedValue([location(), unlocated()]);
        await openPlaces();
        await screen.findByText('Nhà máy Bình Dương');

        expect(screen.getByText('Đã định vị')).toBeInTheDocument();
        expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
        // One setup action: the located row has nothing to set up.
        const setups = screen.getAllByRole('button', { name: 'Thiết lập vị trí' });
        expect(setups).toHaveLength(1);

        fireEvent.click(setups[0]!);

        expect(await screen.findByText('Sửa địa điểm')).toBeInTheDocument();
        expect(screen.getByLabelText('Tên địa điểm')).toHaveValue('Nhà máy Bình Dương');
        expect(screen.getByLabelText('Địa chỉ')).toHaveValue('KCN Sóng Thần');
        // ★ AND THE DIALOG OPENS ON THE POSITION PROBLEM. "Thiết lập vị trí" on
        // the row is the same form the pencil opens, so the section that says
        // "Chưa định vị" and offers the map is right there — which is the whole
        // point of naming the action for the job.
        // Scoped to the FORM, not to a dialog: the places modal and the
        // location form are both dialogs, so `getByRole('dialog')` is
        // ambiguous the moment the second one opens.
        const form = document.querySelector('#location-form') as HTMLElement;
        expect(document.querySelectorAll('#location-form')).toHaveLength(1);
        expect(within(form).getByText('Chưa định vị')).toBeInTheDocument();
      });

      it('★ shows a reader "Chưa định vị" and no setup action', async () => {
        fetchTripLocations.mockResolvedValue([unlocated()]);
        await openPlaces(['trip.read']);

        expect(await screen.findByText('Chưa định vị')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Thiết lập vị trí' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
      });

      it('shows a dispatcher who may add but not edit the readiness, and no setup action', async () => {
        fetchTripLocations.mockResolvedValue([unlocated()]);
        await openPlaces(['trip.read', 'trip.create']);

        expect(await screen.findByText('Chưa định vị')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Thiết lập vị trí' })).toBeNull();
      });
    });
  });

  describe('adding a row', () => {
    /**
     * ★ THE PLAIN PLATE IS WHAT TRAVELS, WHATEVER WAS TYPED.
     *
     * 0011 generates `plate_key` as the plate with punctuation stripped and
     * upper-cased, and matches on it. Sending that same string means the value
     * stored and the value matched on are one string — so the four spellings the
     * workbook accumulated (`50H44266` beside `50H-49266`) cannot come back.
     * The dash is put in for READING, by `formatPlate`, at every display site.
     */
    it('★ sends the plate with no separator, however it was typed', async () => {
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50H-44266' } });
      fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
        target: { value: 'xe nhà' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H44266', note: 'xe nhà', dailyFuelCheckRequired: false }),
      );
    });

    it('★ shows the dash back while it is being typed', async () => {
      // The field reads as a plate; the state underneath is the payload.
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      const plate = screen.getByLabelText('Biển số *') as HTMLInputElement;
      fireEvent.change(plate, { target: { value: '50AA123333' } });

      expect(plate.value).toBe('50AA-123333');
    });

    it('upper-cases the series letter, so one lorry cannot become two', async () => {
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50h44266' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H44266', note: null, dailyFuelCheckRequired: false }),
      );
    });

    it('stores an untouched note as null rather than as an empty string', async () => {
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50H-44266' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H44266', note: null, dailyFuelCheckRequired: false }),
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
      await screen.findByText('51D-65233');

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
      await screen.findByText('51D-65233');

      fireEvent.click(actionButton('Sửa'));

      expect(await screen.findByRole('heading', { name: 'Sửa xe' })).toBeTruthy();
      // ★ SEEDED FROM THE ROW, SHOWN IN THE ONE SPELLING. The catalogue still
      // holds `51D.65233`; the list and this field both read it through
      // `formatPlate`, so what was clicked and what is being corrected are the
      // same string on screen. Only the payload is the stripped form.
      expect((screen.getByLabelText('Biển số *') as HTMLInputElement).value).toBe('51D-65233');
    });

    it('sends the correction to the row it was opened on', async () => {
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(actionButton('Sửa'));
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '51D-65234' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(updateTripVehicle).toHaveBeenCalledWith('v1', { plate: '51D65234', note: null, dailyFuelCheckRequired: false }),
      );
    });
  });

  describe('★ "Khai nhiên liệu đầu ngày" — a real flag on the lorry, never the note', () => {
    it('shows each lorry’s policy in the list', async () => {
      fetchTripVehicles.mockResolvedValue([vehicle({ dailyFuelCheckRequired: true })]);
      renderPage();

      expect(await screen.findByRole('columnheader', { name: 'Khai nhiên liệu đầu ngày' })).toBeTruthy();
      expect(await screen.findByRole('cell', { name: 'Bắt buộc' })).toBeTruthy();
    });

    it('adds a lorry with the policy on, as `dailyFuelCheckRequired: true`', async () => {
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));
      // Off by default: a new lorry is not gated unless somebody says so.
      expect(screen.getByRole('radio', { name: 'Không áp dụng' })).toBeChecked();
      fireEvent.change(screen.getByLabelText('Biển số *'), { target: { value: '50H44266' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Bắt buộc' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(createTripVehicle).toHaveBeenCalledWith({ plate: '50H44266', note: null, dailyFuelCheckRequired: true }),
      );
    });

    it('seeds the policy from the row, and turns it off', async () => {
      fetchTripVehicles.mockResolvedValue([vehicle({ dailyFuelCheckRequired: true })]);
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(actionButton('Sửa'));
      expect(screen.getByRole('radio', { name: 'Bắt buộc' })).toBeChecked();
      fireEvent.click(screen.getByRole('radio', { name: 'Không áp dụng' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() =>
        expect(updateTripVehicle).toHaveBeenCalledWith('v1', { plate: '51D65233', note: null, dailyFuelCheckRequired: false }),
      );
    });

    it('says in words why a hired lorry cannot take it', async () => {
      const { ApiError } = await import('@/utils/errors');
      updateTripVehicle.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'A hired lorry…', { dailyFuelCheckRequired: 'OUTSOURCED_VEHICLE' }),
      );
      renderPage();
      await screen.findByText('51D-65233');

      fireEvent.click(actionButton('Sửa'));
      fireEvent.click(screen.getByRole('radio', { name: 'Bắt buộc' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Xe thuê ngoài đã gồm nhiên liệu trong giá thuê');
    });
  });

  describe('★ "Chi phí xe" — the lorry’s own ledger, read only', () => {
    const fill = (over: Record<string, unknown> = {}) => ({
      id: 'vc1',
      vehicleId: 'v1',
      businessDate: '2026-10-04',
      category: 'fuel',
      amount: '650000.00',
      liters: '42.50',
      odometerKm: 182345,
      note: null,
      source: 'driver_portal',
      sourceTripId: 't1',
      sourceTrip: { id: 't1', scheduledOn: '2026-10-03', customerName: 'VIỄN ĐẠT' },
      sourceAssignmentId: 'a1',
      createdBy: 'd1',
      createdByUser: { id: 'd1', displayName: 'Tài Xế A' },
      createdAt: '2026-10-04T11:37:00.000Z',
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      ...over,
    });
    const ledger = (items: unknown[], totalAmount: string) => ({
      items,
      page: 1,
      limit: 200,
      total: items.length,
      totalPages: items.length === 0 ? 0 : 1,
      totalAmount,
    });
    const openCosts = async () => {
      await screen.findByText('51D-65233');
      fireEvent.click(screen.getByRole('button', { name: 'Chi phí xe' }));
      return screen.findByRole('dialog');
    };

    beforeEach(() => {
      useSession.mockReturnValue(session(['trip.read', 'cost.read']));
      fetchVehicleCosts.mockReset().mockResolvedValue(ledger([fill()], '650000.00'));
    });

    it('★ is offered only to a holder of cost.read, and the list gains no money column', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write']));
      renderPage();
      await screen.findByText('51D-65233');

      expect(screen.queryByRole('button', { name: 'Chi phí xe' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Chi phí|Số tiền/ })).toBeNull();
      expect(fetchVehicleCosts).not.toHaveBeenCalled();
    });

    it('★ opens on the business month with the total, every detail of a fill, and its run as a reference only', async () => {
      renderPage();
      const dialog = await openCosts();

      expect(fetchVehicleCosts).toHaveBeenCalledWith('v1', currentMonthRange());
      await within(dialog).findByText('Tài Xế A');
      expect(dialog).toHaveTextContent('Tổng chi phí xe: 650,000');
      expect(dialog).toHaveTextContent('1 giao dịch');

      const row = within(dialog).getAllByRole('row')[1] as HTMLElement;
      for (const shown of ['4/10/2026', 'Dầu', '650,000', '42.50', '182,345', 'Tài xế khai', '3/10/2026', 'VIỄN ĐẠT']) {
        expect(row).toHaveTextContent(shown);
      }
      expect(within(dialog).getByRole('columnheader', { name: 'Chuyến liên quan' })).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Chuyến liên quan: chỉ dùng để truy vết nguồn phát sinh. Chi phí xe không được cộng vào chi phí chuyến.');
      expect(dialog).not.toHaveTextContent('Đang hiển thị');
    });

    it('★ says exactly how many of the range it shows when the ledger holds more than one read', async () => {
      // Several costs on one day are an ordinary ledger, not an anomaly — 0..N a lorry a day.
      const many = [fill(), fill({ id: 'vc2', amount: '120000.00' })];
      fetchVehicleCosts.mockResolvedValue({ ...ledger(many, '9999000.00'), total: 257, totalPages: 129 });
      renderPage();
      const dialog = await openCosts();

      expect(await within(dialog).findByText(/Đang hiển thị 2\/257 giao dịch mới nhất\./)).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Tổng chi phí xe: 9,999,000');
      expect(dialog).toHaveTextContent('257 giao dịch');
    });

    it('shows a dash where the driver gave no liters or odometer, and for a fill with no run', async () => {
      fetchVehicleCosts.mockResolvedValue(
        ledger([fill({ liters: null, odometerKm: null, source: 'backoffice', sourceTripId: null, sourceTrip: null, sourceAssignmentId: null })], '650000.00'),
      );
      renderPage();
      const dialog = await openCosts();

      const row = (await within(dialog).findAllByRole('row'))[1] as HTMLElement;
      expect(within(row).getAllByText('—')).toHaveLength(3);
      expect(row).toHaveTextContent('Văn phòng');
    });

    it('★ asks the server again for the range typed — never filters a page in the browser', async () => {
      renderPage();
      const dialog = await openCosts();
      await within(dialog).findByText('Tài Xế A');

      fireEvent.change(within(dialog).getByLabelText('Từ ngày'), { target: { value: '01/09/2026' } });

      await waitFor(() =>
        expect(fetchVehicleCosts).toHaveBeenLastCalledWith('v1', { from: '2026-09-01', to: currentMonthRange().to }),
      );
    });

    it('says the range holds nothing, with a zero total', async () => {
      fetchVehicleCosts.mockResolvedValue(ledger([], '0.00'));
      renderPage();
      const dialog = await openCosts();

      expect(await within(dialog).findByText('Không có chi phí xe trong khoảng ngày này.')).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Tổng chi phí xe: 0');
    });

    it('stays readable on a retired lorry — its money outlives its service', async () => {
      useSession.mockReturnValue(session(['trip.read', 'trip.write', 'cost.read']));
      fetchTripVehicles.mockResolvedValue([vehicle({ status: 'archived' })]);
      renderPage();
      await openCosts();

      expect(fetchVehicleCosts).toHaveBeenCalledWith('v1', currentMonthRange());
      expect((actionButton('Sửa') as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers no costs on a customer', async () => {
      renderPage();
      await screen.findByText('51D-65233');
      fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
      await screen.findByText('VIỄN ĐẠT');

      expect(screen.queryByRole('button', { name: 'Chi phí xe' })).toBeNull();
    });
  });

  describe('retiring a row', () => {
    it('★ says what archiving is NOT before doing it', async () => {
      // People read "lưu trữ" as a delete and worry that last month's trips
      // lose the plate they were run under. The dialog has to say they do not.
      renderPage();
      await screen.findByText('51D-65233');

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
      await screen.findByText('51D-65233');

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
      await screen.findByText('51D-65233');

      expect(screen.getByText('Đã lưu trữ')).toBeTruthy();
      expect((actionButton('Sửa') as HTMLButtonElement).disabled).toBe(true);
      expect((actionButton('Lưu trữ') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
