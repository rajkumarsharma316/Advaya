'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { generateKeyPair, saveKeyPair, loadKeyPair, clearKeyPair, KeyPair } from '../lib/crypto';
import { registerWallet } from '../lib/api';

interface AuthState {
  walletAddress: string | null;
  keyPair: KeyPair | null;
  displayName: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (address: string, displayName?: string) => Promise<void>;
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
  });

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem(WALLET_KEY);
    const savedName = localStorage.getItem(DISPLAY_NAME_KEY);
    // We only load keypair if we have a wallet
    let savedKeyPair = null;
    if (savedWallet) {
      savedKeyPair = loadKeyPair(savedWallet);
    }

    if (savedWallet && savedKeyPair) {
      setState({
        walletAddress: savedWallet,
        keyPair: savedKeyPair,
        displayName: savedName,
        isLoading: false,
      });
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (address: string, displayName?: string) => {
    // Clear legacy generic keypair to prevent cross-contamination between wallets
    localStorage.removeItem('advaya_keypair');

    // Generate or reuse keypair
    let kp = loadKeyPair(address);
    const isExisting = !!kp;
    if (!kp) {
      kp = generateKeyPair();
    }
    saveKeyPair(address, kp);

    console.log(`[Auth] Login: ${address.slice(0, 8)}... | keypair: ${isExisting ? 'reused' : 'NEW'} | pubKey: ${kp.publicKey.slice(0, 16)}...`);

    // Register with backend (upserts)
    await registerWallet(address, kp.publicKey, displayName);

    localStorage.setItem(WALLET_KEY, address);
    if (displayName) localStorage.setItem(DISPLAY_NAME_KEY, displayName);

    setState({
      walletAddress: address,
      keyPair: kp,
      displayName: displayName || null,
      isLoading: false,
    });
  }, []);

  const logout = useCallback(() => {
    if (state.walletAddress) {
      clearKeyPair(state.walletAddress);
    }
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(DISPLAY_NAME_KEY);
    setState({ walletAddress: null, keyPair: null, displayName: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
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
