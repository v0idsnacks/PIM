# PIM Backend

The "Brain" - Bun + Elysia + Groq (Llama 3.3) server that processes Instagram DMs.

## Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your environment variables:
   - `GROQ_API_KEY` - Get from [Groq Console](https://console.groq.com/keys) (free, instant)
   - `GROQ_API_KEY_2`, `GROQ_API_KEY_3` - Optional: Additional keys for rotation
   - `DATABASE_URL` - PostgreSQL connection string (Railway provides this)

3. Install dependencies:
```bash
bun install
```

4. Push database schema:
```bash
bun run db:push
```

5. Run the server:
```bash
bun run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/chat` | Process incoming DM (main endpoint) |
| POST | `/test` | Test LLM without database |
| GET | `/history/:sender` | Get conversation history |
| GET | `/keys` | Check API key status |
| POST | `/keys/reset` | Reset key statistics |

## Testing

Quick test with curl:
```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"message": "hey whats up"}'
```

Full chat test:
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"sender": "test_user", "message": "hey whats up"}'
```

## Deployment (Railway)

1. Connect your GitHub repo to Railway
2. Add environment variables in Railway dashboard
3. Deploy!

The server will automatically start on the assigned `PORT`.
