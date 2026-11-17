/**
 * Vitest globalSetup: emit an isolated test-mode Wrangler config.
 *
 * Writing to `.wrangler/test/wrangler.json` (not the root `wrangler.json`) is
 * what keeps the suite immune to build order — a prior `build --mode production`
 * must not leave the test runner reading deploy bindings. Regeneration also
 * re-runs the isolation guard on every test run.
 *
 * Nothing in the suite reads this file yet (no vitest-pool-workers). That is
 * intentional: the path is in place so consumers can land without inventing a
 * second config path later.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWranglerConfig } from './index.ts';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export default async function setup(): Promise<void> {
  await generateWranglerConfig({
    mode: 'test',
    root,
    outFile: '.wrangler/test/wrangler.json',
  });
}
