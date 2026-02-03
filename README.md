# PIM (Proxy Instagram Manager)

> **"My digital twin. An AI system that handles my DMs so I don't have to."**

## ⚠️ Disclaimer
**This is a personal utility project.**
I am "vibe coding" this. There are no unit tests. There is no CI/CD pipeline. There is only me, caffeine, and a desire to automate my social life. If you clone this and it breaks your phone or gets you ghosted by your crush, that’s on you.

## 🧐 What is this?
PIM is an Android-based AI proxy. It lives on my phone, listens for incoming Instagram notifications, and uses an LLM (Large Language Model) to generate context-aware replies based on my personality.

It’s basically an automated "me" that runs 24/7.

## ⚙️ How it Works (The "Architecture")
The system is split into two parts: The **Body** (Android) and the **Brain** (Server).

1.  **The Interceptor (Android):** A background service uses `NotificationListenerService` to catch notifications from specific packages (e.g., `com.instagram.android`).
2.  **The Transport:** The app extracts the sender and message text and POSTs it to my private backend.
3.  **The Memory (PostgreSQL):** The server retrieves the last $N$ messages from that sender to understand the context.
4.  **The Intelligence (LLM):** The conversation history + a system prompt ("You are Aditya, a CS student, sarcastic but helpful...") is sent to Gemini/OpenAI.
5.  **The Action:** The generated reply is sent back to the phone, which uses the Android `RemoteInput` API to reply directly from the notification bar.

## 🛠️ Tech Stack
* **Mobile:** Android Native (Java/Kotlin)
    * *Why?* Because `NotificationListenerService` requires native permissions.
* **Backend:** Bun (ElysiaJS/Hono)
    * *Why?* It's fast, and I like it.
* **Database:** PostgreSQL (hosted on Railway)
    * *Why?* Need structured relations for chat logs.
* **AI:** Gemini 1.5 Flash / GPT-4o
    * *Why?* Cheap, fast, and smart enough to mimic me.

## 🚀 Roadmap / To-Do
- [ ] **Phase 1: The Ears**
    - [ ] Android Service to intercept notifications.
    - [ ] Log output to verify data capture.
- [ ] **Phase 2: The Brain**
    - [ ] Set up Bun server on Railway.
    - [ ] Connect PostgreSQL database.
    - [ ] Integrate LLM API.
- [ ] **Phase 3: The Mouth**
    - [ ] Android `RemoteInput` implementation to auto-reply.
    - [ ] Handle "Do Not Disturb" logic (so I don't reply at 4 AM).
- [ ] **Phase 4: Personality Tuning**
    - [ ] "Roast Mode" implementation.
    - [ ] Specific filters for "VIP" contacts.

## 🔧 Setup (For Me)
1.  Clone repo.
2.  Add `.env` with `GEMINI_API_KEY` and `DATABASE_URL`.
3.  Build Android APK and grant "Notification Access" permission in Settings.
4.  Deploy backend to Railway.
5.  Pray it works.

## 📄 License
MIT. Do whatever you want with it, just don't blame me, Chears☕.
