import { NO_FACTS, mergeFacts, normalizeFacts, type FuelFacts } from './fuel-transaction';

const DRIVER = '22222222-2222-2222-2222-222222222222';
const AT = new Date('2026-10-06T03:43:00Z');

describe('mergeFacts — field by field, append-only', () => {
  it('★ takes facts over several commands, each filling only what is still empty', () => {
    const first = mergeFacts(NO_FACTS, { vendorName: 'Cây xăng X' });
    expect(first).toEqual({ additions: { vendorName: 'Cây xăng X' }, conflicts: [] });

    const afterFirst: FuelFacts = { ...NO_FACTS, ...first.additions } as FuelFacts;
    const second = mergeFacts(afterFirst, { vendorTaxCode: '0100109106', occurredAt: AT });
    expect(second).toEqual({ additions: { vendorTaxCode: '0100109106', occurredAt: AT }, conflicts: [] });

    const afterSecond: FuelFacts = { ...afterFirst, ...second.additions } as FuelFacts;
    expect(mergeFacts(afterSecond, { documentNumber: '0001234' }).additions).toEqual({ documentNumber: '0001234' });
  });

  it('★ treats the same value sent again as a replay — nothing to add, nothing refused', () => {
    const stored: FuelFacts = { ...NO_FACTS, vendorName: 'Cây xăng X', occurredAt: AT, driverUserId: DRIVER };
    expect(
      mergeFacts(stored, { vendorName: 'Cây xăng X', occurredAt: new Date(AT.getTime()), driverUserId: DRIVER }),
    ).toEqual({ additions: {}, conflicts: [] });
  });

  it('★ refuses a different value for a stored fact — by name, never overwriting', () => {
    const stored: FuelFacts = { ...NO_FACTS, vendorTaxCode: '0100109106', occurredAt: AT };
    const result = mergeFacts(stored, {
      vendorTaxCode: '0300588569',
      occurredAt: new Date(AT.getTime() + 60_000),
      documentSeries: '1C24TAA',
    });
    expect(result.conflicts).toEqual(['occurredAt', 'vendorTaxCode']);
    // The empty one is still an addition — judged on its own.
    expect(result.additions).toEqual({ documentSeries: '1C24TAA' });
  });

  it('leaves alone every fact a command does not mention', () => {
    const stored: FuelFacts = { ...NO_FACTS, vendorName: 'Cây xăng X' };
    expect(mergeFacts(stored, {})).toEqual({ additions: {}, conflicts: [] });
  });
});

describe('normalizeFacts — one spelling per fact', () => {
  it('tidies whitespace in a station name and strips spaces and dots from codes', () => {
    expect(
      normalizeFacts({
        vendorName: '  Cây   xăng  X ',
        vendorTaxCode: '0100 109.106',
        documentSeries: ' 1c24 taa ',
        documentNumber: '00.01 234',
      }),
    ).toEqual({
      facts: { vendorName: 'Cây xăng X', vendorTaxCode: '0100109106', documentSeries: '1C24TAA', documentNumber: '0001234' },
      invalid: [],
    });
  });

  it('accepts a branch tax code and the 12-digit form; refuses what is not a tax code', () => {
    expect(normalizeFacts({ vendorTaxCode: '0100109106-001' }).invalid).toEqual([]);
    expect(normalizeFacts({ vendorTaxCode: '079123456789' }).invalid).toEqual([]);
    expect(normalizeFacts({ vendorTaxCode: '12345' }).invalid).toEqual(['vendorTaxCode']);
    expect(normalizeFacts({ vendorTaxCode: 'MST0100109106' }).invalid).toEqual(['vendorTaxCode']);
  });

  it('refuses an empty name and codes with characters a document never has', () => {
    expect(normalizeFacts({ vendorName: '   ' }).invalid).toEqual(['vendorName']);
    expect(normalizeFacts({ documentSeries: 'AB#1' }).invalid).toEqual(['documentSeries']);
    expect(normalizeFacts({ documentNumber: '' }).invalid).toEqual(['documentNumber']);
  });
});
