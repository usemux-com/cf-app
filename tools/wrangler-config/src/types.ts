/**
 * Modes, config types, and pure helpers for wrangler.config.ts.
 *
 * This module stays free of runtime dependencies (only `import type` plus pure
 * values/functions). wrangler.config.ts imports from here rather than the
 * loader so the config stays decoupled from evaluation machinery and cannot
 * form a cycle with `index.ts` (which loads the config file). That property is
 * about module graph hygiene, not about keeping a hand-rolled bundle import-free.
 */
import type { ConfigEnv } from 'vite';
import type { Unstable_RawConfig } from 'wrangler';

/**
 * The modes this project builds for.
 *
 * One Cloudflare account and one D1 database — no staging. `test` is not a
 * deployment target; it exists so Vitest resolves a complete, structurally
 * valid Worker config without any binding that could reach a real resource.
 */
export const WRANGLER_MODES = ['development', 'test', 'production'] as const;

export type WranglerMode = (typeof WRANGLER_MODES)[number];

/**
 * The modes permitted to reach Cloudflare.
 *
 * Everything not listed here is treated as offline and held to the stricter
 * half of the isolation contract. Forgetting to classify a new mode fails
 * closed — an unlisted mode is offline.
 */
export const DEPLOY_MODES: readonly WranglerMode[] = ['production'];

/**
 * Vite's `ConfigEnv`, narrowed so `mode` is one of ours.
 *
 * Leaving `mode` as `string` would defeat the point: a config factory that
 * forgets a mode should not compile, and a typo like `'prod'` should be a type
 * error rather than a silent fall-through to whatever the last branch returns.
 */
export interface ConfigContext extends ConfigEnv {
  mode: WranglerMode;
}

/**
 * Wrangler's own `RawConfig` — the pre-normalisation shape of a `wrangler.json`
 * file — under the name Wrangler publishes it as. Aliasing rather than
 * redeclaring means a Wrangler upgrade that changes a binding field surfaces as
 * a type error in `wrangler.config.ts`, not as a config silently ignored.
 */
export type WranglerConfig = Unstable_RawConfig;

export type WranglerConfigFactory = (
  context: ConfigContext,
) => WranglerConfig | Promise<WranglerConfig>;

/**
 * Identity function that supplies the types.
 *
 * Writing `export default defineConfig(({ mode }) => ({ ... }))` gives `mode`
 * the mode union and checks the result against Wrangler's `RawConfig` without
 * the author annotating either.
 *
 * Lives here (not in the loader) so wrangler.config.ts can import helpers
 * without depending on the evaluation path in `index.ts` — see the module header.
 */
export function defineConfig(factory: WranglerConfigFactory): WranglerConfigFactory {
  return factory;
}

/**
 * The only `database_id` an offline build may carry.
 *
 * All-zero (not the v4-shaped form) because Miniflare keys local D1 sqlite
 * storage by `database_id`. Changing this value opens a new empty file under
 * `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` and orphans every
 * developer's existing local database. This repo shipped
 * `00000000-0000-0000-0000-000000000000` for months in wrangler.jsonc, so
 * Wrangler accepts the all-zero form — the skill's v4 shape is unnecessary here.
 *
 * Cloudflare never issues this id either, so the isolation guard can still
 * assert on it: if this value reaches a deploy, something is wrong by
 * construction rather than by coincidence.
 */
export const OFFLINE_PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';
