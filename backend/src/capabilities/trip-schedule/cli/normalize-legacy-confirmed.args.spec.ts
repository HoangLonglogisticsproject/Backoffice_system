import { parseNormalizationArgs } from './normalize-legacy-confirmed.args';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';

describe('parseNormalizationArgs — dry run unless told exactly what to write', () => {
  it('is a dry run by default, whatever else is passed', () => {
    expect(parseNormalizationArgs([])).toEqual({ mode: 'dry-run' });
    expect(parseNormalizationArgs(['--by', 'boss@hoanglong.test', '--ids', A])).toEqual({ mode: 'dry-run' });
  });

  it('applies only to the ids named — comma or space separated', () => {
    expect(parseNormalizationArgs(['--apply', '--by', 'boss@hoanglong.test', '--ids', `${A},${B}`])).toEqual({
      mode: 'apply',
      by: 'boss@hoanglong.test',
      ids: [A, B],
    });
    expect(parseNormalizationArgs(['--apply', '--ids', A, B, '--by', 'boss@hoanglong.test'])).toMatchObject({ ids: [A, B] });
  });

  it('★ refuses to apply without an actor, without ids, or with something that is not an id', () => {
    expect(parseNormalizationArgs(['--apply', '--ids', A])).toMatchObject({ mode: 'invalid' });
    expect(parseNormalizationArgs(['--apply', '--by', 'boss@hoanglong.test'])).toMatchObject({ mode: 'invalid' });
    expect(parseNormalizationArgs(['--apply', '--by', 'boss@hoanglong.test', '--ids', 'all'])).toMatchObject({
      mode: 'invalid',
      reason: 'Not trip ids: all',
    });
  });
});
