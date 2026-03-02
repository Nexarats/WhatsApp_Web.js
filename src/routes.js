const express = require("express");
const { MessageMedia } = require("whatsapp-web.js");
const SessionManager = require("./sessionManager");

const router = express.Router();

function formatPhone(phone) {
    let finalNumber = String(phone).replace(/\D/g, "");
    if (!finalNumber.startsWith("91") && finalNumber.length === 10) {
        finalNumber = "91" + finalNumber;
    }
    return finalNumber + "@c.us";
}

// 🎉 SINGLE ENDPOINT RPC ROUTER
router.all("/whatsapp", async (req, res) => {
    // Determine action and sessionId from either the payload root, a 'data' object, or URL query
    const action = req.body?.action || req.query?.action;
    const sessionId = req.body?.sessionId || req.query?.sessionId || "default";

    if (!action) {
        return res.status(400).json({ error: "Missing 'action' parameter explicitly. (E.g. { \"action\": \"start\" })" });
    }

    // 0. Emergency wipe (does not depend on session)
    if (action === "clear-all") {
        try {
            await SessionManager.clearAllSessions();
            return res.json({ success: true, message: "All sessions and entire Whatsapp auth cache safely wiped out." });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // Grab or create session conditionally
    let session = SessionManager.getSession(sessionId);

    try {
        switch (action) {
            case "start":
                if (session) {
                    return res.json({ success: true, message: `Session ${sessionId} is already active`, status: session.status });
                }
                await SessionManager.createSession(sessionId);
                return res.json({ success: true, message: `Session ${sessionId} initializing...` });

            case "status":
                if (!session) return res.status(404).json({ error: "Session not found. Calling 'start' action first." });
                return res.json({
                    sessionId: session.id,
                    ready: session.ready,
                    status: session.status,
                });

            case "qr":
                if (!session) return res.status(404).json({ error: "Session not found." });
                return res.json({
                    sessionId: session.id,
                    qrDataUrl: session.qr,
                    hasQr: !!session.qr,
                    ready: session.ready,
                    status: session.status
                });

            case "send":
                if (!session) return res.status(404).json({ error: "Session not found." });
                if (!session.ready) return res.status(503).json({ error: "WhatsApp not connected" });

                var phone = req.body?.phone || req.query?.phone || req.body?.data?.phone;
                var message = req.body?.message || req.query?.message || req.body?.data?.message;

                if (!phone || !message) return res.status(400).json({ error: "Missing phone or message parameter" });

                var targetNumber = formatPhone(phone);
                var isRegistered = await session.client.isRegisteredUser(targetNumber);

                if (!isRegistered) {
                    return res.status(400).json({ error: "Number not registered on WhatsApp" });
                }

                var response = await session.client.sendMessage(targetNumber, message);
                return res.json({ success: true, messageId: response.id._serialized });

            case "send-receipt":
                if (!session) return res.status(404).json({ error: "Session not found." });
                if (!session.ready) return res.status(503).json({ error: "WhatsApp not connected" });

                var base64Data = req.body?.base64Data || req.query?.base64Data || req.body?.data?.base64Data;
                var phoneR = req.body?.phone || req.query?.phone || req.body?.data?.phone;
                var mimetype = req.body?.mimetype || req.query?.mimetype || req.body?.data?.mimetype;
                var filename = req.body?.filename || req.query?.filename || req.body?.data?.filename;
                var caption = req.body?.caption || req.query?.caption || req.body?.data?.caption;

                if (!phoneR || !base64Data) {
                    return res.status(400).json({ error: "Missing phone or base64Data parameter" });
                }

                var tNumber = formatPhone(phoneR);
                var isRegR = await session.client.isRegisteredUser(tNumber);
                if (!isRegR) return res.status(400).json({ error: "Number not registered on WhatsApp" });

                var pureBase64 = base64Data.includes("base64,") ? base64Data.split("base64,")[1] : base64Data;
                var mt = mimetype || "application/pdf";
                var fn = filename || "receipt.pdf";

                var media = new MessageMedia(mt, pureBase64, fn);
                var sendOptions = caption ? { caption } : {};

                var responseR = await session.client.sendMessage(tNumber, media, sendOptions);
                return res.json({ success: true, messageId: responseR.id._serialized });

            case "send-bulk":
                if (!session) return res.status(404).json({ error: "Session not found." });
                if (!session.ready) return res.status(503).json({ error: "WhatsApp not connected" });

                var messages = req.body?.messages || req.query?.messages || req.body?.data?.messages;
                // If provided via query, it might be a JSON string
                if (typeof messages === 'string') {
                    try { messages = JSON.parse(messages); } catch (e) { }
                }

                if (!Array.isArray(messages) || messages.length === 0) {
                    return res.status(400).json({ error: "Messages array is required" });
                }

                res.json({ success: true, status: "Processing in background", total: messages.length });

                var sClient = session.client;
                (async () => {
                    for (const item of messages) {
                        try {
                            if (!item.phone || !item.message) continue;
                            const tn = formatPhone(item.phone);

                            const randomDelay = Math.floor(Math.random() * 3000) + 2000;
                            await new Promise(resolve => setTimeout(resolve, randomDelay));

                            const isReg = await sClient.isRegisteredUser(tn);
                            if (isReg) {
                                await sClient.sendMessage(tn, item.message);
                            }
                        } catch (err) { }
                    }
                })();
                return;

            case "messages":
                if (!session) return res.status(404).json({ error: "Session not found." });
                if (!session.ready) return res.status(503).json({ error: "WhatsApp not connected" });

                var chatPhone = req.body?.phone || req.query?.phone || req.body?.data?.phone;
                var fetchLimit = parseInt(req.body?.limit || req.query?.limit || req.body?.data?.limit) || 20;

                if (!chatPhone) return res.status(400).json({ error: "Phone number parameter is required" });

                var targetChatPhone = formatPhone(chatPhone);
                var chat = await session.client.getChatById(targetChatPhone);

                var chatMessages = await chat.fetchMessages({ limit: fetchLimit });

                var cleanedMessages = chatMessages.map(m => ({
                    id: m.id._serialized,
                    body: m.body,
                    fromMe: m.fromMe,
                    type: m.type,
                    timestamp: m.timestamp,
                    hasMedia: m.hasMedia
                }));

                return res.json({ success: true, messages: cleanedMessages });

            case "pair":
                if (!session) return res.status(404).json({ error: "Session not found. Call 'start' first." });
                var pPhone = req.body?.phone || req.query?.phone || req.body?.data?.phone;
                if (!pPhone) return res.status(400).json({ error: "Phone number parameter is required" });

                if (session.ready) {
                    return res.status(400).json({ error: "WhatsApp is already connected." });
                }
                var code = await session.client.requestPairingCode(String(pPhone).replace(/\D/g, ""));
                return res.json({ success: true, pairingCode: code });

            case "logout":
                if (!session) return res.status(404).json({ error: "Session not found." });
                await SessionManager.deleteSession(sessionId);
                return res.json({ success: true, message: `Session ${sessionId} logged out and completely deleted.` });

            case "restart":
                if (!session) return res.status(404).json({ error: "Session not found." });
                res.json({ success: true, message: `Restarting session ${sessionId}...` });
                setTimeout(async () => {
                    await SessionManager.deleteSession(sessionId);
                    SessionManager.createSession(sessionId);
                }, 1000);
                return;

            default:
                return res.status(400).json({ error: `Unknown action: '${action}'` });
        }
    } catch (error) {
        console.error(`[${sessionId}] ACTION ERROR (${action}):`, error);
        return res.status(500).json({ error: error.message });
    }
});

// 🧭 CATCH-ALL FOR OLD ENDPOINTS (Graceful guidance)
router.use("/", (req, res) => {
    // This will catch any route starting with /whatsapp that wasn't exactly /whatsapp (which is handled above)
    // or any other route mounted on this router.
    const attemptedPath = req.path;
    res.status(404).json({
        error: "Endpoint Not Found",
        message: `The path '${attemptedPath}' is not recognized.`,
        instruction: "This API now uses a Unified Gateway. Send a POST request to '/api/whatsapp' with an 'action' property in the JSON body.",
        example: {
            url: "/api/whatsapp",
            method: "POST",
            body: {
                action: attemptedPath.split("/")[1] || "status",
                sessionId: "default"
            }
        },
        docs: "/docs"
    });
});

module.exports = router;
