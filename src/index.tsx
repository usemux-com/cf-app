import { eq } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import type { Context } from 'hono';
import * as v from 'valibot';
import { todo } from './db/schema';
import { AppContext } from './type';
import { schemaValidator } from './utils/common';
import {
  DatastarProtocolError,
  patchElementsEvent,
  patchSignalsEvent,
  removeElementEvent,
  respondDual,
  selectorForId,
  sseResponse,
  trustedHtmlFromRenderedResponse,
} from './utils/datastar';
import { AddTodo, Item, renderer } from './web/components';

/** Signals group owning the add-todo form's browser-local state. */
const ADD_TODO_SIGNALS = 'addTodoForm';
/** Stable ID of the list-end sentinel new rows are patched in before. */
const LIST_SENTINEL_ID = 'todo';

export function createApp(getDb: (c: Context<AppContext>) => DrizzleD1Database) {
  const app = new Hono<AppContext>();

  // Initialize database for each request
  app.use(async (c, next) => {
    c.set('db', getDb(c));
    await next();
  });

  app.get('*', renderer);
  app.get('/', async (c) => {
    const db = c.get('db');
    const todos = await db.select({ id: todo.id, title: todo.title }).from(todo);
    return c.render(
      <div>
        <AddTodo />
        {todos.map((todo) => {
          return <Item title={todo.title} id={todo.id} />;
        })}
        <div id={LIST_SENTINEL_ID}></div>
      </div>,
      { title: 'Create todos' },
    );
  });

  app.post(
    '/todo',
    schemaValidator(
      'form',
      v.object({
        title: v.pipe(v.string(), v.minLength(1, 'Title is required')),
      }),
      { signalsGroup: ADD_TODO_SIGNALS, fields: ['title'] },
    ),
    async (c) => {
      const db = c.get('db');
      const { title } = c.req.valid('form');
      const id = crypto.randomUUID();
      await db.insert(todo).values({ id, title });
      return respondDual(c.req.raw, {
        // Native/ordinary contract (unchanged): bare row fragment.
        ordinary: () => c.html(<Item title={title} id={id} />),
        datastar: async () => {
          const row = await trustedHtmlFromRenderedResponse(
            await c.html(<Item title={title} id={id} />),
          );
          return sseResponse([
            patchElementsEvent(row, { selector: selectorForId(LIST_SENTINEL_ID), mode: 'before' }),
            // Clear the bound input and any stale field errors on success.
            // Errors are cleared with '' — null would delete the signal cell
            // and orphan the effects watching it (runtime-verified).
            patchSignalsEvent({ [ADD_TODO_SIGNALS]: { title: '', errors: { title: '' } } }),
          ]);
        },
      });
    },
  );

  app.delete('/todo/:id', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    await db.delete(todo).where(eq(todo.id, id));
    return respondDual(c.req.raw, {
      // Native/ordinary contract (unchanged): 200, empty body.
      ordinary: () => {
        c.status(200);
        return c.body(null);
      },
      datastar: () => {
        try {
          return sseResponse(removeElementEvent(selectorForId(`${LIST_SENTINEL_ID}-${id}`)));
        } catch (error) {
          // Malformed protocol input (a hand-crafted id that can never be a
          // server-rendered row) stays distinct from user-fixable feedback.
          if (error instanceof DatastarProtocolError) {
            c.status(400);
            return c.body(null);
          }
          throw error;
        }
      },
    });
  });

  return app;
}

export default createApp((c) => drizzle(c.env.DB));
