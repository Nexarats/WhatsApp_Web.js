import express from 'express';
import WhatsAppClientManager from '../whatsapp/clientManager.js';
import { MessageLog, WhatsAppSession } from '../models/WhatsAppSession.js';
import logger from '../whatsapp/logger.js';

const router = express.Router();

// ─── Helper: get singleton ───────────────────────────────────────────────────
const getClient = () => WhatsAppClientManager.getInstance();

// ─── Middleware: basic API key guard ─────────────────────────────────────────
const apiKeyGuard = (req, res, next) => {
    const apiKey = process.env.WA_API_KEY;
    if (!apiKey) return next();  // No key configured → open (dev mode)

    const provided = req.headers['x-api-key'] || req.query.apiKey;
    if (provided !== apiKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized — invalid API key' });
    }
    next();
};

router.use(apiKeyGuard);

// ─────────────────────────────────────────────────────────────────────────────
// GET /whatsapp/status — Connection status + queue info
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const wa = getClient();
        const dbSession = await WhatsAppSession.findOne({ sessionId: 'default' });
        res.json({
            success: true,
            data: {
                ...wa.getStatus(),
                session: dbSession || null,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /whatsapp/qr — Latest QR code (base64 data-URL)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/qr', (req, res) => {
    try {
        const wa = getClient();
        if (wa.status === 'ready') {
            return res.json({ success: true, message: 'Already connected', qr: null });
        }
        if (!wa.qrCode) {
            return res.json({ success: true, message: 'QR not yet available — client is initialising', qr: null });
        }
        res.json({ success: true, qr: wa.qrCode });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/pair — Request pairing code for phone-number linking
// Body: { phoneNumber: "919876543210" }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pair', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'phoneNumber is required' });
        }
        const wa = getClient();

        if (!wa.client) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client not initialised yet. Please wait and try again.',
            });
        }
        if (wa.status === 'ready') {
            return res.json({ success: true, message: 'Already connected — no pairing needed', pairingCode: null });
        }

        const code = await wa.requestPairingCode(phoneNumber);
        res.json({ success: true, pairingCode: code });
    } catch (err) {
        const message = err.message || '';
        if (message.includes('onCodeReceivedEvent') || message.includes('is not a function')) {
            return res.status(503).json({
                success: false,
                error: 'Phone pairing is not supported in the current whatsapp-web.js version. Please use QR code scanning instead.',
                hint: 'Open WhatsApp → Settings → Linked Devices → Link a Device → Scan the QR code shown above.',
            });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/send — Send a single message (queued)
// Body: { to, type?, content, mediaUrl?, mediaFilename?, metadata? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/send', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { to, type = 'text', content, mediaUrl, mediaFilename, metadata } = req.body;
        if (!to) return res.status(400).json({ success: false, error: '"to" (phone number) is required' });
        if (!content && type === 'text') {
            return res.status(400).json({ success: false, error: '"content" is required for text messages' });
        }

        const log = await wa.messageQueue.add({ to, type, content, mediaUrl, mediaFilename, metadata });
        res.json({ success: true, message: 'Message queued', data: { id: log._id, status: log.status } });
    } catch (err) {
        logger.error('POST /send failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/send-bulk — Send multiple messages
// Body: { messages: [{ to, type?, content, mediaUrl?, mediaFilename?, metadata? }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/send-bulk', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }
        const { messages } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, error: '"messages" array is required' });
        }
        if (messages.length > 50) {
            return res.status(400).json({ success: false, error: 'Max 50 messages per bulk request' });
        }

        const logs = await wa.queueBulk(messages);
        res.json({
            success: true,
            message: `${logs.length} messages queued`,
            data: logs.map((l) => ({ id: l._id, to: l.to, status: l.status })),
        });
    } catch (err) {
        logger.error('POST /send-bulk failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/send-receipt — Send a formatted POS receipt
// Body: { to, receipt: { storeName, invoiceNo, date, items, subtotal, tax, total, footer } }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/send-receipt', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { to, receipt } = req.body;
        if (!to || !receipt) {
            return res.status(400).json({ success: false, error: '"to" and "receipt" are required' });
        }

        const text = _formatReceipt(receipt);
        const log = await wa.queueReceipt(to, text, { invoiceNo: receipt.invoiceNo });
        res.json({ success: true, message: 'Receipt queued', data: { id: log._id } });
    } catch (err) {
        logger.error('POST /send-receipt failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /whatsapp/messages — Message history (paginated)
// Query: page, limit, status, to
// ─────────────────────────────────────────────────────────────────────────────
router.get('/messages', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, to } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (to) filter.to = { $regex: to };

        const total = await MessageLog.countDocuments(filter);
        const messages = await MessageLog.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        res.json({ success: true, data: messages, pagination: { page: Number(page), limit: Number(limit), total } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/logout — Disconnect & clear session, then re-init for new QR
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    try {
        const wa = getClient();
        await wa.logout();
        res.json({ success: true, message: 'Disconnected. Preparing new QR…' });

        setTimeout(() => {
            logger.info('Re-initializing WhatsApp client after logout…');
            wa.restart().catch((err) =>
                logger.error('Post-logout restart failed', { error: err.message }),
            );
        }, 3000);
    } catch (err) {
        const wa = getClient();
        setTimeout(() => wa.restart().catch(() => { }), 3000);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/restart — Restart the client
// ─────────────────────────────────────────────────────────────────────────────
router.post('/restart', async (req, res) => {
    try {
        const wa = getClient();
        wa.restart();  // Intentionally not awaited — runs in background
        res.json({ success: true, message: 'Restart initiated — check /status for progress' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL ENDPOINTS (called by mongodb-service via HTTP)
// ─────────────────────────────────────────────────────────────────────────────

// POST /whatsapp/send-direct — Send a message directly (bypasses queue, for OTP)
// Body: { chatId, message }
router.post('/send-direct', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { chatId, message } = req.body;
        if (!chatId || !message) {
            return res.status(400).json({ success: false, error: '"chatId" and "message" are required' });
        }

        await wa.sendDirect(chatId, message);
        res.json({ success: true, message: 'Message sent directly' });
    } catch (err) {
        logger.error('POST /send-direct failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /whatsapp/is-registered — Check if a number is registered on WhatsApp
// Body: { number: "919876543210@c.us" }
router.post('/is-registered', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { number } = req.body;
        if (!number) {
            return res.status(400).json({ success: false, error: '"number" is required' });
        }

        const isRegistered = await wa.isRegisteredUser(number);
        res.json({ success: true, isRegistered });
    } catch (err) {
        logger.error('POST /is-registered failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /whatsapp/queue-document — Queue a document for sending
// Body: { to, filePath, filename, caption, metadata }
router.post('/queue-document', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { to, filePath, filename, caption, metadata } = req.body;
        if (!to || !filePath || !filename) {
            return res.status(400).json({ success: false, error: '"to", "filePath", and "filename" are required' });
        }

        const log = await wa.queueDocument(to, filePath, filename, caption || '', metadata || {});
        res.json({ success: true, message: 'Document queued', data: { id: log._id } });
    } catch (err) {
        logger.error('POST /queue-document failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /whatsapp/queue-text — Queue a text message
// Body: { to, text, metadata }
router.post('/queue-text', async (req, res) => {
    try {
        const wa = getClient();
        if (wa.status !== 'ready') {
            return res.status(503).json({ success: false, error: `WhatsApp not ready (status: ${wa.status})` });
        }

        const { to, text, metadata } = req.body;
        if (!to || !text) {
            return res.status(400).json({ success: false, error: '"to" and "text" are required' });
        }

        const log = await wa.queueText(to, text, metadata || {});
        res.json({ success: true, message: 'Text queued', data: { id: log._id } });
    } catch (err) {
        logger.error('POST /queue-text failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Utility: receipt formatter ──────────────────────────────────────────────
function _formatReceipt(r) {
    const line = '─'.repeat(30);
    let text = '';
    text += `🧾 *${r.storeName || 'STORE'}*\n`;
    text += `${line}\n`;
    text += `📋 Invoice: *${r.invoiceNo || 'N/A'}*\n`;
    text += `📅 Date: ${r.date || new Date().toLocaleDateString()}\n`;
    text += `${line}\n`;

    if (Array.isArray(r.items)) {
        r.items.forEach((item, i) => {
            text += `${i + 1}. ${item.name}\n`;
            text += `   ${item.qty || 1} × ₹${item.price}  =  ₹${item.amount || (item.qty || 1) * item.price}\n`;
        });
    }

    text += `${line}\n`;
    if (r.subtotal !== undefined) text += `  Subtotal: ₹${r.subtotal}\n`;
    if (r.discount !== undefined) text += `  Discount: -₹${r.discount}\n`;
    if (r.tax !== undefined) text += `  Tax:      ₹${r.tax}\n`;
    text += `  *TOTAL:   ₹${r.total || 0}*\n`;
    text += `${line}\n`;
    if (r.footer) text += `${r.footer}\n`;
    text += `_Thank you for your purchase!_ 🙏`;
    return text;
}

export default router;
