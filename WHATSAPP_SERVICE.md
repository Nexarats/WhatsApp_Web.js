# 📱 WhatsApp Integration Service — Architecture & Usage Guide

> Production-ready WhatsApp messaging service built on `whatsapp-web.js`, integrated into the NexaratsINV Supabase backend.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (:5000)                   │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │   Products   │   │  Customers   │   │   Transactions │  │
│  │   /api/...   │   │   /api/...   │   │   /api/...     │  │
│  └──────────────┘   └──────────────┘   └────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            WhatsApp Service (/api/whatsapp)          │   │
│  │                                                      │   │
│  │  ┌────────────────┐   ┌──────────────────────┐       │   │
│  │  │ REST API Routes│──▶│ WhatsAppClientManager │      │   │
│  │  │  whatsapp.js   │   │   (Singleton)         │      │   │
│  │  └────────────────┘   └──────┬───────────────┘       │   │
│  │                              │                        │   │
│  │                    ┌─────────▼─────────┐              │   │
│  │                    │  Message Queue    │              │   │
│  │                    │ (Rate-limited,    │              │   │
│  │                    │  retry, backoff)  │              │   │
│  │                    └─────────┬─────────┘              │   │
│  │                              │                        │   │
│  │                    ┌─────────▼─────────┐              │   │
│  │                    │  whatsapp-web.js  │              │   │
│  │                    │  (Puppeteer +     │              │   │
│  │                    │   LocalAuth)      │              │   │
│  │                    └──────────────────┘               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Supabase Database                  │   │
│  │  • whatsapp_sessions (status, metadata)              │   │
│  │  • whatsapp_messages (queue, sent, failed, audit)    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | File | Purpose |
|-----------|------|---------|
| **Client Manager** | `whatsapp/clientManager.js` | Singleton that manages the whatsapp-web.js Client — handles QR auth, phone pairing, connection lifecycle, auto-reconnect |
| **Message Queue** | `whatsapp/messageQueue.js` | Rate-limited FIFO queue with 3s delay between messages, max 3 retries with exponential backoff |
| **REST Routes** | `routes/whatsapp.js` | All HTTP endpoints for sending, status, QR, logout, restart |
| **Logger** | `whatsapp/logger.js` | Structured logging with ANSI colors + rotating daily log files |
| **Models** | `models/WhatsAppSession.js` | Supabase models for session metadata + message audit log |
| **Barrel** | `whatsapp/index.js` | Public exports for programmatic use from other modules |

---

## 📦 Required NPM Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `whatsapp-web.js` | ^1.x | WhatsApp Web client via Puppeteer |
| `qrcode` | ^1.x | QR code generation (data-URL) |
| `express` | ^5.x | Already installed — HTTP server |
| `@supabase/supabase-js` | ^2.x | Supabase client for data persistence |
| `cors` | ^2.x | Already installed |
| `dotenv` | ^17.x | Already installed |

Install command:
```bash
npm install whatsapp-web.js qrcode
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | ✅ | `5000` | Server port |
| `SUPABASE_URL` | ✅ | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service role key |
| `WA_API_KEY` | ❌ | _(empty)_ | API key to protect WhatsApp endpoints. Leave empty for dev (no auth). |

---

## 🔐 Session Persistence — How It Works

1. **LocalAuth strategy** — `whatsapp-web.js` stores the Chromium session profile in `whatsapp-service/.wwebjs_auth/`
2. On first launch, the client generates a QR code → scan with WhatsApp mobile
3. After successful scan, the session is persisted to disk automatically
4. On subsequent restarts, the client loads the saved session — **no QR scan needed**
5. Session metadata (status, phone number, push name, timestamps) is also stored in Supabase (`whatsapp_sessions` table) for monitoring
6. If the session expires or gets revoked, the client emits a new QR automatically

**Important**: Add `.wwebjs_auth/` to your `.gitignore` to avoid committing session data.

---

## 🚀 How to Run

```bash
# 1. Navigate to the backend
cd mongodb-service

# 2. Install dependencies (only once)
npm install

# 3. Start in development mode
npm run dev

# 4. Watch the console — you will see:
#    📡 Server running on http://localhost:5000
#    📱 [WA-INFO] WhatsApp client initialising…
#    📱 [WA-INFO] QR code generated — scan with WhatsApp
```

### First-time setup:
1. Open `http://localhost:5000/api/whatsapp/qr` in your browser
2. Copy the base64 QR data-URL and paste in browser address bar, OR use the frontend to display it
3. Scan the QR code with WhatsApp on your phone
4. Once connected, the status will change to `ready`

---

## 📡 API Endpoints Reference

### `GET /api/whatsapp/status`
Returns current connection status and queue info.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ready",
    "connectionInfo": {
      "pushName": "Nexarats POS",
      "phoneNumber": "919876543210",
      "platform": "android"
    },
    "queueLength": 0,
    "reconnectAttempts": 0,
    "uptime": 3600
  }
}
```

---

### `GET /api/whatsapp/qr`
Returns the latest QR code as a base64 data-URL image.

**Response:**
```json
{
  "success": true,
  "qr": "data:image/png;base64,iVBOR..."
}
```

**Usage in frontend (React example):**
```jsx
const [qr, setQr] = useState(null);

useEffect(() => {
  const poll = setInterval(async () => {
    const res = await fetch('/api/whatsapp/qr');
    const data = await res.json();
    if (data.qr) setQr(data.qr);
    if (data.message === 'Already connected') clearInterval(poll);
  }, 3000);
  return () => clearInterval(poll);
}, []);

return qr ? <img src={qr} alt="WhatsApp QR" /> : <p>Loading QR...</p>;
```

---

### `POST /api/whatsapp/pair`
Request a pairing code for phone-number linking (alternative to QR scan).

**Body:**
```json
{
  "phoneNumber": "919876543210"
}
```

**Response:**
```json
{
  "success": true,
  "pairingCode": "ABCD-EFGH"
}
```

---

### `POST /api/whatsapp/send`
Send a single message (queued with rate-limiting).

**Body — Text Message:**
```json
{
  "to": "919876543210",
  "type": "text",
  "content": "Hello from Nexarats POS! Your order is ready.",
  "metadata": { "orderId": "ORD-001" }
}
```

**Body — Image:**
```json
{
  "to": "919876543210",
  "type": "image",
  "content": "Here is your product photo",
  "mediaUrl": "https://example.com/product.jpg"
}
```

**Body — Document (PDF):**
```json
{
  "to": "919876543210",
  "type": "document",
  "content": "Your invoice is attached",
  "mediaUrl": "/path/to/invoice.pdf",
  "mediaFilename": "Invoice-001.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message queued",
  "data": { "id": "65a...", "status": "queued" }
}
```

---

### `POST /api/whatsapp/send-receipt`
Send a beautifully formatted POS receipt.

**Body:**
```json
{
  "to": "919876543210",
  "receipt": {
    "storeName": "Nexarats Store",
    "invoiceNo": "INV-2026-001",
    "date": "24/02/2026",
    "items": [
      { "name": "Product A", "qty": 2, "price": 500, "amount": 1000 },
      { "name": "Product B", "qty": 1, "price": 300, "amount": 300 }
    ],
    "subtotal": 1300,
    "discount": 100,
    "tax": 72,
    "total": 1272,
    "footer": "Visit again! www.nexarats.com"
  }
}
```

**Formatted output on WhatsApp:**
```
🧾 *Nexarats Store*
──────────────────────────────
📋 Invoice: *INV-2026-001*
📅 Date: 24/02/2026
──────────────────────────────
1. Product A
   2 × ₹500  =  ₹1000
2. Product B
   1 × ₹300  =  ₹300
──────────────────────────────
  Subtotal: ₹1300
  Discount: -₹100
  Tax:      ₹72
  *TOTAL:   ₹1272*
──────────────────────────────
Visit again! www.nexarats.com
_Thank you for your purchase!_ 🙏
```

---

### `POST /api/whatsapp/send-bulk`
Send up to 50 messages in one request (rate-limited with 5s gaps).

**Body:**
```json
{
  "messages": [
    { "to": "919876543210", "type": "text", "content": "Hello Customer 1" },
    { "to": "911234567890", "type": "text", "content": "Hello Customer 2" }
  ]
}
```

---

### `GET /api/whatsapp/messages`
Query message history with pagination and filters.

**Query params:** `page`, `limit`, `status` (queued|sending|sent|failed), `to`

```
GET /api/whatsapp/messages?page=1&limit=20&status=failed
```

---

### `POST /api/whatsapp/logout`
Logout the current session and destroy cached auth.

---

### `POST /api/whatsapp/restart`
Restart the WhatsApp client (useful after errors).

---

## 🔌 Programmatic Usage (from other modules)

You can send messages from **anywhere** in your backend without using HTTP:

```javascript
import { whatsapp } from './whatsapp/index.js';

// In your transaction controller:
export const createTransaction = async (req, res) => {
  // ... save transaction ...

  // Send receipt via WhatsApp
  if (customer.phone) {
    await whatsapp.queueReceipt(customer.phone, receiptText, {
      invoiceNo: transaction.invoiceNo,
    });
  }
};

// In your order controller:
export const updateOrderStatus = async (req, res) => {
  // ... update order ...

  await whatsapp.queueText(
    customer.phone,
    `🛍️ Your order #${order.id} is now *${order.status}*!`
  );
};

// Send a document:
await whatsapp.queueDocument(
  '919876543210',
  '/path/to/report.pdf',
  'Monthly-Report.pdf',
  'Please find attached the monthly report.'
);
```

---

## 🔒 Security & API Key

When `WA_API_KEY` is set in `.env`, all WhatsApp endpoints require the key:

```bash
# Via header
curl -H "x-api-key: YOUR_KEY" http://localhost:5000/api/whatsapp/status

# Via query param
curl http://localhost:5000/api/whatsapp/status?apiKey=YOUR_KEY
```

For frontend calls, include the header:
```javascript
fetch('/api/whatsapp/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_KEY',   // Only if WA_API_KEY is set
  },
  body: JSON.stringify({ to: '919876543210', content: 'Hello!' }),
});
```

---

## 🛠️ Troubleshooting Guide

| Issue | Cause | Fix |
|-------|-------|-----|
| **QR not appearing** | Puppeteer/Chromium not installed | Run `npx puppeteer browsers install chrome` |
| **Session lost after restart** | `.wwebjs_auth/` deleted or corrupted | Delete the folder and re-scan QR |
| **"Client not ready"** | Client still initialising or disconnected | Check `/api/whatsapp/status`, wait or restart |
| **Messages stuck in "queued"** | Queue processing paused (client disconnected) | Reconnect client — queue resumes automatically |
| **Rate limit / ban** | Sending too many messages too fast | Increase `minDelay` in `messageQueue.js` (default 3s) |
| **Auth failure loops** | Corrupt session data | Delete `.wwebjs_auth/` folder and restart |
| **Chromium crash** | Insufficient system resources | Add `--disable-gpu`, `--single-process` flags (already configured) |
| **ECONNREFUSED** | Server not running | Ensure `npm run dev` is active on port 5000 |

### Log Files
Daily logs are written to `mongodb-service/logs/whatsapp-YYYY-MM-DD.log`. Check these for detailed debugging information.

---

## ✅ Production Best Practices

1. **Set `WA_API_KEY`** — Never leave endpoints unprotected in production
2. **Use `pm2`** to keep the service alive:
   ```bash
   npm install -g pm2
   pm2 start server.js --name nexarats-backend
   pm2 save
   pm2 startup
   ```
3. **Dedicated WhatsApp number** — Use a separate business number, not your personal one
4. **Monitor the `/status` endpoint** — Set up health checks (e.g., UptimeRobot)
5. **Backup `.wwebjs_auth/`** — In case of server migration, copy this folder to preserve the session
6. **Rate limiting** — The built-in 3s delay is conservative. Adjust based on your volume
7. **Add `.wwebjs_auth/` and `logs/` to `.gitignore`**
8. **Set up MongoDB indexes** — Already done in the schema for `MessageLog`
9. **Rotate log files** — The logger creates daily files; set up cleanup for old logs
10. **Test on a staging number first** — Before going live, test with a non-critical number

---

## 📂 File Structure

```
whatsapp-service/
├── .env                          # Environment variables
├── .wwebjs_auth/                 # WhatsApp session data (auto-created)
├── logs/                         # Daily log files (auto-created)
├── supabase.js                   # Supabase client configuration
├── models/
│   └── WhatsAppSession.js        # Supabase models
├── routes/
│   └── whatsapp.js               # REST API endpoints
├── whatsapp/
│   ├── index.js                  # Public barrel (exports singleton + routes)
│   ├── clientManager.js          # Core client manager (singleton)
│   ├── messageQueue.js           # Rate-limited message queue
│   └── logger.js                 # Structured logger
└── server.js                     # Express server (WhatsApp auto-starts)
```

---

## 🔄 Connection Lifecycle

```
Server Start → Supabase Connect → WhatsApp Initialize
                                       │
                              ┌────────▼────────┐
                              │  Generate QR     │
                              │  (or load saved  │
                              │   session)       │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Authenticated   │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │    READY ✅      │◀── Queue starts processing
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Disconnected    │──▶ Auto-reconnect
                              │  (network/error) │    (exponential backoff)
                              └─────────────────┘
```
