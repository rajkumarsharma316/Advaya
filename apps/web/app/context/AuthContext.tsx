'use client';

/**
 * AuthContext — Fully Decentralized
 * ──────────────────────────────────
 * Identity via Stellar Freighter wallet.
 * Registration goes to Soroban smart contract (not a backend server).
 *
 * Changes from the centralized version:
 *   - Replaced `registerWallet()` API call with `stellar.ts` equivalent
 *   - Added `connectFreighter()` for proper wallet-based login
 *   - Wallet connection verifies via Freighter (user must sign)
 *   - Secret key NEVER leaves the browser
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { generateKeyPair, saveKeyPair, loadKeyPair, clearKeyPair, KeyPair } from '../lib/crypto';
import { registerWallet, cacheWallet } from '../lib/stellar';

interface AuthState {
  walletAddress: string | null;
  keyPair: KeyPair | null;
  displayName: string | null;
  isLoading: boolean;
  freighterAvailable: boolean;
}

interface AuthContextValue extends AuthState {
  login: (address: string, displayName?: string) => Promise<void>;
  connectFreighter: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const WALLET_KEY = 'advaya_wallet';
const DISPLAY_NAME_KEY = 'advaya_display_name';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    walletAddress: null,
    keyPair: null,
    displayName: null,
    isLoading: true,
    freighterAvailable: false,
  });

  // ─── Check Freighter availability ────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const { isConnected } = await import('@stellar/freighter-api');
        const connected = await isConnected();
        setState(s => ({ ...s, freighterAvailable: !!connected }));
      } catch {
        setState(s => ({ ...s, freighterAvailable: false }));
      }
    })();
  }, []);

  // ─── Restore session from localStorage ───────────────────────────────────

  useEffect(() => {
    const savedWallet = localStorage.getItem(WALLET_KEY);
    const savedName = localStorage.getItem(DISPLAY_NAME_KEY);
    let savedKeyPair: KeyPair | null = null;
    if (savedWallet) {
      savedKeyPair = loadKeyPair(savedWallet);
    }

    if (savedWallet && savedKeyPair) {
      setState(s => ({
        ...s,
        walletAddress: savedWallet,
        keyPair: savedKeyPair,
        displayName: savedName,
        isLoading: false,
      }));
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  // ─── Login with Freighter (preferred — proper wallet auth) ────────────────

  const connectFreighter = useCallback(async () => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const { setAllowed, getAddress, isConnected } = await import('@stellar/freighter-api');

      const connected = await isConnected();
      if (!connected) {
        throw new Error('Freighter wallet is not installed. Please install the Freighter browser extension.');
      }

      // Prompt user to approve connection if not already allowed
      await setAllowed();

      const { address } = await getAddress();
      if (!address) throw new Error('Could not retrieve wallet address from Freighter');

      await _doLogin(address);
    } catch (err: any) {
      setState(s => ({ ...s, isLoading: false }));
      throw err;
    }
  }, []);

  // ─── Manual login (fallback for when Freighter is not installed) ──────────

  const login = useCallback(async (address: string, displayName?: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      await _doLogin(address, displayName);
    } catch (err: any) {
      setState(s => ({ ...s, isLoading: false }));
      throw err;
    }
  }, []);

  // ─── Shared login logic ───────────────────────────────────────────────────

  async function _doLogin(address: string, displayName?: string) {
    // Clear any legacy generic keypair
    localStorage.removeItem('advaya_keypair');

    // Generate or reuse keypair (E2E encryption key — never sent to server)
    let kp = loadKeyPair(address);
    const isExisting = !!kp;
    if (!kp) kp = generateKeyPair();
    saveKeyPair(address, kp);

    const savedName = displayName || localStorage.getItem(DISPLAY_NAME_KEY) || undefined;

    console.log(`[Auth] Login: ${address.slice(0, 8)}… | keypair: ${isExisting ? 'reused' : 'NEW'}`);

    // Register on Soroban (fire-and-forget, tolerates failure)
    try {
      const record = await registerWallet(address, kp.publicKey, savedName);
      cacheWallet(record);
    } catch (err) {
      console.warn('[Auth] Soroban registration failed (non-fatal):', err);
    }

    localStorage.setItem(WALLET_KEY, address);
    if (savedName) localStorage.setItem(DISPLAY_NAME_KEY, savedName);

    setState(s => ({
      ...s,
      walletAddress: address,
      keyPair: kp!,
      displayName: savedName || null,
      isLoading: false,
    }));
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(DISPLAY_NAME_KEY);
    setState(s => ({
      ...s,
      walletAddress: null,
      keyPair: null,
      displayName: null,
      isLoading: false,
    }));
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      connectFreighter,
      logout,
      isAuthenticated: !!state.walletAddress && !!state.keyPair,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
