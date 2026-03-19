import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import { WhatsAppSession } from '../models/WhatsAppSession.js';
import MessageQueue from './messageQueue.js';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Singleton guard ─────────────────────────────────────────────────────────
let _instance = null;

/**
 * WhatsAppClientManager
 *
 * Responsibilities:
 *  - Initialize & manage the whatsapp-web.js Client instance
 *  - Generate QR codes (base64 data-URL)
 *  - Support phone-number pairing (link with code)
 *  - Persist session via LocalAuth (Chromium profile on disk)
 *  - Auto-reconnect on disconnection
 *  - Expose high-level send helpers (text, media, receipts)
 *  - Thread-safe singleton to prevent duplicate sessions
 */
class WhatsAppClientManager {
    constructor() {
        if (_instance) {
            throw new Error('WhatsAppClientManager is a singleton — use getInstance()');
        }

        this.client = null;
        this.qrCode = null;                // Latest QR as data-URL
        this.pairingCode = null;           // Link-with-phone code
        this.status = 'disconnected';      // disconnected | connecting | qr_ready | authenticated | ready | failed
        this.connectionInfo = {};
        this.messageQueue = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;        // 5 s initial, exponential back-off
        this._reconnectTimer = null;
        this._initLock = false;

        // Session data stored in `whatsapp-service/.wwebjs_auth/`
        this.authDir = path.join(__dirname, '..', '.wwebjs_auth');

        _instance = this;
    }

    static getInstance() {
        if (!_instance) new WhatsAppClientManager();
        return _instance;
    }

    // ─── Initialisation ──────────────────────────────────────────────────────
    async initialize() {
        if (this._initLock) {
            logger.warn('Initialisation already in progress — skipping duplicate call');
            return;
        }
        this._initLock = true;
        this.status = 'connecting';
        this._qrCount = 0; // Reset QR watchdog counter
        await this._updateDbStatus('connecting');

        try {
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: this.authDir,
                }),
                puppeteer: {
                    headless: true,
                    handleSIGINT: false,
                    handleSIGTERM: false,
                    handleSIGHUP: false,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                    ],
                },
            });

            this._bindEvents();
            await this.client.initialize();
            logger.info('WhatsApp client initialising…');
        } catch (err) {
            logger.error('Initialisation failed', { error: err.message });

            // FIX: "Execution context was destroyed" = stale/corrupt saved session on disk.
            // Clearing the auth cache and retrying fresh is the correct recovery.
            const isContextError = err.message?.includes('Execution context was destroyed')
                || err.message?.includes('Session closed')
                || err.message?.includes('Target closed')
                || err.message?.includes('Protocol error');

            if (isContextError && !this._contextClearRetried) {
                this._contextClearRetried = true;
                logger.warn('Stale Puppeteer context — clearing auth cache and restarting fresh…');
                await this._destroyClient();
                await this._clearAuthCache();
                this._initLock = false;
                this.status = 'disconnected';
                await new Promise(r => setTimeout(r, 3000));
                return this.initialize();
            }
            this._contextClearRetried = false;

            // Handle "browser is already running" — kill stale process and retry once
            if (err.message?.includes('already running') && !this._retried) {
                this._retried = true;
                logger.warn('Stale browser detected — force-killing and retrying…');

                const lockPath = path.join(this.authDir, 'session', 'SingletonLock');
                if (fs.existsSync(lockPath)) {
                    try { fs.unlinkSync(lockPath); logger.info('Deleted stale SingletonLock'); }
                    catch (e) { logger.warn('Failed to delete SingletonLock', { error: e.message }); }
                }

                await this._destroyClient();
                this._initLock = false;
                await new Promise(r => setTimeout(r, 2000));
                return this.initialize();
            }
            this._retried = false;

            this.status = 'failed';
            this._initLock = false;
            await this._updateDbStatus('failed');
            this._scheduleReconnect();
        }
    }

    // ─── Helper: safely destroy the Puppeteer client ──────────────────────────
    async _destroyClient() {
        try {
            const browser = this.client?.pupBrowser || this.client?.pupPage?.browser();
            if (browser) await browser.close().catch(() => { });
        } catch (_) { }
        try { if (this.client) await this.client.destroy(); } catch (_) { }
        this.client = null;
    }

    // ─── Helper: clear stale WhatsApp session data from LocalAuth folder ──────
    async _clearAuthCache() {
        const waPaths = [
            path.join(this.authDir, 'session', 'Default', 'Local Storage'),
            path.join(this.authDir, 'session', 'Default', 'IndexedDB'),
            path.join(this.authDir, 'session', 'Default', 'Session Storage'),
            path.join(this.authDir, 'session', 'Default', 'Local Extension Settings'),
            path.join(this.authDir, 'session', 'SingletonLock'),
            path.join(this.authDir, 'session', 'lockfile'),
            path.join(this.authDir, 'session', 'DevToolsActivePort'),
        ];
        for (const p of waPaths) {
            if (fs.existsSync(p)) {
                try {
                    fs.rmSync(p, { recursive: true, force: true });
                    logger.info(`Cleared stale session path: ${path.basename(p)}`);
                } catch (e) {
                    logger.warn(`Could not clear ${path.basename(p)}`, { error: e.message });
                }
            }
        }
        this.qrCode = null;
        this.pairingCode = null;
    }

    // ─── Events ──────────────────────────────────────────────────────────────
    _bindEvents() {
        const c = this.client;

        c.on('qr', async (qr) => {
            this.qrCode = await qrcode.toDataURL(qr);
            this.status = 'qr_ready';
            await this._updateDbStatus('qr_ready');
            this._qrCount = (this._qrCount || 0) + 1;
            logger.info(`QR code generated — scan with WhatsApp (attempt #${this._qrCount})`);

            // Watchdog: if we've generated too many QR codes without auth, the session
            // is likely corrupted. Clear it and restart to break the infinite QR loop.
            if (this._qrCount >= 20 && !this._contextClearRetried) {
                logger.warn(`QR watchdog triggered after ${this._qrCount} codes — clearing stale session and restarting…`);
                this._qrCount = 0;
                this._contextClearRetried = true;
                setTimeout(async () => {
                    await this._destroyClient();
                    await this._clearAuthCache();
                    this._initLock = false;
                    this._contextClearRetried = false;
                    this.status = 'disconnected';
                    await this.initialize();
                }, 2000);
            }
        });

        c.on('authenticated', async () => {
            this.status = 'authenticated';
            this.qrCode = null;
            this.pairingCode = null;
            await this._updateDbStatus('authenticated');
            logger.success('WhatsApp authenticated');
        });

        c.on('auth_failure', async (msg) => {
            this.status = 'failed';
            this._initLock = false;
            await this._updateDbStatus('failed');
            logger.error('Auth failure', { message: msg });
            this._scheduleReconnect();
        });

        c.on('ready', async () => {
            this.status = 'ready';
            this.reconnectAttempts = 0;
            this._initLock = false;

            // Gather connection info
            const info = this.client.info;
            this.connectionInfo = {
                pushName: info?.pushname || 'Unknown',
                phoneNumber: info?.wid?.user || 'Unknown',
                platform: info?.platform || 'Unknown',
            };

            await this._updateDbStatus('ready', {
                pushName: this.connectionInfo.pushName,
                phoneNumber: this.connectionInfo.phoneNumber,
                platform: this.connectionInfo.platform,
                lastConnectedAt: new Date(),
            });

            // Bootstrap message queue
            this.messageQueue = new MessageQueue(this);
            logger.success('WhatsApp is READY', this.connectionInfo);
        });

        c.on('disconnected', async (reason) => {
            this.status = 'disconnected';
            this._initLock = false;
            await this._updateDbStatus('disconnected', { lastDisconnectedAt: new Date() });
            logger.warn('WhatsApp disconnected', { reason });
            this._scheduleReconnect();
        });

        c.on('change_state', (state) => {
            logger.debug('Connection state changed', { state });
            if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'UNPAIRED') {
                this.status = 'disconnected';
                this._initLock = false;
                this._scheduleReconnect();
            }
        });

        c.on('message', (msg) => {
            logger.debug(`Incoming message from ${msg.from}: ${msg.body?.substring(0, 60)}`);
        });
    }

    // ─── Phone-number pairing ────────────────────────────────────────────────
    async requestPairingCode(phoneNumber) {
        if (!this.client) throw new Error('Client not initialised');
        try {
            const code = await this.client.requestPairingCode(phoneNumber, true);
            this.pairingCode = code;
            logger.info(`Pairing code requested for ${phoneNumber}: ${code}`);
            return code;
        } catch (err) {
            logger.error('Pairing code request failed', { error: err.message });
            throw err;
        }
    }

    // ─── Send helpers ────────────────────────────────────────────────────────

    /**
     * Low-level send — called by the queue.
     * `data` shape: { to, type, content, mediaUrl, mediaFilename }
     */
    async sendMessage(data) {
        if (this.status !== 'ready') {
            throw new Error(`Client not ready (status: ${this.status})`);
        }

        const chatId = this._formatNumber(data.to);

        switch (data.type) {
            case 'text':
                return this.client.sendMessage(chatId, data.content);

            case 'image':
            case 'document': {
                let media;
                if (data.mediaUrl && data.mediaUrl.startsWith('http')) {
                    media = await MessageMedia.fromUrl(data.mediaUrl);
                } else if (data.mediaUrl && fs.existsSync(data.mediaUrl)) {
                    media = MessageMedia.fromFilePath(data.mediaUrl);
                } else {
                    throw new Error('Invalid mediaUrl — provide a URL or local file path');
                }
                if (data.mediaFilename) media.filename = data.mediaFilename;
                return this.client.sendMessage(chatId, media, {
                    caption: data.content || '',
                    sendMediaAsDocument: data.type === 'document',
                });
            }

            case 'receipt':
                // Receipts are formatted text
                return this.client.sendMessage(chatId, data.content);

            default:
                return this.client.sendMessage(chatId, data.content || '');
        }
    }

    /** Format phone → WhatsApp JID */
    _formatNumber(phone) {
        let cleaned = String(phone).replace(/[^0-9]/g, '');
        // Auto-prepend India country code for 10-digit numbers
        if (cleaned.length === 10) {
            cleaned = '91' + cleaned;
        }
        if (!cleaned.endsWith('@c.us')) cleaned += '@c.us';
        return cleaned;
    }

    // ─── Queue wrappers (public API) ─────────────────────────────────────────

    async queueText(to, text, metadata = {}) {
        return this.messageQueue.add({ to, type: 'text', content: text, metadata });
    }

    async queueImage(to, imagePathOrUrl, caption = '', metadata = {}) {
        return this.messageQueue.add({
            to,
            type: 'image',
            content: caption,
            mediaUrl: imagePathOrUrl,
            metadata,
        });
    }

    async queueDocument(to, filePath, filename, caption = '', metadata = {}) {
        return this.messageQueue.add({
            to,
            type: 'document',
            content: caption,
            mediaUrl: filePath,
            mediaFilename: filename,
            metadata,
        });
    }

    async queueReceipt(to, receiptText, metadata = {}) {
        return this.messageQueue.add({ to, type: 'receipt', content: receiptText, metadata });
    }

    async queueBulk(messages) {
        return this.messageQueue.addBulk(messages);
    }

    // ─── Check if a number is registered on WhatsApp ─────────────────────────
    async isRegisteredUser(number) {
        if (!this.client || this.status !== 'ready') {
            throw new Error('Client not ready');
        }
        return this.client.isRegisteredUser(number);
    }

    // ─── Direct send (bypass queue, for OTP etc.) ────────────────────────────
    async sendDirect(chatId, message) {
        if (!this.client || this.status !== 'ready') {
            throw new Error('Client not ready');
        }
        return this.client.sendMessage(chatId, message);
    }

    // ─── Connection management ───────────────────────────────────────────────

    async logout() {
        try {
            if (this.client) {
                try {
                    await this.client.logout();
                    logger.info('WhatsApp logged out');
                } catch (e) {
                    logger.warn('Logout skipped (may already be logged out)', { error: e.message });
                }
                try {
                    await this.client.destroy();
                    logger.info('WhatsApp client destroyed');
                } catch (e) {
                    logger.warn('Destroy warning', { error: e.message });
                }
            }
            this.status = 'disconnected';
            this.client = null;
            this.qrCode = null;
            this.pairingCode = null;
            this._initLock = false;

            // Clear stored auth session
            if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true });
                logger.info('Auth session cache cleared');
            }

            await this._updateDbStatus('disconnected');
            logger.success('Logged out and session destroyed');
        } catch (err) {
            logger.error('Logout error', { error: err.message });
            throw err;
        }
    }

    async restart() {
        logger.info('Restarting WhatsApp client…');
        await this._destroyClient();
        this.status = 'disconnected';
        this._initLock = false;
        this._contextClearRetried = false;
        this._qrCount = 0;
        this.reconnectAttempts = 0;
        this.qrCode = null;
        this.pairingCode = null;

        // Small delay to ensure browser process is fully released
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.initialize();
    }

    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached — giving up');
            return;
        }
        clearTimeout(this._reconnectTimer);
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts += 1;
        logger.info(`Scheduling reconnect #${this.reconnectAttempts} in ${delay / 1000}s`);
        this._reconnectTimer = setTimeout(() => this.restart(), delay);
    }

    // ─── Status ──────────────────────────────────────────────────────────────

    getStatus() {
        return {
            status: this.status,
            connectionInfo: this.connectionInfo,
            queueLength: this.messageQueue?.length || 0,
            reconnectAttempts: this.reconnectAttempts,
            uptime: process.uptime(),
        };
    }

    // ─── DB helpers ──────────────────────────────────────────────────────────

    async _updateDbStatus(status, extra = {}) {
        try {
            await WhatsAppSession.findOneAndUpdate(
                { sessionId: 'default' },
                { status, ...extra },
                { upsert: true, new: true },
            );
        } catch (err) {
            logger.error('DB status update failed', { error: err.message });
        }
    }
}

export default WhatsAppClientManager;
