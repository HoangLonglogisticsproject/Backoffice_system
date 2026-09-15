import type { ConfigService } from '@nestjs/config';
import { VnAdministrativeClient } from './vn-administrative.client';
import type { Env } from '../../config/env.schema';

/**
 * The boundary: what is asked for, and what is believed when it answers.
 *
 * ★ THIS IS THE ONE PLACE THE UPSTREAM'S SHAPE IS PINNED. Everything above
 * works in `{ code, name }`, so if this file misreads the feed nothing else
 * notices — an empty dropdown is the first symptom, in front of a dispatcher.
 *
 * ★ AND THE v1/v2 DISTINCTION IS THE POINT OF HALF OF IT. `/api/v1` is the
 * pre-2025 three-tier feed and `/api/v2` is the post-merger two-tier one; they
 * differ by one field name on the same path. A deployment left on v1 must fail
 * loudly here rather than serve a province with no wards.
 */

const BASE = 'https://units.example/api/v2';

const config = {
  get: () => BASE,
} as unknown as ConfigService<Env, true>;

/**
 * Whatever the network is made to answer. The returned array collects the URLs
 * it was asked for — asserting on that rather than on `mock.calls[0][0]` keeps
 * "what did it request" readable and survives `noUncheckedIndexedAccess`.
 */
const answering = (body: unknown, init: { ok?: boolean; status?: number } = {}): string[] => {
  const asked: string[] = [];
  global.fetch = (async (url: string) => {
    asked.push(url);
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
  }) as unknown as typeof fetch;
  return asked;
};

/** The upstream sends `code` as a NUMBER. Fixtures say so, or they prove nothing. */
const province = (code: number, name: string) => ({
  code,
  name,
  division_type: 'tỉnh',
  codename: 'x',
  phone_code: 1,
});
const ward = (code: number, name: string) => ({ code, name, division_type: 'phường' });

describe('VnAdministrativeClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('the provinces', () => {
    it('asks for the bare list, returns codes as strings, and forwards nothing else', async () => {
      const asked = answering([province(79, 'Thành phố Hồ Chí Minh'), province(1, 'Hà Nội')]);

      const units = await new VnAdministrativeClient(config).listProvinces();

      expect(asked).toEqual([`${BASE}/p/`]);
      // Two things at once, because `toEqual` checks the keys exactly:
      //   - a code arrives as a NUMBER and leaves as a string. It goes into a
      //     URL, a TEXT column and a <SelectItem value>; the coercion happens
      //     once, here, and never again above this line.
      //   - `division_type`, `codename` and `phone_code` are dropped. The
      //     schema `.passthrough()`es them so a field the upstream ADDS cannot
      //     break us, and nothing downstream inherits one nobody asked for.
      expect(units).toEqual([
        { code: '79', name: 'Thành phố Hồ Chí Minh' },
        { code: '1', name: 'Hà Nội' },
      ]);
    });
  });

  describe('the wards', () => {
    it('★ reads them off the PROVINCE — there is no district rung any more', async () => {
      const asked = answering({
        ...province(79, 'Thành phố Hồ Chí Minh'),
        wards: [ward(26743, 'Phường Bến Nghé'), ward(27460, 'Phường Tân Thuận')],
      });

      const units = await new VnAdministrativeClient(config).listWards('79');

      // `/p/{code}?depth=2`, not `/d/{code}` — the 2025 merger left the
      // province as the ward's immediate parent. And ONE call, not two: the
      // old hierarchy needed a district round trip in between.
      expect(asked).toEqual([`${BASE}/p/79?depth=2`]);
      expect(units).toEqual([
        { code: '26743', name: 'Phường Bến Nghé' },
        { code: '27460', name: 'Phường Tân Thuận' },
      ]);
    });

    it('★ refuses a v1 answer instead of reporting a province with no wards', async () => {
      // The same path on the pre-2025 feed answers with `districts` and no
      // `wards` at all. Silently returning [] would leave a dispatcher staring
      // at an empty dropdown with a healthy-looking server behind it.
      answering({ ...province(79, 'Hồ Chí Minh'), districts: [{ code: 760, name: 'Quận 1' }] });

      await expect(new VnAdministrativeClient(config).listWards('79')).rejects.toThrow(
        /unexpected shape/i,
      );
    });

    it('escapes the code rather than pasting it into the URL', async () => {
      const asked = answering({ wards: [ward(1, 'Phường Một')] });

      await new VnAdministrativeClient(config).listWards('79 80');

      expect(asked).toEqual([`${BASE}/p/79%2080?depth=2`]);
    });
  });

  describe('what it will not pass upwards', () => {
    it('★ drops a row repeated with the same code AND name', async () => {
      // Measured, not defensive: the feed repeats rows, and a duplicate React
      // key plus four identical options is what a dispatcher saw.
      answering({
        wards: [ward(25747, 'Phường Thủ Dầu Một'), ward(25747, 'Phường Thủ Dầu Một')],
      });

      expect(await new VnAdministrativeClient(config).listWards('79')).toEqual([
        { code: '25747', name: 'Phường Thủ Dầu Một' },
      ]);
    });

    it('★ keeps two DIFFERENT names under one code — the code is not an identity', async () => {
      answering({ wards: [ward(27118, 'Phường An Hội Đông'), ward(27118, 'Phường An Hội Tây')] });

      // These are two real wards behind one code. Merging them would make two
      // warehouses indistinguishable; what identifies a ward downstream is the
      // code AND the name together.
      expect(await new VnAdministrativeClient(config).listWards('79')).toEqual([
        { code: '27118', name: 'Phường An Hội Đông' },
        { code: '27118', name: 'Phường An Hội Tây' },
      ]);
    });

    it('refuses a non-2xx', async () => {
      answering([], { ok: false, status: 503 });

      await expect(new VnAdministrativeClient(config).listProvinces()).rejects.toThrow(/503/);
    });

    it('refuses a body that is not the list it asked for', async () => {
      // A proxy answering with HTML, or an error object where an array belongs.
      answering({ message: 'nope' });

      await expect(new VnAdministrativeClient(config).listProvinces()).rejects.toThrow(
        /unexpected shape/i,
      );
    });

    it('★ refuses a code that stopped being a number', async () => {
      // `z.number()`, not `z.coerce.string()`. A string code is a shape change
      // worth failing on, not something to paper over.
      answering([{ code: '79', name: 'Thành phố Hồ Chí Minh' }]);

      await expect(new VnAdministrativeClient(config).listProvinces()).rejects.toThrow(
        /unexpected shape/i,
      );
    });

    it('reports an unreachable host as one sentence, not somebody else’s stack', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('ECONNREFUSED 10.0.0.1:443');
      }) as unknown as typeof fetch;

      await expect(new VnAdministrativeClient(config).listProvinces()).rejects.toThrow(
        /did not respond/i,
      );
    });
  });
});
