#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_create_and_approve_conversation() {
    let env = Env::default();
    env.mock_all_auths(); // Mock authorizations so require_auth() passes

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    
    // 1. Create Conversation
    let conv_id = String::from_str(&env, "G_SENDER_TO_RECEIVER");
    let note = String::from_str(&env, "Hello world");
    
    super::create_conversation(env.clone(), conv_id.clone(), sender.clone(), receiver.clone(), note.clone());

    // Verify it exists in user's conversations
    let sender_convs = super::get_user_conversations(env.clone(), sender.clone());
    assert_eq!(sender_convs.len(), 1);
    assert_eq!(sender_convs.get(0).unwrap(), conv_id);

    // Verify initial state is Pending
    let record1 = super::get_conversation(env.clone(), conv_id.clone());
    assert_eq!(record1.sender, sender);
    assert_eq!(record1.receiver, receiver);
    assert_eq!(record1.status, ConversationStatus::Pending);
    
    // 2. Approve Conversation
    super::approve_conversation(env.clone(), conv_id.clone(), receiver.clone());
    
    // Verify state changed to Approved
    let record2 = super::get_conversation(env.clone(), conv_id.clone());
    assert_eq!(record2.status, ConversationStatus::Approved);
}

#[test]
#[should_panic(expected = "Conversation not found")]
fn test_approve_nonexistent_conversation() {
    let env = Env::default();
    env.mock_all_auths();
    
    let receiver = Address::generate(&env);
    let fake_id = String::from_str(&env, "NON_EXISTENT");
    
    super::approve_conversation(env.clone(), fake_id, receiver);
}
