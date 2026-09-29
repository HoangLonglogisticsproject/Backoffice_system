import { describe, expect, it } from 'vitest';
import { translate, type TranslationKey } from '@/types/translate';
import { endReasonText } from './assignmentEndReason';

const vi = (key: TranslationKey) => translate('vi', key);

describe('endReasonText', () => {
  it('★ words the system token for a person, and leaves the token itself alone', () => {
    const stored = 'historical_entry';
    expect(endReasonText(stored, vi)).toBe('Nhập chuyến cũ');
    expect(stored).toBe('historical_entry');
  });

  it('shows a reason a dispatcher typed exactly as typed', () => {
    expect(endReasonText('A báo ốm.', vi)).toBe('A báo ốm.');
  });

  it('never finds a prototype key in a typed reason', () => {
    expect(endReasonText('constructor', vi)).toBe('constructor');
  });
});
