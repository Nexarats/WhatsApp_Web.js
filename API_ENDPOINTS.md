# 📄 WhatsApp API Microservice - Complete API Reference
**Base Path:** `/api`  
**Interactive Docs:** `/docs`  

---

## 🚀 The Unified Gateway
This microservice uses a **Single Endpoint Architecture**. You can access every function using either a `POST` request (for production) or a `GET` request (for quick browser testing).

**Primary Endpoint:** `http://localhost:5000/api/whatsapp`  

---

## 🛠️ Action Reference (GET / URL Examples)
You can call these URLs directly in your browser or via any simple GET request.

| Action | Example Browser URL (GET) |
| :--- | :--- |
| **Start** | `http://localhost:5000/api/whatsapp?action=start` |
| **Status** | `http://localhost:5000/api/whatsapp?action=status` |
| **QR Code** | `http://localhost:5000/api/whatsapp?action=qr` |
| **Pair Code** | `http://localhost:5000/api/whatsapp?action=pair&phone=919000000000` |
| **Send Msg** | `http://localhost:5000/api/whatsapp?action=send&phone=919000000000&message=Hello` |
| **Messages** | `http://localhost:5000/api/whatsapp?action=messages&phone=919000000000&limit=10` |
| **Logout** | `http://localhost:5000/api/whatsapp?action=logout` |
| **Restart** | `http://localhost:5000/api/whatsapp?action=restart` |
| **Clear All** | `http://localhost:5000/api/whatsapp?action=clear-all` |

---

## 🛠️ Multi-User Examples (GET)
To use a specific session (e.g., `userA`), simply add the `sessionId` parameter to the URL.

- **Start Session A:** `http://localhost:5000/api/whatsapp?action=start&sessionId=userA`
- **Status Session A:** `http://localhost:5000/api/whatsapp?action=status&sessionId=userA`
- **Send Msg from A:** `http://localhost:5000/api/whatsapp?action=send&sessionId=userA&phone=919000000000&message=Hi`

---

## 📦 Functional Payloads (JSON / POST)
While GET is convenient for testing, **POST** with a JSON body is recommended for production.

### 1. Send Media/Receipt (Base64)
**Action:** `send-receipt`  
```json
{
  "action": "send-receipt",
  "sessionId": "default",
  "phone": "919000000000",
  "base64Data": "JVBERi0xLjQK...",
  "mimetype": "application/pdf",
  "filename": "invoice.pdf"
}
```

### 2. Send Bulk Messages
**Action:** `send-bulk`  
```json
{
  "action": "send-bulk",
  "messages": [
    { "phone": "1234567890", "message": "Hi A" },
    { "phone": "0987654321", "message": "Hi B" }
  ]
}
```

---

## 🧭 Utility Endpoints

- **Root Info:** `http://localhost:5000/`
- **Health Check:** `http://localhost:5000/health`
- **Interactive Documentation UI:** `http://localhost:5000/docs`

---
**End of API List**  
**Location:** `API_ENDPOINTS.md`
