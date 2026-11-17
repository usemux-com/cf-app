/**
 * Wrangler configuration for cf-app.
 *
 * Replaces the checked-in `wrangler.jsonc`. Real resource ids come from the
 * environment so none is committed; offline modes never reach Cloudflare, and
 * the loader refuses to emit a config that contradicts its mode.
 *
 * Import helpers from `./tools/wrangler-config/src/types.ts`, not the loader.
 * Vite's config loader externalises bare specifiers, so importing `index.ts`
 * would evaluate fine — but that would couple the config to the evaluation
 * path and risk a cycle (`index` loads this file). Types + pure helpers only
 * keep the graph one-way.
 */
import {
  defineConfig,
  OFFLINE_PLACEHOLDER_UUID,
  type ConfigContext,
  type WranglerConfig,
  type WranglerMode,
} from './tools/wrangler-config/src/types.ts';

// Hydrate .env into process.env when present (local shells). CI supplies the
// real environment and has no .env — loadEnvFile must not fail there.
try {
  process.loadEnvFile();
} catch {
  // no .env or unreadable — rely on the process environment
}

const WORKER_NAME = 'cf-app';

/** Fail specifically. A missing id must not become a Worker that cannot reach its database. */
const requireEnv = (name: string, mode: WranglerMode): string =>
  process.env[name]?.trim() ||
  (() => {
    throw new Error(
      `${name} is required for mode "${mode}". ` +
        `Set it in the environment (or .env locally). ` +
        `Get the value from the Cloudflare dashboard or \`wrangler d1 list\` / account settings.`,
    );
  })();

/**
 * Account id for production only.
 *
 * `undefined` offline is what makes a stray deploy impossible — omit the key
 * entirely so Wrangler has nowhere to send the Worker. Shared with drizzle via
 * CLOUDFLARE_ACCOUNT_ID so there is one source of truth.
 */
const getAccountId = (mode: WranglerMode): string | undefined =>
  mode === 'production' ? requireEnv('CLOUDFLARE_ACCOUNT_ID', mode) : undefined;

/**
 * Offline modes run D1 in Miniflare against local SQLite, so the id is never
 * dereferenced — the placeholder is the correct value, not a stand-in.
 * Production must never fall back to the placeholder.
 *
 * FROZEN with database_name: Miniflare keys local D1 storage by database_id.
 * Changing OFFLINE_PLACEHOLDER_UUID orphans the developer's sqlite file.
 */
const getDatabaseId = (mode: WranglerMode): string =>
  mode === 'production' ? requireEnv('CLOUDFLARE_DATABASE_ID', mode) : OFFLINE_PLACEHOLDER_UUID;

export default defineConfig(({ mode }: ConfigContext): WranglerConfig => ({
  // Offline modes stay suffixed so a local log or a stray `wrangler` command
  // can never be mistaken for a deploy target. Worker name does not key D1
  // local state — database_id does (see frozen note below).
  name: mode === 'production' ? WORKER_NAME : `${WORKER_NAME}-${mode}`,
  ...(getAccountId(mode) ? { account_id: getAccountId(mode) } : {}),
  main: './src/index.tsx',
  compatibility_date: '2025-04-01',
  compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],

  assets: { directory: './dist' },

  d1_databases: [
    {
      binding: 'DB',
      // FROZEN fields (both):
      // - database_id: Miniflare keys local D1 sqlite by this value. It must
      //   stay OFFLINE_PLACEHOLDER_UUID offline (the all-zero form this repo
      //   has always used). Changing it creates a new empty sqlite and
      //   orphans the developer's data under
      //   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/.
      // - database_name: db:bootstrap:local calls
      //   `wrangler d1 execute cfapp-db --local` by name; keep it stable.
      database_name: 'cfapp-db',
      database_id: getDatabaseId(mode),
      migrations_dir: './src/db/migrations',
    },
  ],
}));
