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
  supplierSite?: string;
  supplierUrl?: string;
  lastStockCheck?: string;
  stockStatusDetail?: string;
}

export interface SupplierSite {
  id: string;
  name: string;
  url: string;
  domain: string;
  logoText: string;
  brandKeywords: string[];
  status?: 'active' | 'scanning' | 'error' | 'idle';
  lastChecked?: string;
  productsFoundCount?: number;
}

export interface ScanReportItem {
  productId: string;
  productName: string;
  supplierName: string;
  supplierUrl?: string;
  matchedUrl?: string;
  previousStock: boolean;
  newStock: boolean;
  statusDetail: string;
  timestamp: string;
  matchedTitle?: string;
}

export interface ScanSummary {
  id: string;
  startedAt: string;
  completedAt: string;
  totalChecked: number;
  inStockCount: number;
  outOfStockCount: number;
  updatedCount: number;
  results: ScanReportItem[];
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
