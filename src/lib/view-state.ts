/**
 * View state carried in the URL.
 *
 * Keeping the camera in the query string makes a particular field of view
 * linkable and survives a reload of the route, which matters when reviewing a
 * specific region. The slide itself cannot be encoded — a `File` handle is not
 * revivable — so a shared link reopens at the same position once the same slide
 * is chosen again.
 */

export interface ViewSearch {
  /** Series being displayed; the pyramid's own series when absent. */
  readonly series?: number;
  /** Centre of the viewport, in level-0 image pixels. */
  readonly x?: number;
  readonly y?: number;
  /** Resolution in image pixels per screen pixel. */
  readonly r?: number;
  /** Rotation in radians. */
  readonly rot?: number;
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Search params arrive as untrusted strings, so every field is parsed
 * defensively and simply dropped when it is not a finite number.
 */
export function parseViewSearch(search: Record<string, unknown>): ViewSearch {
  const series = finite(search['series']);
  const x = finite(search['x']);
  const y = finite(search['y']);
  const r = finite(search['r']);
  const rot = finite(search['rot']);

  return {
    ...(series !== undefined && series >= 0 ? { series: Math.floor(series) } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(r !== undefined && r > 0 ? { r } : {}),
    ...(rot !== undefined ? { rot } : {}),
  };
}

/** Rounds camera values so panning does not churn the URL with noise. */
export function roundCamera(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
