/**
 * Advaya Crypto Library
 * Client-side end-to-end encryption using NaCl (tweetnacl)
 * - Key generation: X25519 (Curve25519) key pairs
 * - Encryption: NaCl box (X25519 + XSalsa20-Poly1305)
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Helper to encode UTF-8 string to Uint8Array
function strToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Helper to decode Uint8Array to UTF-8 string
function uint8ToStr(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export interface KeyPair {
  publicKey: string;   // base64
  secretKey: string;   // base64 (never leaves client)
}

/**
 * Generate a new X25519 key pair for encryption
 */
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/**
 * Encrypt a plaintext message for a recipient.
 * Returns { ciphertext, nonce } both as base64 strings.
 */
export function encryptMessage(
  plaintext: string,
  recipientPublicKeyB64: string,
  senderSecretKeyB64: string
): { ciphertext: string; nonce: string } {
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);
  const senderSecKey = decodeBase64(senderSecretKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = strToUint8(plaintext);

  const encrypted = nacl.box(message, nonce, recipientPubKey, senderSecKey);

  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message received from a sender.
 */
export function decryptMessage(
  ciphertextB64: string,
  nonceB64: string,
  senderPublicKeyB64: string,
  recipientSecretKeyB64: string
): string | null {
  try {
    const ciphertext = decodeBase64(ciphertextB64);
    const nonce = decodeBase64(nonceB64);
    const senderPubKey = decodeBase64(senderPublicKeyB64);
    const recipientSecKey = decodeBase64(recipientSecretKeyB64);

    const decrypted = nacl.box.open(ciphertext, nonce, senderPubKey, recipientSecKey);
    if (!decrypted) return null;
    return uint8ToStr(decrypted);
  } catch {
    return null;
  }
}

/**
 * Persist keypair to localStorage (secret key never sent to server)
 */
export function saveKeyPair(kp: KeyPair): void {
  localStorage.setItem('advaya_keypair', JSON.stringify(kp));
}

export function loadKeyPair(): KeyPair | null {
  try {
    const raw = localStorage.getItem('advaya_keypair');
    if (!raw) return null;
    return JSON.parse(raw) as KeyPair;
  } catch {
    return null;
  }
}

export function clearKeyPair(): void {
  localStorage.removeItem('advaya_keypair');
}

/**
 * Generate a short readable name from a wallet address
 */
export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Generate avatar initials from address or display name
 */
export function getAvatarText(name?: string, address?: string): string {
  if (name && name.trim()) return name.trim().slice(0, 2).toUpperCase();
  if (address) return address.slice(1, 3).toUpperCase();
  return '??';
}

/**
 * Generate a deterministic gradient color from a string
 */
export function getAvatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + 40) % 360}, 70%, 65%))`;
}
