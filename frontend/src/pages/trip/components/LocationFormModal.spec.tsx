import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripLocation } from '@/types/trip';
import type { PlaceSuggestion, ResolvedPlace } from '@/api/placeSearch';
import { LocationFormModal } from './LocationFormModal';

/**
 * The location form.
 *
 * ★ THE SEARCH IS MOCKED AT THE ADAPTER, NEVER CALLED. `@/api/placeSearch` is
 * the one module that asks our server for suggestions, so the suite replaces it
 * with two functions. Nothing here reaches the network, and the form is tested
 * for what it SENDS rather than for what it draws.
 *
 * ★ THE MAP IS STUBBED TO ITS CONTRACT, NOT RENDERED. Leaflet measures a real
 * container, and jsdom gives every element a size of zero — so the map itself
 * proves nothing here. What matters to this form is the contract: a point in,
 * a moved point out. The stub below is exactly that, which keeps these tests
 * about the FORM and leaves the tiles to a human looking at a screen.
 *
 * ★ WHAT IS PINNED IS THE COUPLING BETWEEN THE ADDRESS AND THE PAIR. Picking a
 * suggestion captures coordinates; typing an address captures none and the
 * server then refuses the driver's confirmation with DESTINATION_MISSING;
 * editing the address of a located row leaves a pair describing somewhere else,
 * which fails as OUTSIDE_GEOFENCE and reads as the driver lying. Those three
 * consequences are the reason this file exists.
 */

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
  useWards: () => ({ items: [], loading: false, failed: false }),
}));

vi.mock('@/api/placeSearch', () => ({
  searchPlaces: vi.fn(),
  resolvePlace: vi.fn(),
  geocodeAddress: vi.fn(),
}));

/**
 * The map, reduced to the contract the form depends on.
 *
 * A button that reports one fixed point stands in for dragging a pin — the
 * form cannot tell the difference, and Leaflet in jsdom would only test jsdom.
 */
vi.mock('./LocationMap', () => ({
  LocationMap: ({ point, onMove }: { point: unknown; onMove: (p: unknown) => void }) => (
    <div data-testid="location-map" data-point={JSON.stringify(point)}>
      <button type="button" onClick={() => onMove({ latitude: 10.5, longitude: 106.5 })}>
        drag-pin
      </button>
    </div>
  ),
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
import { geocodeAddress, resolvePlace, searchPlaces } from '@/api/placeSearch';

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
const geocode = vi.mocked(geocodeAddress);
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

describe('LocationFormModal', () => {
  beforeEach(() => {
    // The address field searches as it is typed, so a stand-in that answers
    // only the one query the tests pick from keeps every other typing quiet.
    geocode.mockReset().mockResolvedValue(null);
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
    // The plain id, not the suggestion object: this provider's ids mean the
    // same thing whenever they are sent.
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('p1'));

    // The address reads as the place wrote it.
    await waitFor(() => expect(screen.getByLabelText('Địa chỉ')).toHaveValue(TCS_PLACE.address));

    // ★ AND THE POSITION CAME WITH IT, ON SCREEN. Until the form showed this,
    // a picked suggestion and a typed address looked identical and the
    // difference only surfaced at a gate.
    expect(screen.getByText('10.9, 106.72')).toBeInTheDocument();
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();

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

    // ★ AND THE FORM SAYS SO, IN WORDS, BEFORE IT IS SAVED. This is the
    // difference between a place nobody located and a place somebody THINKS
    // they located.
    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
    // Saving is still allowed: a place is real before anybody has located it,
    // the server's contract says both or neither, and the trip form warns
    // again at dispatch.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    save();

    // ⚠ THE PLACE IS CREATED, AND IT IS NOT LOCATED. The server will refuse a
    // driver's PICKUP_CONFIRMED there with DESTINATION_MISSING — which names
    // the office, correctly, as the party that has to fix it.
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ latitude: null, longitude: null }),
      ),
    );
  });

  it('★ editing a located place shows its coordinates and keeps them', async () => {
    update.mockResolvedValue(location());
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    // Opened green: the stored pair is taken as describing the stored address,
    // because there is no better claim and suspecting every edited row would
    // train people to ignore the warning.
    expect(screen.getByText('10.8, 106.6')).toBeInTheDocument();
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();

    type('Tên địa điểm', 'Kho OSC 2');
    save();

    // Changing the NAME is not changing the place. Dropping the pair here
    // would un-locate every place the moment somebody fixed a typo.
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

/**
 * ★ THE TRAP THIS SECTION EXISTS FOR. A located row whose address is then
 * corrected keeps coordinates that describe the PREVIOUS address. Saved that
 * way, the driver reaches the right gate and the server answers
 * OUTSIDE_GEOFENCE — which reads as the driver lying about where he is, and is
 * therefore worse than having no coordinates at all.
 */
describe('coordinates that no longer describe the address', () => {
  beforeEach(() => {
    geocode.mockReset().mockResolvedValue(null);
    search.mockReset().mockResolvedValue([]);
    update.mockReset();
  });

  it('★ warns when the address is rewritten under an existing pair', async () => {
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();

    type('Địa chỉ', 'Một nơi hoàn toàn khác, Long An');

    expect(await screen.findByText(/Địa chỉ đã thay đổi/)).toBeInTheDocument();
    // Amber, not green: a pair that may describe somewhere else is not a
    // located place.
    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
  });

  it('★ still saves, sending the old pair — the warning informs, it does not block', async () => {
    update.mockResolvedValue(location());
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    type('Địa chỉ', 'Một nơi hoàn toàn khác, Long An');
    expect(await screen.findByText(/Địa chỉ đã thay đổi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    save();

    // Silently blanking the pair would be this dialog deciding to un-locate a
    // place on the operator's behalf. It says what it sees and sends what it
    // has.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ latitude: 10.8, longitude: 106.6 }),
      ),
    );
  });

  it('a whitespace-only difference is not a change of address', async () => {
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    // The address is a textarea; a trailing newline is not somebody moving the
    // warehouse, and warning about it would teach people to ignore the warning.
    type('Địa chỉ', '  KCN Sóng Thần, Dĩ An \n');

    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.queryByText(/Địa chỉ đã thay đổi/)).toBeNull();
  });
});

describe('the two numbers, for somebody who was handed them', () => {
  beforeEach(() => {
    geocode.mockReset().mockResolvedValue(null);
    search.mockReset().mockResolvedValue([]);
    create.mockReset();
  });

  it('★ half a pair blocks the save and says which half is missing', async () => {
    renderForm();

    // jsdom keeps `<details>` children in the DOM when the fold is closed, so
    // there is no summary to click first.
    type('Vĩ độ', '10.9');

    expect(await screen.findByText(/Cần cả vĩ độ và kinh độ/)).toBeInTheDocument();
    // ⚠ The message is not decoration: without it the Save button dies with no
    // explanation the moment somebody types one of the two numbers.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('★ an off-the-planet pair is refused here, not by the server', async () => {
    renderForm();

    type('Vĩ độ', '120');
    type('Kinh độ', '106.7');

    expect(await screen.findByText(/Toạ độ không hợp lệ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('★ a hand-typed pair does not immediately read as stale', async () => {
    create.mockResolvedValue(location({ id: 'l9' }));
    renderForm();

    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Số 5 ngõ nhỏ, Long An');
    type('Vĩ độ', '10.55');
    type('Kinh độ', '106.55');

    // Typing the numbers is a claim that they describe the address on screen.
    // Without that, the pair would read as stale the instant it was complete —
    // a warning about a disagreement the operator had just resolved.
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.queryByText(/Địa chỉ đã thay đổi/)).toBeNull();

    save();
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ latitude: 10.55, longitude: 106.55 }),
      ),
    );
  });
});

/**
 * ★ THE ADDRESS LOCATING ITSELF — the path that does not ask anybody to pick.
 * Before it existed, an operator who TYPED the address (which is most of them)
 * saved a place no driver could ever confirm arrival at, and nothing on the
 * screen said so.
 */
describe('locating a typed address by itself', () => {
  const GEOCODED: ResolvedPlace = {
    address: 'Số 10, Phường Tân Hải, Thành phố Hồ Chí Minh',
    latitude: 10.77,
    longitude: 106.71,
  };

  beforeEach(() => {
    geocode.mockReset().mockResolvedValue(null);
    search.mockReset().mockResolvedValue([]);
    create.mockReset();
    update.mockReset();
  });

  it('★ a typed address becomes a position, with no suggestion picked', async () => {
    geocode.mockResolvedValue(GEOCODED);
    create.mockResolvedValue(location({ id: 'l9' }));
    renderForm();

    type('Tên địa điểm', 'Kho mới');
    type('Địa chỉ', 'Số 10 đường Nguyễn Hữu Cảnh');

    await waitFor(() => expect(screen.getByText('10.77, 106.71')).toBeInTheDocument());
    expect(screen.getByText('Đã định vị')).toBeInTheDocument();

    save();
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ latitude: 10.77, longitude: 106.71 }),
      ),
    );
  });

  it('★ says the point was derived, not placed', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    type('Địa chỉ', 'Số 10 đường Nguyễn Hữu Cảnh');

    // A geocoded point is the street or the parcel, not the gate — fine for a
    // shop on a named road, wrong by a kilometre for a port. Presenting it as
    // though a person had placed it is how an unchecked row reaches a driver.
    expect(await screen.findByText(/lấy tự động từ địa chỉ/)).toBeInTheDocument();
  });

  it('★ shows WHAT it matched, so a substituted street is visible', async () => {
    // Measured against a real geocoder: asked for "105 đường số 10, Phường Phú
    // Thuận" it answered with Đường Số 7 in the same ward — a different street,
    // confidently, with nothing saying it had substituted one.
    geocode.mockResolvedValue({
      address: 'Đường Số 7, Khu phố 10, Phường Phú Thuận, Thành phố Hồ Chí Minh',
      latitude: 10.7326,
      longitude: 106.7383,
    });
    renderForm();

    type('Địa chỉ', '105 đường số 10, Phường Phú Thuận');

    // Read back, the substitution is obvious in a second. Unread, it is a lorry
    // at the wrong gate and a driver blamed for it.
    expect(await screen.findByText(/Đường Số 7/)).toBeInTheDocument();
  });

  it('★ never rewrites the address with the provider’s wording', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    type('Địa chỉ', 'Số 10 đường Nguyễn Hữu Cảnh');
    await waitFor(() => expect(screen.getByText('Đã định vị')).toBeInTheDocument());

    // The operator may still be typing. Taking the two numbers is the whole
    // point; taking the text as well would be the form arguing with them.
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('Số 10 đường Nguyễn Hữu Cảnh');
  });

  it('stays quiet, and unlocated, when the address matches nothing', async () => {
    geocode.mockResolvedValue(null);
    renderForm();

    type('Địa chỉ', 'Số 10 ngõ không tồn tại');

    await waitFor(() => expect(geocode).toHaveBeenCalled());
    // `null` is the ordinary answer to half an address. The section already
    // says "Chưa định vị"; a second message about it would be noise.
    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
  });

  it('★ does not overwrite a position that is already there', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    await new Promise((wait) => setTimeout(wait, 1200));

    // A located row is not a question. Re-deriving on open would silently
    // replace a pin somebody dragged onto a gate.
    expect(geocode).not.toHaveBeenCalled();
    expect(screen.getByText('10.8, 106.6')).toBeInTheDocument();
  });

  it('★ does not re-derive after the address is edited under an existing pin', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    type('Địa chỉ', 'Một nơi hoàn toàn khác, Long An');
    await new Promise((wait) => setTimeout(wait, 1200));

    // The two now disagree — and the person who dragged that pin onto a gate is
    // a better authority than a geocoder. The warning stands and the choice is
    // theirs.
    expect(geocode).not.toHaveBeenCalled();
    expect(screen.getByText(/Địa chỉ đã thay đổi/)).toBeInTheDocument();
  });

  it('★ a hand-placed pin clears the "derived" caveat', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    type('Địa chỉ', 'Số 10 đường Nguyễn Hữu Cảnh');
    expect(await screen.findByText(/lấy tự động từ địa chỉ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Chỉnh sửa vị trí|Thiết lập vị trí/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'drag-pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vị trí' }));

    // Somebody looked at a map and decided. That is no longer a derivation.
    await waitFor(() => expect(screen.getByText('10.5, 106.5')).toBeInTheDocument());
    expect(screen.queryByText(/lấy tự động từ địa chỉ/)).toBeNull();
  });

  /**
   * ★ BOTH HALVES OF A BUG THAT REACHED A SCREENSHOT. Answering the two
   * dropdowns before typing anything produced "Đã định vị" on a brand-new form
   * — the ward's own centre, taken as the place's position — and typing the
   * address afterwards then left it permanently "lệch" with no way back,
   * because deriving was allowed only from nothing.
   */
  it('★ does not derive from the province and ward alone', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    // `AdminAreaFields` is real here, and with no units stubbed nothing can be
    // picked — so this pins the narrower rule the fix rests on: an address
    // shorter than the minimum is never looked up, whatever else is filled in.
    type('Địa chỉ', 'Số');
    await new Promise((wait) => setTimeout(wait, 1200));

    // The dropdowns are CONTEXT for an address. On their own they are a ward,
    // and a ward's centre is not where a lorry goes.
    expect(geocode).not.toHaveBeenCalled();
    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
  });

  it('★ re-derives when the address changes under a point it derived itself', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    type('Địa chỉ', 'Số 10 đường Nguyễn Hữu Cảnh');
    await waitFor(() => expect(screen.getByText('10.77, 106.71')).toBeInTheDocument());

    geocode.mockResolvedValue({ address: 'Đường 53', latitude: 10.75, longitude: 106.7 });
    type('Địa chỉ', '3 đường số 53');

    // A derived point carries no human decision, so replacing it costs nothing.
    // Refusing to — which is what the first version did — left the form saying
    // "toạ độ vẫn là toạ độ cũ" with no way out but the map.
    await waitFor(() => expect(screen.getByText('10.75, 106.7')).toBeInTheDocument());
    expect(screen.queryByText(/Địa chỉ đã thay đổi/)).toBeNull();
  });

  it('★ refuses an answer that lands in a different ward from the one chosen', async () => {
    // Measured against a real geocoder: asked for a street in Phường Tân Hưng
    // it answered with a street of the same name in Phường Long Trường —
    // fifteen kilometres away, confidently, with nothing marking the swap.
    geocode.mockResolvedValue({
      address: 'Đường Số 53, Phường Long Trường, Thành phố Hồ Chí Minh',
      latitude: 10.81987,
      longitude: 106.807002,
    });
    renderForm(location({ ward: 'Phường Tân Hưng', latitude: null, longitude: null }));

    type('Địa chỉ', 'số 3 đường số 53');
    await waitFor(() => expect(geocode).toHaveBeenCalled(), { timeout: 4000 });

    // At a 300 m geofence a wrong ward is not a near miss — it is a driver at
    // the right gate being told he is somewhere else. Better unlocated.
    await waitFor(() => expect(screen.getByText('Chưa định vị')).toBeInTheDocument());
    expect(screen.queryByText(/Long Trường/)).toBeNull();
  });

  it('accepts an answer in the chosen ward, spelled loosely', async () => {
    geocode.mockResolvedValue({
      address: 'Đường Số 53, P. Tan Hung, TP. Hồ Chí Minh',
      latitude: 10.74,
      longitude: 106.7,
    });
    renderForm(location({ ward: 'Phường Tân Hưng', latitude: null, longitude: null }));

    type('Địa chỉ', 'số 3 đường số 53');

    // Diacritics and the unit prefix must not decide this: rejecting what
    // cannot be matched character-for-character would throw away every good
    // answer from a provider that words addresses its own way.
    await waitFor(() => expect(screen.getByText('10.74, 106.7')).toBeInTheDocument(), {
      timeout: 4000,
    });
  });

  it('★ waits for typing to stop — one lookup, not one per keystroke', async () => {
    geocode.mockResolvedValue(GEOCODED);
    renderForm();

    type('Địa chỉ', 'Số 10 đ');
    type('Địa chỉ', 'Số 10 đường');
    type('Địa chỉ', 'Số 10 đường Nguyễn');

    await waitFor(() => expect(geocode).toHaveBeenCalled());
    // The allowance is counted in requests. A lookup per keystroke would be
    // fifteen purchases for one address.
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith('Số 10 đường Nguyễn');
  });
});

describe('the pin on the map', () => {
  beforeEach(() => {
    geocode.mockReset().mockResolvedValue(null);
    search.mockReset().mockResolvedValue([]);
    update.mockReset();
  });

  const openMap = () =>
    fireEvent.click(screen.getByRole('button', { name: /Thiết lập vị trí|Chỉnh sửa vị trí/ }));

  it('★ a dragged pin becomes the saved position', async () => {
    update.mockResolvedValue(location());
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    openMap();
    fireEvent.click(await screen.findByRole('button', { name: 'drag-pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vị trí' }));

    // ★ THE PIN IS THE ANSWER, NOT THE SEARCH RESULT. A geocoder returns the
    // centre of a parcel; Cảng Cát Lái's centre is most of a kilometre from
    // the gate, outside the 300 m the server confirms within.
    await waitFor(() => expect(screen.getByText('10.5, 106.5')).toBeInTheDocument());

    save();
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ latitude: 10.5, longitude: 106.5 }),
      ),
    );
  });

  it('★ a confirmed pin does not read as stale, and leaves a hand-written address alone', async () => {
    renderForm(location({ latitude: 10.8, longitude: 106.6 }));

    type('Địa chỉ', 'Địa chỉ tôi tự gõ');
    expect(await screen.findByText(/Địa chỉ đã thay đổi/)).toBeInTheDocument();

    openMap();
    fireEvent.click(await screen.findByRole('button', { name: 'drag-pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận vị trí' }));

    // Placing the pin is the operator resolving the disagreement, so the
    // warning goes — and the address they wrote is not overwritten by it.
    await waitFor(() => expect(screen.getByText('Đã định vị')).toBeInTheDocument());
    expect(screen.queryByText(/Địa chỉ đã thay đổi/)).toBeNull();
    expect(screen.getByLabelText('Địa chỉ')).toHaveValue('Địa chỉ tôi tự gõ');
  });

  it('confirms nothing until there is a pin', async () => {
    renderForm();

    openMap();

    // Confirming `null` would be the dialog quietly clearing a position
    // somebody opened it to set.
    expect(await screen.findByRole('button', { name: 'Xác nhận vị trí' })).toBeDisabled();
  });
});
