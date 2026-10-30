/**
 * Server-side catalog cache.
 *
 * The store's Firestore runs on a hard-capped free tier (about 50,000 document
 * reads a day). When every visitor's browser read all products directly, a few
 * hundred visits a day used up the quota and the shop went blank until the
 * next reset.
 *
 * Instead, the server reads the products and the site content once, keeps them
 * in memory, and serves them to every visitor from /api/catalog. Firestore
 * reads now depend on how often the cache refreshes, not on traffic:
 * ~216 reads every 10 minutes ≈ 31,000 a day at most, and only while the
 * server is awake.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, getDoc } from 'firebase/firestore/lite';
import firebaseConfig from '../firebase-applet-config.json';

const TTL_MS = Number(process.env.CATALOG_TTL_MS ?? 10 * 60 * 1000);
/** Minimum gap between forced refreshes (the admin's "I just saved" ping). */
const MIN_REFRESH_GAP_MS = 20 * 1000;

export interface CatalogPayload {
  content: Record<string, unknown> | null;
  products: Record<string, unknown>[];
  loadedAt: string;
}

let cache: CatalogPayload | null = null;
let cacheAt = 0;
let inFlight: Promise<CatalogPayload> | null = null;
let lastForced = 0;
let lastError: string | null = null;

function db() {
  const app = getApps().find(a => a.name === 'catalog') ?? initializeApp(firebaseConfig, 'catalog');
  return getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
}

async function load(): Promise<CatalogPayload> {
  const store = db();
  const [contentSnap, productsSnap] = await Promise.all([
    getDoc(doc(store, 'settings', 'content')),
    getDocs(collection(store, 'products')),
  ]);
  const content = contentSnap.exists() ? (contentSnap.data() as Record<string, unknown>) : null;
  if (content && 'products' in content) delete (content as any).products; // legacy field
  return {
    content,
    products: productsSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    loadedAt: new Date().toISOString(),
  };
}

function refresh(): Promise<CatalogPayload> {
  if (!inFlight) {
    inFlight = load()
      .then(payload => {
        cache = payload;
        cacheAt = Date.now();
        lastError = null;
        return payload;
      })
      .catch(err => {
        lastError = err?.message ?? String(err);
        console.warn('[catalog] refresh failed:', lastError);
        if (cache) return cache; // keep serving the last good copy (e.g. quota exhausted)
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Returns the cached catalog, refreshing it when stale. */
export async function getCatalog(): Promise<CatalogPayload & { stale: boolean }> {
  const age = Date.now() - cacheAt;
  if (cache && age < TTL_MS) return { ...cache, stale: false };
  if (cache) {
    // Serve the old copy immediately, refresh in the background
    refresh().catch(() => {});
    return { ...cache, stale: true };
  }
  const fresh = await refresh();
  return { ...fresh, stale: false };
}

/** Called after the admin saves something, so visitors see it within seconds. */
export function requestRefresh(): boolean {
  if (Date.now() - lastForced < MIN_REFRESH_GAP_MS) return false;
  lastForced = Date.now();
  refresh().catch(() => {});
  return true;
}

export function catalogStatus() {
  return {
    cachedAt: cacheAt ? new Date(cacheAt).toISOString() : null,
    products: cache?.products.length ?? 0,
    lastError,
  };
}
