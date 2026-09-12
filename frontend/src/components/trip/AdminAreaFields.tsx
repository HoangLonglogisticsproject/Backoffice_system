import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDistricts, useProvinces, useWards } from '@/hooks/useVnAdministrative';

/**
 * Tỉnh/Thành phố → Quận/Huyện → Phường/Xã, as three dropdowns that cascade.
 *
 * ★ THREE LEVELS, RECORDING THE PRE-2025 HIERARCHY ON PURPOSE. Vietnam went
 * two-tier on 1 July 2025 and abolished quận/huyện; the server reads the older
 * feed anyway, because these fields exist for a person finding a row in a list
 * and that person still says "Quận 7". The client on the server side carries
 * the full reasoning and the cost.
 *
 * ★ THE CODE AND THE NAME TOGETHER ARE THE ANSWER, because the code alone is
 * not unique in this source — see `keyOf`. Both are reported to the caller and
 * both are stored: the code so a rename can be followed, the name so a list
 * reads without asking anybody.
 *
 * ★ AND THE FIELDS ARE OPTIONAL, WHOEVER IS DOWN. When the source cannot be
 * reached the selects say so and stay empty, and the form still saves. These
 * describe a place for somebody reading a list; they are not what makes a place
 * real, and they are not what a driver is measured against.
 */

export interface AdminAreaValue {
  provinceCode: string | null;
  province: string | null;
  districtCode: string | null;
  district: string | null;
  wardCode: string | null;
  ward: string | null;
}

export const EMPTY_ADMIN_AREA: AdminAreaValue = {
  provinceCode: null,
  province: null,
  districtCode: null,
  district: null,
  wardCode: null,
  ward: null,
};

/**
 * What one option is worth as a value and as a React key: the code AND the name.
 *
 * ★ THE CODE ALONE IS NOT UNIQUE, WHICH WAS MEASURED RATHER THAN ASSUMED. In
 * the source's own data, Hồ Chí Minh's `27118` carries three different wards —
 * "An Hội Đông", "An Hội Tây" and "An Khánh" — and three other codes collide
 * the same way. Keying on the code produced React's "two children with the same
 * key" and, worse, would have made two real warehouses indistinguishable.
 *
 * ★ `null`, NEVER `undefined`. `undefined` makes the select UNCONTROLLED on
 * first render and controlled the moment somebody picks, which is the warning
 * React prints and a class of lost-value bug behind it. `null` is controlled
 * and empty from the first paint.
 */
const keyOf = (code: string | null, name: string | null): string | null =>
  code === null ? null : `${code}|${name ?? ''}`;

/** The unit one option key refers to, or nothing if the list has moved on. */
const unitOf = (
  key: string | null,
  units: { code: string; name: string }[],
): { code: string; name: string } | undefined =>
  key === null ? undefined : units.find((unit) => keyOf(unit.code, unit.name) === key);

/**
 * What the closed trigger reads.
 *
 * ★ THE NAME, RENDERED HERE, NOT `SelectValue`. Base UI's `Select.Value` prints
 * the VALUE it was given — which is why the trigger showed `79` instead of
 * "Thành phố Hồ Chí Minh". The two existing selects in this codebase never
 * noticed: the page-size one has a value that reads like its label, and the
 * language one writes its own trigger content, which is what this does.
 */
function Chosen({ name, placeholder }: Readonly<{ name: string | null; placeholder: string }>) {
  // ★ `min-w-0` IS WHAT LETS IT TRUNCATE AT ALL. A flex child refuses to shrink
  // below its content by default, so without this the trigger grows to fit
  // "Thành phố Hồ Chí Minh", pushes past the dialog, and the modal grows a
  // horizontal scrollbar instead of an ellipsis.
  const shared = 'min-w-0 flex-1 truncate text-left';
  if (name === null) return <span className={`${shared} text-muted-foreground`}>{placeholder}</span>;
  return <span className={shared}>{name}</span>;
}

export function AdminAreaFields({
  value,
  onChange,
}: Readonly<{
  value: AdminAreaValue;
  onChange: (next: AdminAreaValue) => void;
}>) {
  const { t } = useLanguage();
  const provinces = useProvinces();
  const districts = useDistricts(value.provinceCode);
  const wards = useWards(value.districtCode);

  const pickProvince = (key: string | null) => {
    const province = unitOf(key, provinces.items);
    if (!province) return;
    // ★ CHANGING A LEVEL CLEARS EVERY LEVEL BELOW IT. Keeping them would leave
    // a ward filed under a district it does not belong to — a row that reads as
    // precise and is wrong, which is worse than one that reads as incomplete.
    onChange({
      provinceCode: province.code,
      province: province.name,
      districtCode: null,
      district: null,
      wardCode: null,
      ward: null,
    });
  };

  const pickDistrict = (key: string | null) => {
    const district = unitOf(key, districts.items);
    if (!district) return;
    onChange({
      ...value,
      districtCode: district.code,
      district: district.name,
      wardCode: null,
      ward: null,
    });
  };

  const pickWard = (key: string | null) => {
    const ward = unitOf(key, wards.items);
    if (!ward) return;
    onChange({ ...value, wardCode: ward.code, ward: ward.name });
  };

  const provinceChosen = value.provinceCode !== null;
  const districtChosen = value.districtCode !== null;

  return (
    /*
      ★ STACKED, NOT THREE ACROSS. The dialog is `max-w-lg`; three columns leave
      each control about 145px, and "Chọn tỉnh / thành phố" alone is wider than
      that — which is how the row came to overflow its own modal. Vietnamese
      unit names are long by nature ("Thành phố Hồ Chí Minh", "Phường Tân Thuận
      Đông"), so they get the full width, and reading top to bottom happens to
      be the order the cascade depends in.
    */
    <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor="location-province" className="text-sm font-medium text-gray-700">
          {t('locationProvince')}
        </label>
        <Select value={keyOf(value.provinceCode, value.province)} onValueChange={pickProvince}>
          <SelectTrigger id="location-province" className="w-full min-w-0">
            <Chosen
              name={value.province}
              placeholder={t(provinces.loading ? 'loading' : 'locationProvincePick')}
            />
          </SelectTrigger>
          <SelectContent>
            {provinces.items.map((unit) => (
              <SelectItem key={keyOf(unit.code, unit.name)} value={keyOf(unit.code, unit.name)}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {provinces.failed ? (
          <p className="text-xs text-amber-700">{t('adminAreaUnavailable')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="location-district" className="text-sm font-medium text-gray-700">
          {t('locationDistrict')}
        </label>
        <Select
          value={keyOf(value.districtCode, value.district)}
          onValueChange={pickDistrict}
          disabled={!provinceChosen || districts.loading}
        >
          <SelectTrigger id="location-district" className="w-full min-w-0">
            <Chosen
              name={value.district}
              placeholder={t(
                !provinceChosen
                  ? 'locationDistrictNeedsProvince'
                  : districts.loading
                    ? 'loading'
                    : 'locationDistrictPick',
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {districts.items.map((unit) => (
              <SelectItem key={keyOf(unit.code, unit.name)} value={keyOf(unit.code, unit.name)}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {districts.failed ? <p className="text-xs text-amber-700">{t('adminAreaUnavailable')}</p> : null}
      </div>
      <div className="space-y-2">
        <label htmlFor="location-ward" className="text-sm font-medium text-gray-700">
          {t('locationWard')}
        </label>
        {/*
          Disabled until a DISTRICT is chosen, because the list is the
          district's — and the placeholder says which state the control is in,
          rather than leaving a dead box with no explanation.
        */}
        <Select
          value={keyOf(value.wardCode, value.ward)}
          onValueChange={pickWard}
          disabled={!districtChosen || wards.loading}
        >
          <SelectTrigger id="location-ward" className="w-full min-w-0">
            <Chosen
              name={value.ward}
              placeholder={t(
                !districtChosen ? 'locationWardNeedsDistrict' : wards.loading ? 'loading' : 'locationWardPick',
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {wards.items.map((unit) => (
              <SelectItem key={keyOf(unit.code, unit.name)} value={keyOf(unit.code, unit.name)}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {wards.failed ? <p className="text-xs text-amber-700">{t('adminAreaUnavailable')}</p> : null}
      </div>
    </div>
  );
}
