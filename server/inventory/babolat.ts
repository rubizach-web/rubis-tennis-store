/**
 * babolat.co.il (custom Laravel shop).
 *
 * Every product page embeds `window.product = {...}` with:
 *   - options.options: the choices (size slider, colour, add-ons such as stringing)
 *   - options.variants: every purchasable combination, tagged with product_id
 *
 * The variants' own `in_stock` flag is always false on this site, so it is
 * ignored. A size is sellable when a variant of THIS product (this colour)
 * contains it; sizes that sold out simply disappear from the variants.
 *
 * Catalog: /googfeed.xml lists every live product (id, title, mpn, link).
 */

import type { CatalogItem, SupplierSize, SupplierStock } from './types.ts';
import { getText } from './http.ts';
import { extractJsonAfter, stripTags, decodeEntities } from './parse.ts';

const BASE = 'https://babolat.co.il';

interface BabolatOptionValue {
  id: number | string;
  name: string;
}
interface BabolatOption {
  id: number;
  option_type: string;
  class?: string;
  name: string;
  values: BabolatOptionValue[];
}
interface BabolatVariant {
  product_id: number | string;
  attr_values: Array<number | string>;
  url?: string;
}
interface BabolatProduct {
  id: number | string;
  color_id?: number | string;
  name: string;
  options?: { options?: BabolatOption[]; variants?: Record<string, BabolatVariant> };
}

export function babolatProductUrl(ref: string): string {
  if (/^\d+$/.test(ref)) return `${BASE}/product/${ref}`;
  return ref;
}

/** Pure parser — exported for tests. */
export function parseBabolatProduct(html: string, url: string): SupplierStock {
  const p = extractJsonAfter(html, 'window.product') as BabolatProduct | null;
  if (!p || p.id === undefined) {
    return {
      status: 'not_found',
      inStock: false,
      sizes: null,
      url,
      detail: 'דף המוצר אצל בבולט לא מכיל מוצר (כנראה הוסר מהאתר)',
    };
  }

  const options = p.options?.options ?? [];
  const ownVariants = Object.values(p.options?.variants ?? {}).filter(v => String(v.product_id) === String(p.id));

  const colorOpt = options.find(o => o.class === 'color');
  const color = colorOpt?.values.find(v => String(v.id) === String(p.color_id))?.name;

  // The size choice is a real attribute ("attr") that is not the colour.
  const sizeOpt = options.find(o => o.option_type === 'attr' && o.class !== 'color');

  const inStock = ownVariants.length > 0 || options.length === 0;

  let sizes: SupplierSize[] | null = null;
  if (sizeOpt && sizeOpt.values.length > 0) {
    const sellable = new Set<string>();
    for (const v of ownVariants) for (const a of v.attr_values) sellable.add(String(a));
    sizes = sizeOpt.values
      .map(v => ({ label: stripTags(v.name), available: sellable.has(String(v.id)) }))
      // a single "UNIQ"/one-size value is not a real size choice
      .filter(s => s.label !== '');
    if (sizes.length === 1 && /^(uniq|one ?size|onesize)$/i.test(sizes[0].label)) sizes = null;
  }

  const availableLabels = sizes?.filter(s => s.available).map(s => s.label) ?? [];
  return {
    status: 'found',
    inStock,
    sizes,
    title: stripTags(p.name),
    color: color ? stripTags(color) : undefined,
    url,
    detail: inStock
      ? sizes
        ? `במלאי בבבולט — מידות זמינות: ${availableLabels.join(', ') || 'אין'}`
        : 'במלאי בבבולט'
      : 'אזל בבבולט (אין אף וריאציה זמינה)',
  };
}

export function babolatSizeHint(html: string): string {
  const p = extractJsonAfter(html, 'window.product') as BabolatProduct | null;
  return p?.options?.options?.find(o => o.option_type === 'attr' && o.class !== 'color')?.name ?? '';
}

export async function fetchBabolatStock(ref: string): Promise<SupplierStock & { sizeHint: string }> {
  const url = babolatProductUrl(ref);
  try {
    const { status, text } = await getText(url);
    if (status === 404 || status === 410) {
      return { status: 'not_found', inStock: false, sizes: null, url, detail: 'המוצר הוסר מאתר בבולט', sizeHint: '' };
    }
    if (status >= 400) {
      return { status: 'error', inStock: false, sizes: null, url, detail: `אתר בבולט החזיר שגיאה ${status}`, sizeHint: '' };
    }
    return { ...parseBabolatProduct(text, url), sizeHint: babolatSizeHint(text) };
  } catch (err: any) {
    return { status: 'error', inStock: false, sizes: null, url, detail: `תקלה בגישה לבבולט: ${err?.message ?? err}`, sizeHint: '' };
  }
}

/** Pure parser for /googfeed.xml — exported for tests. */
export function parseBabolatFeed(xml: string): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const chunk of xml.split('<item>').slice(1)) {
    const g = (tag: string) => {
      const m = chunk.match(new RegExp(`<g:${tag}>([\\s\\S]*?)</g:${tag}>`));
      return m ? decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : undefined;
    };
    const id = g('id');
    const title = g('title');
    if (!id || !title) continue;
    items.push({
      supplier: 'babolat',
      ref: id,
      url: `${BASE}/product/${id}`,
      title,
      sku: g('mpn'),
      color: g('color'),
      inStock: g('availability') !== 'out_of_stock',
    });
  }
  return items;
}

export async function fetchBabolatCatalog(): Promise<CatalogItem[]> {
  const { status, text } = await getText(`${BASE}/googfeed.xml`, 60000);
  if (status !== 200) throw new Error(`babolat feed HTTP ${status}`);
  return parseBabolatFeed(text);
}

/** Colour of one catalog item (needs its page; used only to break ties). */
export async function fetchBabolatColor(ref: string): Promise<string | undefined> {
  const stock = await fetchBabolatStock(ref);
  return stock.color;
}
