/**
 * WooCommerce suppliers.
 *
 * wilson.co.il exposes the WooCommerce Store API, which returns stock for the
 * product and for every variation (size) as JSON.
 *
 * tennis-online.co.il (Yonex) runs an older WooCommerce without the Store API,
 * so the product page itself is read: the product wrapper carries an
 * `instock`/`outofstock` class and the variations form carries
 * `data-product_variations` with `is_in_stock` per size. Sizes the shop removed
 * are simply missing.
 */

import type { CatalogItem, SupplierId, SupplierSize, SupplierStock } from './types.ts';
import { getJson, getText } from './http.ts';
import { decodeEntities, safeDecodeURIComponent, stripTags } from './parse.ts';

// ---------------------------------------------------------------------------
// Product page (HTML) — used for tennis-online, and as a fallback for Wilson
// ---------------------------------------------------------------------------

interface WooVariationJson {
  attributes: Record<string, string>;
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  variation_is_active?: boolean;
  variation_is_visible?: boolean;
}

/** Maps option slugs to the text the shop shows, per attribute select. */
function readSelectLabels(html: string): { names: Record<string, string>; labels: Record<string, Record<string, string>> } {
  const names: Record<string, string> = {};
  const labels: Record<string, Record<string, string>> = {};
  const selectRe = /<select[^>]*\bname="(attribute_[^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
  let m: RegExpExecArray | null;
  while ((m = selectRe.exec(html))) {
    const attr = m[1];
    labels[attr] = {};
    const optRe = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
    let o: RegExpExecArray | null;
    while ((o = optRe.exec(m[2]))) {
      if (o[1] === '') continue;
      labels[attr][decodeEntities(o[1])] = stripTags(o[2]);
    }
    // <label for="pa_size">מידה</label> sits just before the select
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const lab = [...before.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].pop();
    names[attr] = lab ? stripTags(lab[1]) : safeDecodeURIComponent(attr.replace(/^attribute_(pa_)?/, ''));
  }
  return { names, labels };
}

/** Pure parser for a WooCommerce product page — exported for tests. */
export function parseWooProductPage(html: string, url: string, shopName: string): SupplierStock & { sizeHint: string } {
  const wrapper =
    html.match(/<div[^>]*\bid="product-(\d+)"[^>]*\bclass="([^"]*)"/) ||
    html.match(/<div[^>]*\bclass="([^"]*)"[^>]*\bid="product-(\d+)"/);
  if (!wrapper) {
    return { status: 'not_found', inStock: false, sizes: null, url, detail: `המוצר לא נמצא באתר ${shopName}`, sizeHint: '' };
  }
  const classes = wrapper[0].match(/\bclass="([^"]*)"/)?.[1] ?? '';
  const productInStock = /\binstock\b|\bonbackorder\b/.test(classes) && !/\boutofstock\b/.test(classes);

  const title = stripTags(html.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '') || undefined;

  const varsAttr = html.match(/data-product_variations="([^"]*)"/)?.[1];
  const { names, labels } = readSelectLabels(html);
  const attrKeys = Object.keys(labels);

  if (varsAttr === undefined) {
    // Simple product (no sizes)
    return {
      status: 'found',
      inStock: productInStock,
      sizes: null,
      title,
      url,
      detail: productInStock ? `במלאי באתר ${shopName}` : `אזל באתר ${shopName}`,
      sizeHint: '',
    };
  }

  let variations: WooVariationJson[] | false = false;
  try {
    variations = JSON.parse(decodeEntities(varsAttr));
  } catch {
    variations = false;
  }

  // Use the attribute that actually varies most as "the size"
  const sizeAttr = attrKeys.sort((a, b) => Object.keys(labels[b]).length - Object.keys(labels[a]).length)[0];
  const sizeHint = sizeAttr ? names[sizeAttr] ?? '' : '';

  if (variations === false || !Array.isArray(variations)) {
    // Too many variations for WooCommerce to embed: per-size stock unknown,
    // so every listed size follows the product status.
    const sizes: SupplierSize[] | null = sizeAttr
      ? Object.values(labels[sizeAttr]).map(label => ({ label, available: productInStock }))
      : null;
    return {
      status: 'found',
      inStock: productInStock,
      sizes,
      title,
      url,
      detail: `${productInStock ? 'במלאי' : 'אזל'} באתר ${shopName} (מלאי לפי מידה לא זמין בדף)`,
      sizeHint,
    };
  }

  const bySize = new Map<string, boolean>();
  for (const v of variations) {
    const slug = sizeAttr ? v.attributes?.[sizeAttr] : Object.values(v.attributes ?? {})[0];
    if (slug === undefined || slug === '') continue;
    const label = (sizeAttr && labels[sizeAttr]?.[slug]) || safeDecodeURIComponent(slug);
    const ok = v.is_in_stock !== false && v.is_purchasable !== false && v.variation_is_active !== false;
    bySize.set(label, (bySize.get(label) ?? false) || ok);
  }
  // Sizes shown in the select but with no variation at all are not sellable
  if (sizeAttr) for (const label of Object.values(labels[sizeAttr])) if (!bySize.has(label)) bySize.set(label, false);

  const sizes = [...bySize.entries()].map(([label, available]) => ({ label, available }));
  const inStock = productInStock && sizes.some(s => s.available);
  return {
    status: 'found',
    inStock,
    sizes: sizes.length ? sizes : null,
    title,
    url,
    detail: inStock
      ? `במלאי באתר ${shopName} — מידות זמינות: ${sizes.filter(s => s.available).map(s => s.label).join(', ')}`
      : `אזל באתר ${shopName}`,
    sizeHint,
  };
}

export async function fetchWooPageStock(url: string, shopName: string): Promise<SupplierStock & { sizeHint: string }> {
  try {
    const { status, text } = await getText(url);
    if (status === 404 || status === 410) {
      return { status: 'not_found', inStock: false, sizes: null, url, detail: `המוצר הוסר מאתר ${shopName}`, sizeHint: '' };
    }
    if (status >= 400) {
      return { status: 'error', inStock: false, sizes: null, url, detail: `אתר ${shopName} החזיר שגיאה ${status}`, sizeHint: '' };
    }
    return parseWooProductPage(text, url, shopName);
  } catch (err: any) {
    return { status: 'error', inStock: false, sizes: null, url, detail: `תקלה בגישה לאתר ${shopName}: ${err?.message ?? err}`, sizeHint: '' };
  }
}

// ---------------------------------------------------------------------------
// Store API — wilson.co.il
// ---------------------------------------------------------------------------

interface StoreApiTerm {
  id: number;
  name: string;
  slug: string;
}
interface StoreApiAttribute {
  id: number;
  name: string;
  taxonomy?: string;
  has_variations: boolean;
  terms: StoreApiTerm[];
}
export interface StoreApiProduct {
  id: number;
  name: string;
  permalink: string;
  type: string;
  is_in_stock: boolean;
  is_purchasable?: boolean;
  sku?: string;
  attributes?: StoreApiAttribute[];
  variations?: { id: number; attributes: { name: string; value: string }[] }[];
}
export interface StoreApiVariation {
  id: number;
  parent?: number;
  is_in_stock: boolean;
  is_purchasable?: boolean;
  variation?: string;
}

/** Pure combiner for Store API data — exported for tests. */
export function buildStoreApiStock(
  product: StoreApiProduct,
  variations: StoreApiVariation[],
  shopName: string,
): SupplierStock & { sizeHint: string } {
  const title = stripTags(product.name);
  const url = product.permalink;
  const colorAttr = product.attributes?.find(a => /color|colour|צבע/i.test(`${a.taxonomy ?? ''} ${a.name}`));
  const color = colorAttr?.terms?.map(t => t.name).join(' / ');

  const varying = (product.attributes ?? []).filter(a => a.has_variations);
  if (product.type !== 'variable' || !product.variations?.length || varying.length === 0) {
    return {
      status: 'found',
      inStock: !!product.is_in_stock,
      sizes: null,
      title,
      color,
      url,
      detail: product.is_in_stock ? `במלאי באתר ${shopName}` : `אזל באתר ${shopName}`,
      sizeHint: '',
    };
  }

  // The varying attribute with the most terms is the size
  const sizeAttr = [...varying].sort((a, b) => (b.terms?.length ?? 0) - (a.terms?.length ?? 0))[0];
  const slugToName = new Map(sizeAttr.terms.map(t => [safeDecodeURIComponent(t.slug), t.name]));
  const stockById = new Map(variations.map(v => [v.id, v.is_in_stock !== false && v.is_purchasable !== false]));

  const bySize = new Map<string, boolean>();
  for (const v of product.variations) {
    const attr = v.attributes.find(a => a.name === sizeAttr.name) ?? v.attributes[0];
    if (!attr) continue;
    const slug = safeDecodeURIComponent(attr.value);
    const label = slugToName.get(slug) ?? slug;
    const ok = stockById.get(v.id) ?? false; // unknown variation → not sellable
    bySize.set(label, (bySize.get(label) ?? false) || ok);
  }
  // Terms that have no variation at all are not sellable
  for (const t of sizeAttr.terms) if (!bySize.has(t.name)) bySize.set(t.name, false);

  const sizes = [...bySize.entries()].map(([label, available]) => ({ label, available }));
  const inStock = !!product.is_in_stock && sizes.some(s => s.available);
  return {
    status: 'found',
    inStock,
    sizes,
    title,
    color,
    url,
    detail: inStock
      ? `במלאי באתר ${shopName} — מידות זמינות: ${sizes.filter(s => s.available).map(s => s.label).join(', ')}`
      : `אזל באתר ${shopName}`,
    sizeHint: sizeAttr.name,
  };
}

export async function fetchStoreApiStock(baseUrl: string, productId: string, shopName: string): Promise<SupplierStock & { sizeHint: string }> {
  const api = `${baseUrl}/wp-json/wc/store/v1/products`;
  const url = `${baseUrl}/?p=${productId}`;
  try {
    const { status, data } = await getJson<StoreApiProduct>(`${api}/${productId}`);
    if (status === 404 || (data as any)?.code === 'woocommerce_rest_product_invalid_id') {
      return { status: 'not_found', inStock: false, sizes: null, url, detail: `המוצר הוסר מאתר ${shopName}`, sizeHint: '' };
    }
    if (status >= 400 || !data || typeof data.id !== 'number') {
      return { status: 'error', inStock: false, sizes: null, url, detail: `אתר ${shopName} החזיר תשובה לא צפויה (${status})`, sizeHint: '' };
    }

    let variations: StoreApiVariation[] = [];
    const ids = (data.variations ?? []).map(v => v.id);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await getJson<StoreApiVariation[]>(`${api}?type=variation&per_page=100&include=${chunk.join(',')}`);
      if (Array.isArray(res.data)) variations = variations.concat(res.data);
    }
    return buildStoreApiStock(data, variations, shopName);
  } catch (err: any) {
    return { status: 'error', inStock: false, sizes: null, url, detail: `תקלה בגישה לאתר ${shopName}: ${err?.message ?? err}`, sizeHint: '' };
  }
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export async function fetchStoreApiCatalog(supplier: SupplierId, baseUrl: string): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  for (let page = 1; page <= 30; page++) {
    const { status, data, headers } = await getJson<StoreApiProduct[]>(
      `${baseUrl}/wp-json/wc/store/v1/products?per_page=100&page=${page}`,
      60000,
    );
    if (status !== 200 || !Array.isArray(data)) {
      if (page === 1) throw new Error(`${supplier} catalog HTTP ${status}`);
      break;
    }
    for (const p of data) {
      const colorAttr = p.attributes?.find(a => /color|colour|צבע/i.test(`${a.taxonomy ?? ''} ${a.name}`));
      items.push({
        supplier,
        ref: String(p.id),
        url: p.permalink,
        title: stripTags(p.name),
        color: colorAttr?.terms?.map(t => t.name).join(' / '),
        sku: p.sku || undefined,
        inStock: p.is_in_stock,
      });
    }
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '1');
    if (page >= totalPages || data.length < 100) break;
  }
  return items;
}

/** tennis-online: the WordPress posts API lists every product title + link. */
export async function fetchWpProductCatalog(supplier: SupplierId, baseUrl: string): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  for (let page = 1; page <= 30; page++) {
    const { status, data, headers } = await getJson<{ id: number; link: string; title: { rendered: string } }[]>(
      `${baseUrl}/wp-json/wp/v2/product?per_page=100&page=${page}&_fields=id,link,title`,
      60000,
    );
    if (status !== 200 || !Array.isArray(data)) {
      if (page === 1) throw new Error(`${supplier} catalog HTTP ${status}`);
      break;
    }
    for (const p of data) {
      items.push({ supplier, ref: p.link, url: p.link, title: stripTags(p.title?.rendered ?? '') });
    }
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '1');
    if (page >= totalPages || data.length < 100) break;
  }
  return items;
}
