import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfigFromFile, type Plugin } from 'vite';
import {
  DEPLOY_MODES,
  OFFLINE_PLACEHOLDER_UUID,
  WRANGLER_MODES,
  type ConfigContext,
  type WranglerConfig,
  type WranglerMode,
} from './types.ts';

export type {
  ConfigContext,
  WranglerConfig,
  WranglerConfigFactory,
  WranglerMode,
} from './types.ts';
export { DEPLOY_MODES, OFFLINE_PLACEHOLDER_UUID, WRANGLER_MODES, defineConfig } from './types.ts';

// ── mode isolation ──────────────────────────────────────────────────────────

/**
 * Refuse to emit a config whose bindings do not match its mode.
 *
 * This lives in the loader, not in `wrangler.config.ts`, because a rule written
 * in the config file is only as strong as the next edit — this one fails the
 * build. Both directions matter, and the deploying one bites hardest: a
 * placeholder that survives into a deploy produces a Worker that publishes
 * cleanly and then cannot reach its database, which only shows up under traffic.
 *
 * Extend this for the bindings your project uses. The shape to preserve is
 * "assert both directions": deploying modes must have real resources, offline
 * modes must have nothing that can resolve to one. A check that only guards the
 * deploy direction still lets a test suite quietly hit production.
 */
function assertModeIsolation(mode: WranglerMode, config: WranglerConfig): void {
  const ids = (config.d1_databases ?? []).map((d) => d.database_id);
  const fail = (why: string): never => {
    throw new Error(`wrangler.config.ts is invalid for mode "${mode}": ${why}`);
  };

  if (DEPLOY_MODES.includes(mode)) {
    if (!config.account_id) {
      fail(
        'account_id is required for deploying modes — set CLOUDFLARE_ACCOUNT_ID in the environment (or omit the deploy until it is available)',
      );
    }
    if (ids.length === 0) {
      fail(
        'd1_databases must include at least one database_id — configure a D1 binding with a real id from CLOUDFLARE_DATABASE_ID',
      );
    }
    if (ids.includes(OFFLINE_PLACEHOLDER_UUID)) {
      fail(
        `d1 database_id is still the offline placeholder (${OFFLINE_PLACEHOLDER_UUID}) — set CLOUDFLARE_DATABASE_ID to the real D1 id before deploying`,
      );
    }
    return;
  }

  // Offline: nothing may resolve to a real resource. An account id is what makes
  // a deploy possible at all — without one, a stray `wrangler deploy` has
  // nowhere to go, which is a cheap and strong backstop.
  if (config.account_id) {
    fail(
      `account_id must be absent offline (got "${config.account_id}") — omit the key so a stray wrangler deploy cannot reach Cloudflare`,
    );
  }
  if (config.route || config.routes?.length) {
    fail(
      'route/routes must be absent offline — remove them so offline modes cannot target a live hostname',
    );
  }
  for (const id of ids) {
    if (id !== OFFLINE_PLACEHOLDER_UUID) {
      fail(
        `d1 database_id "${id}" is not the offline placeholder — use OFFLINE_PLACEHOLDER_UUID (${OFFLINE_PLACEHOLDER_UUID}) for mode "${mode}" so local/test runs cannot touch a live D1`,
      );
    }
  }
  for (const d1 of config.d1_databases ?? []) {
    // A remote binding reaches a live resource from a local run, which is
    // exactly what offline isolation exists to prevent.
    if ((d1 as { remote?: boolean }).remote) {
      fail(
        `d1 binding ${d1.binding} sets remote:true — remote D1 bindings are forbidden offline so mode "${mode}" cannot reach a live database`,
      );
    }
  }
}

// ── loading ─────────────────────────────────────────────────────────────────

/**
 * Load and evaluate `wrangler.config.ts` via Vite's own config loader.
 *
 * The skill's reference reimplements this — sibling temp `.mjs`, random suffix,
 * 60s stale-bundle sweep — because it predates (or does not assume) calling
 * `loadConfigFromFile` from outside a Vite process. Vite+ exposes that loader
 * on the `vite` package we already depend on, so this repo calls it instead:
 * TypeScript evaluation, factory invocation with the env, temp-file lifecycle,
 * collision-safe naming and cleanup are all Vite's problem.
 *
 * Errors thrown inside the config (missing env vars, etc.) propagate; a missing
 * file returns `null` and we turn that into an explicit path-named error.
 */
async function loadAndEvaluate(
  sourcePath: string,
  context: ConfigContext,
  root: string,
): Promise<WranglerConfig> {
  const result = await loadConfigFromFile(context, sourcePath, root, 'silent');

  if (!result) {
    throw new Error(`Could not load Wrangler config: no config file found at ${sourcePath}`);
  }

  // loadConfigFromFile already invoked a default-export factory with `context`.
  const resolved = result.config as unknown;
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new Error(
      `${sourcePath} must export a Wrangler config object, or a function returning one`,
    );
  }
  return resolved as WranglerConfig;
}

/**
 * Absolutise the config's path fields against the project root.
 *
 * Paths in `wrangler.config.ts` are written relative to the project root, but
 * Wrangler resolves them relative to whichever file it read them from. Those
 * agree only while the output sits at the root — point `outFile` into
 * `.wrangler/test/` and `./src/worker.ts` silently becomes
 * `.wrangler/test/src/worker.ts`.
 *
 * Only applied when the output is not at the root, so the emitted
 * `wrangler.json` keeps the portable relative paths a reader expects.
 */
function absolutisePaths(config: WranglerConfig, root: string): WranglerConfig {
  const absolute = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : resolve(root, value);

  return {
    ...config,
    ...(config.main ? { main: absolute(config.main) } : {}),
    ...(config.assets
      ? {
          assets: {
            ...config.assets,
            ...(config.assets.directory ? { directory: absolute(config.assets.directory) } : {}),
          },
        }
      : {}),
    ...(config.d1_databases
      ? {
          d1_databases: config.d1_databases.map((d1) => ({
            ...d1,
            ...(d1.migrations_dir ? { migrations_dir: absolute(d1.migrations_dir) } : {}),
          })),
        }
      : {}),
  };
}

// ── plugin ──────────────────────────────────────────────────────────────────

export interface WranglerConfigOptions {
  /** Config source, relative to the Vite root. Default `wrangler.config.ts`. */
  configFile?: string;
  /** Generated output, relative to the Vite root. Default `wrangler.json`. */
  outFile?: string;
}

/**
 * Resolve `wrangler.config.ts` for one mode and write the Wrangler JSON.
 *
 * Exported so a test runner can produce the same config through the same code
 * path, rather than reading whichever mode happened to build last.
 *
 * @returns absolute path of the written file.
 */
export async function generateWranglerConfig(options: {
  mode: string;
  root: string;
  configFile?: string;
  outFile?: string;
  command?: ConfigContext['command'];
}): Promise<string> {
  const { mode, root, configFile = 'wrangler.config.ts', outFile = 'wrangler.json' } = options;

  if (!(WRANGLER_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Unsupported mode "${mode}". Use one of: ${WRANGLER_MODES.join(', ')}.`);
  }

  const context: ConfigContext = {
    mode: mode as WranglerMode,
    command: options.command ?? 'build',
    isSsrBuild: false,
    isPreview: false,
  };

  const sourcePath = resolve(root, configFile);
  const resolved = await loadAndEvaluate(sourcePath, context, root);
  assertModeIsolation(context.mode, resolved);

  const target = resolve(root, outFile);
  // Callers may point `outFile` into a directory that does not exist yet — a
  // test runner asks for `.wrangler/test/wrangler.json` so the pool's config
  // cannot be confused with the one the last build emitted at the root.
  await mkdir(dirname(target), { recursive: true });
  const emitted = dirname(target) === resolve(root) ? resolved : absolutisePaths(resolved, root);
  await writeFile(target, `${JSON.stringify(emitted, null, 2)}\n`, 'utf8');
  return target;
}

/**
 * Write the mode's Wrangler config before `@cloudflare/vite-plugin` reads it.
 *
 * Ordering is explicit, not hopeful: `enforce: 'pre'` puts this ahead of the
 * Cloudflare plugin, and the write happens in `config` — the first hook Vite
 * calls. `configResolved` or `buildStart` would be too late; the Cloudflare
 * plugin has already read its config by then.
 *
 * Under `vp test` the mode is `test`. Writing the root `wrangler.json` then
 * would overwrite whichever mode built last (or poison a later build with the
 * test config). Tests use a separate outFile via globalSetup instead.
 */
export function wranglerConfig(options: WranglerConfigOptions = {}): Plugin {
  return {
    name: 'wrangler-config',
    enforce: 'pre',
    async config(userConfig, env) {
      if (env.mode === 'test') {
        // Root wrangler.json must not be overwritten by the test runner.
        return null;
      }
      await generateWranglerConfig({
        ...options,
        mode: env.mode,
        root: userConfig.root ? resolve(userConfig.root) : process.cwd(),
        command: env.command,
      });
      // Nothing to merge into Vite's config — the side effect is the point.
      return null;
    },
  };
}
