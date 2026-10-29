/**
 * Shared types for supplier stock syncing.
 *
 * Everything under server/inventory is dependency-free on purpose: the same
 * code runs inside the Express server (Cloud Run), in the daily GitHub Actions
 * job, and in plain `node --test` unit tests.
 */

export type SupplierId = 'babolat' | 'wilson' | 'yonex';

export interface SupplierInfo {
  id: SupplierId;
  name: string;
  baseUrl: string;
  /** Lower-case words that identify the brand in a product name. */
  brandKeywords: string[];
}

export const SUPPLIER_INFO: Record<SupplierId, SupplierInfo> = {
  babolat: {
    id: 'babolat',
    name: 'Babolat Israel',
    baseUrl: 'https://babolat.co.il',
    brandKeywords: ['babolat', 'בבולט', 'באבולט'],
  },
  wilson: {
    id: 'wilson',
    name: 'Wilson Israel',
    baseUrl: 'https://wilson.co.il',
    brandKeywords: ['wilson', 'וילסון', 'ווילסון'],
  },
  yonex: {
    id: 'yonex',
    name: 'Tennis Online (Yonex)',
    baseUrl: 'https://www.tennis-online.co.il',
    brandKeywords: ['yonex', 'יונקס'],
  },
};

export const SUPPLIER_IDS = Object.keys(SUPPLIER_INFO) as SupplierId[];

/** One size/option as the supplier shows it. */
export interface SupplierSize {
  label: string;
  available: boolean;
}

/** What a supplier says about one linked product right now. */
export interface SupplierStock {
  /**
   * found      – product page/API answered and was understood
   * not_found  – the supplier no longer lists the product (treated as sold out)
   * error      – network/parse problem; nothing is known
   */
  status: 'found' | 'not_found' | 'error';
  /** True when at least one purchasable variant exists. */
  inStock: boolean;
  /** null when the product has no size choice at the supplier. */
  sizes: SupplierSize[] | null;
  title?: string;
  color?: string;
  url: string;
  detail: string;
}

/** A product in a supplier's catalog, used for linking. */
export interface CatalogItem {
  supplier: SupplierId;
  /** Stable reference stored on the product (URL or numeric id as string). */
  ref: string;
  url: string;
  title: string;
  color?: string;
  sku?: string;
  inStock?: boolean;
}

/** Link state stored on a product. */
export type LinkStatus =
  | 'confirmed' // approved by the store owner
  | 'auto' // linked automatically with high confidence
  | 'suggested' // candidates found, waiting for approval
  | 'none' // nothing found
  | 'manual'; // not synced automatically (other suppliers / owner's choice)

export interface LinkSuggestion {
  ref: string;
  url: string;
  title: string;
  color?: string;
  score: number;
}

/** The subset of the store's Product that syncing reads and writes. */
export interface SyncableProduct {
  id: string;
  name: string;
  tags?: string[];
  sizes?: string[];
  inStock?: boolean;
  supplierSite?: string;
  supplierUrl?: string;
  supplierRef?: string;
  supplierLinkStatus?: LinkStatus;
}

/** Fields the sync writes back onto a product document. */
export interface ProductStockUpdate {
  inStock: boolean;
  unavailableSizes: string[];
  supplierSizes: string[];
  lastStockCheck: string;
  stockStatusDetail: string;
  stockCheckState: 'ok' | 'not_found' | 'error' | 'unlinked' | 'manual';
}
