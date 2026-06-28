import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';
import { z } from 'zod';

export const walletRouter = Router();

const RegisterSchema = z.object({
  address: z.string().min(56).max(56),
  pubKey: z.string().min(1),
  displayName: z.string().max(50).optional(),
});

// POST /api/wallet/register
walletRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { address, pubKey, displayName } = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO wallets (address, pub_key, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (address) DO UPDATE
       SET pub_key = $2, display_name = COALESCE($3, wallets.display_name), last_seen_at = NOW()
       RETURNING address, pub_key, display_name, registered_at`,
      [address, pubKey, displayName || null]
    );
    res.json({ wallet: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/wallet/:address
walletRouter.get('/:address', async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  try {
    const result = await pool.query(
      'SELECT address, pub_key, display_name, registered_at FROM wallets WHERE address = $1',
      [address]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    res.json({ wallet: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// GET /api/wallet/me — Get current user's profile
walletRouter.get('/me/profile', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const walletAddress = (req as any).walletAddress;
  try {
    const result = await pool.query(
      'SELECT address, pub_key, display_name, registered_at, last_seen_at FROM wallets WHERE address = $1',
      [walletAddress]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not registered' });
      return;
    }
    res.json({ wallet: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});
