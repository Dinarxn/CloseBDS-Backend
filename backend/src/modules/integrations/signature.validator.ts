import crypto from 'node:crypto';
import type { WebhookProvider } from './integration.types.js';

export class WebhookSignatureValidator {
  /**
   * Timing-safe verification of webhook signature.
   * If secret is not configured in development, verification passes gracefully.
   */
  static verifySignature(
    _provider: WebhookProvider,
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean {
    // If no secret is configured, accept (graceful unconfigured state for testing)
    if (!secret || secret.trim().length === 0) {
      return true;
    }

    if (!signatureHeader || signatureHeader.trim().length === 0) {
      return false;
    }

    try {
      const payloadString = Buffer.isBuffer(rawPayload)
        ? rawPayload.toString('utf-8')
        : typeof rawPayload === 'string'
        ? rawPayload
        : JSON.stringify(rawPayload);

      const hmac = crypto.createHmac('sha256', secret);
      const computedSignature = hmac.update(payloadString).digest('hex');

      const cleanHeader = signatureHeader.replace(/^sha256=/, '').trim();

      const computedBuffer = Buffer.from(computedSignature, 'hex');
      const receivedBuffer = Buffer.from(cleanHeader, 'hex');

      if (computedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
    } catch {
      return false;
    }
  }
}
