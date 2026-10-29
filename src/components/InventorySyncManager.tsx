import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Clock,
  AlertTriangle,
  Search,
  Link2,
  Hand,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Product } from '../types.ts';
import { safeFetchJson } from '../lib/api.ts';
import { db } from '../lib/firebase.ts';

interface InventorySyncManagerProps {
  products: Product[];
  onUpdateProduct: (product: Product) => Promise<void>;
}

type Suggestion = NonNullable<Product['supplierSuggestions']>[number];

interface CheckResult {
  outcome: string;
  fields: Partial<Product>;
}

interface SyncRun {
  startedAt: string;
  dryRun?: boolean;
  total: number;
  checked: number;
  linkedNow: number;
  needsLink: number;
  unknownSupplier: number;
  manual: number;
  notFound: number;
  errors: number;
  inStock: number;
  outOfStock: number;
  changes?: { productName: string; before: boolean; after: boolean }[];
}

const SUPPLIERS: { id: string; label: string; url: string }[] = [
  { id: 'babolat', label: 'בבולט', url: 'https://babolat.co.il' },
  { id: 'wilson', label: 'וילסון', url: 'https://wilson.co.il' },
  { id: 'yonex', label: 'יונקס · טניס אונליין', url: 'https://www.tennis-online.co.il' },
];

function supplierLabel(p: Product): string {
  if (p.supplierLinkStatus === 'manual') return 'ידני';
  const s = SUPPLIERS.find(x => x.id === p.supplierSite);
  return s ? s.label : p.supplierSite || 'לא זוהה ספק';
}

type Filter = 'all' | 'attention' | 'out' | 'sizes' | 'manual' | 'ok';

/** What the owner should look at first. */
function needsAttention(p: Product): boolean {
  if (p.supplierLinkStatus === 'manual') return false;
  return (
    !p.supplierLinkStatus ||
    p.supplierLinkStatus === 'suggested' ||
    p.supplierLinkStatus === 'none' ||
    p.stockCheckState === 'error' ||
    p.stockCheckState === 'unlinked'
  );
}

function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

export function InventorySyncManager({ products, onUpdateProduct }: InventorySyncManagerProps) {
  const [filter, setFilter] = useState<Filter>('attention');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; current: string } | null>(null);
  const [lastRun, setLastRun] = useState<SyncRun | null | undefined>(undefined);

  // Latest report written by the daily job
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'syncRuns'), orderBy('startedAt', 'desc'), limit(1)));
        setLastRun(snap.empty ? null : (snap.docs[0].data() as SyncRun));
      } catch {
        setLastRun(null);
      }
    })();
  }, []);

  const counts = useMemo(() => {
    const c = { all: products.length, attention: 0, out: 0, sizes: 0, manual: 0, ok: 0 };
    for (const p of products) {
      if (needsAttention(p)) c.attention++;
      if (p.inStock === false) c.out++;
      if ((p.unavailableSizes || []).length > 0 && p.inStock !== false) c.sizes++;
      if (p.supplierLinkStatus === 'manual') c.manual++;
      if ((p.supplierLinkStatus === 'confirmed' || p.supplierLinkStatus === 'auto') && p.stockCheckState === 'ok') c.ok++;
    }
    return c;
  }, [products]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => {
        switch (filter) {
          case 'attention': return needsAttention(p);
          case 'out': return p.inStock === false;
          case 'sizes': return (p.unavailableSizes || []).length > 0 && p.inStock !== false;
          case 'manual': return p.supplierLinkStatus === 'manual';
          case 'ok': return (p.supplierLinkStatus === 'confirmed' || p.supplierLinkStatus === 'auto') && p.stockCheckState === 'ok';
          default: return true;
        }
      })
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.supplierTitle || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [products, filter, search]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function runCheck(p: Product, opts: { relink?: boolean; quiet?: boolean } = {}): Promise<Product | null> {
    const res = await safeFetchJson<CheckResult>('/api/inventory/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: p, relink: !!opts.relink }),
    });
    if (!res.ok || !res.data) {
      if (!opts.quiet) setMessage({ type: 'error', text: `הבדיקה של "${p.name}" נכשלה: ${res.error || 'שגיאת שרת'}` });
      return null;
    }
    const updated = { ...p, ...res.data.fields } as Product;
    await onUpdateProduct(updated);
    return updated;
  }

  async function handleCheck(p: Product) {
    setBusyId(p.id);
    setMessage(null);
    try {
      const u = await runCheck(p);
      if (u) {
        setMessage({
          type: u.stockCheckState === 'ok' ? 'success' : 'info',
          text: `"${p.name}": ${u.stockStatusDetail || (u.inStock === false ? 'אזל' : 'במלאי')}`,
        });
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckAll() {
    const list = products.filter(p => p.supplierLinkStatus !== 'manual');
    if (!list.length) return;
    if (!confirm(`לבדוק עכשיו ${list.length} מוצרים מול אתרי הספקים? זה יכול לקחת כמה דקות — אל תסגור את הדף.`)) return;
    setMessage(null);
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setBulk({ done: i, total: list.length, current: list[i].name });
      const u = await runCheck(list[i], { quiet: true });
      if (!u) failed++;
    }
    setBulk(null);
    setMessage({
      type: failed ? 'info' : 'success',
      text: `הבדיקה הסתיימה: נבדקו ${list.length} מוצרים${failed ? `, ${failed} נכשלו (נסה שוב מאוחר יותר)` : ''}.`,
    });
  }

  async function handleConfirmSuggestion(p: Product, s: Suggestion) {
    setBusyId(p.id);
    try {
      const linked: Product = {
        ...p,
        supplierRef: s.ref,
        supplierUrl: s.url,
        supplierLinkStatus: 'confirmed',
        supplierSuggestions: [],
      };
      await onUpdateProduct(linked);
      await runCheck(linked);
      setExpandedId(null);
      setMessage({ type: 'success', text: `"${p.name}" קושר ל-"${s.title}"${s.color ? ` (${s.color})` : ''} ונבדק.` });
    } finally {
      setBusyId(null);
    }
  }

  async function handleLinkByUrl(p: Product) {
    const url = (pasteUrl[p.id] || '').trim();
    if (!url) return;
    setBusyId(p.id);
    setMessage(null);
    try {
      const res = await safeFetchJson<{ supplier: string; ref: string; url: string; stock: { title?: string; color?: string } }>(
        '/api/inventory/resolve-link',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) },
      );
      if (!res.ok || !res.data) {
        setMessage({ type: 'error', text: res.error || 'לא הצלחתי לקרוא את הקישור' });
        return;
      }
      const linked: Product = {
        ...p,
        supplierSite: res.data.supplier,
        supplierRef: res.data.ref,
        supplierUrl: res.data.url,
        supplierLinkStatus: 'confirmed',
        supplierSuggestions: [],
      };
      await onUpdateProduct(linked);
      await runCheck(linked);
      setPasteUrl(prev => ({ ...prev, [p.id]: '' }));
      setExpandedId(null);
      setMessage({ type: 'success', text: `"${p.name}" קושר ל-"${res.data.stock.title || res.data.url}" ונבדק.` });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetSupplier(p: Product, supplierId: string) {
    setBusyId(p.id);
    try {
      if (supplierId === 'manual') {
        await onUpdateProduct({ ...p, supplierLinkStatus: 'manual', stockCheckState: 'manual', stockStatusDetail: 'מעודכן ידנית' });
        return;
      }
      const changed: Product = {
        ...p,
        supplierSite: supplierId,
        supplierLinkStatus: 'none',
        supplierRef: undefined,
        supplierUrl: undefined,
        supplierSuggestions: [],
      };
      await onUpdateProduct(changed);
      await runCheck(changed); // finds suggestions at the new supplier
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleManualStock(p: Product) {
    await onUpdateProduct({ ...p, inStock: p.inStock === false });
  }

  async function handleToggleSize(p: Product, size: string) {
    const current = new Set(p.unavailableSizes || []);
    if (current.has(size)) current.delete(size);
    else current.add(size);
    await onUpdateProduct({ ...p, unavailableSizes: [...current] });
  }

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  const filters: { id: Filter; label: string; tone: string }[] = [
    { id: 'attention', label: `דורש טיפול (${counts.attention})`, tone: 'bg-amber-500 text-black' },
    { id: 'out', label: `אזלו (${counts.out})`, tone: 'bg-red-500 text-white' },
    { id: 'sizes', label: `חסרות מידות (${counts.sizes})`, tone: 'bg-orange-500 text-black' },
    { id: 'ok', label: `מסונכרנים (${counts.ok})`, tone: 'bg-emerald-500 text-black' },
    { id: 'manual', label: `ידני (${counts.manual})`, tone: 'bg-zinc-200 text-black' },
    { id: 'all', label: `הכל (${counts.all})`, tone: 'bg-gold text-black' },
  ];

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Overview */}
      <div className="bg-zinc-950 border border-white/10 rounded-2xl p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <h3 className="text-xl font-black text-white">סנכרון מלאי מול הספקים</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              כל לילה המערכת בודקת כל מוצר מול הדף שלו אצל הספק (בבולט, וילסון, טניס אונליין) ומעדכנת מה במלאי ובאילו מידות.
              מידה שאזלה מוצגת באתר כלא זמינה, ומוצר שאף מידה שלו לא זמינה מוסתר.
              מוצרים שלא הצלחנו לקשר בוודאות מחכים לאישור שלך — עד אז המלאי שלהם לא משתנה.
            </p>
          </div>
          <button
            onClick={handleCheckAll}
            disabled={!!bulk || !!busyId}
            className="shrink-0 bg-gold text-black px-5 py-3 rounded-xl text-xs font-black flex items-center gap-2 hover:scale-[1.02] transition-all disabled:opacity-40"
          >
            <RefreshCw size={14} className={bulk ? 'animate-spin' : ''} />
            בדוק את כל המוצרים עכשיו
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="במלאי באתר" value={products.length - counts.out} tone="text-emerald-400" />
          <Metric label="אזלו (מוסתרים)" value={counts.out} tone="text-red-400" />
          <Metric label="במלאי עם מידות חסרות" value={counts.sizes} tone="text-orange-400" />
          <Metric label="דורשים טיפול" value={counts.attention} tone="text-amber-400" />
        </div>

        <div className="bg-black/40 border border-white/5 rounded-xl p-4 text-xs text-zinc-400 flex items-start gap-3">
          <Clock size={16} className="text-gold shrink-0 mt-0.5" />
          {lastRun === undefined ? (
            <span>טוען את הסנכרון האחרון...</span>
          ) : lastRun === null ? (
            <span>
              הסנכרון הלילי עוד לא רץ. הוא מופעל מ-GitHub אחרי שמוסיפים את מפתח Firebase להגדרות המאגר. עד אז אפשר להשתמש בכפתור
              "בדוק את כל המוצרים עכשיו".
            </span>
          ) : (
            <span>
              סנכרון אחרון: <b className="text-white">{formatTime(lastRun.startedAt)}</b>
              {lastRun.dryRun ? ' (ניסיון)' : ''} · נבדקו {lastRun.checked} מתוך {lastRun.total} · השתנו{' '}
              {lastRun.changes?.length ?? 0} · מחכים לאישור {lastRun.needsLink}
              {lastRun.errors > 0 && <span className="text-red-400"> · {lastRun.errors} תקלות גישה לספק</span>}
            </span>
          )}
        </div>

        {bulk && (
          <div className="p-4 bg-gold/5 border border-gold/20 rounded-xl space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-bold text-gold truncate">בודק: {bulk.current}</span>
              <span className="font-mono text-zinc-400">{bulk.done}/{bulk.total}</span>
            </div>
            <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div className="bg-gold h-full transition-all" style={{ width: `${Math.max(3, (bulk.done / bulk.total) * 100)}%` }} />
            </div>
          </div>
        )}

        {message && (
          <div
            className={`p-3 rounded-xl text-xs border ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : message.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-white/5 border-white/10 text-zinc-300'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Product list */}
      <div className="bg-zinc-950 border border-white/10 rounded-2xl p-6 md:p-8 space-y-5">
        <div className="flex flex-col lg:flex-row justify-between gap-4 pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Layers size={18} className="text-gold" />
            <h4 className="text-lg font-black text-white">מוצרים</h4>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative md:w-56">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש מוצר..."
                className="w-full bg-black border border-white/10 rounded-lg py-2 pr-9 pl-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-gold"
              />
            </div>
            <div className="flex flex-wrap gap-1 bg-black/60 p-1 rounded-lg border border-white/10 text-[10px] font-bold">
              {filters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-md transition-all ${filter === f.id ? f.tone : 'text-zinc-400 hover:text-white'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="py-14 text-center text-zinc-500 text-xs">
            {filter === 'attention' ? 'אין מוצרים שדורשים טיפול 🎉' : 'אין מוצרים להצגה בסינון הזה.'}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(p => (
              <ProductRow
                key={p.id}
                p={p}
                busy={busyId === p.id || !!bulk}
                expanded={expandedId === p.id}
                pasteUrl={pasteUrl[p.id] || ''}
                onPasteUrl={v => setPasteUrl(prev => ({ ...prev, [p.id]: v }))}
                onToggleExpand={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onCheck={() => handleCheck(p)}
                onRelink={() => p.supplierSite && handleSetSupplier(p, p.supplierSite)}
                onConfirm={s => handleConfirmSuggestion(p, s)}
                onLinkByUrl={() => handleLinkByUrl(p)}
                onSetSupplier={id => handleSetSupplier(p, id)}
                onToggleStock={() => handleToggleManualStock(p)}
                onToggleSize={size => handleToggleSize(p, size)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-black/40 border border-white/5 rounded-xl p-4">
      <span className="text-[10px] font-bold text-zinc-400">{label}</span>
      <div className={`text-2xl font-black mt-1 ${tone}`}>{value}</div>
    </div>
  );
}

function LinkBadge({ p }: { p: Product }) {
  const map: Record<string, { text: string; cls: string }> = {
    confirmed: { text: 'מקושר (אושר)', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    auto: { text: 'מקושר אוטומטית', cls: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5' },
    suggested: { text: 'מחכה לאישור קישור', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    none: { text: 'לא נמצא אצל הספק', cls: 'text-red-300 border-red-500/30 bg-red-500/10' },
    manual: { text: 'מלאי ידני', cls: 'text-zinc-300 border-white/20 bg-white/5' },
  };
  const b = map[p.supplierLinkStatus || ''] || { text: 'עוד לא נבדק', cls: 'text-zinc-400 border-white/10 bg-white/5' };
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${b.cls}`}>{b.text}</span>;
}

interface RowProps {
  key?: string;
  p: Product;
  busy: boolean;
  expanded: boolean;
  pasteUrl: string;
  onPasteUrl: (v: string) => void;
  onToggleExpand: () => void;
  onCheck: () => void;
  onRelink: () => void;
  onConfirm: (s: Suggestion) => void;
  onLinkByUrl: () => void;
  onSetSupplier: (id: string) => void;
  onToggleStock: () => void;
  onToggleSize: (size: string) => void;
}

function ProductRow(props: RowProps) {
  const { p, busy, expanded } = props;
  const inStock = p.inStock !== false;
  const isManual = p.supplierLinkStatus === 'manual';
  const unavailable = new Set(p.unavailableSizes || []);
  const linked = p.supplierLinkStatus === 'confirmed' || p.supplierLinkStatus === 'auto';

  return (
    <div className={`border rounded-xl transition-all ${inStock ? 'border-white/5 bg-black/40' : 'border-red-500/20 bg-red-950/10'}`}>
      <div className="p-4 flex flex-col md:flex-row gap-4 md:items-center justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-14 h-14 rounded-lg bg-black border border-white/10 overflow-hidden shrink-0">
            {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : null}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-bold text-white">{p.name}</h5>
              <span className="text-[10px] text-zinc-500">{supplierLabel(p)}</span>
              <LinkBadge p={p} />
            </div>

            {(p.sizes || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(p.sizes || []).map(size => {
                  const off = unavailable.has(size);
                  return (
                    <button
                      key={size}
                      disabled={!isManual}
                      onClick={() => props.onToggleSize(size)}
                      title={isManual ? 'לחץ כדי לסמן זמינה / לא זמינה' : off ? 'לא זמינה אצל הספק' : 'זמינה אצל הספק'}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        off ? 'border-red-500/30 text-red-400 line-through bg-red-500/5' : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5'
                      } ${isManual ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="text-[10px] text-zinc-500 space-x-2 space-x-reverse">
              {p.stockCheckState === 'error' && <AlertTriangle size={11} className="inline text-red-400 ml-1" />}
              {p.stockStatusDetail && <span>{p.stockStatusDetail}</span>}
              {p.lastStockCheck && <span className="font-mono text-zinc-600">· נבדק {formatTime(p.lastStockCheck)}</span>}
            </div>
            {linked && p.supplierTitle && (
              <div className="text-[10px] text-zinc-500">
                אצל הספק: <span className="text-zinc-300">{p.supplierTitle}{p.supplierColor ? ` · ${p.supplierColor}` : ''}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isManual ? (
            <button
              onClick={props.onToggleStock}
              className={`px-3 py-1.5 rounded-full text-[10px] font-black flex items-center gap-1.5 border ${
                inStock ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
              title="מוצר ידני — לחץ לשינוי"
            >
              {inStock ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {inStock ? 'במלאי' : 'אזל'}
            </button>
          ) : (
            <span
              className={`px-3 py-1.5 rounded-full text-[10px] font-black flex items-center gap-1.5 border ${
                inStock ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {inStock ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {inStock ? 'במלאי' : 'אזל'}
            </span>
          )}

          {!isManual && (
            <button
              onClick={props.onCheck}
              disabled={busy}
              className="bg-white/5 hover:bg-gold/10 border border-white/10 text-zinc-300 hover:text-gold px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 disabled:opacity-40"
            >
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
              בדוק עכשיו
            </button>
          )}

          {p.supplierUrl && (
            <a
              href={p.supplierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-white"
              title="הדף אצל הספק"
            >
              <ExternalLink size={14} />
            </a>
          )}

          <button
            onClick={props.onToggleExpand}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-white flex items-center gap-1 text-[10px] font-bold"
            title="קישור לספק"
          >
            <Link2 size={14} />
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4 bg-black/30">
          {/* Supplier */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-zinc-400 font-bold">ספק:</span>
            {SUPPLIERS.map(s => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => props.onSetSupplier(s.id)}
                className={`px-2.5 py-1 rounded-md border ${
                  !isManual && p.supplierSite === s.id ? 'border-gold text-gold bg-gold/10' : 'border-white/10 text-zinc-300 hover:border-white/30'
                }`}
              >
                {s.label}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => props.onSetSupplier('manual')}
              className={`px-2.5 py-1 rounded-md border flex items-center gap-1 ${
                isManual ? 'border-gold text-gold bg-gold/10' : 'border-white/10 text-zinc-300 hover:border-white/30'
              }`}
            >
              <Hand size={11} /> ידני (בלי סנכרון)
            </button>
          </div>

          {/* Suggestions */}
          {!isManual && (p.supplierSuggestions || []).length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-400 font-bold">
                {p.supplierLinkReason || 'מוצרים דומים אצל הספק'} — בחר את המוצר הנכון:
              </div>
              {(p.supplierSuggestions || []).map(s => (
                <div key={s.ref} className="flex items-center justify-between gap-3 bg-black/40 border border-white/5 rounded-lg p-2.5">
                  <div className="min-w-0 text-[11px]">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-white hover:text-gold underline-offset-2 hover:underline">
                      {s.title}
                    </a>
                    {s.color && <span className="text-zinc-400"> · {s.color}</span>}
                    <span className="text-zinc-600 font-mono"> · התאמה {Math.round(s.score * 100)}%</span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => props.onConfirm(s)}
                    className="shrink-0 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-3 py-1 rounded-md text-[10px] font-black disabled:opacity-40"
                  >
                    זה המוצר
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Paste a link */}
          {!isManual && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-400 font-bold">או הדבק קישור לדף המוצר אצל הספק (בצבע הנכון):</div>
              <div className="flex gap-2">
                <input
                  value={props.pasteUrl}
                  onChange={e => props.onPasteUrl(e.target.value)}
                  placeholder="https://babolat.co.il/..."
                  dir="ltr"
                  className="flex-grow bg-black border border-white/10 rounded-lg py-2 px-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-gold"
                />
                <button
                  disabled={busy || !props.pasteUrl.trim()}
                  onClick={props.onLinkByUrl}
                  className="bg-gold text-black px-4 rounded-lg text-[11px] font-black disabled:opacity-40"
                >
                  קשר ובדוק
                </button>
              </div>
            </div>
          )}

          {!isManual && linked && (
            <button onClick={props.onRelink} disabled={busy} className="text-[10px] text-zinc-500 hover:text-gold underline">
              הקישור לא נכון? חפש מחדש אצל הספק
            </button>
          )}
        </div>
      )}
    </div>
  );
}
