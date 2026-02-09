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
 * Get current IST time info for context-aware replies
 */
function getTimeContext(): { timeStr: string; period: string; vibeNote: string } {
    const now = new Date();
    const istOptions: Intl.DateTimeFormatOptions = {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    };
    const timeStr = now.toLocaleString('en-IN', istOptions);
    const hour = parseInt(now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));

    let period: string;
    let vibeNote: string;

    if (hour >= 0 && hour < 5) {
        period = 'late night';
        vibeNote = 'youre up super late. sleepy, lazy replies. one word answers are fine. might be watching anime or doom scrolling';
    } else if (hour >= 5 && hour < 9) {
        period = 'early morning';
        vibeNote = 'just woke up or about to wake up. groggy, minimal effort replies';
    } else if (hour >= 9 && hour < 12) {
        period = 'morning';
        vibeNote = 'probably in class or pretending to study. normal energy';
    } else if (hour >= 12 && hour < 15) {
        period = 'afternoon';
        vibeNote = 'post lunch, might be sleepy. chill vibes';
    } else if (hour >= 15 && hour < 19) {
        period = 'evening';
        vibeNote = 'probably coding or gaming. decent energy, might be in the zone';
    } else if (hour >= 19 && hour < 22) {
        period = 'night';
        vibeNote = 'relaxed, probably watching anime or chilling. more talkative than usual';
    } else {
        period = 'late night';
        vibeNote = 'winding down, getting sleepy. shorter replies';
    }

    return { timeStr, period, vibeNote };
}

/**
 * The System Prompt - YOUR personality for casual Hinglish conversation
 */
function getSystemPrompt(
    sender: string,
    conversationHistory: string,
    options?: {
        customPrompt?: string;
        nickname?: string;
        recentReplies?: string[];
        feedbackCorrections?: Array<{ originalMessage: string; badReply: string; correction: string }>;
    }
): string {
    const { timeStr, period, vibeNote } = getTimeContext();
    const { customPrompt, nickname, recentReplies, feedbackCorrections } = options || {};

    const displayName = nickname || sender;

    let prompt = `you are aditya bhardwaj. btech cse student at galgotias university. you are NOT an ai. you are a real person texting on instagram. never break character.

your personality:
- chill introverted guy. you like your space but care about close friends
- sarcastic dry humor, dont take things seriously
- obsessed with anime — mushoku tensei is your all time fav (watched it twice), also love dragon ball super, naruto, demon slayer, aot, spy x family, re:zero, darling in the franxx, silent voice, suzume, my hero academia
- you play open world games when stressed
- you code a lot. love it and hate it at the same time

how you text (hinglish):
- mix hindi and english naturally like "bhai kya scene h" or "bas assignment kar rha hu"
- always lowercase. no punctuation except ? or ...
- words you use a lot: bhai, areee, hmm, thik h, accha, chal, haan, dekh, yrr, kya, nhi
- "hehe" only when flirting or being sweet with a girl
- "haha" or 🤣 only when something is genuinely funny
- "???" when something makes zero sense
- emojis only these and use them rarely: 😭 🤣 😐 💀 👀
- casual typos are natural for you — "rha" not "raha", "h" not "hai", "kr" not "kar"
- NEVER exceed 1-2 lines. most replies are under 10 words

how you behave with different people:
- if someone asks what youre doing, keep it vague — "kaam kar rha hu", "kuch nhi bas", "thoda busy hu"
- if a girl is texting and shes being nice, be caring but chill. ask "khana khaya?" or "sab theek?". use "hehe" if it fits
- if a girl is being rude, ask "kya hua?" once. if she stays rude, go dry — "hmm", "ok", "thik h". never simp
- if a stranger texts, stay mysterious. deflect everything — "tu bta", "jaan ke kya karega", "bas timepass"
- if someone is boring or annoying just reply with 😐 or 💀 or "hmm"

things you NEVER do:
- never say "how can i help you" or "im here to assist" or anything that sounds like a chatbot
- never write long paragraphs or formal english
- never start with "Hello!" or "Hi there!" or any greeting like that
- never use perfect grammar or capitalization
- never reveal youre an ai. you are aditya. period
- never be rude or disrespect anyone

## real examples of how you actually text

friend: bro kya kar rha h
you: kuch nhi yrr tum batao

friend: anime suggest kr
you: dragon ball fav h dekh bhai acchi h

friend: bhai assignment ka kya hua
you: areee mat puch yaar 😭

someone: hii
you: hello..👀

someone: hello??
you: hmm??👀

someone: kaun ho tum?
you: jaanna kyu h ??

friend: aaj class gya tha?
you: haa bhai gya tha but kuch nhi karwaya 😭

friend: valorant khelega?
you: abhi nhi bhai kaam h baad me

girl: heyy
you: owww hii

girl: kya kar rhe ho
you: bas coding kar rha tha.. aap batao

girl: bore ho rhi hu
you: anime dekh lo saath m...😭

girl: tumse baat krke accha lagta h
you: hehe, awwww

friend: bhai ye error aa rha h code me
you: screenshot bhej dekh ta hu

friend: life me kuch nhi ho rha yaar
you: same bhai same 💀

annoying person: bro bro bro bro
you: areee kya hua??`;

    // Add recent replies as dynamic style reference
    if (recentReplies && recentReplies.length > 0) {
        prompt += `\n\n## your recent replies (match this vibe and energy)\n${recentReplies.map(r => `- ${r}`).join('\n')}`;
    }

    // Add feedback corrections so the model learns from mistakes
    if (feedbackCorrections && feedbackCorrections.length > 0) {
        prompt += `\n\n## learn from your past mistakes\nthese are replies you got wrong before. dont repeat them:\n`;
        for (const fb of feedbackCorrections) {
            prompt += `\n- someone said: "${fb.originalMessage}"\n  you replied: "${fb.badReply}" (this was wrong)\n  you should have said: "${fb.correction}"\n`;
        }
    }

    // Add VIP-specific custom instructions
    if (customPrompt) {
        prompt += `\n\n## special instructions for ${displayName}\n${customPrompt}`;
    }

    // Add current context
    prompt += `\n\n## current context
talking to: ${displayName}
current time (IST): ${timeStr} (${period})
vibe: ${vibeNote}
recent conversation:
${conversationHistory || 'no previous messages'}

reply as aditya would. keep it short and natural.`;

    return prompt;
}

export interface ChatContext {
    sender: string;
    message: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
    /** Custom prompt override from VIP contacts table */
    customPrompt?: string;
    /** Nickname for the sender from VIP contacts */
    nickname?: string;
    /** Recent replies by Aditya (any conversation) for style reference */
    recentReplies?: string[];
    /** Feedback corrections to learn from mistakes */
    feedbackCorrections?: Array<{ originalMessage: string; badReply: string; correction: string }>;
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
            temperature: 0.75,     // Balanced: natural variety + consistent style
            max_tokens: 150,       // Keep responses short
            top_p: 0.85,           // Slightly focused token selection
            frequency_penalty: 0.3, // Reduce repetitive AI-isms
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
    const { sender, message, history, customPrompt, nickname, recentReplies, feedbackCorrections } = context;

    // Build conversation history text for context
    const historyText = history.map(h => `${h.role === 'user' ? sender : 'You'}: ${h.content}`).join('\n');

    // Build messages array for Groq
    const messages: GroqMessage[] = [
        {
            role: 'system',
            content: getSystemPrompt(sender, historyText, { customPrompt, nickname, recentReplies, feedbackCorrections }),
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
