import { describe, expect, it } from 'vitest';
import { parseViewSearch, roundCamera } from './view-state';

describe('parseViewSearch', () => {
  it('accepts numbers arriving as strings', () => {
    expect(parseViewSearch({ x: '120.5', y: '80', r: '4' })).toEqual({ x: 120.5, y: 80, r: 4 });
  });

  it('drops values that are not finite numbers', () => {
    expect(parseViewSearch({ x: 'abc', y: null, r: Infinity, rot: {} })).toEqual({});
  });

  it('rejects a non-positive resolution and a negative series', () => {
    expect(parseViewSearch({ r: 0, series: -1 })).toEqual({});
  });

  it('truncates a fractional series index', () => {
    expect(parseViewSearch({ series: '2.9' })).toEqual({ series: 2 });
  });

  it('keeps a zero centre, which is a legitimate coordinate', () => {
    expect(parseViewSearch({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('roundCamera', () => {
  it('limits precision so panning does not churn the URL', () => {
    expect(roundCamera(1.23456)).toBe(1.23);
    expect(roundCamera(1.23456, 4)).toBe(1.2346);
  });
});
