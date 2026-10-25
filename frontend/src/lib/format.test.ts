import { describe, expect, it } from 'vitest';
import { typed } from './format';

describe('typed amounts', () => {
  it('reads separators and rejects anything unreadable instead of turning it into 0', () => {
    expect(typed('50,000')).toBe(50000);
    expect(typed(' 1 200.50 ')).toBe(1200.5);
    expect(typed('0')).toBe(0);
    for (const bad of ['', 'abc', '5k', '-3', '1.2.3']) expect(Number.isNaN(typed(bad))).toBe(true);
  });
});
