import { MessageLog } from '../models/WhatsAppSession.js';
import logger from './logger.js';

/**
 * In-memory message queue with rate-limiting, retry logic, and DB persistence.
 *
 * Design decisions:
 *  - Min 3 s between messages to stay under WhatsApp soft rate limits
 *  - Max 3 retries per message with exponential back-off
 *  - Queue is drained in FIFO order; processing is serialized so we never
 *    fire multiple sends in parallel (which would trigger spam detection).
 */
class MessageQueue {
    constructor(whatsappClient) {
        this.client = whatsappClient;       // WhatsAppClientManager instance
        this.queue = [];
        this.processing = false;
        this.minDelay = 3000;               // 3 s between messages
        this.maxRetries = 3;
        this.bulkDelay = 5000;              // 5 s between bulk messages
    }

    /**
     * Enqueue a message and start draining if idle.
     * Returns the created MessageLog document.
     */
    async add(messageData) {
        const log = await MessageLog.create({
            to: messageData.to,
            type: messageData.type || 'text',
            content: messageData.content,
            mediaUrl: messageData.mediaUrl || null,
            mediaFilename: messageData.mediaFilename || null,
            status: 'queued',
            metadata: messageData.metadata || {},
        });

        this.queue.push({ logId: log._id, data: messageData, retries: 0 });
        logger.info(`Message queued → ${messageData.to}`, { id: log._id, type: messageData.type });

        if (!this.processing) this._process();
        return log;
    }

    /**
     * Add multiple messages at once (bulk). Returns array of MessageLog docs.
     */
    async addBulk(messages) {
        const logs = [];
        for (const msg of messages) {
            const log = await this.add({ ...msg, _bulk: true });
            logs.push(log);
        }
        return logs;
    }

    /** Internal serial drain loop. */
    async _process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            try {
                await MessageLog.findByIdAndUpdate(item.logId, { status: 'sending' });
                const result = await this.client.sendMessage(item.data);

                await MessageLog.findByIdAndUpdate(item.logId, {
                    status: 'sent',
                    messageId: result?.id?._serialized || null,
                    sentAt: new Date(),
                });
                logger.success(`Message sent → ${item.data.to}`, { id: item.logId });
            } catch (err) {
                item.retries += 1;
                logger.error(`Send failed (attempt ${item.retries}/${this.maxRetries}) → ${item.data.to}`, {
                    error: err.message,
                });

                if (item.retries < this.maxRetries) {
                    this.queue.push(item);                        // Re-enqueue
                    const backoff = this.minDelay * Math.pow(2, item.retries);
                    await this._sleep(backoff);
                } else {
                    await MessageLog.findByIdAndUpdate(item.logId, {
                        status: 'failed',
                        error: err.message,
                        retryCount: item.retries,
                    });
                    logger.error(`Message permanently failed → ${item.data.to}`, { id: item.logId });
                }
            }

            // Rate-limit pause between messages
            const delay = item.data._bulk ? this.bulkDelay : this.minDelay;
            await this._sleep(delay);
        }

        this.processing = false;
    }

    _sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    /** Current queue depth. */
    get length() {
        return this.queue.length;
    }
}

export default MessageQueue;
