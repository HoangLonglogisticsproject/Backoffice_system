import { ServiceUnavailableException } from '@nestjs/common';
import { VnAdministrativeService } from './vn-administrative.service';
import type { AdministrativeUnit, VnAdministrativeClient } from './vn-administrative.client';

/**
 * The cache, which is the only part of this feature with a decision in it.
 *
 * ★ WHAT IS BEING PINNED IS THE BEHAVIOUR UNDER FAILURE, not the happy path.
 * Anybody can serve a list that arrived. The questions worth a test are: what
 * does a dispatcher see when somebody else's free API is down, and does ten of
 * them opening a dialog at once cost ten requests against a per-IP rate limit.
 */

const HANOI: AdministrativeUnit = { code: '01', name: 'Thành phố Hà Nội' };
const AN_GIANG: AdministrativeUnit = { code: '91', name: 'An Giang' };

/** A stand-in whose next answer each test sets. */
const upstreamThat = (answer: () => Promise<AdministrativeUnit[]>) => {
  const listProvinces = jest.fn(answer);
  const listWards = jest.fn(answer);
  return {
    client: { listProvinces, listWards } as unknown as VnAdministrativeClient,
    listProvinces,
    listWards,
  };
};

describe('VnAdministrativeService', () => {
  it('serves the upstream answer and does not ask again while it is fresh', async () => {
    const { client, listProvinces } = upstreamThat(async () => [HANOI, AN_GIANG]);
    const service = new VnAdministrativeService(client);

    expect(await service.listProvinces()).toEqual([HANOI, AN_GIANG]);
    expect(await service.listProvinces()).toEqual([HANOI, AN_GIANG]);

    // Twice asked, once fetched. The TTL is a day; a dispatcher opening the
    // dialog twenty times in a shift must not be twenty requests.
    expect(listProvinces).toHaveBeenCalledTimes(1);
  });

  it('★ keeps serving the cached list when the upstream has since died', async () => {
    let alive = true;
    const { client } = upstreamThat(async () => {
      if (!alive) throw new Error('ECONNREFUSED');
      return [HANOI];
    });
    const service = new VnAdministrativeService(client);

    await service.listProvinces();
    alive = false;

    // Force the TTL to have passed by ageing the entry rather than by waiting
    // a day: the rule under test is "expired means ASK again", not "expired
    // means throw away".
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 48 * 60 * 60 * 1000);

    // A day-old list of provinces is still a correct list of provinces. An
    // empty dropdown is a dispatcher who cannot file the place in front of them.
    expect(await service.listProvinces()).toEqual([HANOI]);

    jest.restoreAllMocks();
  });

  it('★ refuses with 503 only when nothing has ever been loaded', async () => {
    const { client } = upstreamThat(async () => {
      throw new Error('ECONNREFUSED');
    });
    const service = new VnAdministrativeService(client);

    await expect(service.listProvinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('★ does not cache an empty answer — that is the upstream being wrong, not Vietnam being empty', async () => {
    const { client, listProvinces } = upstreamThat(async () => []);
    const service = new VnAdministrativeService(client);

    await expect(service.listProvinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
    // And the next caller tries again rather than being served the empty list
    // for the next twenty-four hours.
    await expect(service.listProvinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(listProvinces).toHaveBeenCalledTimes(2);
  });

  it('★ ten simultaneous cold callers make ONE upstream request', async () => {
    let release: (units: AdministrativeUnit[]) => void = () => {};
    const pending = new Promise<AdministrativeUnit[]>((resolve) => {
      release = resolve;
    });
    const { client, listProvinces } = upstreamThat(() => pending);
    const service = new VnAdministrativeService(client);

    const callers = Array.from({ length: 10 }, () => service.listProvinces());
    release([HANOI]);

    // The upstream rate-limits per IP and this server is one IP. Everybody
    // waits on the same promise.
    expect(await Promise.all(callers)).toEqual(Array.from({ length: 10 }, () => [HANOI]));
    expect(listProvinces).toHaveBeenCalledTimes(1);
  });

  it('keys wards by province, so one province’s list is never served as another’s', async () => {
    const wards: Record<string, AdministrativeUnit[]> = {
      '01': [{ code: '09877', name: 'Xã An Khánh' }],
      '91': [{ code: '30289', name: 'Phường Long Xuyên' }],
    };
    const listWards = jest.fn(async (code: string) => wards[code] ?? []);
    const service = new VnAdministrativeService({
      listProvinces: jest.fn(),
      listWards,
    } as unknown as VnAdministrativeClient);

    expect(await service.listWards('01')).toEqual(wards['01']);
    expect(await service.listWards('91')).toEqual(wards['91']);
    expect(listWards).toHaveBeenCalledTimes(2);
  });

  it('a province code can never collide with the provinces entry', async () => {
    const listProvinces = jest.fn(async () => [HANOI]);
    const listWards = jest.fn(async () => [{ code: '00001', name: 'Phường Một' }]);
    const service = new VnAdministrativeService({
      listProvinces,
      listWards,
    } as unknown as VnAdministrativeClient);

    // A province literally coded "provinces" is not a thing, but the key space
    // says so rather than leaving it to luck.
    await service.listProvinces();
    expect(await service.listWards('provinces')).toEqual([{ code: '00001', name: 'Phường Một' }]);
  });
});
