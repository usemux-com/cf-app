import type { DrizzleD1Database } from 'drizzle-orm/d1';

type AppEnv = Env;

interface AppVariables {
  db: DrizzleD1Database;
}

export type AppContext = {
  Bindings: AppEnv;
  Variables: AppVariables;
};
