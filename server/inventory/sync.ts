/**
 * The sync logic shared by the daily job and the admin screen:
 *   1. decide which supplier a product belongs to
 *   2. link it to the exact supplier product (once)
 *   3. read the supplier's stock and turn it into the store's fields
 */

import type {
  CatalogItem,
  LinkStatus,
  LinkSuggestion,
  ProductStockUpdate,
  SupplierId,
  SupplierStock,
  SyncableProduct,
} from './types.ts';
import { SUPPLIER_INFO, SUPPLIER_IDS } from './types.ts';
import { fetchBabolatCatalog, fetchBabolatColor, fetchBabolatStock } from './babolat.ts';
import {
  fetchStoreApiCatalog,
  fetchStoreApiStock,
  fetchWooPageStock,
  fetchWpProductCatalog,
} from './woocommerce.ts';
import { matchSizes } from './sizes.ts';
import { getText } from './http.ts';
import { extractJsonAfter } from './parse.ts';
import { rankCandidates, scoreMatch, type RankedMatch } from './matching.ts';

/** Suppliers the owner updates by hand. */
const MANUAL_SUPPLIER_WORDS = ['sportcenter', 'bashgal', 'ספורט סנטר', 'בש-גל', 'בש גל', 'manual', 'ידני'];
/** Brands sold only through manual suppliers. */
const MANUAL_BRAND_WORDS = ['head', 'dunlop', 'דנלופ', 'prince', 'פרינס', 'tecnifibre', 'טכניפייבר'];
/** Model names that identify the brand when the brand itself is not in the name. */
const MODEL_KEYWORDS: Record<SupplierId, string[]> = {
  babolat: ['pure aero', 'pure drive', 'pure strike', 'evoke', 'evo ', 'jet mach', 'jet tere', 'sfx', 'propulse', 'rpm blast', 'pulsion', 'air vertuo', 'rh x', 'rival', 'court l'],
  wilson: ['pro staff', 'blade', 'clash', 'ultra', 'rush pro', 'defyer', 'intrigue', 'kaos', 'rf 01', 'court glide', 'burn', 'shift', 'super tour', 'us open', 'roland garros'],
  yonex: ['ezone', 'vcore', 'percept', 'astrox', 'nanoflare', 'sonicage', 'eclipsion', 'power cushion', 'poly tour'],
};

// ---------------------------------------------------------------------------
// 1. Which supplier?
// ---------------------------------------------------------------------------

export function detectSupplier(p: SyncableProduct): SupplierId | 'manual' | null {
  const site = (p.supplierSite ?? '').toLowerCase().trim();
  if (site) {
    for (const id of SUPPLIER_IDS) {
      const info = SUPPLIER_INFO[id];
      if (site === id || site.includes(new URL(info.baseUrl).hostname.replace(/^www\./, '')) || info.brandKeywords.some(k => site.includes(k))) {
        return id;
      }
    }
    if (MANUAL_SUPPLIER_WORDS.some(w => site.includes(w))) return 'manual';
  }
  if (p.supplierUrl) {
    for (const id of SUPPLIER_IDS) if (p.supplierUrl.includes(new URL(SUPPLIER_INFO[id].baseUrl).hostname.replace(/^www\./, ''))) return id;
  }

  const haystack = `${p.name} ${(p.tags ?? []).join(' ')}`.toLowerCase();
  const hits = SUPPLIER_IDS.filter(id => SUPPLIER_INFO[id].brandKeywords.some(k => haystack.includes(k)));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    // No brand word — fall back to model names that only one brand uses
    const modelHits = SUPPLIER_IDS.filter(id => MODEL_KEYWORDS[id].some(k => haystack.includes(k)));
    if (modelHits.length === 1) return modelHits[0];
  }
  if (hits.length === 0 && MANUAL_BRAND_WORDS.some(w => new RegExp(`(^|[^a-z֐-׿])${w}([^a-z֐-׿]|$)`).test(haystack))) {
    return 'manual';
  }
  return null; // unknown brand, or several brands mentioned
}

/** True when the product name/tags mention the supplier's brand or one of its model names. */
export function nameMentionsSupplier(p: SyncableProduct, supplier: SupplierId): boolean {
  const haystack = `${p.name} ${(p.tags ?? []).join(' ')}`.toLowerCase();
  return SUPPLIER_INFO[supplier].brandKeywords.some(k => haystack.includes(k)) || MODEL_KEYWORDS[supplier].some(k => haystack.includes(k));
}

// ---------------------------------------------------------------------------
// 2. Linking
// ---------------------------------------------------------------------------

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const catalogCache = new Map<SupplierId, { at: number; items: CatalogItem[] }>();

const catalogFailures = new Map<SupplierId, { at: number; message: string }>();
const CATALOG_FAILURE_TTL_MS = 5 * 60 * 1000;

export async function getCatalog(supplier: SupplierId): Promise<CatalogItem[]> {
  const cached = catalogCache.get(supplier);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.items;
  // Don't hammer a supplier that just failed — every unlinked product would retry.
  const failed = catalogFailures.get(supplier);
  if (failed && Date.now() - failed.at < CATALOG_FAILURE_TTL_MS) throw new Error(failed.message);
  try {
    let items: CatalogItem[];
    if (supplier === 'babolat') items = await fetchBabolatCatalog();
    else if (supplier === 'wilson') items = await fetchStoreApiCatalog('wilson', SUPPLIER_INFO.wilson.baseUrl);
    else items = await fetchWpProductCatalog('yonex', SUPPLIER_INFO.yonex.baseUrl);
    catalogCache.set(supplier, { at: Date.now(), items });
    catalogFailures.delete(supplier);
    return items;
  } catch (err: any) {
    catalogFailures.set(supplier, { at: Date.now(), message: err?.message ?? String(err) });
    throw err;
  }
}

/** Forget cached failures (used before the end-of-run retry). */
export function clearCatalogFailures() {
  catalogFailures.clear();
}

/**
 * Finds the supplier product for a store product.
 * For Babolat, colours are not in the catalog, so the colour of every
 * near-identical candidate is read from its page before deciding.
 */
export async function findLink(p: SyncableProduct, supplier: SupplierId): Promise<RankedMatch> {
  const catalog = await getCatalog(supplier);
  let ranked = rankCandidates(p.name, catalog, 12);

  if (supplier === 'babolat' && ranked.suggestions.length > 1) {
    const top = ranked.suggestions[0].score;
    const close = ranked.suggestions.filter(s => s.score >= top - 0.15).slice(0, 10);
    if (close.length > 1) {
      const colored: CatalogItem[] = [];
      for (const s of close) {
        const item = catalog.find(c => c.ref === s.ref);
        if (!item) continue;
        if (!item.color) item.color = await fetchBabolatColor(item.ref); // cached on the catalog item
        colored.push(item);
      }
      ranked = rankCandidates(p.name, colored, 5);
    }
  }
  ranked.suggestions = ranked.suggestions.slice(0, 5);
  return ranked;
}

export interface LinkDecision {
  supplier: SupplierId;
  status: LinkStatus;
  ref?: string;
  url?: string;
  suggestions: LinkSuggestion[];
  reason: string;
}

export async function decideLink(p: SyncableProduct, supplier: SupplierId): Promise<LinkDecision> {
  const ranked = await findLink(p, supplier);
  if (ranked.confident && ranked.best) {
    return { supplier, status: 'auto', ref: ranked.best.ref, url: ranked.best.url, suggestions: ranked.suggestions, reason: ranked.reason };
  }
  return {
    supplier,
    status: ranked.suggestions.length ? 'suggested' : 'none',
    suggestions: ranked.suggestions,
    reason: ranked.reason,
  };
}

// ---------------------------------------------------------------------------
// 3. Stock
// ---------------------------------------------------------------------------

export async function fetchStock(supplier: SupplierId, ref: string, url?: string): Promise<SupplierStock & { sizeHint: string }> {
  if (supplier === 'babolat') return fetchBabolatStock(ref || url || '');
  if (supplier === 'wilson') {
    if (/^\d+$/.test(ref)) return fetchStoreApiStock(SUPPLIER_INFO.wilson.baseUrl, ref, 'וילסון');
    return fetchWooPageStock(url || ref, 'וילסון');
  }
  return fetchWooPageStock(url || ref, 'טניס אונליין');
}

/** Turns the supplier's answer into the store's product fields. */
export function computeStockUpdate(p: SyncableProduct, stock: SupplierStock & { sizeHint?: string }, now = new Date()): ProductStockUpdate {
  const base = { lastStockCheck: now.toISOString(), supplierSizes: [] as string[] };
  const storeSizes = (p.sizes ?? []).filter(s => s.trim());

  if (stock.status !== 'found') {
    return {
      ...base,
      inStock: false,
      unavailableSizes: storeSizes,
      stockStatusDetail: stock.detail,
      stockCheckState: stock.status === 'not_found' ? 'not_found' : 'error',
    };
  }

  const sizes = matchSizes(storeSizes, stock.sizes, stock.inStock, stock.sizeHint ?? '');
  const supplierSizes = (stock.sizes ?? []).filter(s => s.available).map(s => s.label);
  const inStock = storeSizes.length > 0 ? stock.inStock && sizes.available.length > 0 : stock.inStock;

  let detail = stock.detail;
  if (storeSizes.length > 0 && stock.sizes) {
    detail = inStock
      ? `במלאי אצל הספק. מידות שאפשר למכור: ${sizes.available.join(', ')}`
      : `אף אחת מהמידות שלך לא זמינה אצל הספק`;
    if (sizes.notOffered.length) detail += ` · מידות שהספק לא מציע בכלל: ${sizes.notOffered.join(', ')}`;
  }

  return {
    ...base,
    inStock,
    unavailableSizes: sizes.unavailable,
    supplierSizes,
    stockStatusDetail: detail,
    stockCheckState: 'ok',
  };
}

/**
 * Turns a supplier page the owner pasted into a stored link
 * (supplier + stable ref), and reads its stock to confirm it works.
 */
export async function resolveLinkFromUrl(rawUrl: string): Promise<{ supplier: SupplierId; ref: string; url: string; stock: SupplierStock & { sizeHint: string } }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('הקישור לא תקין');
  }
  const host = url.hostname.replace(/^www\./, '');
  const supplier = SUPPLIER_IDS.find(id => new URL(SUPPLIER_INFO[id].baseUrl).hostname.replace(/^www\./, '') === host);
  if (!supplier) throw new Error('הקישור לא שייך לאחד משלושת הספקים (בבולט, וילסון, טניס אונליין)');

  const { status, text, finalUrl } = await getText(url.toString());
  if (status >= 400) throw new Error(`הספק החזיר שגיאה ${status} לקישור הזה`);

  if (supplier === 'babolat') {
    const p = extractJsonAfter(text, 'window.product') as { id?: number } | null;
    if (!p?.id) throw new Error('זה לא נראה כמו דף מוצר של בבולט');
    const ref = String(p.id);
    return { supplier, ref, url: `${SUPPLIER_INFO.babolat.baseUrl}/product/${ref}`, stock: await fetchStock(supplier, ref) };
  }

  if (supplier === 'wilson') {
    const id = text.match(/\bid="product-(\d+)"/)?.[1] ?? text.match(/\bpostid-(\d+)\b/)?.[1];
    if (!id) throw new Error('זה לא נראה כמו דף מוצר של וילסון');
    return { supplier, ref: id, url: finalUrl, stock: await fetchStock(supplier, id, finalUrl) };
  }

  const canonical = text.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/)?.[1] ?? finalUrl;
  if (!/\/product\//.test(canonical)) throw new Error('זה לא נראה כמו דף מוצר של טניס אונליין');
  return { supplier, ref: canonical, url: canonical, stock: await fetchStock(supplier, canonical, canonical) };
}

/** Checks one already-linked product. */
export async function checkLinkedProduct(p: SyncableProduct, supplier: SupplierId) {
  const stock = await fetchStock(supplier, p.supplierRef ?? '', p.supplierUrl);
  return { stock, update: computeStockUpdate(p, stock) };
}

export { scoreMatch };
