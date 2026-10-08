import { judge, type FuelReceipt, type SeenCost } from './fuel-match';

describe('judge — which cost already records this receipt', () => {
  const receipt = (over: Partial<FuelReceipt['facts']> = {}): FuelReceipt => ({
    businessDate: '2026-10-06',
    amount: '772460',
    facts: over,
  });
  let ids = 0;
  const cost = (over: Partial<SeenCost['view']> = {}, seen: Partial<Omit<SeenCost, 'view'>> = {}): SeenCost => ({
    view: {
      fuelTransactionId: null,
      backing: { ledger: 'vehicle', costId: `c${++ids}`, source: 'driver_portal', voided: false },
      vehicle: { id: 'v', plate: '51D-123.45' },
      businessDate: '2026-10-06',
      occurredAt: null,
      recordedAt: new Date('2026-10-06T03:00:00Z'),
      amount: '772460.00',
      liters: '26.00',
      odometerKm: null,
      unitPrice: null,
      driver: null,
      vendor: null,
      document: null,
      trip: null,
      flags: [],
      recordedBy: { id: 'u', displayName: 'U' },
      ...over,
    },
    evidenceCount: 0,
    imageOnFill: false,
    nearby: true,
    ...seen,
  });

  it('★ answers none when nothing looks like the receipt — and still shows the lorry’s day', () => {
    const result = judge(receipt(), [cost({ amount: '500000.00' })]);
    expect(result.outcome).toBe('none');
    expect(result.matches).toEqual([]);
    expect(result.dayRows).toHaveLength(1);
  });

  it('★ answers single for one same-amount cost within a day, on either ledger', () => {
    const vehicle = judge(receipt({ liters: '26.00' }), [cost({ businessDate: '2026-10-07' })]);
    expect(vehicle).toMatchObject({ outcome: 'single', matches: [{ level: 'possible', basis: ['fingerprint'] }] });
    const trip = judge(receipt(), [
      cost({ backing: { ledger: 'trip', costId: 't', source: 'backoffice', voided: false }, businessDate: null, liters: null,
             trip: { id: 'trip', scheduledOn: '2026-10-05', customerName: null } }),
    ]);
    expect(trip.outcome).toBe('single');
  });

  it('★ answers ambiguous for two alike costs — and keeps them two candidates, never one', () => {
    const [a, b] = [cost(), cost()];
    const result = judge(receipt(), [a, b]);
    expect(result.outcome).toBe('ambiguous');
    expect(result.matches.map((match) => match.backing.costId)).toEqual([a.view.backing.costId, b.view.backing.costId]);
  });

  it('ranks the same image above the same document above a fingerprint', () => {
    const [possible, high, exact] = [
      cost(),
      cost({ fuelTransactionId: 'f2', vendor: { name: null, taxCode: '0100109106' }, document: { series: null, number: '0001234' } }, { nearby: false }),
      cost({ fuelTransactionId: 'f3' }, { imageOnFill: true, nearby: false }),
    ];
    const result = judge(receipt({ vendorTaxCode: '0100109106', documentNumber: '0001234' }), [possible, high, exact]);
    expect(result.matches.map((match) => [match.level, match.basis])).toEqual([
      ['exact', ['evidence_hash']],
      ['high', ['document_identity']],
      ['possible', ['fingerprint']],
    ]);
  });

  it('never fingerprints a cost off the lorry or more than a day away', () => {
    const result = judge(receipt(), [cost({}, { nearby: false }), cost({ businessDate: '2026-10-08' })]);
    expect(result.outcome).toBe('none');
  });

  it('★ does not offer a fill whose own receipt says otherwise — and names what conflicts', () => {
    const other = cost({ fuelTransactionId: 'f', vendor: { name: 'Cây xăng X', taxCode: '0100109106' }, document: { series: null, number: '0009999' } });
    const result = judge(receipt({ vendorTaxCode: '0100109106', documentNumber: '0001234', vendorName: 'Cây xăng Y' }), [other]);
    expect(result.outcome).toBe('none');
    expect(result.dayRows[0]?.conflicts).toEqual(['vendorName', 'documentNumber']);
  });

  it('compares liters with whichever row owns them, but only a trip fill stores them as a fact', () => {
    expect(judge(receipt({ liters: '30.00' }), [cost({ liters: '26.00' })]).outcome).toBe('none');
    const lorry = judge(receipt({ liters: '30.00' }), [cost({ fuelTransactionId: 'f', liters: '26.00' })]);
    expect(lorry.dayRows[0]?.conflicts).toEqual([]);
    const trip = judge(receipt({ liters: '30.00' }), [
      cost({ fuelTransactionId: 'f', backing: { ledger: 'trip', costId: 't', source: 'backoffice', voided: false } }),
    ]);
    expect(trip.dayRows[0]?.conflicts).toEqual(['liters']);
  });

  it('reads a missing series as no contradiction, a different one as another receipt', () => {
    const fill = (series: string | null) =>
      cost({ fuelTransactionId: 'f', vendor: { name: null, taxCode: '0100109106' }, document: { series, number: '0001234' } }, { nearby: false });
    const asked = receipt({ vendorTaxCode: '0100109106', documentNumber: '0001234', documentSeries: 'AA/26E' });
    expect(judge(asked, [fill(null)]).outcome).toBe('single');
    expect(judge(asked, [fill('AA/26E')]).outcome).toBe('single');
    expect(judge(asked, [fill('BB/26E')]).outcome).toBe('none');
  });

  it('puts the nearest day first among equals, and counts a receipt without its images as no image match', () => {
    const [far, near] = [cost({ businessDate: '2026-10-05' }), cost({ businessDate: '2026-10-06' })];
    expect(judge(receipt(), [far, near]).matches.map((m) => m.businessDate)).toEqual(['2026-10-06', '2026-10-05']);
    expect(judge(receipt(), [cost({ fuelTransactionId: 'f' }, { evidenceCount: 3 })]).matches[0]).toMatchObject({
      evidenceCount: 3,
      basis: ['fingerprint'],
    });
  });
});
