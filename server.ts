import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { syncOneProduct, isSupplierId } from "./server/inventory/run.ts";
import { detectSupplier, findLink, resolveLinkFromUrl } from "./server/inventory/sync.ts";

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

  // ---------------------------------------------------------------------------
  // Supplier stock (see server/inventory). The daily sync itself runs on
  // GitHub Actions; these routes serve the admin "check now" / linking screen.
  // ---------------------------------------------------------------------------

  // Check one product: link it if needed, read the supplier's stock and
  // return the fields to save. The admin's browser writes them to Firestore.
  app.post("/api/inventory/check", async (req, res) => {
    try {
      const { product, relink } = req.body ?? {};
      if (!product?.id || !product?.name) return res.status(400).json({ error: "חסרים נתוני מוצר" });
      const result = await syncOneProduct(product, { relink: !!relink });
      res.json(result);
    } catch (error: any) {
      console.error("inventory check error:", error);
      res.status(500).json({ error: error?.message || "בדיקת המלאי נכשלה" });
    }
  });

  // Candidate supplier products for a store product
  app.post("/api/inventory/suggest", async (req, res) => {
    try {
      const { product, supplier } = req.body ?? {};
      if (!product?.name) return res.status(400).json({ error: "חסר שם מוצר" });
      const target = isSupplierId(supplier) ? supplier : detectSupplier(product);
      if (!isSupplierId(target)) {
        return res.json({ supplier: target, suggestions: [], reason: "לא זוהה ספק — בחר ספק" });
      }
      const ranked = await findLink(product, target);
      res.json({ supplier: target, suggestions: ranked.suggestions, reason: ranked.reason, confident: ranked.confident });
    } catch (error: any) {
      console.error("inventory suggest error:", error);
      res.status(500).json({ error: error?.message || "חיפוש המוצר אצל הספק נכשל" });
    }
  });

  // Resolve a supplier page the owner pasted, and show its stock
  app.post("/api/inventory/resolve-link", async (req, res) => {
    try {
      const { url } = req.body ?? {};
      if (!url) return res.status(400).json({ error: "חסר קישור" });
      res.json(await resolveLinkFromUrl(String(url)));
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "לא הצלחתי לקרוא את הקישור" });
    }
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

