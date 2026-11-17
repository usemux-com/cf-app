/**
 * Static boundary guard: the Datastar wire protocol may only be constructed by
 * the policy boundary module (src/utils/datastar.ts).
 *
 * The compile-time brands (TrustedHtml, SseEvent, StableIdSelector) stop routes
 * from *importing* their way around the boundary, but nothing stops a route
 * from string-building its own SSE frames. This scan fails the suite the
 * moment a wire-format literal leaks into any other source file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const BOUNDARY = join(SRC, 'utils', 'datastar.ts');

/** The literals that together define the SSE wire contract. */
const WIRE_LITERALS = [
  'datastar-patch-elements',
  'datastar-patch-signals',
  'text/event-stream',
  'Datastar-Request',
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

describe('Datastar boundary guard', () => {
  it('wire-format literals appear only in the boundary module', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === BOUNDARY) continue;
      const source = readFileSync(file, 'utf8');
      for (const literal of WIRE_LITERALS) {
        if (source.includes(literal)) {
          offenders.push(`${relative(SRC, file)} contains "${literal}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
