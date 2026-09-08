import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripLocation } from '@/types/trip';
import type { Coordinates } from '@/utils/googleMaps';
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

describe('LocationFormModal with a map', () => {
  beforeEach(() => {
    configured.value = true;
    search.mockReset();
    resolve.mockReset();
    create.mockReset();
    update.mockReset();
  });

  it('renders existing coordinates as the pin and as the two fields', () => {
    renderForm(location());

    expect(screen.getByTestId('pin')).toHaveTextContent('10.8,106.6');
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.6);
    expect(screen.getByText(/Đã định vị/)).toBeInTheDocument();
  });

  it('renders a place with no coordinates as unlocated, with no pin', () => {
    renderForm(location({ latitude: null, longitude: null }));

    expect(screen.getByTestId('pin')).toHaveTextContent('no-pin');
    expect(screen.getByText(/Chưa định vị/)).toBeInTheDocument();
  });


  it('★ searches after a pause, and selecting a result fills the coordinates and the empty address', async () => {
    search.mockResolvedValue([
      { id: 'p1', primary: 'Kho TCS', secondary: 'Thuận An, Bình Dương' },
    ]);
    resolve.mockResolvedValue({
      address: 'Đường số 3, KCN VSIP 1, Thuận An',
      latitude: 10.9,
      longitude: 106.72,
    });
    renderForm();

    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Kho TCS'));
    expect(search).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.9));
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.72);
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('Đường số 3, KCN VSIP 1, Thuận An');
    expect(screen.getByTestId('pin')).toHaveTextContent('10.9,106.72');
  });

  it('does not search below three characters', async () => {
    renderForm();
    type('Tìm địa chỉ / địa điểm', 'Kh');
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));
    expect(search).not.toHaveBeenCalled();
  });

  it('★ leaves a hand-written address alone when a result is picked', async () => {
    search.mockResolvedValue([{ id: 'p1', primary: 'Kho TCS', secondary: '' }]);
    resolve.mockResolvedValue({ address: 'Google’s wording', latitude: 10.9, longitude: 106.72 });
    renderForm();

    type('Địa chỉ', 'Cổng bảo vệ số 2, KCN VSIP 1');
    type('Tìm địa chỉ / địa điểm', 'Kho TCS');
    fireEvent.click(await screen.findByRole('button', { name: /Kho TCS/ }));

    await waitFor(() => expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.9));
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('Cổng bảo vệ số 2, KCN VSIP 1');
  });

  it('★ dragging the pin updates the coordinates, rounded, and never the address', async () => {
    renderForm(location());

    fireEvent.click(screen.getByRole('button', { name: 'drag-pin' }));

    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.912346);
    expect(screen.getByLabelText('Kinh độ')).toHaveValue(106.7);
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('KCN Sóng Thần, Dĩ An');
  });

  it('★ saves the final pin position to the existing endpoint, with every other field preserved', async () => {
    update.mockResolvedValue(location({ latitude: 10.912346, longitude: 106.7 }));
    const { onSaved, onClose } = renderForm(location());

    fireEvent.click(screen.getByRole('button', { name: 'drag-pin' }));
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
        latitude: null,
        longitude: null,
      }),
    );
  });

  it('★ cannot submit half a point, and says so', async () => {
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

  it('names a failed search and keeps the form usable', async () => {
    search.mockRejectedValue(new Error('quota'));
    renderForm();

    type('Tìm địa chỉ / địa điểm', 'Kho TCS');

    expect(await screen.findByText(/Không tìm được địa điểm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });
});

describe('LocationFormModal without a map', () => {
  it('offers no search and no map, and keeps the manual fields', () => {
    configured.value = false;
    renderForm(location());

    expect(screen.queryByLabelText('Tìm địa chỉ / địa điểm')).toBeNull();
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByLabelText('Vĩ độ')).toHaveValue(10.8);
    expect(screen.getByText(/hệ thống chưa tự tra toạ độ/)).toBeInTheDocument();
  });
});
