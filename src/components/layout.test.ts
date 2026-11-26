import { describe, expect, it } from 'vitest';

import {
  BUTTON_HEIGHT,
  hitSlopFor,
  INPUT_HEIGHT,
  MIN_TOUCH,
  TEXT_BUTTON_HEIGHT,
  TILE_HALF_SIZE,
  TILE_LARGE_HEIGHT,
  TOUCH_GAP,
} from './layout';

describe('layout constants (R12.3, design sizes)', () => {
  it('names the design sizes', () => {
    expect(MIN_TOUCH).toBe(48);
    expect(TOUCH_GAP).toBe(8);
    expect(BUTTON_HEIGHT).toBe(56);
    expect(INPUT_HEIGHT).toBe(56);
    expect(TILE_LARGE_HEIGHT).toBe(96);
    expect(TILE_HALF_SIZE).toBe(112);
    expect(TEXT_BUTTON_HEIGHT).toBeLessThan(MIN_TOUCH);
  });
});

describe('hitSlopFor', () => {
  it('adds nothing to a control that already measures 48 dp each way', () => {
    expect(hitSlopFor({ width: 48, height: 48 })).toBeNull();
    expect(hitSlopFor({ height: BUTTON_HEIGHT })).toBeNull();
    expect(hitSlopFor({ width: 200, height: 112 })).toBeNull();
  });

  it('splits the missing dp evenly between the two sides', () => {
    expect(hitSlopFor({ height: TEXT_BUTTON_HEIGHT })).toEqual({
      top: 2,
      bottom: 2,
      left: 0,
      right: 0,
    });
    expect(hitSlopFor({ width: 28, height: 28 })).toEqual({
      top: 10,
      bottom: 10,
      left: 10,
      right: 10,
    });
  });

  it('treats a non-finite or negative drawn size as zero', () => {
    expect(hitSlopFor({ width: Number.NaN, height: -4 })).toEqual({
      top: 24,
      bottom: 24,
      left: 24,
      right: 24,
    });
  });
});
