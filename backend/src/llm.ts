import 'dotenv/config';

/**
 * Groq LLM Integration with API Key Rotation
 * 
 * Groq Free Tier Limits (per key):
 * - RPM: 30 requests per minute
 * - RPD: 14,400 requests per day (!!!)
 * - TPM: 15,000 tokens per minute
 * 
 * With 3 keys: 90 RPM, 43,200 RPD total
 * 
 * Features:
 * - RPM tracking: 2-second minimum gap between uses of same key
 * - RPD tracking: Tracks daily usage, resets at midnight UTC
 * - Round-robin: Distributes load evenly across all keys
 * - Cooldown: Rate-limited keys are cooled down
 * - Smart fallback: Uses key with most remaining daily quota
 */

// Groq Free Tier Limits (much better than Gemini!)
const LIMITS = {
    RPM: 30,           // Requests per minute per key
    RPD: 14400,        // Requests per day per key (14,400!)
    TPM: 15000,        // Tokens per minute per key
};

// Model to use - Llama 3.3 70B is excellent for casual conversation
const MODEL = 'llama-3.3-70b-versatile';

// Minimum gap between uses of same key (60s / 30 RPM = 2s, use 2.5s for safety)
const MIN_GAP_BETWEEN_USES_MS = 2500;

interface KeyStats {
    key: string;
    index: number;
    masked: string;
    // Usage tracking
    requestsToday: number;
    requestsThisMinute: number[];  // Timestamps of requests in last minute
    lastUsed: number;
    // Error tracking  
    successCount: number;
    failureCount: number;
    consecutiveErrors: number;
    lastErrorMessage: string | null;
    // Cooldown
    cooldownUntil: number;
    // Daily reset tracking
    lastResetDate: string;  // YYYY-MM-DD format
}

// Cooldown durations
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;          // 60s for rate limit
const DAILY_EXHAUSTED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour if daily quota hit
const ERROR_COOLDOWN_MS = 10 * 1000;               // 10s for other errors

// Load API keys from environment
const API_KEYS: string[] = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
].filter((key): key is string => typeof key === 'string' && key.trim().length > 0);

if (API_KEYS.length === 0) {
    console.error('❌ No Groq API keys found! Available env vars:', Object.keys(process.env).filter(k => k.includes('GROQ')));
    throw new Error('No Groq API keys found! Set GROQ_API_KEY in .env');
}

// Get today's date in YYYY-MM-DD format (UTC)
function getTodayDate(): string {
    return new Date().toISOString().split('T')[0] as string;
}

// Initialize key statistics
const keyStats: KeyStats[] = API_KEYS.map((key, index) => ({
    key,
    index,
    masked: key.substring(0, 8) + '...' + key.substring(key.length - 4),
    requestsToday: 0,
    requestsThisMinute: [],
    lastUsed: 0,
    successCount: 0,
    failureCount: 0,
    consecutiveErrors: 0,
    lastErrorMessage: null,
    cooldownUntil: 0,
    lastResetDate: getTodayDate(),
}));

// Log which keys are loaded
keyStats.forEach((stats) => {
    console.log(`🔑 Groq Key ${stats.index + 1}: ${stats.masked}`);
});
console.log(`✅ Loaded ${API_KEYS.length} Groq API key(s) - Using ${MODEL}`);
console.log(`📊 Limits per key: ${LIMITS.RPM} RPM, ${LIMITS.RPD.toLocaleString()} RPD`);
console.log(`📊 Total capacity: ${LIMITS.RPM * API_KEYS.length} RPM, ${(LIMITS.RPD * API_KEYS.length).toLocaleString()} RPD`);

/**
 * Check if daily stats need to be reset (new day)
 */
function checkDailyReset(stats: KeyStats): void {
    const today = getTodayDate();
    if (stats.lastResetDate !== today) {
        console.log(`🌅 New day detected for key ${stats.index + 1}, resetting daily count (was ${stats.requestsToday})`);
        stats.requestsToday = 0;
        stats.lastResetDate = today;
        stats.cooldownUntil = 0;
    }
}

/**
 * Clean up old timestamps from requestsThisMinute array
 */
function cleanupMinuteStats(stats: KeyStats): void {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    stats.requestsThisMinute = stats.requestsThisMinute.filter(ts => ts > oneMinuteAgo);
}

/**
 * Check if a key is available for use
 */
function isKeyAvailable(stats: KeyStats): boolean {
    const now = Date.now();

    checkDailyReset(stats);

    if (now < stats.cooldownUntil) {
        return false;
    }

    if (stats.requestsToday >= LIMITS.RPD) {
        return false;
    }

    cleanupMinuteStats(stats);
    if (stats.requestsThisMinute.length >= LIMITS.RPM) {
        return false;
    }

    if (now - stats.lastUsed < MIN_GAP_BETWEEN_USES_MS) {
        return false;
    }

    return true;
}

/**
 * Get remaining daily quota for a key
 */
function getRemainingDaily(stats: KeyStats): number {
    checkDailyReset(stats);
    return Math.max(0, LIMITS.RPD - stats.requestsToday);
}

/**
 * Select the best available key
 */
function selectBestKey(): KeyStats | null {
    const now = Date.now();

    let availableKeys = keyStats.filter(k => isKeyAvailable(k));

    if (availableKeys.length > 0) {
        availableKeys.sort((a, b) => {
            const aRemaining = getRemainingDaily(a);
            const bRemaining = getRemainingDaily(b);

            if (aRemaining !== bRemaining) {
                return bRemaining - aRemaining;
            }

            return a.lastUsed - b.lastUsed;
        });

        const selected = availableKeys[0]!;
        console.log(`🎯 Selected key ${selected.index + 1} (${getRemainingDaily(selected).toLocaleString()}/${LIMITS.RPD.toLocaleString()} daily remaining)`);
        return selected;
    }

    const keysWithQuota = keyStats.filter(k => {
        checkDailyReset(k);
        return k.requestsToday < LIMITS.RPD && k.cooldownUntil <= now;
    });

    if (keysWithQuota.length > 0) {
        keysWithQuota.sort((a, b) => {
            cleanupMinuteStats(a);
            cleanupMinuteStats(b);

            const aReadyAt = a.requestsThisMinute.length >= LIMITS.RPM
                ? (a.requestsThisMinute[0] ?? now) + 60000
                : Math.max(a.lastUsed + MIN_GAP_BETWEEN_USES_MS, now);
            const bReadyAt = b.requestsThisMinute.length >= LIMITS.RPM
                ? (b.requestsThisMinute[0] ?? now) + 60000
                : Math.max(b.lastUsed + MIN_GAP_BETWEEN_USES_MS, now);

            return aReadyAt - bReadyAt;
        });

        const nextAvailable = keysWithQuota[0]!;
        cleanupMinuteStats(nextAvailable);
        const waitTime = nextAvailable.requestsThisMinute.length >= LIMITS.RPM
            ? Math.ceil(((nextAvailable.requestsThisMinute[0] ?? now) + 60000 - now) / 1000)
            : Math.ceil(Math.max(0, nextAvailable.lastUsed + MIN_GAP_BETWEEN_USES_MS - now) / 1000);

        console.log(`⏳ No keys ready now. Key ${nextAvailable.index + 1} available in ${waitTime}s`);
        return null;
    }

    const totalUsedToday = keyStats.reduce((sum, k) => sum + k.requestsToday, 0);
    console.log(`💀 All keys exhausted! Used ${totalUsedToday.toLocaleString()}/${(LIMITS.RPD * API_KEYS.length).toLocaleString()} daily quota`);
    return null;
}

/**
 * Record a successful request
 */
function recordSuccess(stats: KeyStats): void {
    const now = Date.now();
    stats.successCount++;
    stats.requestsToday++;
    stats.requestsThisMinute.push(now);
    stats.lastUsed = now;
    stats.consecutiveErrors = 0;
    stats.lastErrorMessage = null;

    const totalRemaining = keyStats.reduce((sum, k) => sum + getRemainingDaily(k), 0);
    console.log(`✅ Key ${stats.index + 1} success | Today: ${stats.requestsToday}/${LIMITS.RPD} | Total remaining: ${totalRemaining.toLocaleString()}`);
}

/**
 * Record a failed request and apply cooldown
 */
function recordFailure(stats: KeyStats, error: any): void {
    const now = Date.now();
    stats.failureCount++;
    stats.lastUsed = now;
    stats.consecutiveErrors++;
    stats.lastErrorMessage = error?.message || String(error);

    stats.requestsToday++;
    stats.requestsThisMinute.push(now);

    const errorStatus = error?.status || error?.error?.code || 0;
    const errorMessage = stats.lastErrorMessage?.toLowerCase() || '';

    let cooldownMs = ERROR_COOLDOWN_MS;
    let reason = 'error';

    if (errorStatus === 429 || errorMessage.includes('rate') || errorMessage.includes('quota') || errorMessage.includes('limit')) {
        if (errorMessage.includes('day') || errorMessage.includes('daily')) {
            cooldownMs = DAILY_EXHAUSTED_COOLDOWN_MS;
            stats.requestsToday = LIMITS.RPD;
            reason = 'daily quota exhausted';
        } else {
            cooldownMs = RATE_LIMIT_COOLDOWN_MS;
            reason = 'rate limit (RPM)';
        }
    } else if (errorStatus === 401 || errorStatus === 403 || errorMessage.includes('api key') || errorMessage.includes('invalid') || errorMessage.includes('unauthorized')) {
        cooldownMs = DAILY_EXHAUSTED_COOLDOWN_MS;
        reason = 'invalid/disabled key';
    }

    stats.cooldownUntil = now + cooldownMs;

    console.log(`❌ Key ${stats.index + 1} failed (${reason}) - cooldown ${Math.ceil(cooldownMs / 1000)}s`);
    console.log(`   Error: ${stats.lastErrorMessage?.substring(0, 80)}`);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The System Prompt - YOUR personality for casual Hinglish conversation
 */
function getSystemPrompt(sender: string, conversationHistory: string): string {
    return `You are Aditya Bhardwaj. You are a B.Tech CSE student at Galgotias University.
You are NOT an AI assistant. You are a real human texting on Instagram.

## 🧠 PERSONALITY & VIBE
- **Core:** Casual, chill, introverted. Enjoy solitude but value close friends.
- **Humor:** Sarcastic, dry, sometimes immature. Don't take things too seriously.
- **Obsessions (Anime):** Dragon Ball Super, Naruto, Demon Slayer, AOT, Spy x Family, Re:Zero, Mushoku Tensei (watched 2x - absolute fav), Darling in the Franxx, A Silent Voice, My Little Oni Girl, Suzume, My Hero Academia.
- **Gaming:** Play open world games to escape stress and overthinking.
- **Coding:** It's what you do. You love it but also hate it sometimes.

## 🗣️ CORE SPEAKING STYLE (Hinglish)
- **Language:** Mix Hindi and English naturally. (e.g., "bhai kya scene h", "bas assignment kar rha hu").
- **Formatting:** lowercase only. no punctuation (except maybe ? or ...).
- **Vocabulary:**
  - Common: "bhai", "areee", "hmm", "thik h", "accha", "chal", "haan".
  - Joking/Sweet: "hehe" (Use this ONLY if flirting or being sweet).
  - Laughing: "haha" or "🤣" (Use this if something is actually funny).
  - Confused/Doubt: "???" (Use this if their message makes no sense).
- **Emojis:** Use sparingly. Only these: 😭 🤣 😒 😐 💀 👀.
- **Typos:** Occasionally use casual typos like "rha" instead of "raha", "h" instead of "hai".

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
- NEVER say "How can I help you?", "I'm here to assist", or anything AI-like.
- NEVER reveal you are an AI. You are ADITYA.
- NEVER write long paragraphs. Keep replies 1-2 lines max.
- NEVER use formal language or perfect grammar.
- NEVER start with greetings like "Hello!" or "Hi there!".

## 📝 CURRENT CONTEXT
Talking to: ${sender}
Recent conversation:
${conversationHistory || 'No previous messages'}

Reply as Aditya would naturally text on Instagram. Keep it short and casual.`;
}

export interface ChatContext {
    sender: string;
    message: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
}

interface GroqMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface GroqResponse {
    id: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * Call Groq API with the given key
 */
async function callGroqAPI(apiKey: string, messages: GroqMessage[]): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0.9,      // Higher for more natural/varied responses
            max_tokens: 150,       // Keep responses short
            top_p: 0.9,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        const error: any = new Error(`Groq API error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.body = errorBody;
        throw error;
    }

    const data = await response.json() as GroqResponse;
    const content = data.choices[0]?.message?.content;

    if (!content) {
        throw new Error('Empty response from Groq API');
    }

    console.log(`📊 Tokens used: ${data.usage.total_tokens} (prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens})`);

    return content.trim();
}

/**
 * Generate a response using Groq with conversation history.
 * Uses smart API key selection with cooldowns and retries.
 */
export async function generateReply(context: ChatContext): Promise<string> {
    const { sender, message, history } = context;

    // Build conversation history text for context
    const historyText = history.map(h => `${h.role === 'user' ? sender : 'You'}: ${h.content}`).join('\n');

    // Build messages array for Groq
    const messages: GroqMessage[] = [
        {
            role: 'system',
            content: getSystemPrompt(sender, historyText),
        },
    ];

    // Add conversation history
    for (const h of history) {
        messages.push({
            role: h.role === 'user' ? 'user' : 'assistant',
            content: h.content,
        });
    }

    // Add current message
    messages.push({
        role: 'user',
        content: message,
    });

    // Try with key rotation
    const maxAttempts = Math.min(API_KEYS.length * 2, 6);
    let lastError: Error | null = null;
    const triedKeys = new Set<number>();

    const totalRemaining = keyStats.reduce((sum, k) => sum + getRemainingDaily(k), 0);
    console.log(`🎯 Generating reply for ${sender} (${totalRemaining.toLocaleString()} daily quota remaining)`);

    if (totalRemaining === 0) {
        throw new Error('Daily API quota exhausted. Please try again tomorrow.');
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const selectedKey = selectBestKey();

        if (!selectedKey) {
            const now = Date.now();
            const keysWithQuota = keyStats.filter(k => getRemainingDaily(k) > 0);

            if (keysWithQuota.length === 0) {
                throw new Error('Daily API quota exhausted across all keys.');
            }

            let minWaitTime = Infinity;
            for (const k of keysWithQuota) {
                cleanupMinuteStats(k);
                let keyReadyAt = now;

                if (k.cooldownUntil > now) {
                    keyReadyAt = k.cooldownUntil;
                } else if (k.requestsThisMinute.length >= LIMITS.RPM) {
                    keyReadyAt = (k.requestsThisMinute[0] ?? now) + 60000;
                } else {
                    keyReadyAt = k.lastUsed + MIN_GAP_BETWEEN_USES_MS;
                }

                minWaitTime = Math.min(minWaitTime, keyReadyAt - now);
            }

            const waitTime = Math.max(minWaitTime, 500);

            if (waitTime <= 10000) { // Only wait if under 10 seconds (Groq is fast)
                console.log(`⏳ Waiting ${Math.ceil(waitTime / 1000)}s for next available key...`);
                await sleep(waitTime + 200);
                continue;
            } else {
                console.error(`💀 All keys in extended cooldown (${Math.ceil(waitTime / 1000)}s)`);
                throw new Error('All API keys are rate-limited. Try again in a minute.');
            }
        }

        triedKeys.add(selectedKey.index);
        console.log(`🔄 Attempt ${attempt + 1}/${maxAttempts} using key ${selectedKey.index + 1}`);

        try {
            console.log(`📤 Sending to Groq (${MODEL}): "${message.substring(0, 50)}..."`);

            const startTime = Date.now();
            const response = await callGroqAPI(selectedKey.key, messages);
            const latency = Date.now() - startTime;

            recordSuccess(selectedKey);
            console.log(`✅ Reply generated in ${latency}ms: "${response.substring(0, 50)}..."`);

            return response;

        } catch (error: any) {
            lastError = error;
            recordFailure(selectedKey, error);

            const errorStatus = error?.status || 'unknown';
            console.error(`❌ Key ${selectedKey.index + 1} error: [${errorStatus}] ${error.message}`);

            if (attempt < maxAttempts - 1) {
                const backoffMs = Math.min(300 * Math.pow(2, attempt), 3000);
                console.log(`⏳ Backoff: ${backoffMs}ms before retry...`);
                await sleep(backoffMs);
            }
        }
    }

    console.error(`💀 All ${triedKeys.size} keys tried, ${maxAttempts} attempts failed!`);
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
    const now = Date.now();
    const today = getTodayDate();

    keyStats.forEach(k => checkDailyReset(k));

    const totalUsedToday = keyStats.reduce((sum, k) => sum + k.requestsToday, 0);
    const totalRemainingToday = keyStats.reduce((sum, k) => sum + getRemainingDaily(k), 0);

    return {
        provider: 'Groq',
        model: MODEL,
        limits: {
            rpm: LIMITS.RPM,
            rpd: LIMITS.RPD,
            totalRpmCapacity: LIMITS.RPM * API_KEYS.length,
            totalRpdCapacity: LIMITS.RPD * API_KEYS.length,
        },
        today: {
            date: today,
            used: totalUsedToday,
            remaining: totalRemainingToday,
            percentUsed: Math.round((totalUsedToday / (LIMITS.RPD * API_KEYS.length)) * 100) + '%',
        },
        totalKeys: API_KEYS.length,
        availableNow: keyStats.filter(k => isKeyAvailable(k)).length,
        keys: keyStats.map((stats) => {
            cleanupMinuteStats(stats);
            return {
                index: stats.index + 1,
                masked: stats.masked,
                available: isKeyAvailable(stats),
                usedToday: stats.requestsToday,
                remainingToday: getRemainingDaily(stats),
                requestsLastMinute: stats.requestsThisMinute.length,
                cooldownRemaining: stats.cooldownUntil > now
                    ? Math.ceil((stats.cooldownUntil - now) / 1000) + 's'
                    : null,
                successCount: stats.successCount,
                failureCount: stats.failureCount,
                successRate: stats.successCount + stats.failureCount > 0
                    ? Math.round((stats.successCount / (stats.successCount + stats.failureCount)) * 100) + '%'
                    : 'N/A',
                lastError: stats.lastErrorMessage,
            };
        }),
    };
}

/**
 * Reset all key statistics
 */
export function resetKeyStats(): void {
    const today = getTodayDate();
    keyStats.forEach(stats => {
        stats.successCount = 0;
        stats.failureCount = 0;
        stats.requestsToday = 0;
        stats.requestsThisMinute = [];
        stats.lastUsed = 0;
        stats.cooldownUntil = 0;
        stats.consecutiveErrors = 0;
        stats.lastErrorMessage = null;
        stats.lastResetDate = today;
    });
    console.log('🔄 All key statistics reset');
}
