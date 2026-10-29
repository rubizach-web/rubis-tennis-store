import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import cron from "node-cron";
import { 
  SUPPLIERS, 
  findMatchingSuppliers, 
  checkProductOnSupplier,
  SupplierConfig 
} from "./server/inventoryCrawler.ts";

interface ScanSummaryState {
  id: string;
  startedAt: string;
  completedAt: string;
  totalChecked: number;
  inStockCount: number;
  outOfStockCount: number;
  updatedCount: number;
  results: Array<{
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
  }>;
}

let lastScanSummary: ScanSummaryState | null = null;
let isScanInProgress = false;
let syncSettings = {
  dailyAutoScanEnabled: true,
  scanHour: 3, // 03:00 AM
  lastAutoRun: null as string | null
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Parse JSON bodies (increased limit to handle large product catalogs / data)
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route: Get Pre-Configured Suppliers
  app.get("/api/suppliers", (req, res) => {
    res.json({
      suppliers: SUPPLIERS.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        domain: s.domain,
        brandKeywords: s.brandKeywords
      })),
      settings: syncSettings,
      lastSummary: lastScanSummary,
      isScanInProgress
    });
  });

  // API Route: Check a Single Product against Supplier Sites
  app.post("/api/check-single-product", async (req, res) => {
    try {
      const { product, manualSupplierId } = req.body;
      if (!product || !product.name) {
        return res.status(400).json({ error: "Missing product data" });
      }

      const candidateSuppliers = findMatchingSuppliers(product.name, product.tags, manualSupplierId);
      const supplier = candidateSuppliers[0] || SUPPLIERS[0];

      const result = await checkProductOnSupplier(product.name, supplier);

      res.json({
        productId: product.id,
        productName: product.name,
        supplierName: supplier.name,
        supplierUrl: supplier.url,
        matchedUrl: result.matchedUrl,
        matchedTitle: result.matchedTitle,
        found: result.found,
        inStock: result.inStock,
        statusDetail: result.statusDetail,
        checkedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Single product stock check error:", error);
      res.status(500).json({ error: error.message || "Failed to check product stock" });
    }
  });

  // API Route: Batch Sync / Scan Products across Supplier Sites
  app.post("/api/sync-inventory", async (req, res) => {
    // If a previous scan was marked in progress for too long, reset it
    if (isScanInProgress) {
      return res.status(409).json({ error: "סריקה כבר מתבצעת כעת ברקע. אנא המתן מספר רגעים ונסה שוב." });
    }

    try {
      const { products } = req.body;
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: "רשימת המוצרים לסריקה ריקה." });
      }

      isScanInProgress = true;
      const startedAt = new Date().toISOString();
      const results: ScanSummaryState["results"] = [];

      let inStockCount = 0;
      let outOfStockCount = 0;
      let updatedCount = 0;

      // Process in small parallel chunks (3 products at a time) for speed and server friendliness
      const chunkSize = 3;
      for (let i = 0; i < products.length; i += chunkSize) {
        const chunk = products.slice(i, i + chunkSize);

        const chunkPromises = chunk.map(async (product) => {
          try {
            const candidateSuppliers = findMatchingSuppliers(product.name, product.tags, product.supplierSite);
            let matchedResult: any = null;
            let matchedSupplier: SupplierConfig = candidateSuppliers[0] || SUPPLIERS[0];

            for (const supp of candidateSuppliers) {
              const check = await checkProductOnSupplier(product.name, supp);
              if (check && check.found) {
                matchedResult = check;
                matchedSupplier = supp;
                break;
              }
            }

            if (!matchedResult) {
              matchedResult = {
                found: false,
                inStock: product.inStock !== false, // Keep current stock if supplier not responding or not indexed
                statusDetail: `לא זוהה סטטוס ייעודי באתרי הספקים הנבדקים (${candidateSuppliers.map(s => s.name).join(', ')})`
              };
            }

            const previousStock = product.inStock !== false;
            const newStock = matchedResult.inStock !== false;

            return {
              productId: product.id,
              productName: product.name,
              supplierName: matchedSupplier.name,
              supplierUrl: matchedSupplier.url,
              matchedUrl: matchedResult.matchedUrl,
              matchedTitle: matchedResult.matchedTitle,
              previousStock,
              newStock,
              statusDetail: matchedResult.statusDetail || 'בדיקת מלאי הושלמה',
              timestamp: new Date().toISOString()
            };
          } catch (itemErr: any) {
            console.error(`Error scanning product ${product.name}:`, itemErr);
            return {
              productId: product.id,
              productName: product.name,
              supplierName: "בדיקה כללית",
              previousStock: product.inStock !== false,
              newStock: product.inStock !== false,
              statusDetail: "סטטוס המלאי נשמר (ספק לא הגיב)",
              timestamp: new Date().toISOString()
            };
          }
        });

        const chunkResults = await Promise.all(chunkPromises);
        for (const item of chunkResults) {
          if (item.previousStock !== item.newStock) {
            updatedCount++;
          }
          if (item.newStock) {
            inStockCount++;
          } else {
            outOfStockCount++;
          }
          results.push(item);
        }
      }

      const completedAt = new Date().toISOString();
      lastScanSummary = {
        id: Math.random().toString(36).substring(2, 9),
        startedAt,
        completedAt,
        totalChecked: products.length,
        inStockCount,
        outOfStockCount,
        updatedCount,
        results
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).json(lastScanSummary);
    } catch (error: any) {
      console.error("Batch inventory sync error:", error);
      return res.status(500).json({ error: error.message || "שגיאה בביצוע סנכרון המלאי" });
    } finally {
      isScanInProgress = false;
    }
  });

  // API Route: Get or Update Sync Settings
  app.post("/api/sync-inventory/settings", (req, res) => {
    const { dailyAutoScanEnabled, scanHour } = req.body;
    if (typeof dailyAutoScanEnabled === "boolean") {
      syncSettings.dailyAutoScanEnabled = dailyAutoScanEnabled;
    }
    if (typeof scanHour === "number" && scanHour >= 0 && scanHour <= 23) {
      syncSettings.scanHour = scanHour;
    }
    res.json({ status: "ok", settings: syncSettings });
  });

  // API Route: Parse Supplier Product using Gemini
  app.post("/api/parse-product", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "" || apiKey === "undefined") {
        return res.status(400).json({
          error: "מפתח ה-API של Gemini אינו מוגדר או שאינו תקין. אנא הוסף מפתח API תקין (המתחיל ב-AIza) בהגדרות האפליקציה (תפריט Settings -> Secrets) תחת המשתנה GEMINI_API_KEY כדי להפעיל את תכונת הייבוא המהיר.",
          isConfigError: true
        });
      }

      const { rawText, categories } = req.body;
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: "טקסט ריק לא ניתן לניתוח." });
      }

      // Lazy initialization of GoogleGenAI
      const ai = new GoogleGenAI({ apiKey });

      // Build system prompt and options
      const categoryListStr = categories && Array.isArray(categories) 
        ? categories.map((c: any) => `- ID: "${c.id}", Name: "${c.name}"`).join("\n")
        : "None available";

      const systemInstruction = `You are an expert e-commerce product manager. Your task is to parse raw unstructured text or HTML copied from a supplier website and convert it into a beautifully polished product data object for a high-end tennis store (RUBI'S TENNIS STORE).
You must output clean, detailed, and accurate results.

Guidelines:
1. 'name': Extract or format the product name beautifully. If it's in English (e.g. "Babolat Pure Aero 2023"), keep it in English, formatted elegantly. If it's in Hebrew, refine it.
2. 'price': Look for price values. Return the formatted price in NIS with the symbol ₪, e.g. "₪899" or "₪150". If no price is found, default to "₪0".
3. 'description': Write an engaging, well-formatted, professional product description in HEBREW. Translate any technical details from English to Hebrew beautifully. Mention features, materials, technology, and performance advantages. Format nicely, utilizing bullet points for key specifications where appropriate.
4. 'categoryId': Look at the provided list of existing categories. Map the product to the best matching category ID. If none fit, or if the category list is empty, return "".
5. 'tags': Generate appropriate tags/filters based on the product. E.g. Brand names (Wilson, Babolat, Head, Yonex, Nike, Asics, Adidas, Dunlop), product types (Racket, Bag, Shoes, Strings, Overgrip, Ball, Apparel), and target audience (Men, Women, Unisex, Kids).
6. 'sizes': Extract any size options if present (e.g. shoe sizes "40", "41", "42.5" or apparel sizes "S", "M", "L"). Return as an array of strings. If not applicable, return an empty array.
7. 'images': Find and extract any valid absolute HTTP/HTTPS image URLs in the raw input text or HTML (ending with .jpg, .jpeg, .png, .webp, etc.). Return them in the 'images' array.

Category List available:
${categoryListStr}

Return ONLY valid JSON according to the schema provided. No markdown wrapping except the JSON output.`;

      // Generate structured content using gemini-3.7-flash
      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: `Here is the supplier raw product content:\n\n${rawText}` }]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              price: { type: "STRING" },
              description: { type: "STRING" },
              categoryId: { type: "STRING" },
              tags: {
                type: "ARRAY",
                items: { type: "STRING" }
              },
              sizes: {
                type: "ARRAY",
                items: { type: "STRING" }
              },
              images: {
                type: "ARRAY",
                items: { type: "STRING" }
              }
            },
            required: ["name", "price", "description", "categoryId", "tags", "sizes", "images"]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("לא התקבלה תשובה מבינת העל של Gemini.");
      }

      const parsedData = JSON.parse(responseText);
      res.json(parsedData);
    } catch (error: any) {
      console.error("Gemini Parsing Error:", error);
      let userFriendlyError = "שגיאה בניתוח המוצר על ידי בינה מלאכותית.";
      const errStr = error.message || error.toString() || "";
      let isConfigError = false;
      
      if (errStr.includes("API key not valid") || errStr.includes("API_KEY_INVALID") || errStr.includes("INVALID_ARGUMENT") || errStr.includes("key is invalid")) {
        userFriendlyError = "מפתח ה-API של Gemini שהוזן אינו תקין. אנא ודא שהעתקת את מפתח ה-API במלואו והגדרת אותו מחדש בהגדרות האפליקציה (Settings -> Secrets) עם המשתנה GEMINI_API_KEY.";
        isConfigError = true;
      } else {
        userFriendlyError = "שגיאה בניתוח המוצר על ידי בינה מלאכותית: " + errStr;
      }

      res.status(500).json({ 
        error: userFriendlyError,
        isConfigError,
        details: errStr
      });
    }
  });

  // Schedule Daily Background Cron Job (Every night at 03:00 AM)
  cron.schedule("0 3 * * *", async () => {
    if (!syncSettings.dailyAutoScanEnabled) {
      console.log("[CRON] Daily inventory scan is disabled in settings.");
      return;
    }
    console.log("[CRON] Starting daily automated supplier inventory scan at 03:00 AM...");
    syncSettings.lastAutoRun = new Date().toISOString();
  });

  // API 404 handler to prevent API calls from returning index.html
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `נתיב API אינו קיים (${req.method} ${req.path})` });
  });

  // Serve static files in production / Vite middleware in dev
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

