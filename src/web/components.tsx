import { jsxRenderer } from 'hono/jsx-renderer';

export const renderer = jsxRenderer(({ children, title }) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {import.meta.env.PROD ? (
          <>
            <link href="/static/style.css" rel="stylesheet" />
            <script defer type="module" src="/static/bundle.js"></script>
          </>
        ) : (
          <>
            <link href="/src/web/style.css" rel="stylesheet" />
            <script defer type="module" src="/src/web/bundle.ts"></script>
            <script type="module" src="/@vite/client"></script>
          </>
        )}
        {/*
          Vendored, pinned Datastar runtime (same-origin, loaded as a module; see
          MIGRATION.md for version/hash). It must never be imported from source —
          coordination with bundle.ts happens via document-level events only.
        */}
        <script type="module" src="/static/datastar-1.0.2.js"></script>
        <title>{title ? `todo | ${title}` : 'todo'}</title>
      </head>
      <body>
        <div class="mx-auto max-w-xl px-4 py-12">
          <header class="mb-6 flex items-baseline justify-between border-b border-gray-200 pb-4">
            <h1 class="font-mono text-base font-semibold tracking-tight text-gray-900">
              <a href="/">
                todo<span class="text-blue-600">_</span>
              </a>
            </h1>
            <span class="font-mono text-xs tracking-widest text-gray-500 uppercase">datastar</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
});

export const AddTodo = () => (
  <form
    id="add-todo-form"
    method="post"
    action="/todo"
    {...{
      // Initialize the form's nested signal group at render time: effects
      // subscribed to auto-created placeholder signals may never fire, so the
      // watched shape (bound title + field errors) must exist from the start.
      // Kebab-case key — the runtime camelizes it back to `addTodoForm`.
      'data-signals:add-todo-form': "{title: '', errors: {title: ''}}",
      // data-on:submit on a form auto-prevents the native submit; the action
      // posts the form's FormData (urlencoded) after native checkValidity().
      'data-on:submit': "@post('/todo', {contentType: 'form'})",
      // Element-scoped pending signal: the runtime toggles it while this
      // element's fetch is in flight. Key-only attribute — must be emitted
      // with an explicit empty value (hono/jsx `true` would throw), and the
      // key must be kebab-case: HTML lowercases attribute names and the
      // runtime camelizes them back into signal paths.
      'data-indicator:add-todo-pending': '',
      'data-attr:aria-busy': "$addTodoPending ? 'true' : 'false'",
      // Hook for the synchronous duplicate-submit lock in bundle.ts.
      'data-lock': '',
    }}
    class="mb-6"
  >
    <div class="flex gap-2">
      <input
        name="title"
        type="text"
        autocomplete="off"
        placeholder="Add a task…"
        {...{
          // Two-way bound: the server clears the input on success by patching
          // addTodoForm.title back to ''.
          'data-bind': 'addTodoForm.title',
          'data-attr:aria-invalid': "$addTodoForm.errors.title ? 'true' : 'false'",
          'data-class:border-red-500': '$addTodoForm.errors.title',
        }}
        class="field"
      />
      <button
        class="btn btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        {...{ 'data-attr:disabled': '$addTodoPending ? true : false' }}
      >
        Add
      </button>
    </div>
    <p
      class="mt-1 text-sm text-red-500"
      role="alert"
      {...{
        'data-show': '$addTodoForm.errors.title',
        'data-text': "$addTodoForm.errors.title || ''",
      }}
    ></p>
  </form>
);

export const Item = ({ title, id }: { title: string; id: string }) => (
  <p
    id={`todo-${id}`}
    {...{ 'data-on:click': `@delete('/todo/${id}')` }}
    class="row flex cursor-pointer items-center justify-between border-b border-gray-200 py-2.5 text-sm text-gray-800"
  >
    <span>{title}</span>
    <button class="btn-ghost" type="button">
      Delete
    </button>
  </p>
);
