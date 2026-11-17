# In-Depth working with the Hono Todo App Codebase

This tutorial will guide you through understanding and gaining a solid working knowledge of a full-stack todo application built with Hono, a Node.js web framework. The app uses modern tools like Drizzle ORM for database management, Datastar for dynamic frontend interactions, Vite for frontend tooling, and D1 as the database. We'll explore the project's structure, setup, and functionality, and by the end, you'll be able to run, modify, and extend the application.

---

## Overview of the Application

This is a full-stack todo list application with the following technologies:

- **Backend**: Hono (web framework), Drizzle ORM (database management), Valibot (validation), and D1 (database).
- **Frontend**: Datastar (dynamic interactions), TailwindCSS (styling), and Vite (bundling and development server).
- **Development Tools**: Docker Compose (database management), Oxlint and Oxfmt (code quality).

The app allows users to:

- View a list of todos.
- Add new todos via a form.
- Delete existing todos.

Datastar enables dynamic updates without full page reloads, and Drizzle manages the database schema and migrations.

### How the dynamic layer fits together

- The pinned Datastar browser runtime is vendored at `public/static/datastar-1.0.2.js`
  (see `MIGRATION.md` for version, source URL, and SHA-256) and loaded as a module
  from the document shell. No CDN is involved.
- `src/utils/datastar.ts` is the only module that owns the Datastar wire protocol:
  request classification, SSE framing, patch selectors/modes, signal patches, and
  trusted server-rendered HTML. Routes use its helpers to return either ordinary
  HTML/JSON or `200 text/event-stream` patches; `Vary: Datastar-Request` is stamped
  on both. A static guard test (`tests/datastar-guard.test.ts`) keeps the wire
  literals confined to that module.
- Forms keep working without JavaScript: they use native `method`/`action`, and the
  server keeps the ordinary (non-Datastar) response contract for them.
- `src/web/bundle.ts` is a small browser module (the duplicate-submit lock), not an
  expression dump.

---

## Setting Up the Environment

1. **Clone the Repository**:
   If you haven't already, clone the repository containing the codebase.

2. **Install Dependencies**:
   Run the following command to install all dependencies listed in `package.json`:

   ```
   pnpm install
   ```

## Running the Database

5. **Bootstrap the local D1 state** (first install, or any time `.wrangler/` has been deleted):

   ```bash
   pnpm db:bootstrap:local
   ```

   This runs a no-op `SELECT 1` against the local D1 binding (so Miniflare creates `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` and the hash-named sqlite file inside it), then symlinks that file to `cf-app.db` at the project root — which is what Drizzle's local config reads. The symlink is gitignored.

6. **Apply database migrations**:

   ```bash
   pnpm db:migrate:local
   ```

   To wipe local data and start over: `pnpm db:reset:local` clears the D1 dir and re-runs the bootstrap (symlink included); then run `db:migrate:local` again.

7. **Start the development server**:

   ```bash
   pnpm dev
   ```

   The application will start at **http://localhost:5173**

## Starting the Development Server

1. **Start the Development Server**:
   Run the following command to start the app in development mode:

   ```
   pnpm run dev
   ```
