import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';

export interface SupplierConfig {
  id: string;
  name: string;
  url: string;
  domain: string;
  brandKeywords: string[];
  searchUrls: (query: string) => string[];
}

export const SUPPLIERS: SupplierConfig[] = [
  {
    id: 'babolat',
    name: 'BABOLAT ISRAEL',
    url: 'https://babolat.co.il',
    domain: 'babolat.co.il',
    brandKeywords: ['babolat', 'בבולט', 'באבולט', 'pure aero', 'pure drive', 'pure strike', 'evoke', 'boost'],
    searchUrls: (q: string) => [
      `https://babolat.co.il/?s=${encodeURIComponent(q)}&post_type=product`
    ]
  },
  {
    id: 'wilson',
    name: 'WILSON ISRAEL',
    url: 'https://wilson.co.il',
    domain: 'wilson.co.il',
    brandKeywords: ['wilson', 'ווילסון', 'וילסון', 'pro staff', 'blade', 'clash', 'ultra', 'burn', 'shift'],
    searchUrls: (q: string) => [
      `https://wilson.co.il/?s=${encodeURIComponent(q)}&post_type=product`
    ]
  },
  {
    id: 'yonex',
    name: 'YONEX / TENNIS ONLINE',
    url: 'https://www.tennis-online.co.il',
    domain: 'tennis-online.co.il',
    brandKeywords: ['yonex', 'יונקס', 'ezone', 'vcore', 'percept', 'astrox', 'nanoflare'],
    searchUrls: (q: string) => [
      `https://www.tennis-online.co.il/?s=${encodeURIComponent(q)}&post_type=product`
    ]
  },
  {
    id: 'sportcenter',
    name: 'ספורט סנטר',
    url: 'https://www.sportcenter.co.il',
    domain: 'sportcenter.co.il',
    brandKeywords: ['head', 'הד', 'speed', 'radical', 'gravity', 'extreme', 'prestige', 'boom', 'ספורט סנטר', 'sportcenter'],
    searchUrls: (q: string) => [
      `https://www.sportcenter.co.il/?s=${encodeURIComponent(q)}&post_type=product`
    ]
  },
  {
    id: 'bashgal',
    name: 'בש-גל ספורט',
    url: 'https://bashgal.co.il',
    domain: 'bashgal.co.il',
    brandKeywords: ['bashgal', 'בש-גל', 'בש גל', 'dunlop', 'דנלופ', 'prince', 'פרינס', 'tecnifibre', 'טכניפייבר'],
    searchUrls: (q: string) => [
      `https://bashgal.co.il/?s=${encodeURIComponent(q)}&post_type=product`
    ]
  }
];

// Normalized token extractor
function extractSearchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\u0590-\u05FF\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !['של', 'עם', 'את', 'מחיר', 'שח', 'דגם', 'עבור', 'the', 'and', 'with', 'for', 'tennis', 'טניס'].includes(t));
}

// Find matching suppliers for a product
export function findMatchingSuppliers(productName: string, tags?: string[], manualSupplierId?: string): SupplierConfig[] {
  if (manualSupplierId) {
    const found = SUPPLIERS.find(s => s.id === manualSupplierId || s.name === manualSupplierId);
    if (found) return [found];
  }

  const searchScope = `${productName} ${(tags || []).join(' ')}`.toLowerCase();
  
  const matched = SUPPLIERS.filter(supplier => {
    return supplier.brandKeywords.some(keyword => searchScope.includes(keyword.toLowerCase()));
  });

  return matched.length > 0 ? matched : [SUPPLIERS[0]];
}

// Check stock on a supplier site using HTTP fetch + Cheerio
export async function checkProductOnSupplier(
  productName: string, 
  supplier: SupplierConfig,
  customQuery?: string
): Promise<{
  found: boolean;
  inStock: boolean;
  matchedTitle?: string;
  matchedUrl?: string;
  statusDetail: string;
  price?: string;
}> {
  const query = (customQuery || productName.replace(/\(.*?\)/g, '')).trim();
  const searchUrls = supplier.searchUrls(query);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache'
  };

  const productTokens = extractSearchTokens(productName);

  for (const url of searchUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);

      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      // Collect product cards or items
      const candidateElements: { el: any; title: string; link: string; htmlText: string }[] = [];

      // Check common WooCommerce, Shopify, Magento, custom selectors
      const selectors = [
        '.product', '.product-item', '.product-card', '.type-product',
        'article.product', '.grid-item', '.grid__item', '.product_item',
        '.main-products .item', '.products-grid .item', '.card-product',
        'li.product'
      ];

      $(selectors.join(', ')).each((_, elem) => {
        const titleEl = $(elem).find('.woocommerce-loop-product__title, .product-title, .title, h2, h3, .name, a.title, .product-item-link').first();
        const title = titleEl.text().trim();
        const link = $(elem).find('a').first().attr('href') || url;
        const htmlText = $(elem).text().toLowerCase();

        if (title) {
          candidateElements.push({ el: $(elem), title, link, htmlText });
        }
      });

      // If no cards detected via selectors, check all links containing titles
      if (candidateElements.length === 0) {
        $('h2, h3, h4').each((_, h) => {
          const title = $(h).text().trim();
          const link = $(h).closest('a').attr('href') || $(h).find('a').attr('href') || url;
          const htmlText = $(h).closest('div, section, article').text().toLowerCase();
          if (title.length > 4) {
            candidateElements.push({ el: $(h), title, link, htmlText });
          }
        });
      }

      // Check match score for each candidate
      let bestMatch: { title: string; link: string; htmlText: string; score: number } | null = null;

      for (const candidate of candidateElements) {
        const candTokens = extractSearchTokens(candidate.title);
        if (candTokens.length === 0) continue;

        let matches = 0;
        for (const token of productTokens) {
          if (candTokens.some(ct => ct.includes(token) || token.includes(ct))) {
            matches++;
          }
        }

        const score = matches / Math.max(productTokens.length, 1);
        if (score >= 0.3 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { ...candidate, score };
        }
      }

      if (bestMatch) {
        const fullMatchedUrl = bestMatch.link.startsWith('http') 
          ? bestMatch.link 
          : `${supplier.url}${bestMatch.link.startsWith('/') ? '' : '/'}${bestMatch.link}`;

        // Check out of stock indicators in the card
        const outOfStockPhrases = [
          'אזל מהמלאי',
          'אזל המלאי',
          'לא במלאי',
          'חסר במלאי',
          'זמנית לא במלאי',
          'לא זמין',
          'out of stock',
          'sold out',
          'outofstock',
          'is-sold-out',
          'badge--sold-out'
        ];

        const isOutOfStock = outOfStockPhrases.some(phrase => bestMatch!.htmlText.includes(phrase));

        return {
          found: true,
          inStock: !isOutOfStock,
          matchedTitle: bestMatch.title,
          matchedUrl: fullMatchedUrl,
          statusDetail: isOutOfStock 
            ? `נמצא באתר ${supplier.name} אך מסומן שאינו זמין במלאי ("${bestMatch.title}")`
            : `נמצא ומאומת במלאי באתר ${supplier.name} ("${bestMatch.title}")`
        };
      }

      // If page indicates "no products found"
      const noResultsPhrases = ['לא נמצאו מוצרים', 'לא נמצאו תוצאות', 'no products were found', '0 תוצאות'];
      const pageText = $('body').text().toLowerCase();
      const hasNoResults = noResultsPhrases.some(p => pageText.includes(p));

      if (hasNoResults) {
        return {
          found: false,
          inStock: false,
          statusDetail: `לא נמצאו פריטים תואמים באתר ${supplier.name}`
        };
      }

    } catch (err: any) {
      console.warn(`Error scanning ${supplier.name} at ${url}:`, err.message);
    }
  }

  // If we couldn't find a direct card, return unconfirmed / not found
  return {
    found: false,
    inStock: false,
    statusDetail: `המוצר לא אותר בחיפוש באתר ${supplier.name}`
  };
}

// AI-Assisted Stock & Product Verification using Gemini (when available)
export async function verifyStockWithAi(
  productName: string,
  supplierName: string,
  scrapedSnippet: string,
  apiKey?: string
): Promise<{ inStock: boolean; confidence: number; reason: string }> {
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return { inStock: true, confidence: 0.5, reason: 'בדיקת טקסט סטנדרטית' };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Check if this product is in stock based on the supplier text snippet:
Product Name: "${productName}"
Supplier: "${supplierName}"
Supplier Snippet: "${scrapedSnippet.slice(0, 1500)}"

Return JSON with:
- "inStock": boolean (true if in stock / purchasable, false if out of stock or sold out)
- "confidence": number (0 to 1)
- "reason": string (short summary in Hebrew)`
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    return {
      inStock: Boolean(parsed.inStock),
      confidence: Number(parsed.confidence) || 0.8,
      reason: parsed.reason || 'נבדק בעזרת Gemini AI'
    };
  } catch (err) {
    return { inStock: true, confidence: 0.5, reason: 'הערכה ראשונית' };
  }
}
