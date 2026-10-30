import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const demoRooms = sqliteTable("demo_rooms", {
  id: text("id").primaryKey(),
  hostTokenHash: text("host_token_hash").notNull(),
  guestTokenHash: text("guest_token_hash").notNull(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
