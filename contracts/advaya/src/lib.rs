//! Advaya Soroban Smart Contract
//!
//! Replaces the centralized PostgreSQL database for:
//!   - Wallet registration (name + encryption public key)
//!   - Conversation state  (pending | approved | rejected)
//!
//! Message content is NEVER stored on-chain.
//! Messages are encrypted by the browser and stored on IPFS,
//! then broadcast via Waku P2P. This contract only manages
//! access control and conversation metadata.
//!
//! Deploy with:
//!   stellar contract build
//!   stellar contract deploy --wasm target/wasm32-unknown-unknown/release/advaya.wasm \
//!     --source <DEPLOYER_SECRET_KEY> --network testnet

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    log, symbol_short,
    Address, Bytes, Env, Map, String, Vec,
};

// ─── Data Types ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct WalletRecord {
    pub pub_key: String,
    pub display_name: String,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ConversationStatus {
    Pending,
    Approved,
    Rejected,
}

#[contracttype]
#[derive(Clone)]
pub struct ConversationRecord {
    /// The deterministic ID is stored as the key in the map.
    /// It is computed off-chain as sorted(senderAddr, receiverAddr) joined with ":"
    pub sender: Address,
    pub receiver: Address,
    pub status: ConversationStatus,
    pub request_note: String,
    pub created_at: u64,
    pub updated_at: u64,
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Wallet(Address),
    Conversation(String), // key = deterministic conversationId string
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AdvayaContract;

#[contractimpl]
impl AdvayaContract {

    // ─── Wallet ──────────────────────────────────────────────────────────

    /// Register or update a wallet's public key and optional display name.
    /// Called from the browser after Freighter wallet connection.
    pub fn register(
        env: Env,
        address: Address,
        pub_key: String,
        display_name: String,
    ) {
        address.require_auth();

        let now = env.ledger().timestamp();
        let key = DataKey::Wallet(address.clone());

        let existing: Option<WalletRecord> = env.storage().persistent().get(&key);
        let registered_at = existing.map(|r| r.registered_at).unwrap_or(now);

        let record = WalletRecord {
            pub_key,
            display_name,
            registered_at,
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);

        log!(&env, "Wallet registered: {}", address);
    }

    /// Read a wallet record (pub_key + display_name).
    /// Returns None if not registered.
    pub fn get_wallet(env: Env, address: Address) -> Option<WalletRecord> {
        let key = DataKey::Wallet(address);
        env.storage().persistent().get(&key)
    }

    // ─── Conversations ────────────────────────────────────────────────────

    /// Create a pending conversation request.
    /// The sender must be the caller (auth required).
    /// `conv_id` is the deterministic "<addrA>:<addrB>" string computed client-side.
    pub fn create_conversation(
        env: Env,
        conv_id: String,
        sender: Address,
        receiver: Address,
        request_note: String,
    ) {
        sender.require_auth();

        let key = DataKey::Conversation(conv_id.clone());

        // Fail if conversation already exists
        if env.storage().persistent().has(&key) {
            panic!("Conversation already exists");
        }

        let record = ConversationRecord {
            sender: sender.clone(),
            receiver: receiver.clone(),
            status: ConversationStatus::Pending,
            request_note,
            created_at: env.ledger().timestamp(),
            updated_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);

        log!(&env, "Conversation created: {} → {}", sender, receiver);
    }

    /// Approve a pending conversation request.
    /// Only the receiver can approve.
    pub fn approve_conversation(env: Env, conv_id: String, receiver: Address) {
        receiver.require_auth();

        let key = DataKey::Conversation(conv_id.clone());
        let mut record: ConversationRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("Conversation not found"));

        if record.receiver != receiver {
            panic!("Not the receiver");
        }
        if record.status != ConversationStatus::Pending {
            panic!("Conversation is not pending");
        }

        record.status = ConversationStatus::Approved;
        record.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);

        log!(&env, "Conversation approved: {}", conv_id);
    }

    /// Reject a pending conversation request.
    /// Only the receiver can reject.
    pub fn reject_conversation(env: Env, conv_id: String, receiver: Address) {
        receiver.require_auth();

        let key = DataKey::Conversation(conv_id.clone());
        let mut record: ConversationRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("Conversation not found"));

        if record.receiver != receiver {
            panic!("Not the receiver");
        }

        record.status = ConversationStatus::Rejected;
        record.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);

        log!(&env, "Conversation rejected: {}", conv_id);
    }

    /// Read a conversation record.
    pub fn get_conversation(env: Env, conv_id: String) -> Option<ConversationRecord> {
        let key = DataKey::Conversation(conv_id);
        env.storage().persistent().get(&key)
    }
}
