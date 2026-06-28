'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './context/AuthContext';
import { generateKeyPair } from './lib/crypto';

export default function LandingPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<'hero' | 'connect'>('hero');
  const [address, setAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/chats');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg-base)',
      }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim() || address.trim().length !== 56) return;
    setSubmitting(true);
    setError('');
    try {
      await login(address.trim(), displayName.trim() || undefined);
      router.push('/chats');
    } catch (err: any) {
      setError(err.message || 'Connection failed. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  };

  const fillTestWallet = () => {
    // Valid Stellar test address (exactly 56 chars starting with G)
    const test = 'GBHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3ESGFXUVC';
    setAddress(test);
    setDisplayName('Demo User');
  };

  return (
    <div className="landing-bg">
      {/* Animated particles */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: 2,
            height: 2,
            borderRadius: '50%',
            background: 'var(--brand-primary)',
            opacity: 0.4,
            left: `${10 + i * 16}%`,
            top: `${20 + (i % 3) * 20}%`,
            animation: `pulse-glow ${2 + i * 0.5}s infinite alternate`,
          }} />
        ))}
      </div>

      <div className="landing-card animate-slide-up">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, margin: '0 auto 16px',
            boxShadow: '0 0 32px rgba(108,99,255,0.4)',
          }}>
            🔐
          </div>
          <h1 style={{
            fontSize: 28, fontWeight: 700,
            background: 'linear-gradient(135deg, #fff 0%, var(--brand-secondary) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: 6,
          }}>
            Advaya
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
            End-to-end encrypted messaging<br />built on Stellar.
          </p>
        </div>

        {/* Features strip */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {['🔒 E2E Encrypted', '🌐 Decentralized', '🚫 No metadata'].map(f => (
            <span key={f} style={{
              fontSize: 11, padding: '4px 10px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 20,
              color: 'var(--text-secondary)',
            }}>{f}</span>
          ))}
        </div>

        {step === 'hero' ? (
          <>
            <button
              id="connect-wallet-btn"
              className="btn btn-primary w-full"
              style={{ justifyContent: 'center', fontSize: 15, padding: '12px 20px' }}
              onClick={() => setStep('connect')}
            >
              Connect Wallet
            </button>
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>
              Phase 1: Enter your Stellar public key to get started.
            </p>
          </>
        ) : (
          <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="input-label">Stellar Public Key (G…)</label>
              <input
                id="wallet-address-input"
                className="input-field"
                type="text"
                placeholder="GBHJJ…V6 (56 chars)"
                value={address}
                onChange={e => setAddress(e.target.value)}
                autoFocus
                maxLength={56}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              {address.length > 0 && address.length !== 56 && (
                <p style={{ fontSize: 11, color: 'var(--status-pending)', marginTop: 4 }}>
                  {56 - address.length} more characters needed
                </p>
              )}
              {address.length === 56 && !address.startsWith('G') && (
                <p style={{ fontSize: 11, color: 'var(--status-danger)', marginTop: 4 }}>
                  Stellar public keys start with 'G'
                </p>
              )}
            </div>

            <div>
              <label className="input-label">
                Display Name{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="display-name-input"
                className="input-field"
                type="text"
                placeholder="Alice"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={50}
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 8, padding: '10px 14px',
                fontSize: 13, color: 'var(--status-danger)',
              }}>
                {error}
              </div>
            )}

            <button
              id="login-btn"
              type="submit"
              className="btn btn-primary w-full"
              disabled={submitting || address.length !== 56 || !address.startsWith('G')}
              style={{ justifyContent: 'center', fontSize: 15, padding: '12px 20px' }}
            >
              {submitting ? 'Connecting…' : 'Enter Advaya →'}
            </button>

            <button
              type="button"
              onClick={fillTestWallet}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 12, textDecoration: 'underline',
                textAlign: 'center', padding: 0,
              }}
            >
              Use test wallet (demo)
            </button>

            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setStep('hero'); setError(''); }}
              style={{ justifyContent: 'center', fontSize: 13 }}
            >
              ← Back
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            Your encryption keys never leave your browser.
            <br />Messages are encrypted before they reach our servers.
          </p>
        </div>
      </div>
    </div>
  );
}
