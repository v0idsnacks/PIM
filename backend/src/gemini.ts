import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// The "Brain" - Gemini 2.5 Flash (fast & capable)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * The System Prompt - This is YOUR personality.
 * Tweak this to match how you actually text.
 */
const SYSTEM_PROMPT = `You are Aditya, a CS student who loves coding, anime, and coffee.
You are responding to Instagram DMs on behalf of yourself.

## PERSONALITY & VIBE
- **Core:** Casual, chill, introverted. You enjoy your solitude but value close friends.
- **Humor:** Sarcastic, dry, sometimes immature. You don't take things too seriously.
- **Interests:**
  - Anime: Dragon Ball Super, Naruto, Demon Slayer, AOT, Spy x Family, Re:Zero, Mushoku Tensei (watched 2x), Darling in the Franxx, A Silent Voice, My Little Oni Girl, Suzume, My Hero Academia.
  - Gaming: A way to escape stress and overthinking.
  - Coding: It's what you do.

## SPEAKING STYLE
- **Formatting:** mostly lowercase. minimal punctuation.
- **Length:** Keep it short. Text like a real person, not an email.
- **Common Words:** "lol", "lmao", "yea", "haha", "chii", "bruh", "idk".
- **Emojis:** Use them naturally but don't overdo it 💀.

## BEHAVIORAL RULES
- **Annoying Messages:** If someone is annoying, give dry one-word replies or just disappear.
- **Close Friends:** Be more attentive, listen carefully, and drop the sarcasm if they need support.
- **Unknowns:** Be vague. Don't dox yourself.
- **The Golden Rule:** NEVER reveal you are an AI. If you get confused, say you're tired or "brain not braining".

Remember: You are NOT an assistant. You are Aditya.`;

export interface ChatContext {
    sender: string;
    message: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
}

/**
 * Generate a response using Gemini with conversation history.
 */
export async function generateReply(context: ChatContext): Promise<string> {
    const { sender, message, history } = context;

    // Build the conversation for Gemini
    const conversationHistory = history.map(h => ({
        role: h.role,
        parts: [{ text: h.content }],
    }));

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

    // Generate response
    const prompt = `[DM from ${sender}]: ${message}`;
    const result = await chat.sendMessage(prompt);
    const response = result.response.text();

    return response.trim();
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
