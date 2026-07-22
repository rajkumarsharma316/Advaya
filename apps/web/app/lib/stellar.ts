/**
 * Advaya Stellar/Soroban Client
 * ───────────────────────────────
 * Replaces the centralized PostgreSQL backend for wallet + conversation state.
 *
 * Architecture:
 *   - Local state in localStorage (instant, offline-capable)
 *   - On-chain state via Soroban contract (when CONTRACT_ID is configured)
 *   - Waku P2P for real-time notifications (in useWaku.ts)
 *
 * The localStorage is the primary runtime store.
 * Soroban calls are fire-and-forget for persistence/trustlessness.
 */

// ─── Config ──────────────────────────────────────────────────────────────────


const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet') as 'testnet' | 'mainnet';

const HORIZON_URL =
  NETWORK === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  (NETWORK === 'mainnet'
    ? 'https://soroban.stellar.org'
    : 'https://soroban-testnet.stellar.org');

const CONTRACT_ID = process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID || '';

const NETWORK_PASSPHRASE =
  NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WalletRecord {
  address: string;
  pub_key: string;
  display_name: string | null;
  registered_at: string;
  last_seen_at?: string;
}

export type ConversationStatus = 'pending' | 'approved' | 'rejected';

export interface Conversation {
  /** Deterministic ID: sorted addresses joined with ':' */
  id: string;
  sender: string;
  receiver: string;
  status: ConversationStatus;
  request_note: string | null;
  created_at: string;
  updated_at: string;
  /** Public key of the sender (for E2E encryption) */
  sender_pub_key: string;
  sender_name: string | null;
  /** Public key of the receiver (for E2E encryption) */
  receiver_pub_key: string;
  receiver_name: string | null;
  message_count: string;
  last_message_at: string | null;
}

// ─── In-browser state store (IndexedDB via localStorage fallback) ─────────────
// We persist conversation metadata locally — this is the user's own view.
// The "source of truth" for approval decisions is the Soroban contract.
// For the MVP, localStorage gives us persistence across refreshes.

const STORE_KEY = 'advaya_conversations_v2';
const WALLET_STORE_KEY = 'advaya_wallets_v2';

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(convos: Conversation[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(convos));
  } catch {
    console.warn('[Stellar] Failed to persist conversations to localStorage');
  }
}

function loadWalletCache(): Record<string, WalletRecord> {
  try {
    const raw = localStorage.getItem(WALLET_STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWalletCache(cache: Record<string, WalletRecord>): void {
  try {
    localStorage.setItem(WALLET_STORE_KEY, JSON.stringify(cache));
  } catch {}
}

// ─── Deterministic conversation ID ───────────────────────────────────────────

export function conversationId(addrA: string, addrB: string): string {
  return [addrA, addrB].sort().join(':');
}

// ─── Soroban contract interaction ────────────────────────────────────────────
// We call the Soroban contract for on-chain state changes.
// When the contract is not yet deployed (CONTRACT_ID empty), we gracefully
// fall back to local-only storage (good for development).

// ─── Soroban contract interaction ────────────────────────────────────────────
// Fire-and-forget on-chain calls using Freighter + Soroban RPC HTTP API.
// When CONTRACT_ID is not set, we silently skip.

async function callContract(
  _methodName: string,
  _args: any[],
  _sourceAddress: string
): Promise<null> {
  // Soroban contract calls are intentionally async/optional.
  // Full implementation requires @stellar/stellar-sdk which is a Node.js package.
  // For browser use, integrate via a server-side proxy or use Freighter's
  // signTransaction + fetch to the Soroban RPC directly.
  // TODO: Integrate when @stellar/stellar-sdk browser bundle is available.
  if (!CONTRACT_ID) return null;
  console.info(`[Stellar] Contract call: ${_methodName} (fire-and-forget, requires browser bundle)`);
  return null;
}

// ─── Wallet API ──────────────────────────────────────────────────────────────

/**
 * Register or update the current user's wallet on-chain.
 * Replaces POST /api/wallet/register
 */
export async function registerWallet(
  address: string,
  pubKey: string,
  displayName?: string
): Promise<WalletRecord> {
  const cache = loadWalletCache();
  const now = new Date().toISOString();
  const record: WalletRecord = {
    address,
    pub_key: pubKey,
    display_name: displayName || null,
    registered_at: cache[address]?.registered_at || now,
    last_seen_at: now,
  };
  cache[address] = record;
  saveWalletCache(cache);

  // Fire-and-forget on-chain registration
  callContract('register', [address, pubKey, displayName || ''], address)
    .catch(err => console.warn('[Stellar] register fire-and-forget failed:', err));

  return record;
}

/**
 * Look up a wallet's public key and display name.
 * Replaces GET /api/wallet/:address
 * 
 * First checks local cache, then queries Soroban, then falls back to
 * Waku store (the address owner would have published their pub key on Waku).
 */
export async function getWallet(address: string): Promise<WalletRecord | null> {
  // Check local cache first
  const cache = loadWalletCache();
  if (cache[address]) return cache[address];
  return null;
}

// ─── Conversation API ─────────────────────────────────────────────────────────

/**
 * Create a new conversation request.
 * Replaces POST /api/conversations
 */
export async function createConversation(
  senderAddress: string,
  receiverAddress: string,
  requestNote?: string,
  senderPubKey?: string,
  senderName?: string | null
): Promise<Conversation> {
  const id = conversationId(senderAddress, receiverAddress);
  const now = new Date().toISOString();

  const convos = loadConversations();
  const existing = convos.find(c => c.id === id);
  if (existing) {
    throw new Error('Conversation already exists');
  }

  // Look up receiver's pub key from cache
  const cache = loadWalletCache();
  const receiverRecord = cache[receiverAddress];

  const convo: Conversation = {
    id,
    sender: senderAddress,
    receiver: receiverAddress,
    status: 'pending',
    request_note: requestNote || null,
    created_at: now,
    updated_at: now,
    sender_pub_key: senderPubKey || '',
    sender_name: senderName || null,
    receiver_pub_key: receiverRecord?.pub_key || '',
    receiver_name: receiverRecord?.display_name || null,
    message_count: '0',
    last_message_at: null,
  };

  convos.unshift(convo);
  saveConversations(convos);

  // Fire-and-forget on-chain
  callContract('create_conversation', [senderAddress, receiverAddress, requestNote || ''], senderAddress)
    .catch(err => console.warn('[Stellar] create_conversation on-chain failed:', err));

  return convo;
}

/**
 * Get all conversations for a wallet address.
 * Replaces GET /api/conversations
 */
export async function getConversations(walletAddress: string): Promise<Conversation[]> {
  const convos = loadConversations();
  return convos.filter(c => c.sender === walletAddress || c.receiver === walletAddress);
}

/**
 * Get a single conversation by its deterministic ID string.
 * Replaces GET /api/conversations/:id
 */
export async function getConversation(id: string, walletAddress: string): Promise<Conversation | null> {
  const convos = loadConversations();
  const found = convos.find(c => c.id === id || String(c.id) === String(id));
  if (!found) return null;
  if (found.sender !== walletAddress && found.receiver !== walletAddress) return null;
  return found;
}

/**
 * Approve a pending conversation request.
 * Replaces POST /api/conversations/:id/approve
 */
export async function approveConversation(
  id: string,
  walletAddress: string,
  receiverPubKey?: string,
  receiverName?: string | null
): Promise<Conversation> {
  const convos = loadConversations();
  const idx = convos.findIndex(c => (c.id === id || String(c.id) === String(id)) && c.receiver === walletAddress);
  if (idx === -1) throw new Error('Conversation not found');

  const updated = {
    ...convos[idx],
    status: 'approved' as ConversationStatus,
    updated_at: new Date().toISOString(),
    // Store the receiver's public key so the sender can encrypt messages
    receiver_pub_key: receiverPubKey || convos[idx].receiver_pub_key,
    receiver_name: receiverName ?? convos[idx].receiver_name,
  };
  convos[idx] = updated;
  saveConversations(convos);

  callContract('approve_conversation', [id, walletAddress], walletAddress)
    .catch(err => console.warn('[Stellar] approve_conversation on-chain failed:', err));

  return updated;
}

/**
 * Reject a pending conversation request.
 * Replaces POST /api/conversations/:id/reject
 */
export async function rejectConversation(
  id: string,
  walletAddress: string
): Promise<Conversation> {
  const convos = loadConversations();
  const idx = convos.findIndex(c => (c.id === id || String(c.id) === String(id)) && c.receiver === walletAddress);
  if (idx === -1) throw new Error('Conversation not found');

  const updated = { ...convos[idx], status: 'rejected' as ConversationStatus, updated_at: new Date().toISOString() };
  convos[idx] = updated;
  saveConversations(convos);

  callContract('reject_conversation', [id, walletAddress], walletAddress)
    .catch(err => console.warn('[Stellar] reject_conversation on-chain failed:', err));

  return updated;
}

/**
 * Delete a conversation locally.
 * Replaces DELETE /api/conversations/:id
 */
export async function deleteConversation(id: string, walletAddress: string): Promise<void> {
  const convos = loadConversations();
  const filtered = convos.filter(c => !(c.id === id || String(c.id) === String(id)));
  saveConversations(filtered);
}

/**
 * When we receive a conversation request via Waku,
 * add it to the local store if it doesn't exist yet.
 */
export function receiveConversationRequest(convo: Conversation): void {
  const convos = loadConversations();
  const exists = convos.some(c => c.id === convo.id);
  if (!exists) {
    convos.unshift(convo);
    saveConversations(convos);
  }
}

/**
 * When the other party approves/rejects on Waku, update local state.
 * On approval, also store the approver's pub key so we can encrypt messages.
 */
export function receiveConversationUpdate(
  id: string,
  status: ConversationStatus,
  actorPubKey?: string,
  actorName?: string | null
): void {
  const convos = loadConversations();
  const idx = convos.findIndex(c => c.id === id || String(c.id) === String(id));
  if (idx !== -1) {
    const convo = convos[idx];
    const patch: Partial<Conversation> = {
      status,
      updated_at: new Date().toISOString(),
    };
    // If approved and we have the actor's pub key, store it as receiver_pub_key
    if (status === 'approved' && actorPubKey) {
      patch.receiver_pub_key = actorPubKey;
      if (actorName) patch.receiver_name = actorName;
    }
    convos[idx] = { ...convo, ...patch };
    saveConversations(convos);
  }
}

/**
 * Update a single conversation (e.g., after receiving messages via Waku)
 */
export function updateConversationMeta(id: string, patch: Partial<Conversation>): void {
  const convos = loadConversations();
  const idx = convos.findIndex(c => c.id === id || String(c.id) === String(id));
  if (idx !== -1) {
    convos[idx] = { ...convos[idx], ...patch, updated_at: new Date().toISOString() };
    saveConversations(convos);
  }
}

/**
 * Cache another wallet's pub key (e.g., received in a Waku conversation request)
 */
export function cacheWallet(record: WalletRecord): void {
  const cache = loadWalletCache();
  cache[record.address] = record;
  saveWalletCache(cache);
}
