/**
 * Product photos live in a public GitHub repository and are served through the
 * jsDelivr CDN, not inside Firestore documents.
 *
 * Why: this Firestore database bills reads by data size, and photos stored as
 * base64 inside product documents used up the free daily quota after a handful
 * of page loads. With photos outside the database, product documents are a few
 * KB each.
 *
 * Used by the admin upload route (server.ts) and the one-time migration
 * (scripts/migrate-images.ts). Needs GITHUB_IMAGES_TOKEN: a fine-grained token
 * with "Contents: read and write" on the images repository only.
 */

import { createHash } from 'node:crypto';

export const IMAGES_REPO = process.env.IMAGES_REPO || 'rubizach-web/rubis-tennis-images';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export function parseDataUrl(dataUrl: string): { type: string; base64: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { type: m[1].toLowerCase(), base64: m[2].replace(/\s+/g, '') };
}

export function isDataImage(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:image/');
}

function token(): string {
  const t = process.env.GITHUB_IMAGES_TOKEN || process.env.IMAGES_TOKEN;
  if (!t) throw new Error('GITHUB_IMAGES_TOKEN is not set');
  return t;
}

async function gh(path: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${IMAGES_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rubis-tennis-store',
      ...(init.headers || {}),
    },
  });
}

function cdnUrl(path: string, ref: string) {
  // A commit SHA makes the URL immutable and available immediately on the CDN.
  return `https://cdn.jsdelivr.net/gh/${IMAGES_REPO}@${ref}/${path}`;
}

/**
 * Stores one image and returns its public URL. The file name is the image's
 * hash, so uploading the same photo twice reuses the existing file.
 */
export async function storeImage(dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('not an image data URL');
  const bytes = Buffer.from(parsed.base64, 'base64');
  if (bytes.length === 0) throw new Error('empty image');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('image is larger than 8 MB');

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const path = `p/${hash.slice(0, 2)}/${hash}.${EXT[parsed.type] ?? 'img'}`;

  // Already uploaded?
  const existing = await gh(`/commits?path=${encodeURIComponent(path)}&per_page=1`);
  if (existing.ok) {
    const commits = (await existing.json()) as { sha: string }[];
    if (commits.length) return cdnUrl(path, commits[0].sha);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await gh(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Add product image ${hash.slice(0, 8)}`, content: parsed.base64 }),
    });
    if (res.ok) {
      const body = (await res.json()) as { commit: { sha: string } };
      return cdnUrl(path, body.commit.sha);
    }
    // 409/422: another upload moved the branch, or the file appeared meanwhile — retry
    if (res.status === 409 || res.status === 422) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      const again = await gh(`/commits?path=${encodeURIComponent(path)}&per_page=1`);
      if (again.ok) {
        const commits = (await again.json()) as { sha: string }[];
        if (commits.length) return cdnUrl(path, commits[0].sha);
      }
      continue;
    }
    throw new Error(`GitHub refused the image upload (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('GitHub image upload kept conflicting, try again');
}

/** Replaces every embedded image in a value (any depth) with its stored URL. */
export async function externalizeImages<T>(value: T, onImage?: (url: string) => void): Promise<T> {
  if (isDataImage(value)) {
    const url = await storeImage(value);
    onImage?.(url);
    return url as unknown as T;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await externalizeImages(v, onImage));
    return out as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await externalizeImages(v, onImage);
    return out as T;
  }
  return value;
}

/** Counts embedded images and their size, for reports. */
export function measureEmbedded(value: unknown, acc = { count: 0, bytes: 0 }) {
  if (isDataImage(value)) {
    acc.count++;
    acc.bytes += value.length;
  } else if (Array.isArray(value)) value.forEach(v => measureEmbedded(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => measureEmbedded(v, acc));
  return acc;
}
