import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FuelCandidate } from '@/types/fuel';

const get = vi.fn();
const post = vi.fn();

vi.mock('./client', () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const { attachFuelReceipt, findFuelMatches, stageFuelEvidence } = await import('./fuelEvidence');

const candidate = (over: Partial<FuelCandidate> = {}): FuelCandidate =>
  ({
    fuelTransactionId: null,
    backing: { ledger: 'vehicle', costId: 'cost-1', source: 'driver_portal', voided: false },
    vehicle: { id: 'lorry-1', plate: '51D12345' },
    trip: { id: 'trip-1', scheduledOn: '2026-10-06', customerName: null },
    ...over,
  }) as FuelCandidate;

const attachment = {
  evidenceIds: ['img-1'],
  facts: { liters: '26', vendorTaxCode: '0100109106', documentNumber: '0001234' },
  acknowledgedMatches: ['fill-9'],
  vehicleId: 'lorry-searched',
  businessDate: '2026-10-06',
};

/**
 * What the fuel-receipt calls send. ★ The negative assertions are the rules:
 * no call creates a cost, a lorry cost is never sent liters, and a trip fill is
 * given its lorry and day only when it is opened.
 */
describe('fuel receipt calls', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: {} });
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it('uploads ONE multipart field, overriding the JSON default', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'bill.jpg', { type: 'image/jpeg' });
    await stageFuelEvidence(file);
    const [url, form, config] = post.mock.calls[0] as [string, FormData, { headers: Record<string, string> }];
    expect(url).toBe('/fuel-evidence');
    expect([...form.keys()]).toEqual(['file']);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
  });

  it('searches with the receipt and its images, comma-separated — a GET, never a write', async () => {
    await findFuelMatches('lorry-1', { businessDate: '2026-10-06', amount: '772460' }, ['a', 'b']);
    expect(get).toHaveBeenCalledWith('/trip-vehicles/lorry-1/fuel-matches', {
      params: { businessDate: '2026-10-06', amount: '772460', evidence: 'a,b' },
    });
    await findFuelMatches('lorry-1', { businessDate: '2026-10-06', amount: '1' }, []);
    expect(get.mock.calls[1]?.[1]).toEqual({ params: { businessDate: '2026-10-06', amount: '1' } });
    expect(post).not.toHaveBeenCalled();
  });

  it('★ attaches to a lorry cost through ITS route — and never sends it liters, a lorry or a day', async () => {
    await attachFuelReceipt(candidate(), attachment);
    expect(post).toHaveBeenCalledWith('/trip-vehicles/lorry-1/costs/cost-1/fuel-transaction', {
      vendorTaxCode: '0100109106',
      documentNumber: '0001234',
      evidence: [{ id: 'img-1' }],
      acknowledgedMatches: ['fill-9'],
    });
  });

  it('★ opens a trip line’s fill with the searched lorry and day, and its liters as a fact', async () => {
    await attachFuelReceipt(candidate({ backing: { ledger: 'trip', costId: 'line-1', source: 'backoffice', voided: false } }), attachment);
    expect(post).toHaveBeenCalledWith('/trip-schedules/trip-1/costs/line-1/fuel-transaction', {
      vendorTaxCode: '0100109106',
      documentNumber: '0001234',
      evidence: [{ id: 'img-1' }],
      acknowledgedMatches: ['fill-9'],
      vehicleId: 'lorry-searched',
      businessDate: '2026-10-06',
      liters: '26',
    });
  });

  it('adds to a trip fill that exists without re-sending its fixed lorry and day', async () => {
    await attachFuelReceipt(
      candidate({ fuelTransactionId: 'fill-1', backing: { ledger: 'trip', costId: 'line-1', source: 'backoffice', voided: false } }),
      attachment,
    );
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('vehicleId');
    expect(body).not.toHaveProperty('businessDate');
  });
});
