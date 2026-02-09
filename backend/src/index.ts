import 'dotenv/config';
import { Elysia, t } from 'elysia';
import { db } from './db';
import { messages, vipContacts, feedback } from './db/schema';
import { generateReply } from './llm';
import { eq, desc, and } from 'drizzle-orm';
import { ensureTablesExist } from './db/migrate';

// Run auto-migration on startup
await ensureTablesExist();

const app = new Elysia()
    // Health check
    .get('/', () => ({
        status: 'alive',
        service: 'PIM Backend',
        timestamp: new Date().toISOString(),
    }))

    // Main chat endpoint - The "Brain"
    .post('/chat', async ({ body }) => {
        const { sender, message } = body;
        const startTime = Date.now();

        // Normalize sender name (trim whitespace, lowercase for consistency)
        const normalizedSender = sender.trim().toLowerCase();

        console.log(`📩 [${new Date().toISOString()}] Incoming from ${normalizedSender}: ${message}`);

        try {
            let formattedHistory: Array<{ role: 'user' | 'model'; content: string }> = [];
            let customPrompt: string | undefined;
            let nickname: string | undefined;
            let recentReplies: string[] = [];

            // Step 1: Fetch conversation history (last 20 messages) - ONLY from this sender
            if (db) {
                const history = await db
                    .select()
                    .from(messages)
                    .where(eq(messages.contactName, normalizedSender))
                    .orderBy(desc(messages.createdAt))
                    .limit(20);

                console.log(`📚 Found ${history.length} previous messages with ${normalizedSender}`);

                // Reverse to get chronological order
                const chronologicalHistory = history.reverse();

                // Format history for LLM
                formattedHistory = chronologicalHistory.map(msg => ({
                    role: msg.isFromUser ? 'model' as const : 'user' as const,
                    content: msg.messageContent,
                }));

                if (formattedHistory.length > 0) {
                    console.log(`📜 Conversation context: ${formattedHistory.map(h => `[${h.role}]: ${h.content.substring(0, 30)}...`).join(' | ')}`);
                }

                // Step 1b: Fetch recent replies by Aditya (any conversation) for style reference
                const recentOwnReplies = await db
                    .select({ content: messages.messageContent })
                    .from(messages)
                    .where(eq(messages.isFromUser, true))
                    .orderBy(desc(messages.createdAt))
                    .limit(5);

                recentReplies = recentOwnReplies.map(r => r.content);
                if (recentReplies.length > 0) {
                    console.log(`🎭 Loaded ${recentReplies.length} recent replies for style reference`);
                }

                // Step 1c: Check if sender is a VIP contact
                const vip = await db
                    .select()
                    .from(vipContacts)
                    .where(
                        and(
                            eq(vipContacts.username, normalizedSender),
                            eq(vipContacts.isEnabled, true)
                        )
                    )
                    .limit(1);

                if (vip.length > 0 && vip[0]) {
                    const vipContact = vip[0];
                    customPrompt = vipContact.customPrompt ?? undefined;
                    nickname = vipContact.nickname ?? undefined;
                    console.log(`⭐ VIP contact detected: ${normalizedSender} (nickname: ${nickname || 'none'}, has custom prompt: ${!!customPrompt})`);
                }
            }

            // Step 1d: Fetch recent feedback corrections (bad replies with corrections)
            let feedbackCorrections: Array<{ originalMessage: string; badReply: string; correction: string }> = [];
            if (db) {
                const recentFeedback = await db
                    .select()
                    .from(feedback)
                    .where(eq(feedback.rating, 'bad'))
                    .orderBy(desc(feedback.createdAt))
                    .limit(10);

                feedbackCorrections = recentFeedback
                    .filter(fb => fb.correction && fb.correction.trim().length > 0)
                    .map(fb => ({
                        originalMessage: fb.originalMessage,
                        badReply: fb.aiReply,
                        correction: fb.correction!,
                    }));

                if (feedbackCorrections.length > 0) {
                    console.log(`📝 Loaded ${feedbackCorrections.length} feedback corrections for LLM`);
                }
            }

            const dbTime = Date.now();
            console.log(`⏱️ DB fetch took ${dbTime - startTime}ms`);

            // Step 2: Generate AI response
            const reply = await generateReply({
                sender,
                message,
                history: formattedHistory,
                customPrompt,
                nickname,
                recentReplies,
                feedbackCorrections,
            });

            const aiTime = Date.now();
            console.log(`⏱️ AI generation took ${aiTime - dbTime}ms`);
            console.log(`🤖 Reply to ${sender}: ${reply}`);

            // Step 3: Save both messages to database (if connected)
            if (db) {
                // Save incoming message
                await db.insert(messages).values({
                    contactName: normalizedSender,
                    messageContent: message,
                    isFromUser: false, // They sent this
                    platform: 'instagram',
                });

                // Save our reply
                await db.insert(messages).values({
                    contactName: normalizedSender,
                    messageContent: reply,
                    isFromUser: true, // We replied
                    platform: 'instagram',
                });
            }

            const totalTime = Date.now() - startTime;
            console.log(`✅ Total request time: ${totalTime}ms`);

            return {
                success: true,
                sender,
                originalMessage: message,
                reply,
                timing: {
                    totalMs: totalTime,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('❌ Error processing message:', errorMsg);
            console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));

            // Fallback response
            return {
                success: false,
                sender,
                originalMessage: message,
                reply: "aree rukna thoda kaam h baad me baat karta hu...",
                error: errorMsg,
            };
        }

    }, {
        body: t.Object({
            sender: t.String(),
            message: t.String(),
        }),
    })

    // Quick test endpoint (no DB required)
    .post('/test', async ({ body }) => {
        const { message } = body;
        const startTime = Date.now();

        console.log(`🧪 [${new Date().toISOString()}] Test message: ${message}`);

        const { quickReply } = await import('./llm');
        const reply = await quickReply(message);

        const totalTime = Date.now() - startTime;
        console.log(`✅ Test reply in ${totalTime}ms: ${reply}`);

        return {
            reply,
            timing: {
                totalMs: totalTime,
                timestamp: new Date().toISOString(),
            },
        };
    }, {
        body: t.Object({
            message: t.String(),
        }),
    })

    // Get conversation history for a user
    .get('/history/:sender', async ({ params }) => {
        const { sender } = params;

        if (!db) {
            return { sender, messages: [], error: 'Database not connected' };
        }

        const history = await db
            .select()
            .from(messages)
            .where(eq(messages.contactName, sender))
            .orderBy(desc(messages.createdAt))
            .limit(50);

        return { sender, messages: history };
    })

    // API key status check
    .get('/keys', async () => {
        const { getKeyStatus } = await import('./llm');
        return getKeyStatus();
    })

    // Reset API key stats (for debugging)
    .post('/keys/reset', async () => {
        const { resetKeyStats, getKeyStatus } = await import('./llm');
        resetKeyStats();
        return { message: 'Key stats reset', status: getKeyStatus() };
    })

    // ===== VIP Contacts Management =====

    // Add or update a VIP contact
    .post('/vip', async ({ body }) => {
        const { username, nickname, customPrompt } = body;
        const normalizedUsername = username.trim().toLowerCase();

        if (!db) {
            return { success: false, error: 'Database not connected' };
        }

        // Check if VIP contact already exists
        const existing = await db
            .select()
            .from(vipContacts)
            .where(eq(vipContacts.username, normalizedUsername))
            .limit(1);

        if (existing.length > 0) {
            // Update existing
            await db
                .update(vipContacts)
                .set({
                    nickname: nickname || existing[0]!.nickname,
                    customPrompt: customPrompt || existing[0]!.customPrompt,
                    isEnabled: true,
                })
                .where(eq(vipContacts.username, normalizedUsername));

            console.log(`⭐ Updated VIP contact: ${normalizedUsername}`);
            return { success: true, action: 'updated', username: normalizedUsername };
        }

        // Create new
        await db.insert(vipContacts).values({
            username: normalizedUsername,
            nickname: nickname || null,
            customPrompt: customPrompt || null,
            isEnabled: true,
        });

        console.log(`⭐ Added VIP contact: ${normalizedUsername}`);
        return { success: true, action: 'created', username: normalizedUsername };
    }, {
        body: t.Object({
            username: t.String(),
            nickname: t.Optional(t.String()),
            customPrompt: t.Optional(t.String()),
        }),
    })

    // List all VIP contacts
    .get('/vip', async () => {
        if (!db) {
            return { contacts: [], error: 'Database not connected' };
        }

        const contacts = await db
            .select()
            .from(vipContacts)
            .orderBy(vipContacts.username);

        return { contacts };
    })

    // Delete a VIP contact (soft disable)
    .delete('/vip/:username', async ({ params }) => {
        const { username } = params;
        const normalizedUsername = username.trim().toLowerCase();

        if (!db) {
            return { success: false, error: 'Database not connected' };
        }

        await db
            .update(vipContacts)
            .set({ isEnabled: false })
            .where(eq(vipContacts.username, normalizedUsername));

        console.log(`⭐ Disabled VIP contact: ${normalizedUsername}`);
        return { success: true, username: normalizedUsername };
    })

    // ===== Feedback System =====

    // Submit feedback on an AI reply
    .post('/feedback', async ({ body }) => {
        const { contactName, originalMessage, aiReply, rating, correction } = body;

        if (!db) {
            return { success: false, error: 'Database not connected' };
        }

        await db.insert(feedback).values({
            contactName: contactName.trim().toLowerCase(),
            originalMessage,
            aiReply,
            rating,
            correction: correction || null,
        });

        console.log(`📝 Feedback received: ${rating} for reply "${aiReply.substring(0, 40)}..."${correction ? ` → correction: "${correction.substring(0, 40)}..."` : ''}`);
        return { success: true, rating };
    }, {
        body: t.Object({
            contactName: t.String(),
            originalMessage: t.String(),
            aiReply: t.String(),
            rating: t.String(),       // 'good' | 'bad'
            correction: t.Optional(t.String()),
        }),
    })

    // Get all feedback entries
    .get('/feedback', async () => {
        if (!db) {
            return { feedback: [], error: 'Database not connected' };
        }

        const allFeedback = await db
            .select()
            .from(feedback)
            .orderBy(desc(feedback.createdAt))
            .limit(100);

        return { feedback: allFeedback };
    })

    // ===== Messages (for Android app sync) =====

    // Get all conversations (distinct contacts with last message)
    .get('/conversations', async () => {
        if (!db) {
            return { conversations: [], error: 'Database not connected' };
        }

        // Get all unique contacts with their most recent message
        const allMessages = await db
            .select()
            .from(messages)
            .orderBy(desc(messages.createdAt));

        // Group by contact and get the latest message for each
        const contactMap = new Map<string, { contactName: string; lastMessage: string; lastMessageTime: string | null; messageCount: number; isFromUser: boolean | null }>();

        for (const msg of allMessages) {
            if (!contactMap.has(msg.contactName)) {
                contactMap.set(msg.contactName, {
                    contactName: msg.contactName,
                    lastMessage: msg.messageContent,
                    lastMessageTime: msg.createdAt,
                    messageCount: 1,
                    isFromUser: msg.isFromUser,
                });
            } else {
                const existing = contactMap.get(msg.contactName)!;
                existing.messageCount++;
            }
        }

        return { conversations: Array.from(contactMap.values()) };
    })

    // Get all messages (for full sync to Android Room DB)
    .get('/messages', async ({ query }) => {
        if (!db) {
            return { messages: [], error: 'Database not connected' };
        }

        const limit = parseInt(query.limit || '200');
        const offset = parseInt(query.offset || '0');

        const allMessages = await db
            .select()
            .from(messages)
            .orderBy(desc(messages.createdAt))
            .limit(limit)
            .offset(offset);

        return { messages: allMessages, limit, offset };
    })

    .listen(process.env.PORT || 3000);

console.log(`
🚀 PIM Backend is running! (Powered by Groq + Llama 3.3)
📍 http://localhost:${app.server?.port}

Endpoints:
  GET  /          - Health check
  POST /chat      - Process incoming DM
  POST /test      - Test LLM without DB
  GET  /history/:sender - Get conversation history
  GET  /keys      - Check API key status
  POST /keys/reset - Reset key statistics
  POST /vip       - Add/update VIP contact
  GET  /vip       - List all VIP contacts
  DELETE /vip/:username - Disable VIP contact
  POST /feedback  - Submit reply feedback
  GET  /feedback  - List all feedback
  GET  /conversations - List all conversations
  GET  /messages  - Get all messages (for sync)
`);

export type App = typeof app;
