/**
 * Advaya IPFS Client (Helia + Pinata)
 * ────────────────────────────────────
 * Fully decentralized file/message storage.
 *
 * Upload strategy:
 *   1. Add content to local in-browser Helia node (fast, instant CID)
 *   2. Pin to Pinata cloud (optional but highly recommended for persistence)
 *
 * Download strategy:
 *   1. Try local Helia node (instant if we uploaded it)
 *   2. Try Pinata dedicated gateway (fast, reliable)
 *   3. Fall back to public IPFS gateways (ipfs.io, cloudflare)
 *
 * This completely replaces the centralized /api/files/* upload server.
 */

import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { MemoryDatastore } from 'datastore-core/memory';

// ─── Config ───────────────────────────────────────────────────────────────────

const PINATA_JWT = process.env.NEXT_PUBLIC_PINATA_JWT || '';
const PINATA_GATEWAY = process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'https://gateway.pinata.cloud';
const PINATA_API = 'https://api.pinata.cloud';

// Fallback gateways if Pinata is not configured
const PUBLIC_GATEWAYS = [
  PINATA_GATEWAY,
  'https://ipfs.io/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
  'https://dweb.link/ipfs',
];

// ─── Helia singleton ─────────────────────────────────────────────────────────

let heliaInstance: Awaited<ReturnType<typeof createHelia>> | null = null;
let fsInstance: ReturnType<typeof unixfs> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the in-browser Helia (IPFS) node.
 * Uses MemoryBlockstore by default (fast, no IndexedDB permission issues).
 */
export async function initIpfs(): Promise<void> {
  if (heliaInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const blockstore = new MemoryBlockstore();
      const datastore = new MemoryDatastore();

      heliaInstance = await createHelia({ blockstore, datastore });
      fsInstance = unixfs(heliaInstance);

      console.log('✅ Helia IPFS node initialized');
    } catch (err) {
      console.error('❌ Failed to initialize Helia:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Upload raw bytes to IPFS.
 * Returns the CID string.
 *
 * Also pins to Pinata in the background for persistence.
 */
export async function uploadToIpfs(bytes: Uint8Array): Promise<string> {
  await initIpfs();
  const cid = await fsInstance!.addBytes(bytes);
  const cidStr = cid.toString();

  // Pin to Pinata in the background (don't await — don't block the UX)
  pinToPinata(bytes, cidStr).catch(err =>
    console.warn('[IPFS] Pinata pin failed (will use local/gateway fallback):', err)
  );

  return cidStr;
}

/**
 * Pin content to Pinata for persistent storage.
 * Uses the Pinata Pinning Services API.
 */
export async function pinToPinata(bytes: Uint8Array, cidHint?: string): Promise<string> {
  if (!PINATA_JWT) {
    console.warn('[Pinata] No JWT configured — skipping cloud pin');
    return cidHint || '';
  }

  // Slice to a concrete ArrayBuffer to satisfy TypeScript's BlobPart type
  const buffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, cidHint || 'advaya_upload');

  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`📌 Pinned to Pinata: ${data.IpfsHash}`);
  return data.IpfsHash as string;
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download raw bytes from IPFS by CID.
 *
 * Strategy:
 *   1. Local Helia node (if we have the block in memory)
 *   2. Pinata gateway (if JWT configured)
 *   3. Public gateways (ipfs.io, cloudflare, etc.)
 */
export async function downloadFromIpfs(cidString: string): Promise<Uint8Array> {
  // 1. Try local Helia node first
  try {
    await initIpfs();
    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);

    // Check if we have the block locally
    const has = await heliaInstance!.blockstore.has(cid);
    if (has) {
      return await streamCat(cid);
    }
  } catch {
    // Block not in local store — fall through to gateway
  }

  // 2. Try HTTP gateways in order
  const errors: string[] = [];
  for (const gateway of PUBLIC_GATEWAYS) {
    try {
      const url = `${gateway}/${cidString}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);

        // Store in local Helia so future requests are instant
        try {
          await initIpfs();
          const { CID } = await import('multiformats/cid');
          const cid = CID.parse(cidString);
          await fsInstance!.addBytes(bytes);
        } catch {
          // Best-effort caching
        }

        return bytes;
      }
      errors.push(`${gateway}: HTTP ${res.status}`);
    } catch (err: any) {
      errors.push(`${gateway}: ${err.message}`);
    }
  }

  throw new Error(`Failed to fetch CID ${cidString} from all gateways:\n${errors.join('\n')}`);
}

/**
 * Stream cat from local Helia node.
 */
async function streamCat(cid: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of fsInstance!.cat(cid)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Build a public gateway URL for a CID (for sharing/linking purposes).
 */
export function ipfsGatewayUrl(cid: string): string {
  return `${PINATA_GATEWAY}/${cid}`;
}
