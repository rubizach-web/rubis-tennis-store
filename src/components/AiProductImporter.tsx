import { useState } from 'react';
import { Sparkles, Loader2, Check, AlertCircle, X, ChevronRight, Image as ImageIcon, Plus } from 'lucide-react';
import { Product, Category } from '../types.ts';
import { safeFetchJson } from '../lib/api.ts';

interface AiProductImporterProps {
  categories: Category[];
  onAddProduct: (product: Product) => Promise<void>;
  onClose: () => void;
}

export function AiProductImporter({ categories, onAddProduct, onClose }: AiProductImporterProps) {
  const [rawText, setRawText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigError, setIsConfigError] = useState(false);
  
  // Parsed Product State
  const [parsedData, setParsedData] = useState<{
    name: string;
    price: string;
    description: string;
    categoryId: string;
    tags: string[];
    sizes: string[];
    images: string[];
  } | null>(null);

  // Editing after parse
  const [editedName, setEditedName] = useState('');
  const [editedPrice, setEditedPrice] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedCategoryId, setEditedCategoryId] = useState('');
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [editedSizes, setEditedSizes] = useState<string[]>([]);
  const [editedImages, setEditedImages] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [newSize, setNewSize] = useState('');
  const [isAddingToStore, setIsAddingToStore] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);

  const handleAnalyze = async () => {
    if (!rawText.trim()) {
      setError('אנא הדבק טקסט או קוד מוצר לניתוח');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setIsConfigError(false);
    setParsedData(null);

    try {
      const result = await safeFetchJson('/api/parse-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rawText,
          categories: categories.map(c => ({ id: c.id, name: c.name }))
        }),
      });

      if (!result.ok || !result.data) {
        if (result.isConfigError) {
          setIsConfigError(true);
        }
        throw new Error(result.error || 'שגיאה בניתוח המוצר עם בינה מלאכותית');
      }

      const data = result.data;
      setParsedData(data);
      setEditedName(data.name || '');
      setEditedPrice(data.price || '');
      setEditedDescription(data.description || '');
      setEditedCategoryId(data.categoryId || categories[0]?.id || '');
      setEditedTags(data.tags || []);
      setEditedSizes(data.sizes || []);
      setEditedImages(data.images || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'אירעה שגיאה בחיבור לשרת ה-AI');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmAndAdd = async () => {
    if (!editedName.trim()) {
      alert('אנא הזן שם למוצר');
      return;
    }

    setIsAddingToStore(true);
    try {
      const newProduct: Product = {
        id: Math.random().toString(36).substr(2, 9),
        name: editedName,
        price: editedPrice.startsWith('₪') ? editedPrice : `₪${editedPrice}`,
        description: editedDescription,
        categoryId: editedCategoryId,
        tags: editedTags,
        sizes: editedSizes,
        image: editedImages[0] || '',
        images: editedImages,
        inStock: true
      };

      await onAddProduct(newProduct);
      setAddSuccess(true);
      setTimeout(() => {
        setAddSuccess(false);
        setParsedData(null);
        setRawText('');
      }, 2000);
    } catch (err: any) {
      alert('שגיאה בשמירת המוצר: ' + err.message);
    } finally {
      setIsAddingToStore(false);
    }
  };

  return (
    <div className="bg-zinc-950 border border-gold/20 rounded-xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-in fade-in duration-300" dir="rtl">
      {/* Background Glow */}
      <div className="absolute top-0 left-0 w-64 h-64 bg-gold/5 blur-[80px] pointer-events-none rounded-full" />
      
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="bg-gold/10 p-2 rounded-lg text-gold border border-gold/20 animate-pulse">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white tracking-tight uppercase italic">ייבוא מוצרים מהיר בעזרת AI</h3>
            <p className="text-xs text-zinc-400 font-light mt-0.5">פשוט העתק את דף הספק והדבק כאן. ה-AI יעשה את השאר בשבילך.</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded transition-all cursor-pointer"
        >
          <X size={20} />
        </button>
      </div>

      {error && (
        <div className="space-y-4 mb-6">
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg flex items-start gap-3 text-sm animate-in slide-in-from-top-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">אירעה שגיאה:</p>
              <p className="text-xs text-red-300/90 mt-1">{error}</p>
            </div>
          </div>

          {isConfigError && (
            <div className="bg-zinc-900/80 border border-gold/30 rounded-xl p-5 text-sm text-zinc-300 space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                <Sparkles size={16} className="text-gold" />
                <h4 className="font-black text-white text-xs uppercase tracking-wider">מדריך מהיר להגדרת מפתח ה-API של Gemini</h4>
              </div>
              
              <ol className="space-y-3 text-xs list-decimal list-inside leading-relaxed text-zinc-300">
                <li>
                  <span className="font-bold text-white">השגת מפתח API חינמי:</span> היכנס לכתובת{' '}
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-gold hover:underline font-mono inline-block"
                  >
                    aistudio.google.com/app/apikey
                  </a>{' '}
                  וצור מפתח חדש (Get API key).
                </li>
                <li>
                  <span className="font-bold text-white">פתיחת הגדרות האפליקציה:</span> לחץ על <span className="text-white font-bold">סמל גלגל השיניים (Settings)</span> בתפריט העליון של Google AI Studio.
                </li>
                <li>
                  <span className="font-bold text-white">הגדרת סוד (Secrets):</span> בחר בלשונית <span className="text-white font-bold">Secrets</span> או <span className="text-white font-bold">Environment Variables</span>.
                </li>
                <li>
                  <span className="font-bold text-white">הוספת המפתח:</span> הוסף משתנה סודי חדש בשם{' '}
                  <code className="bg-black/40 px-1.5 py-0.5 rounded text-gold font-mono border border-white/5">GEMINI_API_KEY</code>{' '}
                  והדבק את המפתח שהעתקת כערך שלו.
                </li>
                <li>
                  <span className="font-bold text-white">שמירה וריענון:</span> לחץ על שמירה והחלון ייטען מחדש עם מפתח ה-API המעודכן!
                </li>
              </ol>

              <div className="pt-2 flex justify-end">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-gold/10 hover:bg-gold/20 border border-gold/30 text-gold text-[10px] font-bold py-1.5 px-3 rounded uppercase tracking-wider transition-all cursor-pointer"
                >
                  מעבר לקבלת מפתח API ↗
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {!parsedData ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-300">הדבק כאן את טקסט המוצר (או קוד HTML מהספק):</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="לדוגמה:
Babolat Pure Aero 2023 Racket
מחיר: 899 ש''ח.
מיועד לשחקנים מקצועיים המחפשים ספין מקסימלי ועוצמה.
משקל: 300 גרם, ראש: 100, תבנית גידים: 16x19.
מידות זמינות לגריפ: 2, 3, 4."
              rows={8}
              className="w-full bg-black/60 border border-white/10 rounded-xl p-4 text-sm text-zinc-200 focus:outline-none focus:border-gold/40 transition-all font-light placeholder:text-zinc-600 custom-scrollbar leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            >
              ביטול
            </button>
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !rawText.trim()}
              className="bg-gold text-black px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest hover:bg-gold/90 transition-all shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>מנתח מוצר...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>נתח מוצר עם AI</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-gold/10 border border-gold/30 rounded-lg p-3 text-xs text-gold flex items-center gap-2">
            <Check size={14} strokeWidth={3} />
            <span>המוצר נותח בהצלחה! אנא עברו על הפרטים ואשרו את הוספתו לחנות.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Form Fields */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">שם המוצר</label>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-gold font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">מחיר</label>
                  <input
                    type="text"
                    value={editedPrice}
                    onChange={(e) => setEditedPrice(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg p-3 text-sm text-gold font-bold focus:outline-none focus:border-gold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">קטגוריה</label>
                  <select
                    value={editedCategoryId}
                    onChange={(e) => setEditedCategoryId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-gold appearance-none"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">תיאור מוצר (בעברית מלוטשת)</label>
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-black border border-white/10 rounded-lg p-3 text-xs text-zinc-300 focus:outline-none focus:border-gold leading-relaxed"
                />
              </div>
            </div>

            {/* Images, Sizes and Tags */}
            <div className="space-y-5">
              {/* Product Gallery */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">תמונות שחולצו ({editedImages.length})</label>
                <div className="grid grid-cols-3 gap-2">
                  {editedImages.map((img, idx) => (
                    <div key={idx} className="relative aspect-square border border-white/10 rounded-lg overflow-hidden bg-black group/img">
                      <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <button
                        onClick={() => setEditedImages(editedImages.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  <div
                    onClick={() => {
                      const url = prompt('הכנס כתובת URL של תמונה מהספק:');
                      if (url && url.trim()) {
                        setEditedImages([...editedImages, url.trim()]);
                      }
                    }}
                    className="aspect-square border border-dashed border-white/10 hover:border-gold rounded-lg flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-gold cursor-pointer bg-black/20 transition-all text-[9px] font-bold"
                  >
                    <Plus size={14} />
                    <span>הוסף URL</span>
                  </div>
                </div>
              </div>

              {/* Tags/Filters */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">תגיות וסינונים</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTag.trim()) {
                        e.preventDefault();
                        if (!editedTags.includes(newTag.trim())) {
                          setEditedTags([...editedTags, newTag.trim()]);
                        }
                        setNewTag('');
                      }
                    }}
                    placeholder="הוסף תגית (למשל: Babolat)..."
                    className="flex-grow bg-black border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-gold"
                  />
                  <button
                    onClick={() => {
                      if (newTag.trim() && !editedTags.includes(newTag.trim())) {
                        setEditedTags([...editedTags, newTag.trim()]);
                        setNewTag('');
                      }
                    }}
                    className="p-2 border border-gold/20 text-gold hover:bg-gold/10 rounded-lg"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {editedTags.map((t, idx) => (
                    <span key={idx} className="bg-zinc-900 border border-white/10 text-white px-2.5 py-1 rounded-full text-[9px] font-bold flex items-center gap-1.5">
                      {t}
                      <button onClick={() => setEditedTags(editedTags.filter((_, i) => i !== idx))} className="text-zinc-500 hover:text-red-400">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Sizes */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">מידות במלאי</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSize}
                    onChange={(e) => setNewSize(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSize.trim()) {
                        e.preventDefault();
                        if (!editedSizes.includes(newSize.trim())) {
                          setEditedSizes([...editedSizes, newSize.trim()]);
                        }
                        setNewSize('');
                      }
                    }}
                    placeholder="הוסף מידה (למשל: 44, XL)..."
                    className="flex-grow bg-black border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-gold"
                  />
                  <button
                    onClick={() => {
                      if (newSize.trim() && !editedSizes.includes(newSize.trim())) {
                        setEditedSizes([...editedSizes, newSize.trim()]);
                        setNewSize('');
                      }
                    }}
                    className="p-2 border border-gold/20 text-gold hover:bg-gold/10 rounded-lg"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {editedSizes.map((s, idx) => (
                    <span key={idx} className="bg-gold/5 border border-gold/20 text-gold px-2.5 py-1 rounded text-[9px] font-bold flex items-center gap-1.5">
                      {s}
                      <button onClick={() => setEditedSizes(editedSizes.filter((_, i) => i !== idx))} className="text-gold/40 hover:text-red-400">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-6 border-t border-white/5 gap-4">
            <button
              onClick={() => setParsedData(null)}
              className="text-zinc-500 hover:text-white flex items-center gap-1 text-xs"
            >
              <ChevronRight size={16} />
              <span>חזור לערוך טקסט מקור</span>
            </button>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setParsedData(null);
                  setRawText('');
                }}
                className="px-5 py-2.5 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
              >
                נקה והתחל מחדש
              </button>
              <button
                onClick={handleConfirmAndAdd}
                disabled={isAddingToStore || addSuccess}
                className={`px-8 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest transition-all shadow-lg cursor-pointer ${
                  addSuccess 
                    ? 'bg-green-600 text-white' 
                    : 'bg-gold text-black hover:bg-gold/90'
                } flex items-center gap-2`}
              >
                {isAddingToStore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>מוסיף לחנות...</span>
                  </>
                ) : addSuccess ? (
                  <>
                    <Check size={14} />
                    <span>נוסף בהצלחה!</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>אשר והוסף לחנות</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
