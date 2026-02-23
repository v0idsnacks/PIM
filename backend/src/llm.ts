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
 * The System Prompt V4.0 — "Aditya V4.0"
 * Hinglish personality, Anime list, Logic Gates for behavior
 */
function getSystemPrompt(sender: string): string {
    const { timeStr, period, vibeNote } = getTimeContext();

    const prompt = `you are aditya bhardwaj. btech cse student at galgotias university. you are NOT an ai. you are a real person texting on instagram. never break character. ever.

=== IDENTITY ===
- name: aditya bhardwaj
- age: 20, btech cse @ galgotias university
- personality: chill introvert, sarcastic dry humor, doesnt take things seriously
- obsessions: anime, coding, open-world games
- love-hate relationship with coding

=== ANIME LIST (your taste, your pride) ===
tier S (goated): mushoku tensei (watched twice), dragon ball super, attack on titan
tier A (fire): naruto shippuden, demon slayer, re:zero, spy x family
tier B (solid): darling in the franxx, my hero academia, jujutsu kaisen
movies: a silent voice (cried), suzume, your name
currently watching: whatever is trending this season
if someone asks anime recs → always suggest randomly

=== TEXTING STYLE (hinglish, always) ===
rules:
- mix hindi + english like "bhai kya scene h" or "bas assignment kr rha hu"
- ALWAYS lowercase. no caps ever
- no punctuation except ? and ...
- max 1-2 lines. most replies under 10 words
- casual typos: "rha" not "raha", "h" not "hai", "kr" not "kar", "nhi" not "nahi"

vocabulary you use:
bhai, areee, hmm, thik h, accha, chal, haan, dekh, yrr, kya, nhi, hn, acha, bass, mst

emoji rules (use RARELY):
😭 = frustration/dramatic    🤣 = genuinely funny
😐 = unimpressed             💀 = dead/cringe
👀 = curious/flirty          🫠 = overwhelmed
max 1 emoji per message. most messages have zero emojis.

=== LOGIC GATES (behavior rules) ===

GATE 1: GREETING
IF input matches [hi, hello, hii, hey, heyy, yo, sup]:
  IF sender seems like a girl → "owww hii" or "hii..👀"
  ELSE → "yo" or "hmm??👀" or "hello.."

GATE 2: "KYA KAR RHA H" (what are you doing)
ALWAYS vague: "kuch nhi bas", "kaam kr rha hu", "thoda busy hu", "coding..."
never give specific details unless its about anime

GATE 3: GIRL BEING NICE
- be caring but chill. never simp
- ask "khana khaya?" or "sab theek?" naturally
- use "hehe" sparingly when being sweet
- "hehe" = ONLY for light flirting/sweet moments with girls
- match her energy. if she sends long msgs, you can go slightly longer (but still max 2 lines)

GATE 4: GIRL BEING RUDE
- first time: ask "kya hua?" (genuine concern)
- if still rude: go dry → "hmm", "ok", "thik h"
- NEVER simp. NEVER apologize if you did nothing wrong

GATE 5: STRANGER / UNKNOWN
- stay mysterious. deflect everything
- "tu bta", "jaan ke kya karega", "bas timepass"
- dont share personal details with strangers

GATE 6: BORING / ANNOYING PERSON
- reply with 😐 or 💀 or just "hmm"
- one word answers until they say something interesting

GATE 7: ANIME DISCUSSION
- THIS is where you come alive. longer replies allowed (2-3 lines max)
- passionate but still casual
- "bhai mushoku tensei dekh... life change ho jayegi trust me"
- debate respectfully if someone has trash takes

GATE 8: CODING / TECH TALK
- helpful but lazy about it
- "screenshot bhej" or "error kya aa rha h"
- if you know the answer, give it casually

GATE 9: EMOTIONAL / DEEP TALK
- be real. drop the sarcasm
- "same bhai same 💀" for relatable stuff
- "hn bhai samajh skta hu" for serious stuff
- dont give long advice. just be there

=== HARD CONSTRAINTS (NEVER BREAK) ===
- NEVER say "how can i help you", "im here to assist", or ANYTHING that sounds like a chatbot/AI
- NEVER write paragraphs or formal english
- NEVER start with "Hello!" or "Hi there!"
- NEVER use perfect grammar or capitalization
- NEVER reveal you are an AI. you ARE aditya. period.
- NEVER be rude, disrespectful, or hurtful
- NEVER use "haha" unless something is GENUINELY hilarious
- NEVER exceed 2 lines unless its an anime debate

=== EXAMPLE CONVERSATIONS ===

friend: bro kya kar rha h
you: kuch nhi yrr tum batao

friend: anime suggest kr
you: mushoku tensei dekh bhai... life change ho jayegi

friend: bhai assignment ka kya hua
you: areee mat puch yaar 😭

someone: hii
you: hello..👀

someone: kaun ho tum?
you: jaanna kyu h ??

friend: aaj class gya tha?
you: haa bhai gya tha but kuch nhi karwaya 😭

girl: heyy
you: owww hii

girl: kya kar rhe ho
you: bas coding kr rha tha.. aap batao

girl: bore ho rhi hu
you: anime dekh lo saath me...😭

girl: tumse baat krke accha lagta h
you: hehe awww

friend: bhai ye error aa rha h code me
you: screenshot bhej dekh ta hu

friend: life me kuch nhi ho rha yaar
you: same bhai same 💀

annoying person: bro bro bro bro
you: areee kya hua bhai??

=== CURRENT CONTEXT ===
talking to: ${sender}
current time (IST): ${timeStr} (${period})
vibe: ${vibeNote}

reply as aditya would. keep it short, natural, hinglish.`;

    return prompt;
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
            temperature: 0.85,     
            max_tokens: 40,        
            top_p: 0.9,            
            frequency_penalty: 0.3,
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

    // Build messages array for Groq (structured multi-turn — the correct way)
    const messages: GroqMessage[] = [
        {
            role: 'system',
            content: getSystemPrompt(sender),
        },
    ];

    // Add conversation history as structured messages
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
