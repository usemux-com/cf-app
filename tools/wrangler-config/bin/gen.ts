/**
 * Standalone CLI: generate wrangler.json for a given mode.
 *
 * Usage: node tools/wrangler-config/bin/gen.ts <mode>
 *
 * Node 24+ strips TypeScript natively. Relative imports only — no package
 * install under tools/. Exit non-zero when the isolation guard rejects the
 * emitted config.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRANGLER_MODES, generateWranglerConfig, type WranglerMode } from '../src/index.ts';

// Accept a leading `--` so `nub run wrangler:config -- development` works
// (nub forwards the separator as argv[2]).
const modeArg = process.argv[2] === '--' ? process.argv[3] : process.argv[2];
const mode = modeArg;

if (!mode || !(WRANGLER_MODES as readonly string[]).includes(mode)) {
  console.error(
    `Usage: node tools/wrangler-config/bin/gen.ts <mode>\n` +
      `  mode must be one of: ${WRANGLER_MODES.join(', ')}`,
  );
  process.exit(1);
}

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
// test writes beside the suite so it cannot collide with a build's root config
const outFile = mode === 'test' ? '.wrangler/test/wrangler.json' : 'wrangler.json';

try {
  const written = await generateWranglerConfig({
    mode: mode as WranglerMode,
    root,
    outFile,
  });
  console.log(written);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}
