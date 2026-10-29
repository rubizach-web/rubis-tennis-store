/**
 * Syncs one product end to end (supplier → link → stock) and returns the
 * fields to write. Used by the daily job and by the admin "check now" button.
 */

import type { LinkStatus, LinkSuggestion, ProductStockUpdate, SupplierId, SupplierStock, SyncableProduct } from './types.ts';
import { SUPPLIER_IDS } from './types.ts';
import { computeStockUpdate, decideLink, detectSupplier, fetchStock, type LinkDecision } from './sync.ts';

export type SyncOutcome =
  | 'checked' // linked product, stock read
  | 'linked' // linked automatically during this run, stock read
  | 'needs_link' // waiting for the owner to pick the supplier product
  | 'manual' // supplier updated by hand
  | 'unknown_supplier' // brand not recognised
  | 'not_found' // supplier removed the product
  | 'error'; // supplier did not answer

export interface ProductSyncFields extends Partial<ProductStockUpdate> {
  supplierSite?: string;
  supplierRef?: string;
  supplierUrl?: string;
  supplierLinkStatus?: LinkStatus;
  supplierSuggestions?: LinkSuggestion[];
  supplierLinkReason?: string;
  supplierTitle?: string;
  supplierColor?: string;
}

export interface ProductSyncResult {
  productId: string;
  productName: string;
  outcome: SyncOutcome;
  supplier?: SupplierId;
  fields: ProductSyncFields;
  previousInStock: boolean;
  newInStock: boolean;
  previousUnavailable: string[];
  newUnavailable: string[];
}

export interface SyncDeps {
  decideLink: (p: SyncableProduct, s: SupplierId) => Promise<LinkDecision>;
  fetchStock: (s: SupplierId, ref: string, url?: string) => Promise<SupplierStock & { sizeHint: string }>;
  now?: () => Date;
}

const defaultDeps: SyncDeps = { decideLink, fetchStock };

export interface StoredProduct extends SyncableProduct {
  unavailableSizes?: string[];
}

export async function syncOneProduct(
  p: StoredProduct,
  options: { relink?: boolean } = {},
  deps: SyncDeps = defaultDeps,
): Promise<ProductSyncResult> {
  const now = deps.now?.() ?? new Date();
  const previousInStock = p.inStock !== false;
  const previousUnavailable = p.unavailableSizes ?? [];
  const base = { productId: p.id, productName: p.name, previousInStock, previousUnavailable };
  const unchanged = { newInStock: previousInStock, newUnavailable: previousUnavailable };

  // The owner explicitly took this product out of the automatic sync
  if (p.supplierLinkStatus === 'manual') {
    return { ...base, ...unchanged, outcome: 'manual', fields: { stockCheckState: 'manual', lastStockCheck: now.toISOString() } };
  }

  const detected = detectSupplier(p);
  if (detected === 'manual') {
    return {
      ...base, ...unchanged, outcome: 'manual',
      fields: { stockCheckState: 'manual', stockStatusDetail: 'ספק שמעודכן ידנית — לא נבדק אוטומטית', lastStockCheck: now.toISOString() },
    };
  }
  if (detected === null) {
    return {
      ...base, ...unchanged, outcome: 'unknown_supplier',
      fields: {
        stockCheckState: 'unlinked',
        stockStatusDetail: 'לא זוהה ספק לפי שם המוצר — בחר ספק במסך המלאי',
        lastStockCheck: now.toISOString(),
      },
    };
  }

  const supplier = detected;
  const fields: ProductSyncFields = { supplierSite: supplier };
  let outcome: SyncOutcome = 'checked';
  let ref = p.supplierRef;
  let url = p.supplierUrl;

  const isLinked = !!ref && (p.supplierLinkStatus === 'confirmed' || (p.supplierLinkStatus === 'auto' && !options.relink));
  if (!isLinked) {
    let decision: LinkDecision;
    try {
      decision = await deps.decideLink(p, supplier);
    } catch (err: any) {
      // Supplier catalog unreachable: nothing is known, so leave stock as is.
      return {
        ...base, ...unchanged, outcome: 'error', supplier,
        fields: {
          supplierSite: supplier,
          stockCheckState: 'error',
          stockStatusDetail: `לא הצלחתי לקרוא את רשימת המוצרים של הספק (${err?.message ?? err}) — המלאי לא שונה`,
          lastStockCheck: now.toISOString(),
        },
      };
    }
    fields.supplierSuggestions = decision.suggestions;
    fields.supplierLinkReason = decision.reason;
    if (decision.status === 'auto' && decision.ref) {
      ref = decision.ref;
      url = decision.url;
      fields.supplierRef = ref;
      fields.supplierUrl = url;
      fields.supplierLinkStatus = 'auto';
      outcome = 'linked';
    } else {
      fields.supplierLinkStatus = decision.status;
      return {
        ...base, ...unchanged, outcome: 'needs_link', supplier,
        fields: {
          ...fields,
          stockCheckState: 'unlinked',
          stockStatusDetail: `${decision.reason}. המלאי לא שונה עד שתאשר את המוצר אצל הספק.`,
          lastStockCheck: now.toISOString(),
        },
      };
    }
  }

  const stock = await deps.fetchStock(supplier, ref!, url);
  const update = computeStockUpdate(p, stock, now);
  if (stock.title) fields.supplierTitle = stock.title;
  if (stock.color) fields.supplierColor = stock.color;
  if (stock.status === 'not_found') outcome = 'not_found';
  if (stock.status === 'error') outcome = 'error';

  return {
    ...base,
    outcome,
    supplier,
    fields: { ...fields, ...update },
    newInStock: update.inStock,
    newUnavailable: update.unavailableSizes,
  };
}

/** True when writing `fields` would change anything besides the timestamp. */
export function hasMeaningfulChange(p: Record<string, any>, fields: ProductSyncFields): boolean {
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'lastStockCheck') continue;
    if (JSON.stringify(p[k] ?? null) !== JSON.stringify(v ?? null)) return true;
  }
  return false;
}

export function isSupplierId(s: unknown): s is SupplierId {
  return typeof s === 'string' && (SUPPLIER_IDS as string[]).includes(s);
}
