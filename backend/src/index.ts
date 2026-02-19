import 'dotenv/config';
import { Elysia, t } from 'elysia';
import { generateReply } from './llm';

/**
 * PIM Backend — Stateless Intelligence Engine
 * 
 * Architecture: Local-First & Stateless
 * The Brain: Input → Thought → Output
 * No database. No state. Android holds the memory.
 */

const app = new Elysia()
    // Health check
    .get('/', () => ({
        status: 'alive',
        service: 'PIM Backend (Stateless Brain)',
        timestamp: new Date().toISOString(),
    }))

    // Main chat endpoint — The "Brain"
    // Android sends: sender, message, and the full conversation history
    .post('/chat', async ({ body }) => {
        const { sender, message, history } = body;
        const startTime = Date.now();

        console.log(`📩 [${new Date().toISOString()}] Incoming from ${sender}: ${message}`);
        console.log(`📚 History: ${history.length} messages provided`);

        try {
            // Format history for LLM (already comes pre-formatted from Android)
            const formattedHistory = history.map(h => ({
                role: h.role as 'user' | 'model',
                content: h.content,
            }));

            // Generate AI response — pure function, no DB involved
            const reply = await generateReply({
                sender,
                message,
                history: formattedHistory,
            });

            const totalTime = Date.now() - startTime;
            console.log(`🤖 Reply to ${sender}: ${reply}`);
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
            history: t.Array(t.Object({
                role: t.String(),    // 'user' | 'model'
                content: t.String(),
            }), { default: [] }),
        }),
    })

    // Quick test endpoint (no history needed)
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

    // API key status check
    .get('/keys', async () => {
        const { getKeyStatus } = await import('./llm');
        return getKeyStatus();
    })

    // Reset API key stats
    .post('/keys/reset', async () => {
        const { resetKeyStats, getKeyStatus } = await import('./llm');
        resetKeyStats();
        return { message: 'Key stats reset', status: getKeyStatus() };
    })

    .listen(process.env.PORT || 3000);

console.log(`
🚀 PIM Backend is running! (Stateless Brain — Groq + Llama 3.3)
📍 http://localhost:${app.server?.port}

Endpoints:
  GET  /          - Health check
  POST /chat      - Process incoming DM (sender + message + history[])
  POST /test      - Test LLM without history
  GET  /keys      - Check API key status
  POST /keys/reset - Reset key statistics
`);

export type App = typeof app;
