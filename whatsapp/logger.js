import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Log directory ───────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const getLogFile = () => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(LOG_DIR, `whatsapp-${date}.log`);
};

// ─── ANSI colors ─────────────────────────────────────────────────────────────
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

const LEVEL_CONFIG = {
    info: { color: COLORS.cyan, icon: '📱' },
    warn: { color: COLORS.yellow, icon: '⚠️' },
    error: { color: COLORS.red, icon: '❌' },
    debug: { color: COLORS.gray, icon: '🔍' },
    success: { color: COLORS.green, icon: '✅' },
};

/**
 * Structured logger for the WhatsApp service.
 */
const logger = {
    _write(level, message, meta = null) {
        const ts = new Date().toISOString();
        const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
        const prefix = `${cfg.color}[${ts}] ${cfg.icon} [WA-${level.toUpperCase()}]${COLORS.reset}`;

        // Console
        const consoleMsg = `${prefix} ${message}`;
        if (level === 'error') {
            console.error(consoleMsg, meta || '');
        } else {
            console.log(consoleMsg, meta ? JSON.stringify(meta) : '');
        }

        // File
        const fileLine = `[${ts}] [${level.toUpperCase()}] ${message}${meta ? ' | ' + JSON.stringify(meta) : ''}\n`;
        fs.appendFileSync(getLogFile(), fileLine);
    },
    info(msg, meta) { this._write('info', msg, meta); },
    warn(msg, meta) { this._write('warn', msg, meta); },
    error(msg, meta) { this._write('error', msg, meta); },
    debug(msg, meta) { this._write('debug', msg, meta); },
    success(msg, meta) { this._write('success', msg, meta); },
};

export default logger;
