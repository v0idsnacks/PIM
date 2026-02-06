import 'dotenv/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

/**
 * API Key Rotation System
 * - Loads multiple keys from environment
 * - Auto-switches to next key on failure
 * - Cycles through all available keys
 */
const API_KEYS: string[] = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
].filter((key): key is string => typeof key === 'string' && key.trim().length > 0);

if (API_KEYS.length === 0) {
    console.error('❌ No Gemini API keys found! Available env vars:', Object.keys(process.env).filter(k => k.includes('GEMINI')));
    throw new Error('No Gemini API keys found! Set GEMINI_API_KEY in .env');
}

// Log which keys are loaded (masked for security)
API_KEYS.forEach((key, index) => {
    const masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
    console.log(`🔑 Key ${index + 1}: ${masked}`);
});
console.log(`✅ Loaded ${API_KEYS.length} Gemini API key(s)`);

let currentKeyIndex = 0;

/**
 * Get the current API key
 */
function getCurrentKey(): string {
    return API_KEYS[currentKeyIndex];
}

/**
 * Rotate to the next API key
 */
function rotateKey(): void {
    const oldIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    console.log(`🔄 Rotated API key: ${oldIndex + 1} → ${currentKeyIndex + 1} (of ${API_KEYS.length})`);
}

/**
 * Get a fresh Gemini model instance with current key
 */
function getModel(): GenerativeModel {
    const genAI = new GoogleGenerativeAI(getCurrentKey());
    return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/**
 * The System Prompt - This is YOUR personality.
 * Tweak this to match how you actually text.
 */
const systemPrompt = `
      You are Aditya Bhardwaj. You are a B.Tech CSE student at Galgotias University.
      You are NOT an AI assistant. You are a real human texting on Instagram.

      ## 🗣️ CORE SPEAKING STYLE (Hinglish)
      - **Language:** Mix Hindi and English naturally. (e.g., "bhai kya scene h", "bas assignment kar rha hu").
      - **Formatting:** lowercase only. no punctuation (except maybe ? or ...).
      - **Vocabulary:**
        - Common: "bhai", "areee", "hmm", "thik h".
        - Joking/Sweet: "hehe" (Use this ONLY if flirting or being sweet).
        - Laughing: "haha" or "🤣" (Use this if something is actually funny).
        - Confused/Doubt: "???" (Use this if their message makes no sense).
      - **Emojis:** Use sparingly. Only these: 😭 🤣 😒 😐 💀 👀.

      ## 🧠 PERSONALITY LOGIC GATES

      **CASE 1: If I am BUSY (Coding/Gaming/Sleeping)**
      - Context: If the chat history shows I haven't replied in a while or user asks "kya kar rha h".
      - Reply: "kaam kar rha hu" or "thoda busy hu". (Keep it simple).

      **CASE 2: If User is a GIRL**
      - **Sub-case A (She is Nice/Normal):** Be caring but chill. Ask "khana khaya?" or "tabiyat kaisi h?". Use "hehe" if appropriate.
      - **Sub-case B (She is Rude):** Ask "kya hua?" or "pareshan h kya?" ONCE.
      - **Sub-case C (She is Still Rude):** Switch to DRY mode. Reply "hmm", "ok", "thik h". Don't simp.

      **CASE 3: If User is a STRANGER (Unknown)**
      - **Goal:** Mystery Mode. Stay hidden.
      - **Tactic:** Deflect questions back to them. Never give straight answers about yourself.
      - Examples:
        - User: "kaun h?" -> You: "tu bta" or "jaan ke kya karega?"
        - User: "kya kar rha h?" -> You: "bas timepass" or "kuch khas nhi"

      **CASE 4: If User is ANNOYING/BORING**
      - Reply: "😒", "😐", "hmm", or just "💀".

      ## 🚫 ABSOLUTE RESTRICTIONS
      - NEVER say "How can I help you?".
      - NEVER reveal you are an AI.
      - NEVER write long paragraphs. Break it up or keep it 1-line.

      ## 📝 CURRENT CONTEXT
      Talking to: ${sender}
      History:
      ${conversationHistory}
    `;

export interface ChatContext {
    sender: string;
    message: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
}

/**
 * Generate a response using Gemini with conversation history.
 * Automatically rotates API keys on failure.
 */
export async function generateReply(context: ChatContext): Promise<string> {
    const { sender, message, history } = context;

    // Build the conversation for Gemini
    const conversationHistory = history.map(h => ({
        role: h.role,
        parts: [{ text: h.content }],
    }));

    const prompt = `[DM from ${sender}]: ${message}`;

    // Try each API key until one works
    let lastError: Error | null = null;
    const maxRetries = API_KEYS.length;

    console.log(`🎯 Attempting to generate reply for ${sender}, trying up to ${maxRetries} key(s)`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`🔄 Attempt ${attempt + 1}/${maxRetries} using key ${currentKeyIndex + 1}`);

        try {
            const model = getModel();

            // Start chat with history
            const chat = model.startChat({
                history: [
                    {
                        role: 'user',
                        parts: [{ text: SYSTEM_PROMPT }],
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'Got it. I am Aditya now. Ready to reply to DMs.' }],
                    },
                    ...conversationHistory,
                ],
            });

            console.log(`📤 Sending message to Gemini: "${prompt.substring(0, 50)}..."`);

            // Generate response
            const result = await chat.sendMessage(prompt);
            const response = result.response.text();

            console.log(`✅ Response generated using key ${currentKeyIndex + 1}: "${response.substring(0, 50)}..."`);
            return response.trim();

        } catch (error: any) {
            lastError = error;
            const errorMessage = error?.message || String(error);
            const errorStatus = error?.status || 'unknown';

            console.error(`❌ Key ${currentKeyIndex + 1} failed!`);
            console.error(`   Status: ${errorStatus}`);
            console.error(`   Message: ${errorMessage}`);

            // Check if it's a rate limit, quota, or bad request error
            const isRotatable =
                errorStatus === 429 ||
                errorStatus === 400 ||
                errorStatus === 403 ||
                errorStatus === 500 ||
                errorMessage?.includes('quota') ||
                errorMessage?.includes('rate') ||
                errorMessage?.includes('limit') ||
                errorMessage?.includes('exhausted') ||
                errorMessage?.includes('API key');

            if (isRotatable && attempt < maxRetries - 1) {
                console.log(`⚠️ Rotating to next key...`);
                rotateKey();
            } else if (attempt < maxRetries - 1) {
                // For other errors, still try rotating
                console.log(`⚠️ Unknown error type, still rotating to try next key...`);
                rotateKey();
            }
        }
    }

    // All keys exhausted
    console.error(`💀 All ${API_KEYS.length} API keys failed! Last error: ${lastError?.message}`);
    throw lastError || new Error('All API keys exhausted');
}

/**
 * Quick test function - can be called without DB
 */
export async function quickReply(message: string): Promise<string> {
    return generateReply({
        sender: 'Unknown',
        message,
        history: [],
    });
}

/**
 * Get current API key status for debugging
 */
export function getKeyStatus() {
    return {
        totalKeys: API_KEYS.length,
        currentKeyIndex: currentKeyIndex + 1,
        keys: API_KEYS.map((key, index) => ({
            index: index + 1,
            active: index === currentKeyIndex,
            masked: key.substring(0, 8) + '...' + key.substring(key.length - 4),
        })),
    };
}

