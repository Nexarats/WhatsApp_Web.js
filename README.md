# Single Endpoint WhatsApp API Microservice 🚀

A highly concurrent, headless WhatsApp API microservice powered by `whatsapp-web.js` and Express.js. Designed to manage multiple completely isolated WhatsApp sessions from a single unified API Gateway.

## 🌟 Single Endpoint Architecture (RPC Data-Driven)

This API relies on a single **Unified URL**:
**Format:** `POST /api/whatsapp`

Instead of hitting different routes like `/send` or `/qr`, you just send a JSON payload with an `action` attribute.

### 🔑 Basic Workflow (Single or Multi-User)

To use the service, simply send a POST request with the desired action. If you need to isolate numbers (multi-user), include a `sessionId`. If you omit `sessionId`, it defaults to `default`.

1. **Start Session:** `POST /api/whatsapp` with `{ "action": "start", "sessionId": "optional_id" }`
2. **Get QR Code:** `POST /api/whatsapp` with `{ "action": "qr", "sessionId": "optional_id" }`
3. **Send Message:** `POST /api/whatsapp` with `{ "action": "send", "sessionId": "optional_id", "phone": "123...", "message": "Hi" }`

---

## 🌎 Vercel Deployment Instructions

You can deploy this API to Vercel instantly using the attached `vercel.json`!

1. Install the Vercel CLI: `npm i -g vercel`
2. Run `vercel login` and follow the prompts.
3. Open your terminal inside this project's directory.
4. Run: `vercel` (and hit Enter to accept defaults)
5. Run: `vercel --prod` to push your build to production!

---

### ⚠️ IMPORTANT VERCEL DISCLAIMER (Serverless vs Puppeteer)

**While you CAN deploy this on Vercel seamlessly using the `vercel.json` provided, you need to understand Vercel's Serverless architecture limitations!**

Vercel freezes functions the millisecond your request returns a response (or drops it after a 10s-60s timeout limit). WhatsApp bots require a persistent, 24/7 background long-polling socket connection.
**If deployed directly to Vercel Serverless:**
1. Background incoming messages will NOT be retrieved reliably as the Lambda container goes to sleep.
2. Initializing `puppeteer` (Headless browser) takes exactly 10-15s, which exceeds Vercel Hobby tier timeout limits (meaning `start` might hang depending on your plan tier!).

### ✅ Better Deployment Options (For 24/7 Online Bots)

For the absolute best production-grade reliability (keeping the underlying Chrome browser awake permanently), it is strictly recommended you deploy this application to environments running Docker or Standard Node VPS environments like:

- **Railway.app** (No-Config required, just specify this GitHub repository, and Railway will run it on an isolated container forever).
- **Render.com** (Highly scalable, similar execution node styles to Railway, supports websockets perfectly).
- **Digital Ocean / AWS EC2** (Standard Linux VPS).

Simply upload the codebase, run `npm install`, and `npm run start` (`node server.js`).

---

## ⚡ API Action Reference

**Send all requests as `POST` to `/api/whatsapp`:**

- **Start Client:** `{ "action": "start", "sessionId": "..." }`
- **Session Status:** `{ "action": "status" }`
- **Get QR Code:** `{ "action": "qr" }`
- **Request Pair Code:** `{ "action": "pair", "phone": "98765..." }`
- **Send Msg:** `{ "action": "send", "phone": "...", "message": "Hi" }`
- **Send Receipt (Base64 file):** `{ "action": "send-receipt", "phone": "...", "base64Data": "..." }`
- **Fetch Chat History:** `{ "action": "messages", "phone": "919876543210", "limit": 50 }`
- **Logout Client:** `{ "action": "logout" }`
- **Emergency Session Wipe:** `{ "action": "clear-all" }` (Wipes all sessions globally)

---

## 📖 Interactive Documentation
Visit `http://localhost:5000/docs` to see the full interactive documentation.
