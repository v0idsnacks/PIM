import { pgTable, serial, text, boolean, timestamp, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const messages = pgTable("messages", {
	id: serial().primaryKey().notNull(),
	contactName: text("contact_name").notNull(),
	messageContent: text("message_content").notNull(),
	isFromUser: boolean("is_from_user").default(false),
	platform: text().default('instagram'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const vipContacts = pgTable("vip_contacts", {
	id: serial().primaryKey().notNull(),
	username: text().notNull(),
	nickname: text(),
	customPrompt: text("custom_prompt"),
	isEnabled: boolean("is_enabled").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("vip_contacts_username_unique").on(table.username),
]);
