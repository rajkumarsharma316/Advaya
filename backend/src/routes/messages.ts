import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';
import { z } from 'zod';

export const messageRouter = Router();
messageRouter.use(authMiddleware);

const SendMessageSchema = z.object({
  conversationId: z.number().int().positive(),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  messageType: z.enum(['text', 'file', 'image']).default('text'),
  readOnce: z.boolean().default(false),
  expiresInSeconds: z.number().int().positive().optional(),
});

// POST /api/messages — Send an encrypted message
messageRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const sender = (req as any).walletAddress as string;
  const parsed = SendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { conversationId, ciphertext, nonce, messageType, readOnce, expiresInSeconds } = parsed.data;

  try {
    // Verify sender is part of this approved conversation
    const convoCheck = await pool.query(
      `SELECT id FROM conversations 
       WHERE id = $1 AND status = 'approved' AND (sender = $2 OR receiver = $2)`,
      [conversationId, sender]
    );
    if (convoCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not authorized or conversation not approved' });
      return;
    }

    const expiresAt = expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null;

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender, ciphertext, nonce, message_type, read_once, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, conversation_id, sender, ciphertext, nonce, message_type, read_once, sent_at, expires_at`,
      [conversationId, sender, ciphertext, nonce, messageType, readOnce, expiresAt]
    );

    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages/:conversationId — Fetch messages for a conversation
messageRouter.get('/:conversationId', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { conversationId } = req.params;
  const { before, limit = '50' } = req.query;

  try {
    // Verify wallet is part of this conversation
    const convoCheck = await pool.query(
      `SELECT id FROM conversations WHERE id = $1 AND (sender = $2 OR receiver = $2)`,
      [conversationId, wallet]
    );
    if (convoCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not authorized for this conversation' });
      return;
    }

    // Handle read-once: mark message as read and delete if already read
    const messages = await pool.query(
      `SELECT id, conversation_id, sender, ciphertext, nonce, message_type, 
              read_once, sent_at, expires_at, read_at
       FROM messages
       WHERE conversation_id = $1 
         AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         ${before ? 'AND id < $3' : ''}
       ORDER BY sent_at ASC
       LIMIT $2`,
      before ? [conversationId, parseInt(limit as string), before] : [conversationId, parseInt(limit as string)]
    );

    // Mark read-once messages as read (they'll be deleted on next fetch)
    const readOnceIds = messages.rows
      .filter(m => m.read_once && !m.read_at && m.sender !== wallet)
      .map(m => m.id);

    if (readOnceIds.length > 0) {
      await pool.query(
        `UPDATE messages SET read_at = NOW(), deleted_at = NOW() WHERE id = ANY($1)`,
        [readOnceIds]
      );
    }

    res.json({ messages: messages.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// DELETE /api/messages/:id — Delete a message (self-destruct or manual)
messageRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE messages SET deleted_at = NOW()
       WHERE id = $1 AND sender = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, wallet]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Message not found or unauthorized' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});
