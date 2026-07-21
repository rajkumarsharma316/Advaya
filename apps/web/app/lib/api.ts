/**
 * @deprecated
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is DEPRECATED as part of the full decentralization of Advaya.
 *
 * All functions in this file previously called a centralized Node.js backend.
 * They have been replaced by:
 *
 *   Wallet & Conversation state → apps/web/app/lib/stellar.ts
 *   Real-time messaging         → apps/web/app/hooks/useWaku.ts (Waku P2P)
 *   File storage                → apps/web/app/lib/ipfs.ts (IPFS + Pinata)
 *
 * This file is intentionally kept as a reference during transition.
 * Do NOT import from this file in any new or updated code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

class DeprecatedError extends Error {
  constructor(fnName: string) {
    super(
      `[Advaya] ${fnName}() is deprecated. ` +
      `Use stellar.ts for conversations/wallets and useWaku.ts for messaging. ` +
      `The centralized backend has been removed.`
    );
    this.name = 'DeprecatedError';
  }
}

// ─── Re-exported types (for backwards compatibility during migration) ─────────

export type { Conversation, WalletRecord } from './stellar';

export interface Message {
  id: string;
  conversation_id: string;
  sender: string;
  ciphertext: string;
  nonce: string;
  message_type: 'text' | 'file' | 'image';
  read_once: boolean;
  sent_at: string;
  expires_at: string | null;
  read_at: string | null;
  ipfs_cid?: string;
  file_id?: string;
  file_name?: string;
  file_size?: number;
  file_nonce?: string;
}

// ─── Deprecated functions — all throw at runtime ─────────────────────────────

/** @deprecated Use stellar.ts registerWallet() */
export async function registerWallet(..._: any[]): Promise<never> {
  throw new DeprecatedError('registerWallet');
}

/** @deprecated Use stellar.ts getWallet() */
export async function getWallet(..._: any[]): Promise<never> {
  throw new DeprecatedError('getWallet');
}

/** @deprecated Use stellar.ts */
export async function getMyProfile(..._: any[]): Promise<never> {
  throw new DeprecatedError('getMyProfile');
}

/** @deprecated Use stellar.ts getConversations() */
export async function getConversations(..._: any[]): Promise<never> {
  throw new DeprecatedError('getConversations');
}

/** @deprecated Use stellar.ts getConversation() */
export async function getConversation(..._: any[]): Promise<never> {
  throw new DeprecatedError('getConversation');
}

/** @deprecated Use stellar.ts createConversation() */
export async function createConversation(..._: any[]): Promise<never> {
  throw new DeprecatedError('createConversation');
}

/** @deprecated Use stellar.ts approveConversation() */
export async function approveConversation(..._: any[]): Promise<never> {
  throw new DeprecatedError('approveConversation');
}

/** @deprecated Use stellar.ts rejectConversation() */
export async function rejectConversation(..._: any[]): Promise<never> {
  throw new DeprecatedError('rejectConversation');
}

/** @deprecated Use stellar.ts deleteConversation() */
export async function deleteConversation(..._: any[]): Promise<never> {
  throw new DeprecatedError('deleteConversation');
}

/** @deprecated Use useWaku + IPFS. Messages go through Waku P2P, no server. */
export async function getMessages(..._: any[]): Promise<never> {
  throw new DeprecatedError('getMessages');
}

/** @deprecated Use useWaku sendChatMessage() */
export async function sendMessage(..._: any[]): Promise<never> {
  throw new DeprecatedError('sendMessage');
}

/** @deprecated Use ipfs.ts uploadToIpfs() */
export async function uploadEncryptedFile(..._: any[]): Promise<never> {
  throw new DeprecatedError('uploadEncryptedFile');
}

/** @deprecated Use ipfs.ts downloadFromIpfs() */
export async function downloadEncryptedFile(..._: any[]): Promise<never> {
  throw new DeprecatedError('downloadEncryptedFile');
}

/** @deprecated Use ipfs.ts ipfsGatewayUrl() */
export function getFileUrl(..._: any[]): string {
  console.warn('[Advaya] getFileUrl() is deprecated. Use ipfsGatewayUrl() from ipfs.ts.');
  return '';
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
