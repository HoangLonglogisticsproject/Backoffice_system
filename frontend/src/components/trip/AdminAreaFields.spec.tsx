import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AdminAreaFields, EMPTY_ADMIN_AREA, type AdminAreaValue } from './AdminAreaFields';

/**
 * The three cascading dropdowns.
 *
 * ★ THE HOOKS ARE STUBBED, NOT THE HTTP LAYER. What is under test is the
 * CASCADE — which control is live, what a pick writes, and what changing a
 * level does to the levels below it. Whether a list arrives is the hook's
 * business and the server's.
 */

const provinces = vi.fn();
const districts = vi.fn();
const wards = vi.fn();

vi.mock('@/hooks/useVnAdministrative', () => ({
  useProvinces: () => provinces(),
  useDistricts: (code: string | null) => districts(code),
  useWards: (code: string | null) => wards(code),
}));

const HCM = { code: '79', name: 'Thành phố Hồ Chí Minh' };
const HA_NOI = { code: '1', name: 'Thành phố Hà Nội' };
const Q1 = { code: '760', name: 'Quận 1' };
const GO_VAP = { code: '764', name: 'Quận Gò Vấp' };
const BEN_NGHE = { code: '26743', name: 'Phường Bến Nghé' };

const settled = (items: { code: string; name: string }[]) => ({
  items,
  loading: false,
  failed: false,
});

/** A place filled in to the bottom, for the tests about clearing it again. */
const IN_BEN_NGHE: AdminAreaValue = {
  provinceCode: HCM.code,
  province: HCM.name,
  districtCode: Q1.code,
  district: Q1.name,
  wardCode: BEN_NGHE.code,
  ward: BEN_NGHE.name,
};

const renderFields = (value: AdminAreaValue = EMPTY_ADMIN_AREA) => {
  const onChange = vi.fn();
  render(
    <LanguageProvider>
      <AdminAreaFields value={value} onChange={onChange} />
    </LanguageProvider>,
  );
  return { onChange };
};

/**
 * Opens a select and picks one of its options.
 *
 * ★ POINTER EVENTS, NOT A BARE CLICK. Base UI commits a selection on
 * pointerup; `fireEvent.click` alone dispatches neither, so the popup opens,
 * the option is found, and nothing is ever chosen — a silent no-op that reads
 * in the failure output as "the component did not call onChange" and sends you
 * looking for a bug in the component.
 */
const choose = async (trigger: string, option: string) => {
  fireEvent.click(screen.getByLabelText(trigger));
  const chosen = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(chosen);
  fireEvent.pointerUp(chosen);
  fireEvent.click(chosen);
};

describe('AdminAreaFields', () => {
  beforeEach(() => {
    provinces.mockReset().mockReturnValue(settled([HCM, HA_NOI]));
    districts.mockReset().mockReturnValue(settled([]));
    wards.mockReset().mockReturnValue(settled([]));
  });

  it('★ offers all three levels: tỉnh → quận/huyện → phường/xã', () => {
    renderFields();

    expect(screen.getByLabelText('Tỉnh / Thành phố')).toBeInTheDocument();
    expect(screen.getByLabelText('Quận / Huyện')).toBeInTheDocument();
    expect(screen.getByLabelText('Phường / Xã')).toBeInTheDocument();
  });

  it('reports both the code and the name when a province is picked', async () => {
    const { onChange } = renderFields();

    await choose('Tỉnh / Thành phố', HCM.name);

    // The code identifies and the name rides along, so a list reads without
    // asking anybody. Both are stored.
    expect(onChange).toHaveBeenCalledWith({
      provinceCode: HCM.code,
      province: HCM.name,
      districtCode: null,
      district: null,
      wardCode: null,
      ward: null,
    });
  });

  it('★ each control is dead until the one above it is answered, and says which', () => {
    renderFields();

    expect(screen.getByLabelText('Quận / Huyện')).toBeDisabled();
    expect(screen.getByText('Chọn tỉnh trước')).toBeInTheDocument();

    expect(screen.getByLabelText('Phường / Xã')).toBeDisabled();
    expect(screen.getByText('Chọn quận / huyện trước')).toBeInTheDocument();
  });

  it('★ asks for children of the level above — districts of the province, wards of the DISTRICT', () => {
    renderFields();
    expect(districts).toHaveBeenCalledWith(null);
    expect(wards).toHaveBeenCalledWith(null);

    districts.mockReturnValue(settled([Q1, GO_VAP]));
    wards.mockReturnValue(settled([BEN_NGHE]));
    renderFields(IN_BEN_NGHE);

    expect(districts).toHaveBeenLastCalledWith(HCM.code);
    // Not the province: in this hierarchy a ward hangs off its district.
    expect(wards).toHaveBeenLastCalledWith(Q1.code);
  });

  it('★ changing the province clears BOTH levels below it', async () => {
    districts.mockReturnValue(settled([Q1, GO_VAP]));
    wards.mockReturnValue(settled([BEN_NGHE]));
    const { onChange } = renderFields(IN_BEN_NGHE);

    await choose('Tỉnh / Thành phố', HA_NOI.name);

    // Keeping them would leave Quận 1 and Phường Bến Nghé filed under Hà Nội —
    // a row that reads as precise and is wrong.
    expect(onChange).toHaveBeenCalledWith({
      provinceCode: HA_NOI.code,
      province: HA_NOI.name,
      districtCode: null,
      district: null,
      wardCode: null,
      ward: null,
    });
  });

  it('★ changing the district clears the ward and keeps the province', async () => {
    districts.mockReturnValue(settled([Q1, GO_VAP]));
    wards.mockReturnValue(settled([BEN_NGHE]));
    const { onChange } = renderFields(IN_BEN_NGHE);

    await choose('Quận / Huyện', GO_VAP.name);

    expect(onChange).toHaveBeenCalledWith({
      provinceCode: HCM.code,
      province: HCM.name,
      districtCode: GO_VAP.code,
      district: GO_VAP.name,
      wardCode: null,
      ward: null,
    });
  });

  it('keeps the two levels above when a ward is picked', async () => {
    districts.mockReturnValue(settled([Q1]));
    wards.mockReturnValue(settled([BEN_NGHE]));
    const { onChange } = renderFields({
      ...EMPTY_ADMIN_AREA,
      provinceCode: HCM.code,
      province: HCM.name,
      districtCode: Q1.code,
      district: Q1.name,
    });

    await choose('Phường / Xã', BEN_NGHE.name);

    expect(onChange).toHaveBeenCalledWith(IN_BEN_NGHE);
  });

  it('★ the trigger shows the NAME, not the code', () => {
    districts.mockReturnValue(settled([Q1]));
    wards.mockReturnValue(settled([BEN_NGHE]));
    renderFields(IN_BEN_NGHE);

    // Base UI's own `Select.Value` renders the VALUE, which put `79` where the
    // province name belongs. The trigger draws its own content instead.
    expect(screen.getByLabelText('Tỉnh / Thành phố')).toHaveTextContent(HCM.name);
    expect(screen.getByLabelText('Quận / Huyện')).toHaveTextContent(Q1.name);
    expect(screen.getByLabelText('Phường / Xã')).toHaveTextContent(BEN_NGHE.name);
  });

  it('★ says the list could not be loaded rather than showing an empty dropdown with no reason', async () => {
    provinces.mockReturnValue({ items: [], loading: false, failed: true });
    renderFields();

    // And the message says the form still saves: these fields describe a place,
    // they are not what makes one real.
    await waitFor(() =>
      expect(screen.getByText(/Không lấy được danh mục hành chính/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Vẫn lưu được địa điểm/)).toBeInTheDocument();
  });
});
