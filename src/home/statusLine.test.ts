import { describe, expect, it } from 'vitest';

import { statusLine } from './statusLine';

describe('statusLine (R6.5)', () => {
  it('"Not checked in" without a first punch, whatever `out` says', () => {
    expect(statusLine(undefined)).toBe('Not checked in');
    expect(statusLine(null)).toBe('Not checked in');
    expect(statusLine({})).toBe('Not checked in');
    expect(statusLine({ in: null, out: null })).toBe('Not checked in');
    expect(statusLine({ in: '', out: '18:05' })).toBe('Not checked in');
  });

  it('"Checked in HH:mm" with a first punch only', () => {
    expect(statusLine({ in: '09:12' })).toBe('Checked in 09:12');
    expect(statusLine({ in: '09:12', out: null })).toBe('Checked in 09:12');
    expect(statusLine({ in: '09:12', out: '' })).toBe('Checked in 09:12');
  });

  it('"Checked in HH:mm · out HH:mm" with both', () => {
    expect(statusLine({ in: '09:12', out: '18:05' })).toBe('Checked in 09:12 · out 18:05');
  });
});
