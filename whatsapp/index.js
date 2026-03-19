/**
 * WhatsApp Service — public barrel file
 *
 * Usage from anywhere in the backend:
 *
 *   import { whatsapp } from './whatsapp/index.js';
 *
 *   // Send a text
 *   await whatsapp.queueText('919876543210', 'Hello from POS!');
 *
 *   // Send a receipt
 *   await whatsapp.queueReceipt('919876543210', receiptText, { orderId: '123' });
 *
 *   // Send document
 *   await whatsapp.queueDocument('919876543210', '/path/to/invoice.pdf', 'Invoice.pdf', 'Your invoice');
 *
 *   // Check status
 *   const status = whatsapp.getStatus();
 */

import WhatsAppClientManager from './clientManager.js';

// Export singleton for programmatic use
export const whatsapp = WhatsAppClientManager.getInstance();

// Export router for server mounting
export { default as whatsappRoutes } from '../routes/whatsapp.js';

// Boot function — call once after DB is connected
export async function initWhatsApp() {
    await whatsapp.initialize();
}

export default WhatsAppClientManager;
