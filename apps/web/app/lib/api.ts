/**
 * Advaya API Client
 * Typed HTTP client that injects the wallet address header
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  walletAddress?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (walletAddress) {
    headers['x-wallet-address'] = walletAddress;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed: ${res.status}`);
  }

  return data as T;
}

// ─── Wallet ─────────────────────────────────────────────────────────────────

export interface WalletRecord {
  address: string;
  pub_key: string;
  display_name: string | null;
  registered_at: string;
  last_seen_at?: string;
}

export async function registerWallet(
  address: string,
  pubKey: string,
  displayName?: string
): Promise<{ wallet: WalletRecord }> {
  return request('/api/wallet/register', {
    method: 'POST',
    body: JSON.stringify({ address, pubKey, displayName }),
  });
}

export async function getWallet(address: string): Promise<{ wallet: WalletRecord }> {
  return request(`/api/wallet/${address}`);
}

export async function getMyProfile(walletAddress: string): Promise<{ wallet: WalletRecord }> {
  return request('/api/wallet/me/profile', {}, walletAddress);
}

// ─── Conversations ────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  sender: string;
  receiver: string;
  status: 'pending' | 'approved' | 'rejected';
  request_note: string | null;
  created_at: string;
  updated_at: string;
  sender_pub_key: string;
  sender_name: string | null;
  receiver_pub_key: string;
  receiver_name: string | null;
  message_count: string;
  last_message_at: string | null;
}

export async function getConversations(walletAddress: string): Promise<{ conversations: Conversation[] }> {
  return request('/api/conversations', {}, walletAddress);
}

export async function getConversation(id: number, walletAddress: string): Promise<{ conversation: Conversation }> {
  return request(`/api/conversations/${id}`, {}, walletAddress);
}

export async function createConversation(
  receiverAddress: string,
  requestNote: string | undefined,
  walletAddress: string
): Promise<{ conversation: Conversation }> {
  return request('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ receiverAddress, requestNote }),
  }, walletAddress);
}

export async function approveConversation(id: number, walletAddress: string): Promise<{ conversation: Conversation }> {
  return request(`/api/conversations/${id}/approve`, { method: 'POST' }, walletAddress);
}

export async function rejectConversation(id: number, walletAddress: string): Promise<{ conversation: Conversation }> {
  return request(`/api/conversations/${id}/reject`, { method: 'POST' }, walletAddress);
}

export async function deleteConversation(id: number, walletAddress: string): Promise<{ success: boolean }> {
  return request(`/api/conversations/${id}`, { method: 'DELETE' }, walletAddress);
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface Message {
  id: number;
  conversation_id: number;
  sender: string;
  ciphertext: string;
  nonce: string;
  message_type: 'text' | 'file' | 'image';
  read_once: boolean;
  sent_at: string;
  expires_at: string | null;
  read_at: string | null;
  // File/image metadata (populated from decrypted ciphertext payload)
  file_id?: string;
  file_name?: string;
  file_size?: number;
  file_nonce?: string;
}

export async function getMessages(
  conversationId: number,
  walletAddress: string,
  params?: { before?: number; limit?: number }
): Promise<{ messages: Message[] }> {
  const qs = new URLSearchParams();
  if (params?.before) qs.set('before', String(params.before));
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs}` : '';
  return request(`/api/messages/${conversationId}${query}`, {}, walletAddress);
}

export async function sendMessage(
  payload: {
    conversationId: number;
    ciphertext: string;
    nonce: string;
    messageType?: 'text' | 'file' | 'image';
    readOnce?: boolean;
    expiresInSeconds?: number;
  },
  walletAddress: string
): Promise<{ message: Message }> {
  return request('/api/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, walletAddress);
}

export async function deleteMessage(id: number, walletAddress: string): Promise<{ deleted: boolean }> {
  return request(`/api/messages/${id}`, { method: 'DELETE' }, walletAddress);
}

// ─── Files ──────────────────────────────────────────────────────────────────

/**
 * Upload an encrypted file blob to the server.
 * Uses multipart/form-data (not JSON).
 */
export async function uploadEncryptedFile(
  file: Blob,
  conversationId: number,
  originalName: string,
  mimeType: string,
  fileSize: number,
  walletAddress: string
): Promise<{ fileId: string; originalName: string; mimeType: string; fileSize: number }> {
  const formData = new FormData();
  formData.append('file', file, 'encrypted.enc');
  formData.append('conversationId', String(conversationId));
  formData.append('originalName', originalName);
  formData.append('mimeType', mimeType);
  formData.append('fileSize', String(fileSize));

  const headers: Record<string, string> = {};
  if (walletAddress) {
    headers['x-wallet-address'] = walletAddress;
  }
  // Do NOT set Content-Type — browser will set it with boundary for FormData

  const res = await fetch(`${API_BASE}/api/files/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Upload failed: ${res.status}`);
  }
  return data;
}

/**
 * Download the encrypted file blob from the server.
 * Returns raw ArrayBuffer for client-side decryption.
 */
export async function downloadEncryptedFile(
  fileId: string,
  walletAddress: string
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {};
  if (walletAddress) {
    headers['x-wallet-address'] = walletAddress;
  }

  const res = await fetch(`${API_BASE}/api/files/${fileId}`, {
    headers,
  });

  if (!res.ok) {
    throw new ApiError(res.status, `File download failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * Get the URL for downloading an encrypted file.
 */
export function getFileUrl(fileId: string): string {
  return `${API_BASE}/api/files/${fileId}`;
}

export { ApiError };
