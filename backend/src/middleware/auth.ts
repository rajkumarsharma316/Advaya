import { Request, Response, NextFunction } from 'express';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Verifies a wallet signature for protected routes.
 * The client must send:
 *   Authorization: Bearer <wallet_address>:<signature>:<message>
 * Or pass { walletAddress } in the body (for Phase 1 dev convenience).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Phase 1: Accept walletAddress from header or body for development
  const walletAddress =
    req.headers['x-wallet-address'] as string ||
    req.body?.walletAddress;

  if (!walletAddress) {
    res.status(401).json({ error: 'Wallet address required' });
    return;
  }

  // Validate it looks like a Stellar address
  try {
    Keypair.fromPublicKey(walletAddress);
  } catch {
    res.status(401).json({ error: 'Invalid wallet address format' });
    return;
  }

  // Attach wallet address to request
  (req as any).walletAddress = walletAddress;
  next();
}
