import { describe, expect, it } from 'vitest';
import {
  brightfieldVariables,
  buildBrightfieldStyle,
  buildFluorescenceStyle,
  channelVariables,
} from './channel-style';
import type { ChannelSettings } from './channels';

function settings(overrides: Partial<ChannelSettings>): ChannelSettings {
  return {
    index: 0,
    label: 'Channel 1',
    visible: true,
    color: [1, 0, 0],
    min: 0,
    max: 255,
    gamma: 1,
    ...overrides,
  };
}

/** Collects every band index the expression samples. */
function bandsUsed(expression: unknown, found: number[] = []): number[] {
  if (!Array.isArray(expression)) return found;
  if (expression[0] === 'band' && typeof expression[1] === 'number') found.push(expression[1]);
  for (const part of expression) bandsUsed(part, found);
  return found;
}

describe('channelVariables', () => {
  it('maps the display window onto a scale and offset', () => {
    const variables = channelVariables([settings({ min: 100, max: 300 })]);
    // A sample at min must land on 0 and one at max on 1.
    expect(100 * (variables['c0_s'] ?? 0) + (variables['c0_o'] ?? 0)).toBeCloseTo(0);
    expect(300 * (variables['c0_s'] ?? 0) + (variables['c0_o'] ?? 0)).toBeCloseTo(1);
  });

  it('survives a zero-width window rather than dividing by zero', () => {
    const variables = channelVariables([settings({ min: 50, max: 50 })]);
    expect(Number.isFinite(variables['c0_s'] ?? NaN)).toBe(true);
    expect(Number.isFinite(variables['c0_o'] ?? NaN)).toBe(true);
  });

  it('folds hidden channels into a black colour so they contribute nothing', () => {
    const variables = channelVariables([settings({ visible: false, color: [1, 1, 1] })]);
    expect(variables['c0_r']).toBe(0);
    expect(variables['c0_g']).toBe(0);
    expect(variables['c0_b']).toBe(0);
  });

  it('names variables per channel so several can coexist', () => {
    const variables = channelVariables([settings({}), settings({ index: 1 })]);
    expect(variables).toHaveProperty('c0_gam');
    expect(variables).toHaveProperty('c1_gam');
  });
});

describe('buildFluorescenceStyle', () => {
  it('samples one band per channel, in order', () => {
    const style = buildFluorescenceStyle([settings({}), settings({ index: 1 }), settings({ index: 2 })]);
    expect([...new Set(bandsUsed(style.color))].sort()).toEqual([1, 2, 3]);
  });

  it('produces a four-component colour', () => {
    const style = buildFluorescenceStyle([settings({})]);
    expect(Array.isArray(style.color)).toBe(true);
    expect((style.color as unknown[])[0]).toBe('array');
    expect((style.color as unknown[]).length).toBe(5);
  });

  it('still yields a valid style with no channels', () => {
    const style = buildFluorescenceStyle([]);
    expect(bandsUsed(style.color)).toEqual([]);
    expect(style.variables).toEqual({});
  });
});

describe('buildBrightfieldStyle', () => {
  it('reads the three colour bands of a decoded tile', () => {
    const style = buildBrightfieldStyle({ min: 0, max: 1, gamma: 1 });
    expect([...new Set(bandsUsed(style.color))].sort()).toEqual([1, 2, 3]);
  });

  it('shares one window across the three components', () => {
    const variables = brightfieldVariables({ min: 0.1, max: 0.9, gamma: 2 });
    expect(variables['rgb_gam']).toBe(2);
    expect(0.1 * (variables['rgb_s'] ?? 0) + (variables['rgb_o'] ?? 0)).toBeCloseTo(0);
    expect(0.9 * (variables['rgb_s'] ?? 0) + (variables['rgb_o'] ?? 0)).toBeCloseTo(1);
  });
});
