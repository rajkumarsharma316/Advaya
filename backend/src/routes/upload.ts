import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';

export const uploadRouter = Router();
uploadRouter.use(authMiddleware);

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer — store in memory first, then write to disk with UUID name
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
  },
});

/**
 * POST /api/files/upload
 * Accepts a multipart form upload of an encrypted file blob.
 * Fields: file (binary), conversationId, originalName, mimeType, fileSize
 */
uploadRouter.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const wallet = (req as any).walletAddress as string;

    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const { conversationId, originalName, mimeType, fileSize } = req.body;

    if (!conversationId || !originalName || !mimeType || !fileSize) {
      res.status(400).json({ error: 'Missing required fields: conversationId, originalName, mimeType, fileSize' });
      return;
    }

    try {
      // Verify the uploader is part of this approved conversation
      const convoCheck = await pool.query(
        `SELECT id FROM conversations
         WHERE id = $1 AND status = 'approved' AND (sender = $2 OR receiver = $2)`,
        [conversationId, wallet]
      );
      if (convoCheck.rows.length === 0) {
        res.status(403).json({ error: 'Not authorized or conversation not approved' });
        return;
      }

      // Write encrypted blob to disk
      const fileId = uuidv4();
      const storedName = fileId + '.enc';
      const storedPath = path.join(UPLOADS_DIR, storedName);
      fs.writeFileSync(storedPath, req.file.buffer);

      // Insert metadata into DB
      await pool.query(
        `INSERT INTO file_attachments (id, conversation_id, uploader, original_name, mime_type, file_size, stored_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [fileId, conversationId, wallet, originalName, mimeType, parseInt(fileSize), storedName]
      );

      res.status(201).json({
        fileId,
        originalName,
        mimeType,
        fileSize: parseInt(fileSize),
      });
    } catch (err) {
      console.error('File upload failed:', err);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

/**
 * GET /api/files/:fileId
 * Serves the encrypted file blob. Auth required — verifies the requester
 * is part of the conversation the file belongs to.
 */
uploadRouter.get('/:fileId', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { fileId } = req.params;

  try {
    // Fetch file metadata and verify access
    const result = await pool.query(
      `SELECT fa.*, c.sender, c.receiver
       FROM file_attachments fa
       JOIN conversations c ON c.id = fa.conversation_id
       WHERE fa.id = $1 AND (c.sender = $2 OR c.receiver = $2)`,
      [fileId, wallet]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'File not found or unauthorized' });
      return;
    }

    const file = result.rows[0];
    const filePath = path.join(UPLOADS_DIR, file.stored_path);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    // Stream the encrypted blob back
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('File download failed:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

/**
 * GET /api/files/:fileId/meta
 * Returns file metadata without downloading the blob.
 */
uploadRouter.get('/:fileId/meta', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req as any).walletAddress as string;
  const { fileId } = req.params;

  try {
    const result = await pool.query(
      `SELECT fa.id, fa.original_name, fa.mime_type, fa.file_size, fa.created_at
       FROM file_attachments fa
       JOIN conversations c ON c.id = fa.conversation_id
       WHERE fa.id = $1 AND (c.sender = $2 OR c.receiver = $2)`,
      [fileId, wallet]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'File not found or unauthorized' });
      return;
    }

    res.json({ file: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch file metadata' });
  }
});
