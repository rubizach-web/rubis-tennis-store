import { useState, useEffect } from 'react';
import { 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  ExternalLink, 
  Clock, 
  ShieldCheck, 
  Globe, 
  Zap, 
  Filter, 
  AlertTriangle,
  Layers,
  Search,
  Sliders,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { Product, SupplierSite, ScanReportItem, ScanSummary } from '../types.ts';
import { safeFetchJson } from '../lib/api.ts';

interface InventorySyncManagerProps {
  products: Product[];
  onUpdateProduct: (product: Product) => Promise<void>;
  onBatchUpdateProducts?: (products: Product[]) => Promise<void>;
}

export function InventorySyncManager({ products, onUpdateProduct }: InventorySyncManagerProps) {
  const [suppliers, setSuppliers] = useState<SupplierSite[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentScanningProduct, setCurrentScanningProduct] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<ScanSummary | null>(null);
  const [dailyAutoScan, setDailyAutoScan] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'instock' | 'outofstock' | 'changed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [checkingProductId, setCheckingProductId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Fetch Suppliers and Initial Settings
  useEffect(() => {
    fetchSuppliersData();
  }, []);

  const fetchSuppliersData = async () => {
    try {
      const res = await safeFetchJson('/api/suppliers');
      if (res.ok && res.data) {
        const data = res.data;
        setSuppliers(data.suppliers || []);
        if (data.settings) {
          setDailyAutoScan(Boolean(data.settings.dailyAutoScanEnabled));
        }
        if (data.lastSummary && Array.isArray(data.lastSummary.results)) {
          setLastSummary(data.lastSummary);
        }
      }
    } catch (e) {
      console.warn('Failed to load suppliers status', e);
    }
  };

  const handleToggleDailyScan = async () => {
    const nextState = !dailyAutoScan;
    setDailyAutoScan(nextState);
    try {
      await safeFetchJson('/api/sync-inventory/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyAutoScanEnabled: nextState, scanHour: 3 })
      });
      setStatusMessage({
        type: 'success',
        text: nextState ? 'הסריקה היומית האוטומטית הופעלה (תתבצע כל לילה ב-03:00)' : 'הסריקה היומית האוטומטית כובתה'
      });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (e) {
      console.error(e);
    }
  };

  // Run Batch Scan
  const handleRunFullScan = async () => {
    if (products.length === 0) {
      alert('אין מוצרים בחנות לסריקה.');
      return;
    }

    setIsScanning(true);
    setScanProgress(5);
    setStatusMessage(null);
    setCurrentScanningProduct('מתחבר לאתרי היבואנים...');

    try {
      // Send lightweight product data to avoid payload overhead
      const lightweightProducts = products.map(p => ({
        id: p.id,
        name: p.name,
        tags: p.tags,
        supplierSite: p.supplierSite,
        supplierUrl: p.supplierUrl,
        inStock: p.inStock
      }));

      let summary: ScanSummary | null = null;

      const response = await safeFetchJson<ScanSummary>('/api/sync-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: lightweightProducts })
      });

      if (response.ok && response.data && Array.isArray(response.data.results)) {
        summary = response.data;
      } else {
        // Fallback to client-orchestrated progressive scan
        console.warn('Batch endpoint returned non-standard response, switching to progressive scan...', response.error);
        const startedAt = new Date().toISOString();
        const results: ScanReportItem[] = [];
        let inStockCount = 0;
        let outOfStockCount = 0;
        let updatedCount = 0;

        for (let i = 0; i < products.length; i++) {
          const p = products[i];
          setCurrentScanningProduct(`בודק: ${p.name} (${i + 1}/${products.length})`);
          setScanProgress(Math.round(((i + 1) / products.length) * 90));

          try {
            const singleRes = await safeFetchJson('/api/check-single-product', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                product: {
                  id: p.id,
                  name: p.name,
                  tags: p.tags,
                  supplierSite: p.supplierSite,
                  supplierUrl: p.supplierUrl,
                  inStock: p.inStock
                }
              })
            });

            const prev = p.inStock !== false;
            const newStock = singleRes.ok && singleRes.data ? Boolean(singleRes.data.inStock) : prev;
            if (prev !== newStock) updatedCount++;
            if (newStock) inStockCount++; else outOfStockCount++;

            results.push({
              productId: p.id,
              productName: p.name,
              supplierName: singleRes.data?.supplierName || p.supplierSite || 'ספק',
              supplierUrl: singleRes.data?.supplierUrl || p.supplierUrl,
              matchedUrl: singleRes.data?.matchedUrl,
              matchedTitle: singleRes.data?.matchedTitle,
              previousStock: prev,
              newStock,
              statusDetail: singleRes.data?.statusDetail || 'בדיקת מלאי הושלמה',
              timestamp: new Date().toISOString()
            });
          } catch {
            const prev = p.inStock !== false;
            if (prev) inStockCount++; else outOfStockCount++;
            results.push({
              productId: p.id,
              productName: p.name,
              supplierName: p.supplierSite || 'ספק',
              previousStock: prev,
              newStock: prev,
              statusDetail: 'סטטוס מלאי נוכחי נשמר',
              timestamp: new Date().toISOString()
            });
          }
        }

        summary = {
          id: Math.random().toString(36).substring(2, 9),
          startedAt,
          completedAt: new Date().toISOString(),
          totalChecked: products.length,
          inStockCount,
          outOfStockCount,
          updatedCount,
          results
        };
      }

      if (!summary || !Array.isArray(summary.results)) {
        throw new Error('לא התקבלו תוצאות סריקה תקינות.');
      }

      setLastSummary(summary);
      setScanProgress(100);

      // Apply changes to database ONLY for products whose stock status actually changed
      let appliedDbUpdates = 0;
      for (const item of summary.results) {
        const originalProduct = products.find(p => p.id === item.productId);
        if (originalProduct) {
          const isStockChanged = originalProduct.inStock !== Boolean(item.newStock);
          const updatedProduct: Product = {
            ...originalProduct,
            inStock: Boolean(item.newStock),
            supplierSite: item.supplierName || originalProduct.supplierSite || '',
            supplierUrl: item.matchedUrl || item.supplierUrl || originalProduct.supplierUrl || '',
            lastStockCheck: item.timestamp || new Date().toISOString(),
            stockStatusDetail: item.statusDetail || ''
          };

          if (isStockChanged) {
            try {
              await onUpdateProduct(updatedProduct);
              appliedDbUpdates++;
              // Delay between Firestore writes to protect write rate limit
              await new Promise(r => setTimeout(r, 150));
            } catch (e) {
              console.warn('Failed to save stock update for product', item.productName, e);
            }
          }
        }
      }

      setStatusMessage({
        type: 'success',
        text: `הסריקה הושלמה בהצלחה! נבדקו ${summary.totalChecked} מוצרים. ${summary.inStockCount} במלאי, ${summary.outOfStockCount} אזלו מהמלאי. ${appliedDbUpdates > 0 ? `עודכנו ${appliedDbUpdates} מוצרים שסטטוס המלאי שלהם השתנה.` : 'לא זוהו שינויים בסטטוס המלאי.'}`
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'אירעה שגיאה בסריקת האתרים'
      });
    } finally {
      setIsScanning(false);
      setCurrentScanningProduct(null);
    }
  };

  // Check Single Product
  const handleCheckSingleProduct = async (product: Product) => {
    setCheckingProductId(product.id);
    try {
      const lightweightProduct = {
        id: product.id,
        name: product.name,
        tags: product.tags,
        supplierSite: product.supplierSite,
        supplierUrl: product.supplierUrl,
        inStock: product.inStock
      };

      const response = await safeFetchJson('/api/check-single-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: lightweightProduct })
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error || 'שגיאה בבדיקת המוצר');
      }
      const data = response.data;

      const updatedProduct: Product = {
        ...product,
        inStock: Boolean(data.inStock),
        supplierSite: data.supplierName || product.supplierSite || '',
        supplierUrl: data.matchedUrl || product.supplierUrl || '',
        lastStockCheck: data.checkedAt || new Date().toISOString(),
        stockStatusDetail: data.statusDetail || ''
      };

      await onUpdateProduct(updatedProduct);

      setStatusMessage({
        type: 'success',
        text: `המוצר "${product.name}" נבדק מול ${data.supplierName}: ${data.inStock ? 'במלאי ✓' : 'אזל מהמלאי ✗'}`
      });
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err: any) {
      alert('שגיאה בבדיקת המוצר מול הספק: ' + err.message);
    } finally {
      setCheckingProductId(null);
    }
  };

  // Toggle Stock Status Manually
  const handleToggleStockManually = async (product: Product) => {
    const newStock = product.inStock === false ? true : false;
    const updated: Product = {
      ...product,
      inStock: newStock,
      lastStockCheck: new Date().toISOString(),
      stockStatusDetail: newStock ? 'סומן ידנית כמצוי במלאי' : 'סומן ידנית כאזל מהמלאי'
    };
    await onUpdateProduct(updated);
  };

  // Filtered Products List
  const displayProducts = products.filter(p => {
    const matchesSearch = !searchTerm.trim() || 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.supplierSite && p.supplierSite.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === 'instock') return p.inStock !== false;
    if (filterMode === 'outofstock') return p.inStock === false;
    if (filterMode === 'changed' && lastSummary && Array.isArray(lastSummary.results)) {
      const scanItem = lastSummary.results.find(r => r.productId === p.id);
      return Boolean(scanItem && scanItem.previousStock !== scanItem.newStock);
    }
    return true;
  });

  const inStockCount = products.filter(p => p.inStock !== false).length;
  const outOfStockCount = products.filter(p => p.inStock === false).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300" dir="rtl">
      {/* Top Banner & Control Station */}
      <div className="bg-zinc-950 border border-gold/20 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-gold/5 blur-[100px] pointer-events-none rounded-full" />

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 pb-6 border-b border-white/5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gold/10 border border-gold/30 rounded-xl text-gold">
                <Globe size={22} />
              </div>
              <div>
                <h3 className="text-xl md:text-2xl font-black text-white uppercase italic tracking-tight">
                  סנכרון מלאי יומי אוטומטי מול אתרי היבואנים
                </h3>
                <p className="text-xs text-zinc-400 font-light">
                  המערכת סורקת באופן עצמאי את 5 אתרי הספקים הראשיים, מאתרת את המוצרים ומעדכנת זמינות מלאי בחנות
                </p>
              </div>
            </div>
          </div>

          {/* Action Trigger */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <button
              onClick={handleRunFullScan}
              disabled={isScanning}
              className="flex-grow lg:flex-initial bg-gold hover:bg-gold/90 text-black px-6 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
              <span>{isScanning ? 'סורק אתרי ספקים כעת...' : 'סרוק ובדוק מלאי עכשיו בכל האתרים'}</span>
            </button>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className={`mt-6 p-4 rounded-xl text-xs font-bold flex items-center gap-3 animate-in slide-in-from-top-2 ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' 
              : statusMessage.type === 'error'
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : 'bg-gold/10 border border-gold/30 text-gold'
          }`}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* 5 Supplier Cards Overview */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
              5 אתרי היבואנים המחוברים לסריקה אוטומטית:
            </span>
            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
              <Clock size={12} className="text-gold" />
              <span>סריקה יומית: בכל לילה ב-03:00</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { name: 'BABOLAT', url: 'https://babolat.co.il', domain: 'babolat.co.il', desc: 'מחבטים, תיקים ונעליים' },
              { name: 'WILSON', url: 'https://wilson.co.il', domain: 'wilson.co.il', desc: 'ציוד טניס מקצועי' },
              { name: 'YONEX', url: 'https://www.tennis-online.co.il', domain: 'tennis-online.co.il', desc: 'טניס אונליין ישראל' },
              { name: 'ספורט סנטר', url: 'https://www.sportcenter.co.il', domain: 'sportcenter.co.il', desc: 'היבואן הרשמי Head' },
              { name: 'בש-גל', url: 'https://bashgal.co.il', domain: 'bashgal.co.il', desc: 'ציוד ספורט Dunlop' },
            ].map((sup, idx) => (
              <div key={idx} className="bg-black/50 border border-white/10 hover:border-gold/30 rounded-xl p-3.5 transition-all flex flex-col justify-between group">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-black text-white group-hover:text-gold transition-colors">{sup.name}</span>
                    <p className="text-[9px] text-zinc-500 font-mono mt-0.5">{sup.domain}</p>
                  </div>
                  <a 
                    href={sup.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-gold transition-colors p-1"
                    title="כניסה לאתר הספק"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[9px] text-zinc-400">
                  <span>{sup.desc}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" title="פעיל לסריקה" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Daily Schedule & Summary Metrics */}
        <div className="mt-6 pt-6 border-t border-white/5 grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Daily Auto Scan Setting */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">סריקה יומית אוטומטית</span>
              <p className="text-xs font-black text-white">
                {dailyAutoScan ? 'מופעלת (כל 24 שעות)' : 'כבויה'}
              </p>
            </div>
            <button
              onClick={handleToggleDailyScan}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                dailyAutoScan ? 'bg-gold' : 'bg-zinc-800'
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-black transition-transform absolute top-1 ${
                dailyAutoScan ? 'left-1' : 'right-1'
              }`} />
            </button>
          </div>

          {/* Metric: Total Products */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">סך מוצרים בחנות</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-white">{products.length}</span>
              <span className="text-[10px] text-zinc-500">פריטים</span>
            </div>
          </div>

          {/* Metric: In Stock */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">זמינים במלאי כעת</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-400">{inStockCount}</span>
              <span className="text-[10px] text-zinc-500">({products.length ? Math.round((inStockCount / products.length) * 100) : 0}%)</span>
            </div>
          </div>

          {/* Metric: Out of Stock */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4">
            <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">אזלו מהמלאי</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-red-400">{outOfStockCount}</span>
              <span className="text-[10px] text-zinc-500">פריטים חסרים</span>
            </div>
          </div>
        </div>

        {/* Live Scan Progress */}
        {isScanning && (
          <div className="mt-6 p-4 bg-gold/5 border border-gold/20 rounded-xl space-y-3 animate-in fade-in">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-gold flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                <span>{currentScanningProduct || 'סורק מוצרים...'}</span>
              </span>
              <span className="font-mono text-zinc-400">{scanProgress}%</span>
            </div>
            <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-gold h-full transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(scanProgress, 10)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Products Stock List & Management Table */}
      <div className="bg-zinc-950 border border-white/10 rounded-2xl p-6 md:p-8 space-y-6">
        {/* Table Filters Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Layers size={18} className="text-gold" />
            <h4 className="text-lg font-black text-white uppercase italic tracking-tight">
              פירוט סטטוס מלאי לכל מוצרי החנות
            </h4>
          </div>

          {/* Filter Tabs & Search */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-grow md:w-56">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="חיפוש מוצר או ספק..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-black border border-white/10 rounded-lg py-2 pr-9 pl-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-gold"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex bg-black/60 p-1 rounded-lg border border-white/10 text-[10px] font-bold">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'all' ? 'bg-gold text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                הכל ({products.length})
              </button>
              <button
                onClick={() => setFilterMode('instock')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'instock' ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                במלאי ({inStockCount})
              </button>
              <button
                onClick={() => setFilterMode('outofstock')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'outofstock' ? 'bg-red-500 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                אזל מהמלאי ({outOfStockCount})
              </button>
            </div>
          </div>
        </div>

        {/* Product Rows */}
        <div className="space-y-3">
          {displayProducts.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 text-xs">
              לא נמצאו מוצרים התואמים את החיפוש או הסינון.
            </div>
          ) : (
            displayProducts.map((product) => {
              const isInStock = product.inStock !== false;
              const isChecking = checkingProductId === product.id;

              return (
                <div 
                  key={product.id}
                  className={`bg-black/40 border rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all hover:border-gold/30 ${
                    isInStock ? 'border-white/5' : 'border-red-500/20 bg-red-950/5'
                  }`}
                >
                  {/* Product Info */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-lg bg-black border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {product.image ? (
                        <img 
                          src={product.image} 
                          alt={product.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[9px] text-zinc-600">אין תמונה</span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="text-sm font-bold text-white">{product.name}</h5>
                        <span className="text-xs font-bold text-gold font-mono">{product.price}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-zinc-400">
                        {product.supplierSite && (
                          <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded text-zinc-300">
                            ספק: {product.supplierSite}
                          </span>
                        )}
                        {product.stockStatusDetail && (
                          <span className="text-zinc-500 truncate max-w-md">
                            {product.stockStatusDetail}
                          </span>
                        )}
                        {product.lastStockCheck && (
                          <span className="text-zinc-600 font-mono text-[9px]">
                            נבדק: {new Date(product.lastStockCheck).toLocaleDateString('he-IL')} {new Date(product.lastStockCheck).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status Pill */}
                  <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                    {/* Stock Status Badge */}
                    <button
                      onClick={() => handleToggleStockManually(product)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all ${
                        isInStock 
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' 
                          : 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                      }`}
                      title="לחץ לשינוי ידני"
                    >
                      {isInStock ? (
                        <>
                          <CheckCircle2 size={12} />
                          <span>במלאי</span>
                        </>
                      ) : (
                        <>
                          <XCircle size={12} />
                          <span>אזל מהמלאי</span>
                        </>
                      )}
                    </button>

                    {/* Single Check Trigger */}
                    <button
                      onClick={() => handleCheckSingleProduct(product)}
                      disabled={isChecking}
                      className="bg-white/5 hover:bg-gold/10 hover:border-gold/30 border border-white/10 text-zinc-300 hover:text-gold px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      title="בדוק כעת זמינות באתר הספק"
                    >
                      <RefreshCw size={12} className={isChecking ? 'animate-spin text-gold' : ''} />
                      <span>{isChecking ? 'בודק...' : 'בדוק מוצר זה'}</span>
                    </button>

                    {/* Matched Supplier Link */}
                    {product.supplierUrl && (
                      <a
                        href={product.supplierUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-white transition-all"
                        title="צפה בדף המוצר באתר הספק"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
