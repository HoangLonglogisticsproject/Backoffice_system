import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AdminAreaFields, EMPTY_ADMIN_AREA, type AdminAreaValue } from './AdminAreaFields';

/**
 * The two cascading dropdowns, and what became of the third.
 *
 * ★ THE HOOKS ARE STUBBED, NOT THE HTTP LAYER. What is under test is the
 * CASCADE — which control is live, what a pick writes, and what changing the
 * province does to everything under it. Whether a list arrives is the hook's
 * business and the server's.
 */

const provinces = vi.fn();
const wards = vi.fn();

vi.mock('@/hooks/useVnAdministrative', () => ({
  useProvinces: () => provinces(),
  useWards: (code: string | null) => wards(code),
}));

const HCM = { code: '79', name: 'Thành phố Hồ Chí Minh' };
const HA_NOI = { code: '1', name: 'Thành phố Hà Nội' };
const BEN_NGHE = { code: '26743', name: 'Phường Bến Nghé' };
const TAN_THUAN = { code: '27460', name: 'Phường Tân Thuận' };

const settled = (items: { code: string; name: string }[]) => ({
  items,
  loading: false,
  failed: false,
});

/** A place filled in to the bottom, under the post-merger hierarchy. */
const IN_BEN_NGHE: AdminAreaValue = {
  ...EMPTY_ADMIN_AREA,
  provinceCode: HCM.code,
  province: HCM.name,
  wardCode: BEN_NGHE.code,
  ward: BEN_NGHE.name,
};

/**
 * A row filed BEFORE 1 July 2025: it still carries the abolished quận/huyện,
 * and a province that has since been merged away is equally possible.
 */
const PRE_MERGER: AdminAreaValue = {
  ...IN_BEN_NGHE,
  districtCode: '760',
  district: 'Quận 1',
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
    wards.mockReset().mockReturnValue(settled([]));
  });

  it('★ offers two levels and no third: tỉnh → phường/xã', () => {
    renderFields();

    expect(screen.getByLabelText('Tỉnh / Thành phố')).toBeInTheDocument();
    expect(screen.getByLabelText('Phường / Xã')).toBeInTheDocument();
    // The 2025 merger abolished quận/huyện. Offering it would ask somebody to
    // file a place under a tier that no longer exists.
    expect(screen.queryByLabelText('Quận / Huyện')).not.toBeInTheDocument();
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

  it('★ the ward is dead until a province is answered, and says so', () => {
    renderFields();

    expect(screen.getByLabelText('Phường / Xã')).toBeDisabled();
    expect(screen.getByText('Chọn tỉnh trước')).toBeInTheDocument();
  });

  it('★ asks for wards of the PROVINCE — there is no rung in between any more', () => {
    renderFields();
    expect(wards).toHaveBeenCalledWith(null);

    wards.mockReturnValue(settled([BEN_NGHE]));
    renderFields(IN_BEN_NGHE);

    expect(wards).toHaveBeenLastCalledWith(HCM.code);
  });

  it('★ changing the province clears the ward under it', async () => {
    wards.mockReturnValue(settled([BEN_NGHE]));
    const { onChange } = renderFields(IN_BEN_NGHE);

    await choose('Tỉnh / Thành phố', HA_NOI.name);

    // Keeping it would leave Phường Bến Nghé filed under Hà Nội — a row that
    // reads as precise and is wrong.
    expect(onChange).toHaveBeenCalledWith({
      provinceCode: HA_NOI.code,
      province: HA_NOI.name,
      districtCode: null,
      district: null,
      wardCode: null,
      ward: null,
    });
  });

  it('keeps the province when a ward is picked', async () => {
    wards.mockReturnValue(settled([BEN_NGHE, TAN_THUAN]));
    const { onChange } = renderFields({
      ...EMPTY_ADMIN_AREA,
      provinceCode: HCM.code,
      province: HCM.name,
    });

    await choose('Phường / Xã', BEN_NGHE.name);

    expect(onChange).toHaveBeenCalledWith(IN_BEN_NGHE);
  });

  it('★ the trigger shows the NAME, not the code', () => {
    wards.mockReturnValue(settled([BEN_NGHE]));
    renderFields(IN_BEN_NGHE);

    // Base UI's own `Select.Value` renders the VALUE, which put `79` where the
    // province name belongs. The trigger draws its own content instead.
    expect(screen.getByLabelText('Tỉnh / Thành phố')).toHaveTextContent(HCM.name);
    expect(screen.getByLabelText('Phường / Xã')).toHaveTextContent(BEN_NGHE.name);
  });

  describe('a row filed before the merger', () => {
    it('★ shows the abolished district, so the address column is accounted for', () => {
      wards.mockReturnValue(settled([BEN_NGHE]));
      renderFields(PRE_MERGER);

      // `fullAddress` still prints "Quận 1". Without this the form would show
      // nothing that explains where it came from, which reads as a bug.
      expect(screen.getByText('Quận / Huyện (trước sáp nhập)')).toBeInTheDocument();
      expect(screen.getByText('Quận 1')).toBeInTheDocument();
      expect(screen.getByText(/đã bỏ từ 01\/07\/2025/)).toBeInTheDocument();
    });

    it('★ shows nothing about districts on a row that never had one', () => {
      wards.mockReturnValue(settled([BEN_NGHE]));
      renderFields(IN_BEN_NGHE);

      expect(screen.queryByText('Quận / Huyện (trước sáp nhập)')).not.toBeInTheDocument();
    });

    it('★ offers no way to edit it — only the province re-pick clears it', () => {
      wards.mockReturnValue(settled([BEN_NGHE]));
      renderFields(PRE_MERGER);

      // Two controls on the form, both of them the current hierarchy's. A
      // control for the old tier would invite somebody to fill it back in.
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
    });

    it('★ re-picking the province drops the district with the ward', async () => {
      wards.mockReturnValue(settled([BEN_NGHE]));
      const { onChange } = renderFields(PRE_MERGER);

      await choose('Tỉnh / Thành phố', HA_NOI.name);

      // The two are only ever wrong as a pair: a new province with an old
      // district under it is a row that is half migrated and self-contradictory.
      expect(onChange).toHaveBeenCalledWith({
        provinceCode: HA_NOI.code,
        province: HA_NOI.name,
        districtCode: null,
        district: null,
        wardCode: null,
        ward: null,
      });
    });

    it('★ an unrelated edit leaves the district exactly as it was', async () => {
      wards.mockReturnValue(settled([BEN_NGHE, TAN_THUAN]));
      const { onChange } = renderFields(PRE_MERGER);

      await choose('Phường / Xã', TAN_THUAN.name);

      // Correcting the ward must not silently destroy the district the row has
      // carried since before the reform — it is still what the contract says.
      expect(onChange).toHaveBeenCalledWith({
        ...PRE_MERGER,
        wardCode: TAN_THUAN.code,
        ward: TAN_THUAN.name,
      });
    });
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
