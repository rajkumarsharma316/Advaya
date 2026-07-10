'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './context/AuthContext';

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

  const handleFreighterConnect = async () => {
    setSubmitting(true);
    setError('');
    try {
      // Dynamic import avoids SSR issues
      const freighter = await import('@stellar/freighter-api');

      // Step 1: Request permission — opens the Freighter popup
      // In Freighter API v2, requestAccess() no longer returns the key.
      const accessResult = await freighter.requestAccess();
      if (accessResult && (accessResult as any).error) {
        throw new Error((accessResult as any).error);
      }

      // Step 2: Get the address (v2 renamed getPublicKey → getAddress)
      const addrResult = await freighter.getAddress();
      const address =
        typeof addrResult === 'string'
          ? addrResult
          : (addrResult as any).address ?? (addrResult as any).publicKey ?? '';

      if (!address || address.length !== 56) {
        throw new Error('Could not retrieve public key from Freighter.');
      }

      await login(address, displayName.trim() || undefined);
      router.push('/chats');
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (!msg || msg.toLowerCase().includes('not installed') || msg.toLowerCase().includes('not found')) {
        setError('Freighter extension not found. Please install it from freighter.app');
      } else {
        setError(msg || 'Wallet connection failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };


  const fillTestWallet = () => {
    // Valid Stellar test address (exactly 56 chars starting with G)
    const test = 'GBHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3ESGFXUVCE';
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* PRIMARY: Freighter one-click connect */}
            <button
              id="connect-freighter-btn"
              className="btn btn-primary w-full"
              onClick={handleFreighterConnect}
              disabled={submitting}
              style={{
                justifyContent: 'center', fontSize: 15, padding: '13px 20px',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'linear-gradient(135deg, #5E35B1, #7C4DFF)',
                boxShadow: '0 0 24px rgba(94,53,177,0.45)',
              }}
            >
              {submitting ? (
                <>
                  <span style={{
                    width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTop: '2px solid #fff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Connecting…
                </>
              ) : (
                <>
                  {/* Freighter-style icon */}
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
                    <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.15)"/>
                    <path d="M8 23L16 9L24 23H8Z" fill="white" opacity="0.95"/>
                    <path d="M12 23L16 16L20 23H12Z" fill="#B39DDB"/>
                  </svg>
                  Connect with Freighter
                </>
              )}
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            {/* SECONDARY: Manual key entry */}
            <button
              id="manual-key-btn"
              className="btn btn-ghost w-full"
              style={{ justifyContent: 'center', fontSize: 13, padding: '10px 20px' }}
              onClick={() => { setStep('connect'); setError(''); }}
            >
              Enter Public Key Manually
            </button>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 8, padding: '10px 14px',
                fontSize: 13, color: 'var(--status-danger)', marginTop: 4,
              }}>
                {error}
                {error.toLowerCase().includes('freighter') && (
                  <a
                    href="https://freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', marginTop: 6, color: 'var(--brand-secondary)', fontSize: 12 }}
                  >
                    → Install Freighter extension ↗
                  </a>
                )}
              </div>
            )}

            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Your private key never leaves Freighter.
            </p>
          </div>
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
                  Stellar public keys start with &apos;G&apos;
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
