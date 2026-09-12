import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripLocation } from '@/types/trip';
import type { PlaceSuggestion, ResolvedPlace } from '@/utils/googleMaps';
import { LocationFormModal } from './LocationFormModal';

/**
 * The location form.
 *
 * ★ GOOGLE IS MOCKED AT THE ADAPTER, NEVER LOADED. `@/utils/googleMaps` is the
 * one module that talks to Google, so the suite replaces it with three
 * functions. Nothing here reaches the network, and the form is tested for what
 * it SENDS rather than for what it draws.
 *
 * ★ THERE IS NO POSITION SECTION ANY MORE, AND THAT IS THE POINT OF SEVERAL
 * TESTS BELOW. The pill, the map dialog and the two coordinate fields were
 * removed; the only way a place now gets coordinates is by PICKING a suggestion
 * in the address field, which carries them. A place typed as free text is saved
 * with none — and the server then refuses a driver's confirmation there as
 * DESTINATION_MISSING. That consequence is pinned here so it cannot be lost
 * quietly.
 */
const configured = vi.hoisted(() => ({ value: true }));

/**
 * The three administrative dropdowns, stubbed at the hook.
 *
 * They read our own API through react-query, which is a provider this suite
 * has no reason to stand up: what is under test here is the place form, not
 * whether a list of provinces arrives. Stubbed empty, the selects render and
 * stay empty — which is also the real behaviour when the source is down.
 */
vi.mock('@/hooks/useVnAdministrative', () => ({
  useProvinces: () => ({ items: [], loading: false, failed: false }),
  useDistricts: () => ({ items: [], loading: false, failed: false }),
  useWards: () => ({ items: [], loading: false, failed: false }),
}));

vi.mock('@/utils/googleMaps', () => ({
  isMapsConfigured: () => configured.value,
  searchPlaces: vi.fn(),
  resolvePlace: vi.fn(),
}));

vi.mock('@/api/tripCatalogue', () => ({
  createTripLocation: vi.fn(),
  createSharedTripLocation: vi.fn(),
  updateTripLocationById: vi.fn(),
}));

import {
  createSharedTripLocation,
  createTripLocation,
  updateTripLocationById,
} from '@/api/tripCatalogue';
import { resolvePlace, searchPlaces } from '@/utils/googleMaps';

const location = (over: Partial<TripLocation> = {}): TripLocation => ({
  id: 'l1',
  customerId: 'c1',
  name: 'Kho OSC',
  address: 'KCN Sóng Thần, Dĩ An',
  contact: 'Anh Tư',
  note: 'Cổng 2',
  provinceCode: null,
  province: null,
  districtCode: null,
  district: null,
  wardCode: null,
  ward: null,
  latitude: 10.8,
  longitude: 106.6,
  status: 'active',
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const renderForm = (editing: TripLocation | null = null, customerId: string | null = 'c1') => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <LanguageProvider>
      <LocationFormModal
        customerId={customerId}
        editing={editing}
        onClose={onClose}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  );
  return { onSaved, onClose };
};

const search = vi.mocked(searchPlaces);
const resolve = vi.mocked(resolvePlace);
const create = vi.mocked(createTripLocation);
const update = vi.mocked(updateTripLocationById);
const createShared = vi.mocked(createSharedTripLocation);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

const TCS = { id: 'p1', primary: 'Kho TCS', secondary: 'Thuận An, Bình Dương' };
const TCS_PLACE: ResolvedPlace = {
  address: 'Đường số 3, KCN VSIP 1, Thuận An',
  latitude: 10.9,
  longitude: 106.72,
  province: 'Tỉnh Bình Dương',
  ward: 'Phường Bình Hòa',
};

/** The empty administrative set every body carries when nothing was chosen. */
const NO_ADMIN_AREA = {
  provinceCode: null,
  province: null,
  districtCode: null,
  district: null,
  wardCode: null,
  ward: null,
};

describe('LocationFormModal with a map', () => {
  beforeEach(() => {
    configured.value = true;
    // The address field searches as it is typed, so a stand-in that answers
    // only the one query the tests pick from keeps every other typing quiet.
    search.mockReset().mockImplementation(async (input) => (input === 'Kho TCS' ? [TCS] : []));
    resolve.mockReset();
    create.mockReset();
    update.mockReset();
    createShared.mockReset();
  });

  it('★ picking a suggestion writes the address AND carries its coordinates into the save', async () => {
    resolve.mockResolvedValue(TCS_PLACE);
    create.mockResolvedValue(location({ id: 'l9', name: 'Kho TCS' }));
    renderForm();

    type('Tên địa điểm', 'Kho TCS');
    type('Địa chỉ', 'Kho TCS');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Kho TCS'));
    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' })));

    // The address reads as the place wrote it.
    await waitFor(() => expect(screen.getByLabelText('Địa chỉ')).toHaveValue(TCS_PLACE.address));

    // ★ AND THE POSITION CAME WITH IT, invisibly. With the coordinate fields
    // gone this is the ONLY way a new place is located, so the proof has to be
    // the request rather than anything on screen.
    save();
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('c1', {
        name: 'Kho TCS',
        address: TCS_PLACE.address,
        contact: null,
        note: null,
        ...NO_ADMIN_AREA,
        latitude: 10.9,
        longitude: 106.72,
      }),
    );
  });

  it('★ a free-text address nobody picked is saved WITHOUT coordinates — the geofence gap, pinned', async () => {
    create.mockResolvedValue(location({ id: 'l9', latitude: null, longitude: null }));
    renderForm();

    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Số 5 ngõ nhỏ, không có trên bản đồ');
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(await screen.findByText('Không tìm thấy địa điểm phù hợp.')).toBeInTheDocument();

    save();

    // ⚠ THE PLACE IS CREATED, AND IT IS NOT LOCATED. The server will refuse a
    // driver's PICKUP_CONFIRMED there with DESTINATION_MISSING. Nothing in this
    // dialog can fix that any more: the position section was removed, so the
    // only remedy is picking a place the map knows.
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ latitude: null, longitude: null }),
      ),
    );
  });

  it('★ editing a located place keeps its coordinates, though nothing shows them', async () => {
    update.mockResolvedValue(location());
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    type('Tên địa điểm', 'Kho OSC 2');
    save();

    // The form no longer displays the pair, and must not silently drop it —
    // that would un-locate every place the moment somebody fixed a typo.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ latitude: 10.8, longitude: 106.6 }),
      ),
    );
  });

  it('does not search the address an existing place opened with', async () => {
    renderForm(location());
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));
    expect(search).not.toHaveBeenCalled();
  });

  it('does not search below three characters', async () => {
    renderForm();
    type('Địa chỉ', 'Kh');
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));
    expect(search).not.toHaveBeenCalled();
  });

  it('★ a search that comes back after the query shrank does not repopulate the list', async () => {
    let release: (rows: PlaceSuggestion[]) => void = () => {};
    search.mockImplementation(
      () =>
        new Promise<PlaceSuggestion[]>((resolveSearch) => {
          release = resolveSearch;
        }),
    );
    renderForm();

    type('Địa chỉ', 'Kho TCS');
    await waitFor(() => expect(search).toHaveBeenCalled());
    // The operator clears it while the request is still on the wire.
    type('Địa chỉ', '');

    await act(async () => {
      release([TCS]);
    });

    expect(screen.queryByRole('button', { name: /Kho TCS/ })).toBeNull();
  });

  it('names a failed search and keeps the form usable', async () => {
    search.mockRejectedValue(new Error('network'));
    renderForm();

    type('Địa chỉ', 'Kho TCS');

    expect(await screen.findByText(/Không tìm được/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('creates under the customer it was opened for', async () => {
    create.mockResolvedValue(location({ id: 'l9', name: 'Kho mới' }));
    renderForm();

    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Thủ Dầu Một');
    save();

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('c1', {
        name: 'Kho mới',
        address: 'Thủ Dầu Một',
        contact: null,
        note: null,
        ...NO_ADMIN_AREA,
        latitude: null,
        longitude: null,
      }),
    );
  });

  it('★ opened with no customer, it creates a SHARED place — a different endpoint, not a null argument', async () => {
    createShared.mockResolvedValue(location({ id: 'l9', customerId: null, name: 'Cảng Cát Lái' }));
    renderForm(null, null);

    type('Tên địa điểm', 'Cảng Cát Lái');
    type('Địa chỉ', 'Đường Nguyễn Thị Định, TP. Thủ Đức');
    save();

    await waitFor(() =>
      expect(createShared).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cảng Cát Lái' })),
    );
    // The per-customer endpoint is the one that would file it under somebody.
    expect(create).not.toHaveBeenCalled();
  });

  it('★ an edit goes by id, whoever owns the row — the customer it was opened with is not restated', async () => {
    update.mockResolvedValue(location());
    renderForm(location({ id: 'l4' }));

    type('Tên địa điểm', 'Kho OSC 2');
    save();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('l4', expect.objectContaining({ name: 'Kho OSC 2' })),
    );
  });

  it('★ keeps the contact and the note the row already had, though neither is asked for', async () => {
    update.mockResolvedValue(location());
    renderForm(location());

    type('Tên địa điểm', 'Kho OSC 2');
    save();

    // The two fields were removed from the form, not from the record. Sending
    // them back as null would blank them on every correction.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ contact: 'Anh Tư', note: 'Cổng 2' }),
      ),
    );
  });
});

describe('LocationFormModal without a map', () => {
  beforeEach(() => {
    configured.value = false;
    search.mockReset();
    create.mockReset();
  });

  it('★ offers no suggestions at all, so nothing created here can be located', async () => {
    renderForm();

    type('Địa chỉ', 'Số 5 ngõ nhỏ');
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));

    expect(search).not.toHaveBeenCalled();
  });

  it('★ saves, unlocated, through the same endpoint', async () => {
    create.mockResolvedValue(location({ id: 'l9', latitude: null, longitude: null }));
    renderForm();

    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Thủ Dầu Một');
    save();

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ latitude: null, longitude: null }),
      ),
    );
  });
});
