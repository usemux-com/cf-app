import { text, sqliteTable } from 'drizzle-orm/sqlite-core';

export const todo = sqliteTable('todo', {
  id: text('id').primaryKey(),
  title: text({ length: 256 }).notNull(),
});
