import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripLocation } from '@/types/trip';
import type { Coordinates, PlaceSuggestion, ResolvedPlace } from '@/utils/googleMaps';
import { LocationFormModal } from './LocationFormModal';

/**
 * The location form with a map configured.
 *
 * ★ GOOGLE IS MOCKED AT THE ADAPTER, NEVER LOADED. `@/utils/googleMaps` is
 * the one module that talks to Google, so the suite replaces it with three
 * functions and the map with a stand-in that exposes what the real one does:
 * the pin it was given, and a way to move it. Nothing here reaches the
 * network, and the form is tested for what it sends — the same body the
 * existing endpoint has always taken.
 *
 * ★ AND THE OPERATOR NEVER TYPES A COORDINATE. Every located outcome below is
 * reached through "Thiết lập vị trí": find, pin, confirm. The two number
 * fields are read only to prove what was saved.
 */
const configured = vi.hoisted(() => ({ value: true }));

vi.mock('@/utils/googleMaps', () => ({
  isMapsConfigured: () => configured.value,
  searchPlaces: vi.fn(),
  resolvePlace: vi.fn(),
}));

vi.mock('./LocationMap', () => ({
  LocationMap: ({ point, onMove }: { point: Coordinates | null; onMove: (p: Coordinates) => void }) => (
    <div data-testid="map">
      <span data-testid="pin">{point ? `${point.latitude},${point.longitude}` : 'no-pin'}</span>
      <button type="button" onClick={() => onMove({ latitude: 10.912345678, longitude: 106.7 })}>
        drag-pin
      </button>
    </div>
  ),
}));

vi.mock('@/api/tripCatalogue', () => ({
  createTripLocation: vi.fn(),
  updateTripLocation: vi.fn(),
}));

import { createTripLocation, updateTripLocation } from '@/api/tripCatalogue';
import { resolvePlace, searchPlaces } from '@/utils/googleMaps';

const location = (over: Partial<TripLocation> = {}): TripLocation => ({
  id: 'l1',
  customerId: 'c1',
  name: 'Kho OSC',
  address: 'KCN Sóng Thần, Dĩ An',
  contact: 'Anh Tư',
  note: 'Cổng 2',
  latitude: 10.8,
  longitude: 106.6,
  status: 'active',
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const renderForm = (editing: TripLocation | null = null) => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <LanguageProvider>
      <LocationFormModal customerId="c1" editing={editing} onClose={onClose} onSaved={onSaved} />
    </LanguageProvider>,
  );
  return { onSaved, onClose };
};

const search = vi.mocked(searchPlaces);
const resolve = vi.mocked(resolvePlace);
const create = vi.mocked(createTripLocation);
const update = vi.mocked(updateTripLocation);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

const openSetup = () => fireEvent.click(screen.getByRole('button', { name: /Thiết lập vị trí|Chỉnh sửa vị trí/ }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vị trí' }));

const TCS = { id: 'p1', primary: 'Kho TCS', secondary: 'Thuận An, Bình Dương' };
const TCS_PLACE: ResolvedPlace = { address: 'Đường số 3, KCN VSIP 1, Thuận An', latitude: 10.9, longitude: 106.72 };

describe('LocationFormModal with a map', () => {
  beforeEach(() => {
    configured.value = true;
    search.mockReset();
    resolve.mockReset();
    create.mockReset();
    update.mockReset();
  });

  it('shows a located place as located, offers "Chỉnh sửa vị trí", and keeps the numbers behind the advanced fold', () => {
    renderForm(location());

    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa vị trí' })).toBeInTheDocument();
    expect(screen.queryByText('Địa điểm này chưa có vị trí trên bản đồ.')).toBeNull();
    // No map until asked for; the numbers exist for the record, under a fold.
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByText('Nhập toạ độ thủ công (nâng cao)')).toBeInTheDocument();
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.6);
  });

  it('★ shows an unlocated place as unlocated, in plain words, with "Thiết lập vị trí"', () => {
    renderForm(location({ latitude: null, longitude: null }));

    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
    expect(screen.getByText('Địa điểm này chưa có vị trí trên bản đồ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thiết lập vị trí' })).toBeInTheDocument();
    expect(screen.queryByText(/hệ thống chưa tự tra/)).toBeNull();
  });

  it('★ find, pick, confirm: the place’s position and address land on the form, and it is located', async () => {
    search.mockResolvedValue([TCS]);
    resolve.mockResolvedValue(TCS_PLACE);
    renderForm();

    openSetup();
    expect(screen.getByTestId('pin')).toHaveTextContent('no-pin');
    expect(screen.getByRole('button', { name: 'Xác nhận vị trí' })).toBeDisabled();

    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Kho TCS'));
    expect(search).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' })));
    await waitFor(() => expect(screen.getByTestId('pin')).toHaveTextContent('10.9,106.72'));

    // Nothing has reached the form yet.
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(null);
    confirm();

    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.9);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.72);
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue(TCS_PLACE.address);
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa vị trí' })).toBeInTheDocument();
  });

  it('does not search below three characters', async () => {
    renderForm();
    openSetup();
    type('Tìm địa chỉ / địa điểm', 'Kh');
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));
    expect(search).not.toHaveBeenCalled();
  });

  it('★ a search that comes back after the query shrank does not repopulate the list', async () => {
    let finish!: (rows: PlaceSuggestion[]) => void;
    search.mockImplementationOnce(
      () =>
        new Promise<PlaceSuggestion[]>((r) => {
          finish = r;
        }),
    );
    renderForm();
    openSetup();

    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Kho TCS'));
    type('Tìm địa chỉ / địa điểm', 'Kh');
    await act(async () => {
      finish([TCS]);
    });

    expect(screen.queryByRole('button', { name: /Kho TCS/ })).toBeNull();
    expect(screen.queryByText('Đang tìm…')).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('★ leaves a hand-written address alone when a found place is confirmed, and still takes its position', async () => {
    search.mockResolvedValue([TCS]);
    let finish!: (place: ResolvedPlace) => void;
    resolve.mockImplementationOnce(
      () =>
        new Promise<ResolvedPlace>((r) => {
          finish = r;
        }),
    );
    renderForm();

    type('Địa chỉ', 'Cổng bảo vệ số 2, KCN VSIP 1');
    openSetup();
    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    // Google answers late; the operator's address is still theirs when it does.
    await act(async () => {
      finish({ address: 'Google’s wording', latitude: 10.9, longitude: 106.72 });
    });
    await waitFor(() => expect(screen.getByTestId('pin')).toHaveTextContent('10.9,106.72'));
    confirm();

    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('Cổng bảo vệ số 2, KCN VSIP 1');
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.9);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.72);
  });

  it('★ editing the position opens the map on the existing pin; dragging and confirming keeps the pin, rounded, and never the address', () => {
    renderForm(location());

    openSetup();
    expect(screen.getByTestId('pin')).toHaveTextContent('10.8,106.6');

    fireEvent.click(screen.getByRole('button', { name: 'drag-pin' }));
    expect(screen.getByTestId('pin')).toHaveTextContent('10.912345678,106.7');
    // Still a draft: the form has not moved.
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
    confirm();

    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.912346);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.7);
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('KCN Sóng Thần, Dĩ An');
  });

  it('★ cancelling the map discards the draft', () => {
    renderForm(location());

    openSetup();
    fireEvent.click(screen.getByRole('button', { name: 'drag-pin' }));
    // Two dialogs, two cancels: the one inside the map's own dialog.
    const mapDialog = screen.getByTestId('map').closest('dialog');
    if (!mapDialog) throw new Error('the map is not inside a dialog');
    fireEvent.click(within(mapDialog).getByRole('button', { name: 'Hủy bỏ' }));

    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.6);
  });

  it('★ saves the confirmed pin to the existing endpoint, with every other field preserved', async () => {
    update.mockResolvedValue(location({ latitude: 10.912346, longitude: 106.7 }));
    const { onSaved, onClose } = renderForm(location());

    openSetup();
    fireEvent.click(screen.getByRole('button', { name: 'drag-pin' }));
    confirm();
    save();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('c1', 'l1', {
        name: 'Kho OSC',
        address: 'KCN Sóng Thần, Dĩ An',
        contact: 'Anh Tư',
        note: 'Cổng 2',
        latitude: 10.912346,
        longitude: 106.7,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('★ a place located through the map is saved located, and the words say so until then', async () => {
    search.mockResolvedValue([TCS]);
    resolve.mockResolvedValue(TCS_PLACE);
    create.mockResolvedValue(location({ id: 'l9', name: 'Kho TCS', latitude: 10.9, longitude: 106.72 }));
    renderForm();
    expect(screen.getByText('Địa điểm này chưa có vị trí trên bản đồ.')).toBeInTheDocument();

    type('Tên địa điểm', 'Kho TCS');
    openSetup();
    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));
    await waitFor(() => expect(screen.getByTestId('pin')).toHaveTextContent('10.9,106.72'));
    confirm();
    expect(screen.queryByText('Địa điểm này chưa có vị trí trên bản đồ.')).toBeNull();
    save();

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('c1', {
        name: 'Kho TCS',
        address: TCS_PLACE.address,
        contact: null,
        note: null,
        latitude: 10.9,
        longitude: 106.72,
      }),
    );
  });

  it('creates under the customer it was opened for, unlocated when no position was set', async () => {
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
        latitude: null,
        longitude: null,
      }),
    );
  });

  it('★ the advanced fold cannot submit half a point, and says so', () => {
    renderForm();
    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Thủ Dầu Một');
    type('Vĩ độ', '10.8');

    expect(screen.getByRole('alert')).toHaveTextContent('Cần cả vĩ độ và kinh độ');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    save();
    expect(create).not.toHaveBeenCalled();

    type('Kinh độ', '106.6');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('cannot submit a point off the planet', () => {
    renderForm();
    type('Vĩ độ', '91');
    type('Kinh độ', '106.6');

    expect(screen.getByRole('alert')).toHaveTextContent('Toạ độ không hợp lệ');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('names a failed search inside the map dialog and keeps the form usable', async () => {
    search.mockRejectedValue(new Error('quota'));
    renderForm();
    openSetup();

    type('Tìm địa chỉ / địa điểm', 'Kho TCS');

    expect(await screen.findByText(/Không tìm được địa điểm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });
});

describe('LocationFormModal without a map', () => {
  beforeEach(() => {
    configured.value = false;
  });

  it('★ offers no map action, says the map is not enabled, and keeps the manual fields in the open', () => {
    renderForm(location());

    expect(screen.queryByRole('button', { name: /Thiết lập vị trí|Chỉnh sửa vị trí/ })).toBeNull();
    expect(screen.queryByText('Nhập toạ độ thủ công (nâng cao)')).toBeNull();
    expect(screen.getByText(/Bản đồ chưa được bật/)).toBeInTheDocument();
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
  });

  it('still saves a hand-typed pair through the same endpoint', async () => {
    create.mockResolvedValue(location({ id: 'l9' }));
    renderForm();

    type('Tên địa điểm', 'Kho OSC');
    type('Địa chỉ', 'KCN Sóng Thần');
    type('Vĩ độ', '10.8');
    type('Kinh độ', '106.6');
    save();

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('c1', expect.objectContaining({ latitude: 10.8, longitude: 106.6 })),
    );
  });
});
