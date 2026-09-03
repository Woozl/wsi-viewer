/**
 * Small runtime validators for data crossing the WASM boundary.
 *
 * The core hands back JSON, so its shape is only a convention until it is
 * checked. These helpers turn a malformed payload into a clear error at the
 * boundary instead of an undefined-property failure deep in a component.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRecord(text: string, context: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${context}: expected an object`);
  return parsed;
}

export function parseArray(text: string, context: string): unknown[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${context}: expected an array`);
  return parsed;
}

export function num(source: Record<string, unknown>, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context}: "${key}" is not a finite number`);
  }
  return value;
}

export function str(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new Error(`${context}: "${key}" is not a string`);
  return value;
}

export function bool(source: Record<string, unknown>, key: string, context: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw new Error(`${context}: "${key}" is not a boolean`);
  return value;
}

/** Reads a `Record<string, string>`, skipping any entry that is not a string. */
export function stringMap(
  source: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, string> {
  const value = source[key];
  if (!isRecord(value)) throw new Error(`${context}: "${key}" is not an object`);
  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string') result[entryKey] = entryValue;
  }
  return result;
}

export function numberArray(
  source: Record<string, unknown>,
  key: string,
  context: string,
): number[] {
  const value = source[key];
  if (!Array.isArray(value)) throw new Error(`${context}: "${key}" is not an array`);
  return value.filter((entry): entry is number => typeof entry === 'number');
}
