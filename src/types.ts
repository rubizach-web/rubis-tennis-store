/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  name: string;
  price: string;
  image: string;
  images?: string[];
  description: string;
  categoryId: string;
  tags?: string[];
  sizes?: string[];
  inStock?: boolean;
  /** 'babolat' | 'wilson' | 'yonex' for synced products (older values may be supplier names). */
  supplierSite?: string;
  /** Page of this exact product (and colour) at the supplier. */
  supplierUrl?: string;
  /** Supplier's own id for the product (Babolat / Wilson) or its URL (Tennis Online). */
  supplierRef?: string;
  /**
   * confirmed – approved by the owner · auto – linked automatically with high confidence
   * suggested – candidates waiting for approval · none – nothing found · manual – not synced
   */
  supplierLinkStatus?: 'confirmed' | 'auto' | 'suggested' | 'none' | 'manual';
  supplierSuggestions?: { ref: string; url: string; title: string; color?: string; score: number }[];
  supplierLinkReason?: string;
  supplierTitle?: string;
  supplierColor?: string;
  /** Store sizes that cannot be sold right now (shown greyed out on the site). */
  unavailableSizes?: string[];
  /** Sizes the supplier currently has (for the owner's reference). */
  supplierSizes?: string[];
  lastStockCheck?: string;
  stockStatusDetail?: string;
  stockCheckState?: 'ok' | 'not_found' | 'error' | 'unlinked' | 'manual';
}

/** True when the product can be bought: in stock, and (if it has sizes) at least one size left. */
export function isSellable(product: Pick<Product, 'inStock' | 'sizes' | 'unavailableSizes'>): boolean {
  if (product.inStock === false) return false;
  const hasSizes = (product.sizes || []).some(s => s.trim());
  return !hasSizes || sellableSizes(product).length > 0;
}

/** Sizes a customer can actually choose for this product. */
export function sellableSizes(product: Pick<Product, 'sizes' | 'unavailableSizes'>): string[] {
  const out = new Set((product.unavailableSizes || []).map(s => s.trim()));
  return (product.sizes || []).filter(s => s.trim() && !out.has(s.trim()));
}

export interface Category {
  id: string;
  name: string;
  subtitle?: string;
  image?: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  message: string;
  timestamp: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize?: string;
}

export interface SiteContent {
  hero: {
    title: string;
    subtitle: string;
    cta: string;
    bgImage: string;
  };
  siteName: string;
  logo: string;
  labels: {
    home: string;
    collection: string;
    contact: string;
    about: string;
    categoriesTitle: string;
  };
  contact: {
    whatsapp: string;
    phone: string;
    facebook: string;
    email: string;
    address: string;
  };
  about: {
    title: string;
    content: string;
    image?: string;
  };
  categories: Category[];
}

export const DEFAULT_CONTENT: SiteContent = {
  hero: {
    title: "יוקרה בכל פרט",
    subtitle: "גלו את הקולקציה החדשה שלנו של מוצרי ספורט ופרימיום",
    cta: "לחנות פייסבוק",
    bgImage: "https://images.unsplash.com/photo-1622279457486-62dcc4a4bd13?auto=format&fit=crop&q=80&w=2000",
  },
  siteName: "RUBI'S TENNIS STORE",
  logo: "https://storage.googleapis.com/static-files-prod/ais-api/v1/projects/ais-dev-rwpn6ahrmao6jpx7xyzwol-443341525750/files/logo.png", // URL to the uploaded logo
  labels: {
    home: "בית",
    collection: "קולקציה",
    contact: "צור קשר",
    about: "אודותינו",
    categoriesTitle: "מבחר קטגוריות",
  },
  contact: {
    whatsapp: "972500000000",
    phone: "050-0000000",
    facebook: "https://facebook.com",
    email: "contact@luxury.com",
    address: "תל אביב, ישראל",
  },
  about: {
    title: "הסיפור שלנו",
    content: "ברוכים הבאים ל-RUBI'S TENNIS STORE. אנחנו מתמחים באספקת ציוד טניס מקצועי ואיכותי לשחקנים בכל הרמות. עם ניסיון של שנים בתחום, אנחנו כאן כדי להבטיח שתקבלו את הטופ של הטופ.",
    image: "https://images.unsplash.com/photo-1595435064212-472178396010?auto=format&fit=crop&q=80&w=800",
  },
  categories: [
    { id: "1", name: "נעליים", subtitle: "קולקציית פרימיום 2026", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=800" },
    { id: "2", name: "תיקים", subtitle: "עמידות וסטייל ללא פשרות", image: "https://images.unsplash.com/photo-1553062407-98eeb94c6a62?auto=format&fit=crop&q=80&w=800" },
    { id: "3", name: "אביזרי ספורט", subtitle: "כל מה שצריך למשחק מושלם", image: "https://images.unsplash.com/photo-1617083270638-ed589254030d?auto=format&fit=crop&q=80&w=800" },
  ],
};
