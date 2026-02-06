import 'dotenv/config';
import { Elysia, t } from 'elysia';
import { db } from './db';
import { messages } from './db/schema';
import { generateReply } from './gemini';
import { eq, desc } from 'drizzle-orm';
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

            // Step 1: Fetch conversation history (last 10 messages) - ONLY from this sender
            if (db) {
                const history = await db
                    .select()
                    .from(messages)
                    .where(eq(messages.contactName, normalizedSender))
                    .orderBy(desc(messages.createdAt))
                    .limit(10);

                console.log(`📚 Found ${history.length} previous messages with ${normalizedSender}`);

                // Reverse to get chronological order
                const chronologicalHistory = history.reverse();

                // Format history for Gemini
                formattedHistory = chronologicalHistory.map(msg => ({
                    role: msg.isFromUser ? 'model' as const : 'user' as const,
                    content: msg.messageContent,
                }));

                if (formattedHistory.length > 0) {
                    console.log(`📜 Conversation context: ${formattedHistory.map(h => `[${h.role}]: ${h.content.substring(0, 30)}...`).join(' | ')}`);
                }
            }

            const dbTime = Date.now();
            console.log(`⏱️ DB fetch took ${dbTime - startTime}ms`);

            // Step 2: Generate AI response
            const reply = await generateReply({
                sender,
                message,
                history: formattedHistory,
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

        const { quickReply } = await import('./gemini');
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
        const { getKeyStatus } = await import('./gemini');
        return getKeyStatus();
    })

    .listen(process.env.PORT || 3000);

console.log(`
🚀 PIM Backend is running!
📍 http://localhost:${app.server?.port}

Endpoints:
  GET  /          - Health check
  POST /chat      - Process incoming DM
  POST /test      - Test Gemini without DB
  GET  /history/:sender - Get conversation history
  GET  /keys      - Check API key status
`);

export type App = typeof app;
