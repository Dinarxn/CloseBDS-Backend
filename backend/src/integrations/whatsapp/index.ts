/**
 * WhatsApp Service Provider Types & Contract placeholder (Post-MVP Official API)
 */

export interface WhatsAppMessagePayload {
  recipientPhoneNumber: string;
  templateName?: string;
  parameters?: Record<string, string>;
  messageText?: string;
  messageId?: string;
}

export interface WhatsAppSendResult {
  messageId: string;
  providerMessageId?: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

/**
 * WhatsApp Service Provider Abstraction Contract
 * Reserved strictly for official Meta WhatsApp Business Cloud API integration post-MVP.
 */
export interface WhatsAppService {
  sendMessage(payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult>;
}
