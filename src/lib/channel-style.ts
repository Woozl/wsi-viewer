/**
 * WebGL styling for channel compositing.
 *
 * The whole point of doing this in a style rather than in the worker is that
 * adjusting a slider must not refetch tiles. OpenLayers compiles the expression
 * into a shader once, and `updateStyleVariables` then pushes new uniforms, so
 * dragging a window or changing a colour is a uniform update rather than a
 * decode.
 *
 * Float tile data is uploaded to a `gl.FLOAT` texture untouched, so `band(n)`
 * yields raw sample values and the display window can be expressed in the units
 * the file actually uses.
 */
import type { ExpressionValue } from 'ol/expr/expression';
import type { BrightfieldAdjustment, ChannelSettings } from './channels';

/**
 * OpenLayers style expressions are nested arrays of operators and literals.
 *
 * Mirrors the library's own `ExpressionValue`, which is deliberately loose;
 * naming it here keeps that looseness in one place instead of spreading `any`
 * through the builders.
 */
type Expression = ExpressionValue;

export type StyleVariables = Readonly<Record<string, number>>;

function scaleOf(min: number, max: number): { scale: number; offset: number } {
  // A zero-width window would divide by zero and blank the image.
  const span = max - min === 0 ? 1 : max - min;
  return { scale: 1 / span, offset: -min / span };
}

/** Variable names are per channel so one shader serves any arrangement. */
function names(index: number): Record<'s' | 'o' | 'gam' | 'r' | 'g' | 'b', string> {
  const prefix = `c${String(index)}`;
  return {
    s: `${prefix}_s`,
    o: `${prefix}_o`,
    gam: `${prefix}_gam`,
    r: `${prefix}_r`,
    g: `${prefix}_g`,
    b: `${prefix}_b`,
  };
}

/**
 * Uniform values for the current settings.
 *
 * Visibility is folded into the colour rather than carried as its own uniform:
 * a hidden channel contributes zero to every component, which costs one fewer
 * multiply per channel in the shader.
 */
export function channelVariables(channels: readonly ChannelSettings[]): StyleVariables {
  const variables: Record<string, number> = {};
  channels.forEach((channel, position) => {
    const key = names(position);
    const { scale, offset } = scaleOf(channel.min, channel.max);
    const [r, g, b] = channel.color;
    variables[key.s] = scale;
    variables[key.o] = offset;
    variables[key.gam] = channel.gamma;
    variables[key.r] = channel.visible ? r : 0;
    variables[key.g] = channel.visible ? g : 0;
    variables[key.b] = channel.visible ? b : 0;
  });
  return variables;
}

/** Windowed, gamma-corrected intensity of one band, in 0..1. */
function intensity(band: number, index: number): Expression {
  const key = names(index);
  const windowed: Expression = [
    'clamp',
    ['+', ['*', ['band', band], ['var', key.s]], ['var', key.o]],
    0,
    1,
  ];
  return ['^', windowed, ['var', key.gam]];
}

function sum(terms: readonly Expression[]): Expression {
  if (terms.length === 0) return 0;
  return terms.reduce((left, right) => ['+', left, right]);
}

/**
 * Additive composite of every channel.
 *
 * Additive rather than alpha blending because that is what the instrument does:
 * two fluorophores in the same place emit together, so a green and a red marker
 * overlapping should read yellow, not "whichever was drawn last".
 */
export function buildFluorescenceStyle(channels: readonly ChannelSettings[]): {
  variables: StyleVariables;
  color: Expression;
} {
  const components: Expression[][] = [[], [], []];
  channels.forEach((_, position) => {
    // Bands are one-based, and are uploaded in channel order.
    const value = intensity(position + 1, position);
    const key = names(position);
    components[0]?.push(['*', value, ['var', key.r]]);
    components[1]?.push(['*', value, ['var', key.g]]);
    components[2]?.push(['*', value, ['var', key.b]]);
  });

  return {
    variables: channelVariables(channels),
    color: [
      'array',
      ['clamp', sum(components[0] ?? []), 0, 1],
      ['clamp', sum(components[1] ?? []), 0, 1],
      ['clamp', sum(components[2] ?? []), 0, 1],
      1,
    ],
  };
}

/**
 * Window and gamma over an already-composited RGB image.
 *
 * Brightfield tiles arrive as decoded JPEG, so their bands are the red, green
 * and blue the scanner produced. Adjusting them here keeps the compressed tile
 * path intact, which is what makes gigapixel brightfield slides usable at all.
 */
export function buildBrightfieldStyle(adjustment: BrightfieldAdjustment): {
  variables: StyleVariables;
  color: Expression;
} {
  const component = (band: number): Expression => [
    '^',
    ['clamp', ['+', ['*', ['band', band], ['var', 'rgb_s']], ['var', 'rgb_o']], 0, 1],
    ['var', 'rgb_gam'],
  ];

  const { scale, offset } = scaleOf(adjustment.min, adjustment.max);
  return {
    variables: { rgb_s: scale, rgb_o: offset, rgb_gam: adjustment.gamma },
    color: ['array', component(1), component(2), component(3), 1],
  };
}

export function brightfieldVariables(adjustment: BrightfieldAdjustment): StyleVariables {
  const { scale, offset } = scaleOf(adjustment.min, adjustment.max);
  return { rgb_s: scale, rgb_o: offset, rgb_gam: adjustment.gamma };
}
