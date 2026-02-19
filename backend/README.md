# PIM Backend — Stateless Brain

The "Brain" — a pure intelligence engine. Input → Thought → Output.

**Architecture:** Local-First & Stateless. No database. No state.
Android holds the memory (conversation history as local JSON).
This server just takes a message + history, thinks, and replies.

**Stack:** Bun + Elysia + Groq (Llama 3.3 70B)

## Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your Groq API keys:
   - `GROQ_API_KEY` — Get from [Groq Console](https://console.groq.com/keys) (free, instant)
   - `GROQ_API_KEY_2`, `GROQ_API_KEY_3` — Optional: Additional keys for rotation
   - That's it. No database URL needed.

3. Install dependencies:
```bash
bun install
```

4. Run the server:
```bash
bun run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/chat` | Process incoming DM (sender + message + history[]) |
| POST | `/test` | Test LLM without history |
| GET | `/keys` | Check API key status |
| POST | `/keys/reset` | Reset key statistics |

## `/chat` Request Body

```json
{
  "sender": "username",
  "message": "hey whats up",
  "history": [
    { "role": "user", "content": "previous msg from them" },
    { "role": "model", "content": "your previous reply" }
  ]
}
```

The `history` array is sent by the Android app from local JSON storage.
Max 20 messages. The server stores nothing.

## Testing

Quick test (no history):
```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"message": "hey whats up"}'
```

Full chat test (with history):
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"sender": "test_user", "message": "bro kya scene h", "history": [{"role": "user", "content": "hello"}, {"role": "model", "content": "yo"}]}'
```

## Deployment (Render)

1. Connect your GitHub repo to Render
2. Add `GROQ_API_KEY` (and optionally `_2`, `_3`) in Render dashboard
3. Deploy!

No database provisioning needed. The server is stateless.
