/**
 * Advaya IPFS Client (Pinata REST API)
 * ────────────────────────────────────
 * Fully decentralized file/message storage.
 *
 * Upload strategy:
 *   1. Pin directly to Pinata cloud using their REST API for persistence.
 *
 * Download strategy:
 *   1. Try Pinata dedicated gateway (fast, reliable)
 *   2. Fall back to public IPFS gateways (ipfs.io, cloudflare)
 *
 * (Removed local Helia node to fix Vercel Next.js 15+ Turbopack build failures)
 */

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

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Upload raw bytes to IPFS using Pinata.
 * Returns the CID string.
 */
export async function uploadToIpfs(bytes: Uint8Array): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT is required to upload files in the cloud version of Advaya.');
  }

  // Slice to a concrete ArrayBuffer to satisfy TypeScript's BlobPart type
  const buffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, 'advaya_upload');

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
 *   1. Pinata gateway (if configured)
 *   2. Public gateways (ipfs.io, cloudflare, etc.)
 */
export async function downloadFromIpfs(cidString: string): Promise<Uint8Array> {
  const errors: string[] = [];
  
  for (const gateway of PUBLIC_GATEWAYS) {
    try {
      const url = `${gateway}/${cidString}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      }
      errors.push(`${gateway}: HTTP ${res.status}`);
    } catch (err: any) {
      errors.push(`${gateway}: ${err.message}`);
    }
  }

  throw new Error(`Failed to fetch CID ${cidString} from all gateways:\n${errors.join('\n')}`);
}

/**
 * Build a public gateway URL for a CID (for sharing/linking purposes).
 */
export function ipfsGatewayUrl(cid: string): string {
  return `${PINATA_GATEWAY}/${cid}`;
}
