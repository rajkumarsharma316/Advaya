import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';
import { z } from 'zod';

export const conversationRouter = Router();
conversationRouter.use(authMiddleware);

const CreateConvoSchema = z.object({
  receiverAddress: z.string().length(56),
  requestNote: z.string().max(300).optional(),
});

// POST /api/conversations — Create a new conversation request
conversationRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const sender = (req as any).walletAddress as string;
  const parsed = CreateConvoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { receiverAddress, requestNote } = parsed.data;

  if (sender === receiverAddress) {
    res.status(400).json({ error: 'Cannot start conversation with yourself' });
    return;
  }

  try {
    // Check receiver is registered
    const receiverCheck = await pool.query('SELECT address FROM wallets WHERE address = $1', [receiverAddress]);
    if (receiverCheck.rows.length === 0) {
      res.status(404).json({ error: 'Receiver wallet not registered on Advaya' });
      return;
    }

    // Check for existing conversation (either direction)
    const existing = await pool.query(
      `SELECT id, status FROM conversations 
       WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)`,
      [sender, receiverAddress]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Conversation already exists', conversation: existing.rows[0] });
      return;
    }

    const result = await pool.query(
      `INSERT INTO conversations (sender, receiver, request_note)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [sender, receiverAddress, requestNote || null]
    );

    res.status(201).json({ conversation: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/conversations — List all conversations for current wallet
conversationRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  try {
    const result = await pool.query(
      `SELECT c.*, 
        sw.pub_key as sender_pub_key, sw.display_name as sender_name,
        rw.pub_key as receiver_pub_key, rw.display_name as receiver_name,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) as message_count,
        (SELECT sent_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1) as last_message_at
       FROM conversations c
       JOIN wallets sw ON sw.address = c.sender
       JOIN wallets rw ON rw.address = c.receiver
       WHERE c.sender = $1 OR c.receiver = $1
       ORDER BY COALESCE(last_message_at, c.created_at) DESC`,
      [wallet]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/conversations/:id — Get single conversation
conversationRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.*, 
        sw.pub_key as sender_pub_key, sw.display_name as sender_name,
        rw.pub_key as receiver_pub_key, rw.display_name as receiver_name
       FROM conversations c
       JOIN wallets sw ON sw.address = c.sender
       JOIN wallets rw ON rw.address = c.receiver
       WHERE c.id = $1 AND (c.sender = $2 OR c.receiver = $2)`,
      [id, wallet]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ conversation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// POST /api/conversations/:id/approve
conversationRouter.post('/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE conversations SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND receiver = $2 AND status = 'pending'
       RETURNING *`,
      [id, wallet]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pending conversation not found' });
      return;
    }
    res.json({ conversation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve conversation' });
  }
});

// POST /api/conversations/:id/reject
conversationRouter.post('/:id/reject', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE conversations SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND receiver = $2 AND status = 'pending'
       RETURNING *`,
      [id, wallet]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pending conversation not found' });
      return;
    }
    res.json({ conversation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject conversation' });
  }
});
