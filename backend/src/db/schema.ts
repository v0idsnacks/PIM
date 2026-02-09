import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Messages table - stores all message history for context.
 */
export const messages = pgTable('messages', {
    id: serial('id').primaryKey(),
    contactName: text('contact_name').notNull(),        // e.g., "radha_01"
    messageContent: text('message_content').notNull(),  // The actual message
    isFromUser: boolean('is_from_user').default(false), // true = You replied, false = They sent
    platform: text('platform').default('instagram'),
    createdAt: timestamp('created_at').defaultNow(),
});

/**
 * VIP Contacts - special handling for certain people.
 * Future feature: Different prompts for different people.
 */
export const vipContacts = pgTable('vip_contacts', {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    nickname: text('nickname'),                 // How Aditya refers to them
    customPrompt: text('custom_prompt'),        // Override system prompt for this person
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports for use in the app
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type VipContact = typeof vipContacts.$inferSelect;
export type NewVipContact = typeof vipContacts.$inferInsert;

/**
 * Feedback table - stores user feedback on AI replies.
 * Used to improve future responses by injecting corrections into the LLM prompt.
 */
export const feedback = pgTable('feedback', {
    id: serial('id').primaryKey(),
    messageId: serial('message_id'),                     // References messages.id
    contactName: text('contact_name').notNull(),          // Who the reply was sent to
    originalMessage: text('original_message').notNull(),  // What they said
    aiReply: text('ai_reply').notNull(),                  // What AI replied
    rating: text('rating').notNull(),                     // 'good' | 'bad'
    correction: text('correction'),                       // What Aditya would have actually said
    createdAt: timestamp('created_at').defaultNow(),
});

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
