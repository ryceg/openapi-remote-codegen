import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';

/** Suffixes the generator owns, and may therefore delete from the output dir. */
const GENERATED_SUFFIXES = ['.generated.remote.ts', '.generated.ts'];

/**
 * Delete generated files this run no longer emits, returning what was removed.
 *
 * The shared modules come and go with the spec and the config — dropping the last
 * form() removes the form utils, overriding every catch arm removes the error
 * translation — so a stale copy left behind keeps type-checking and shipping
 * against a contract nothing generates any more.
 */
export function pruneStaleGeneratedFiles(dir: string, emitted: Iterable<string>): string[] {
  if (!existsSync(dir)) return [];

  const keep = new Set(emitted);
  const removed: string[] = [];
  for (const existing of readdirSync(dir)) {
    if (keep.has(existing)) continue;
    if (!GENERATED_SUFFIXES.some(suffix => existing.endsWith(suffix))) continue;
    unlinkSync(resolve(dir, existing));
    removed.push(existing);
  }
  return removed;
}
