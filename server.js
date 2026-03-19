import dotenv from 'dotenv';

dotenv.config();

import express from 'express';
import cors from 'cors';
import { whatsappRoutes, initWhatsApp } from './whatsapp/index.js';

// ─── Global crash guards ─────────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('\x1b[33m%s\x1b[0m', '⚠️  Unhandled Rejection (server kept alive):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('\x1b[31m%s\x1b[0m', '🔥 Uncaught Exception (server kept alive):', err.message);
    if (err.message?.includes('out of memory') || err.message?.includes('ENOMEM')) {
        process.exit(1);
    }
});

const app = express();
const PORT = process.env.PORT || 5005;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/', (req, res) => {
    res.json({
        status: 'WhatsApp Service is running',
        port: PORT,
        endpoints: [
            '/api/whatsapp/status',
            '/api/whatsapp/qr',
            '/api/whatsapp/pair',
            '/api/whatsapp/send',
            '/api/whatsapp/send-bulk',
            '/api/whatsapp/send-receipt',
            '/api/whatsapp/messages',
            '/api/whatsapp/logout',
            '/api/whatsapp/restart',
        ]
    });
});

// ─── API Key Authentication Middleware (FIX C2) ───────────────────────────────
// Protects all WhatsApp API routes. Set WA_API_KEY in your .env file and
// pass x-api-key header from the main backend when calling this service.
const apiKeyAuth = (req, res, next) => {
    const apiKey = process.env.WA_API_KEY;

    // If WA_API_KEY is not configured, block all access in production
    if (!apiKey) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({ success: false, error: 'WhatsApp service not configured.' });
        }
        // Allow in dev without a key (but warn)
        console.warn('[WA-Auth] WARNING: WA_API_KEY not set — running without auth in dev mode');
        return next();
    }

    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== apiKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API key.' });
    }

    next();
};

// API Routes (auth-protected)
app.use('/api/whatsapp', apiKeyAuth, whatsappRoutes);

const startServer = async () => {
    try {
        // Boot WhatsApp client (no DB needed — uses in-memory stores)
        initWhatsApp().catch(err => console.error('WhatsApp init error:', err.message));

        app.listen(PORT, () => {
            console.log(`\x1b[36m%s\x1b[0m`, `─────────────────────────────────────────────────────`);
            console.log(`\x1b[35m%s\x1b[0m`, `📱 WhatsApp Service running on http://localhost:${PORT}`);
            console.log(`\x1b[33m%s\x1b[0m`, `📋 API Endpoints:`);
            console.log(`   GET  /api/whatsapp/status`);
            console.log(`   GET  /api/whatsapp/qr`);
            console.log(`   POST /api/whatsapp/send`);
            console.log(`   POST /api/whatsapp/logout`);
            console.log(`   POST /api/whatsapp/restart`);
            console.log(`\x1b[36m%s\x1b[0m`, `─────────────────────────────────────────────────────`);
        });
    } catch (err) {
        console.error('❌ Failed to start WhatsApp service:', err.message);
        process.exit(1);
    }
};

export default app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    startServer();
}
