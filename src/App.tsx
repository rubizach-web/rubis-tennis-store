/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, FormEvent, ChangeEvent, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { 
  Accessibility,
  Plus, 
  Minus,
  ShoppingCart,
  Trash2, 
  Edit2, 
  Save, 
  X, 
  LogOut, 
  Settings, 
  Menu, 
  Facebook, 
  MessageCircle, 
  Mail, 
  MapPin, 
  Phone,
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  Check,
  Lock,
  ArrowRight,
  Upload,
  ArrowLeft,
  AlertCircle,
  Search,
  GripVertical,
  XCircle,
  CheckCircle,
  Filter,
  Sparkles,
  Globe,
  RefreshCw
} from 'lucide-react';
import { DEFAULT_CONTENT, SiteContent, Category, Product, Lead, CartItem } from './types.ts';
import { AiProductImporter } from './components/AiProductImporter.tsx';
import { InventorySyncManager } from './components/InventorySyncManager.tsx';
import { auth, db, sanitizeForFirestore } from './lib/firebase.ts';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  User 
} from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  collection, 
  addDoc,
  query,
  orderBy,
  Timestamp,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';

// --- Utilities ---
const ADMIN_EMAILS = ["rubizach@gmail.com", "omerle009@gmail.com"];

const compressImage = (base64Str: string, maxWidth = 1000, maxHeight = 1000, quality = 0.75): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
};

// --- Components ---

function FilePicker({ 
  label, 
  value, 
  onChange, 
  accept = "image/*" 
}: { 
  label: string, 
  value: string, 
  onChange: (val: string) => void,
  accept?: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64);
        onChange(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">{label}</label>
      <div 
        onClick={() => fileInputRef.current?.click()}
        className="group relative border-2 border-dashed border-white/10 rounded-xl p-8 flex flex-col items-center justify-center gap-4 hover:border-gold hover:bg-gold/5 transition-all cursor-pointer overflow-hidden min-h-[160px]"
      >
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          accept={accept}
          onChange={handleFileChange}
        />
        
        {value ? (
          <div className="flex flex-col items-center gap-3">
             <div className="relative group/preview">
               <img 
                src={value} 
                className="h-28 w-auto object-contain rounded-lg border border-white/10 shadow-2xl" 
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/error/200/200';
                }}
               />
               <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                  <Upload size={24} className="text-gold animate-bounce" />
               </div>
             </div>
             <div className="flex flex-col items-center">
               <span className="text-[10px] text-gold font-black uppercase tracking-[0.2em]">לחץ להחלפה</span>
               <button 
                 onClick={(e) => { e.stopPropagation(); onChange(''); }}
                 className="mt-2 text-[9px] text-red-500/70 hover:text-red-500 uppercase font-bold transition-colors"
               >
                 הסר תמונה
               </button>
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/30 group-hover:text-gold transition-colors">
            <div className="p-4 bg-white/5 rounded-full ring-1 ring-white/10 group-hover:ring-gold/30">
              <Upload size={32} />
            </div>
            <div className="text-center">
               <p className="text-xs font-black uppercase tracking-widest">בחר קובץ להעלאה</p>
               <p className="text-[9px] uppercase tracking-tighter mt-1">PNG, JPG גודל מומלץ: 800x600</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [viewMode, setViewMode] = useState<'store' | 'admin'>('store');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const isAdmin = useMemo(() => {
    const normalizedEmail = user?.email?.toLowerCase();
    return normalizedEmail ? ADMIN_EMAILS.includes(normalizedEmail) : false;
  }, [user]);

  const isVerifiedAdmin = useMemo(() => {
    return isAdmin && user?.emailVerified === true;
  }, [isAdmin, user]);

  const isPendingVerification = useMemo(() => {
    const normalizedEmail = user?.email?.toLowerCase();
    return normalizedEmail && ADMIN_EMAILS.includes(normalizedEmail) && !user?.emailVerified;
  }, [user]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setViewMode('store');
      }
    });
    return () => unsubscribe();
  }, []);

  // Content Listener (Public)
  useEffect(() => {
    // Try local storage first for instant load
    const cached = localStorage.getItem('site_content');
    if (cached) {
      try {
        setContent(JSON.parse(cached));
      } catch (e) {
        console.error("Failed to parse cached content", e);
      }
    }

    const unsub = onSnapshot(doc(db, 'settings', 'content'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as any;
        const { products: legacyProducts, ...cleanData } = data;
        const finalContent = { ...DEFAULT_CONTENT, ...cleanData };
        
        if (finalContent.siteName === "Rubi's Tennis") {
          finalContent.siteName = "RUBI'S TENNIS STORE";
        }
        
        setContent(finalContent);
        try {
          localStorage.setItem('site_content', JSON.stringify(finalContent));
        } catch (e) {
          console.warn("Storage quota exceeded for site_content", e);
        }
      }
    }, (error) => {
      console.warn("Content snapshot notice:", error);
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
      }
    });
    return () => unsub();
  }, []);

  // Products Listener (Public)
  useEffect(() => {
    // Try cache first
    const cached = localStorage.getItem('site_products');
    if (cached) {
      try {
        setProducts(JSON.parse(cached));
      } catch (e) {}
    }

    const q = query(collection(db, 'products'));
    const unsub = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(productsData);
      try {
        localStorage.setItem('site_products', JSON.stringify(productsData));
      } catch (e) {
        console.warn("Storage quota exceeded for site_products", e);
        // If products list is too big, maybe just cache the basic info next time
        // but for now, we just avoid the crash
      }
    }, (error) => {
      console.warn("Products snapshot notice:", error);
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
      }
    });
    return () => unsub();
  }, []);

  // Leads Listener (Admin Only)
  useEffect(() => {
    if (!isVerifiedAdmin) {
      setLeads([]);
      return;
    }
    const q = query(collection(db, 'leads'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: (doc.data().timestamp as Timestamp)?.toDate()?.toISOString() || doc.data().timestamp
      })) as Lead[];
      setLeads(leadsData);
    }, (error) => {
      console.warn("Leads snapshot notice:", error);
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
      }
    });
    return () => unsub();
  }, [isVerifiedAdmin]);

  const saveContent = async (newContent: SiteContent) => {
    if (!isVerifiedAdmin) return false;
    // Always update local state & storage first
    setContent(newContent);
    try {
      localStorage.setItem('site_content', JSON.stringify(newContent));
    } catch (e) {}

    if (quotaExceeded) {
      return true;
    }

    try {
      await setDoc(doc(db, 'settings', 'content'), sanitizeForFirestore(newContent));
      return true;
    } catch (e: any) {
      console.warn("Save content to Firestore failed:", e);
      if (e.code === 'resource-exhausted' || e.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
        return true;
      } else if (e.message?.includes('too large')) {
        alert("שגיאה: הקובץ גדול מדי עבור המערכת. נסה להעלות תמונה קטנה יותר או להשתמש בקישור (URL).");
      } else {
        alert("שגיאה בשמירה: " + (e.message || "וודא שאתה מחובר כמנהל"));
      }
      return false;
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    const targetEmail = email.trim().toLowerCase();

    try {
      if (isRegistering) {
        if (!ADMIN_EMAILS.includes(targetEmail)) {
          setLoginError('ניתן להירשם רק עם אימייל המנהל המורשה.');
          setLoginLoading(false);
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, targetEmail, password);
        await sendEmailVerification(userCredential.user);
        setVerificationSent(true);
        setIsRegistering(false);
        setLoginError('');
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, targetEmail, password);
        if (!userCredential.user.email || !ADMIN_EMAILS.includes(userCredential.user.email.toLowerCase())) {
          await signOut(auth);
          setLoginError('גישה נשללה: המשתמש אינו מנהל מורשה.');
        } else if (!userCredential.user.emailVerified) {
          setLoginError('נא לאמת את כתובת האימייל שלך. בדוק את תיבת הדואר הנכנס.');
        } else {
          setShowAdminLogin(false);
          setViewMode('admin');
          setEmail('');
          setPassword('');
        }
      }
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        setLoginError('משתמש לא קיים. אם זו הפעם הראשונה, בחר באופציית "הרשמה".');
      } else if (e.code === 'auth/wrong-password') {
        setLoginError('סיסמה שגויה.');
      } else {
        setLoginError('שגיאה: ' + (e.message || 'פרטים שגויים'));
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setLoginError('נא להזין תחילה את כתובת האימייל שלך בשדה למעלה.');
      alert('נא להזין תחילה את כתובת האימייל שלך בשדה למעלה.');
      return;
    }
    if (!ADMIN_EMAILS.includes(targetEmail)) {
      setLoginError('גישה נשללה: כתובת אימייל זו אינה מורשית כמנהל במערכת.');
      alert('גישה נשללה: כתובת אימייל זו אינה מורשית כמנהל במערכת.');
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    try {
      console.log("Sending password reset email to secure admin:", targetEmail);
      await sendPasswordResetEmail(auth, targetEmail);
      setResetSent(true);
      setLoginError('');
      alert('קישור לאיפוס סיסמה נשלח בהצלחה לכתובת:\n' + targetEmail + '\n\nשים לב: אנא בדוק גם את תיקיית הספאם (Spam/דואר זבל) וכן את לשונית "קידומי מכירות" (Promotions) או "רשתות חברתיות" במידה והמייל לא מופיע תוך מספר דקות.');
    } catch (e: any) {
      console.error("Password reset failure:", e);
      let errMsg = e.message || e;
      if (e.code === 'auth/user-not-found') {
        errMsg = 'לא נמצא משתמש רשום עם אימייל זה. אם טרם נרשמת, יש לבצע הרשמה תחילה.';
      } else if (e.code === 'auth/invalid-email') {
        errMsg = 'כתובת האימייל שהוזנה אינה תקינה.';
      }
      setLoginError('שגיאה בשליחת איפוס: ' + errMsg);
      alert('שגיאה בשליחת איפוס: ' + errMsg);
    } finally {
      setLoginLoading(false);
    }
  };

  const resendVerification = async () => {
    if (user && !user.emailVerified) {
      try {
        await sendEmailVerification(user);
        setVerificationSent(true);
        setTimeout(() => setVerificationSent(false), 8000);
      } catch (e: any) {
        alert('שגיאה בשליחת אימייל אימות: ' + (e.message || e));
      }
    }
  };

  const addLead = async (lead: Omit<Lead, 'id' | 'timestamp'>) => {
    const localLead: Lead = {
      ...lead,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString()
    };
    
    // Save to local leads storage
    try {
      const stored = localStorage.getItem('site_offline_leads');
      const leadsList = stored ? JSON.parse(stored) : [];
      localStorage.setItem('site_offline_leads', JSON.stringify([localLead, ...leadsList]));
    } catch (e) {}

    if (quotaExceeded) {
      alert('פרטיך התקבלו בהצלחה! נחזור אליך בהקדם.');
      return;
    }

    try {
      await addDoc(collection(db, 'leads'), sanitizeForFirestore({
        ...lead,
        timestamp: Timestamp.now()
      }));
      alert('פרטיך התקבלו! נחזור אליך בהקדם.');
    } catch (e: any) {
      console.warn("Lead save to Firestore warning:", e);
      if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
        alert('פרטיך התקבלו בהצלחה! נחזור אליך בהקדם.');
      } else {
        alert('חלה שגיאה בשליחת הפרטים. נסה שוב מאוחר יותר.');
      }
    }
  };

  const deleteLead = async (id: string) => {
    if (!isVerifiedAdmin) return;
    if (!confirm('האם אתה בטוח שברצונך למחוק ליד זה?')) return;
    
    setLeads(prev => prev.filter(l => l.id !== id));
    
    if (quotaExceeded) {
      alert('הליד נמחק בהצלחה!');
      return;
    }

    try {
      await deleteDoc(doc(db, 'leads', id));
      alert('הליד נמחק בהצלחה!');
    } catch (e: any) {
      console.warn("Delete lead warning:", e);
      if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
        alert('הליד נמחק בהצלחה!');
      } else {
        alert("שגיאה במחיקה: " + e.message);
      }
    }
  };

  const addToCart = (product: Product, quantity: number, selectedSize?: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id && item.selectedSize === selectedSize);
      if (existing) {
        return prev.map(item => 
          (item.product.id === product.id && item.selectedSize === selectedSize) 
            ? { ...item, quantity: item.quantity + quantity } 
            : item
        );
      }
      return [...prev, { product, quantity, selectedSize }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (productId: string, size?: string) => {
    setCart(prev => prev.filter(item => !(item.product.id === productId && item.selectedSize === size)));
  };

  const updateCartQuantity = (productId: string, quantity: number, size?: string) => {
    if (quantity <= 0) {
      removeFromCart(productId, size);
      return;
    }
    setCart(prev => prev.map(item => 
      (item.product.id === productId && item.selectedSize === size) 
        ? { ...item, quantity } 
        : item
    ));
  };

  const saveProduct = async (product: Product) => {
    if (!isVerifiedAdmin) return;
    
    // Safety check: Firestore document size limit is ~1MB (1,048,576 bytes)
    const estimatedSize = JSON.stringify(product).length;
    if (estimatedSize > 1040000) { 
       const errorMsg = "המוצר מכיל יותר מדי מידע (תמונות באיכות גבוהה מדי או רבות מדי). אנא נסה להסיר תמונה אחת או להשתמש בתמונות ששוקלות פחות.";
       alert(errorMsg);
       throw new Error(errorMsg);
    }

    // Optimistic local update so UI and storage are always synced
    setProducts(prev => {
      const exists = prev.some(p => p.id === product.id);
      const updated = exists ? prev.map(p => p.id === product.id ? product : p) : [...prev, product];
      try {
        localStorage.setItem('site_products', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    if (quotaExceeded) {
      return;
    }

    try {
      const sanitized = sanitizeForFirestore(product);
      await setDoc(doc(db, 'products', product.id), sanitized);
    } catch (e: any) {
      console.warn("Save product to Firestore encountered an issue:", e);
      if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota limit exceeded') || e?.message?.includes('exhausted')) {
        setQuotaExceeded(true);
        console.warn("Firestore quota reached: product was saved to local cache.");
      } else {
        alert("שגיאה בשמירת המוצר: " + (e.message || "נסה שוב"));
        throw e;
      }
    }
  };

  const deleteProduct = async (id: string) => {
    if (!isVerifiedAdmin) return;
    
    setProducts(prev => {
      const updated = prev.filter(p => p.id !== id);
      try {
        localStorage.setItem('site_products', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    if (quotaExceeded) {
      alert('המוצר נמחק בהצלחה!');
      return;
    }

    try {
      await deleteDoc(doc(db, 'products', id));
      alert('המוצר נמחק בהצלחה!');
    } catch (e: any) {
      console.warn("Delete product warning:", e);
      if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota limit exceeded')) {
        setQuotaExceeded(true);
        alert('המוצר נמחק בהצלחה!');
      } else {
        alert("שגיאה במחיקת המוצר: " + (e.message || "נסה שוב"));
      }
    }
  };

  return (
    <div className="min-h-screen bg-luxury-black overflow-x-hidden text-luxury-white">
      {quotaExceeded && (
        <div className="fixed top-0 left-0 right-0 z-[999] bg-red-950/90 border-b border-red-500/30 text-white p-3 backdrop-blur-md flex items-center justify-between gap-4 px-4 shadow-xl">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-400 shrink-0" size={18} />
            <p className="text-xs text-zinc-200">
              <span className="font-bold text-red-300 ml-1">מצב לא מקוון / מגבלת מכסה זמנית:</span>
              הנתונים מוצגים מזיכרון המטמון המקומי. כלל הפעולות בחנות ממשיכות לעבוד כרגיל.
            </p>
          </div>
          <button 
            onClick={() => setQuotaExceeded(false)}
            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded transition-colors"
          >
            סגור
          </button>
        </div>
      )}

      {isVerifiedAdmin && viewMode === 'admin' ? (
        <AdminPanel 
          content={content} 
          products={products}
          setContent={saveContent} 
          onSaveProduct={saveProduct}
          onDeleteProduct={deleteProduct}
          onLogout={() => { signOut(auth); setViewMode('store'); }} 
          onReturn={() => setViewMode('store')}
          leads={leads}
          onDeleteLead={deleteLead}
        />
      ) : (
        <>
          <Navbar 
            onAdminClick={() => {
              if (isVerifiedAdmin) {
                setViewMode('admin');
                return;
              }
              setEmail('');
              setPassword('');
              setLoginError('');
              setResetSent(false);
              setVerificationSent(false);
              setShowAdminLogin(true);
            }}
            content={content} 
            cartCount={cart.reduce((acc, item) => acc + item.quantity, 0)}
            onCartClick={() => setIsCartOpen(true)}
            onContactClick={() => setIsContactOpen(true)}
            onAboutClick={() => setIsAboutOpen(true)}
            onCategorySelect={(id) => {
              setSelectedCategory(id);
              const el = document.getElementById('products');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            activeCategoryId={selectedCategory}
          />
          <LandingPage 
            content={content} 
            products={products}
            onAddLead={addLead} 
            onAdminClick={() => {
              if (isVerifiedAdmin) {
                setViewMode('admin');
                return;
              }
              setEmail('');
              setPassword('');
              setLoginError('');
              setResetSent(false);
              setVerificationSent(false);
              setShowAdminLogin(true);
            }} 
            onProductClick={setSelectedProduct}
            cartCount={cart.reduce((acc, item) => acc + item.quantity, 0)}
            onCartClick={() => setIsCartOpen(true)}
            onContactClick={() => setIsContactOpen(true)}
            onAboutClick={() => setIsAboutOpen(true)}
            onCategorySelect={(id) => {
              setSelectedCategory(id);
            }}
            selectedCategory={selectedCategory}
          />
          <AnimatePresence>
            {isContactOpen && (
              <ContactModal 
                key="contact-modal"
                content={content}
                onClose={() => setIsContactOpen(false)}
                onAddLead={addLead}
              />
            )}
            {isAboutOpen && (
              <AboutModal 
                key="about-modal"
                content={content}
                onClose={() => setIsAboutOpen(false)}
              />
            )}
            {selectedProduct && (
              <ProductDetailsModal 
                key={`product-details-modal-${selectedProduct.id}`}
                product={selectedProduct} 
                onClose={() => setSelectedProduct(null)} 
                onAddToCart={addToCart}
              />
            )}
            {isCartOpen && (
              <CartDrawer 
                key="cart-drawer-modal"
                items={cart} 
                onClose={() => setIsCartOpen(false)} 
                onUpdateQuantity={updateCartQuantity}
                onRemove={removeFromCart}
                siteName={content.siteName}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Admin Login Modal */}
      <AnimatePresence>
        {showAdminLogin && (
          <motion.div 
            key="admin-login-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-gold/30 p-8 rounded-2xl w-full max-w-md shadow-2xl relative my-auto max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button onClick={() => { setShowAdminLogin(false); setResetSent(false); setLoginError(''); }} className="absolute top-4 left-4 text-zinc-400 hover:text-white">
                <X />
              </button>

              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-gold/20">
                  <Lock className="text-gold" size={32} />
                </div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">כניסת מנהל</h2>
                <p className="text-xs text-text-muted uppercase tracking-widest mt-1">גישה מוגבלת לצוות בלבד</p>
              </div>

              {verificationSent ? (
                <div className="text-center py-8">
                   <div className="bg-gold/10 p-4 rounded-lg mb-6 border border-gold/20">
                      <p className="text-gold font-bold italic uppercase tracking-wider mb-2">נשלח אימייל אימות!</p>
                      <p className="text-sm text-zinc-300">אנא בדוק את תיבת המייל שלך (**{user?.email}**) ואשר את ההרשמה.</p>
                      <p className="text-[10px] text-zinc-500 mt-4 leading-relaxed">לאחר האישור, תוכל להתחבר למערכת.</p>
                   </div>
                   <button 
                    onClick={() => setVerificationSent(false)}
                    className="text-zinc-400 hover:text-white transition-colors text-xs uppercase font-bold tracking-widest"
                   >
                     חזרה למסך ההתחברות
                   </button>
                </div>
              ) : resetSent ? (
                <div className="text-center py-8 space-y-6">
                   <div className="bg-gold/10 p-6 rounded-2xl mb-2 border border-gold/20 space-y-3">
                      <p className="text-gold font-black text-lg">לינק לאיפוס סיסמה נשלח בהצלחה!</p>
                      <p className="text-sm text-zinc-300 leading-relaxed">
                         אם כתובת האימייל שהזנת רשומה במערכת כמנהל, תקבל אימייל עם קישור לאיפוס סיסמתך תוך מספר דקות.
                      </p>
                      <p className="text-xs text-zinc-400 font-bold bg-black/30 p-3 rounded border border-white/5 leading-normal">
                         💡 <span className="text-white">חשוב מאוד:</span> אימיילים משרתי Firebase עלולים להגיע לתיקיית <strong className="text-gold">ספאם / דואר זבל (Spam)</strong>, או ללשונית <strong className="text-gold">קידומי מכירות (Promotions)</strong> או <strong className="text-gold">רשתות חברתיות</strong> ב-Gmail. אנא בדוק היטב בתיקיות אלו!
                      </p>
                   </div>
                   <button 
                    onClick={() => setResetSent(false)}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest transition-colors border border-white/10"
                   >
                     חזרה למסך התחברות
                   </button>
                </div>
              ) : user && !user.emailVerified && isAdmin ? (
                <div className="text-center py-6 space-y-6 animate-in fade-in duration-300">
                   <div className="bg-gold/10 p-6 rounded-2xl border border-gold/20 space-y-4">
                      <p className="text-gold font-bold text-lg">המייל שלך טרם אומת</p>
                      <p className="text-sm text-zinc-300 leading-relaxed">
                        נרשמת בהצלחה עם האימייל <strong className="text-white">{user.email}</strong>, אך עליך לאמת את כתובת המייל כדי להיכנס לעמוד הניהול.
                      </p>
                      <p className="text-xs text-zinc-400">
                        אנא בדוק את תיבת הדואר הנכנס (וגם את תיבת הספאם/קידומי מכירות) ולחץ על קישור האימות ששלחנו אליך.
                      </p>
                   </div>

                   {verificationSent && (
                     <div className="bg-green-500/10 border border-green-500/20 p-3 rounded text-green-400 text-xs font-bold animate-pulse">
                       אימייל אימות חדש נשלח בהצלחה!
                     </div>
                   )}

                   {loginError && (
                     <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-2 text-red-500 text-sm">
                       <AlertCircle size={16} />
                       {loginError}
                     </div>
                   )}

                   <div className="flex flex-col gap-3">
                     <button 
                      onClick={resendVerification}
                      className="w-full bg-gold hover:bg-gold/80 hover:scale-[1.02] text-black py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-[0_4px_15px_rgba(212,175,55,0.2)]"
                     >
                       שלח אימייל אימות שוב
                     </button>
                     
                     <button 
                      onClick={async () => {
                        if (auth.currentUser) {
                          await auth.currentUser.reload();
                          setUser(auth.currentUser);
                          if (auth.currentUser.emailVerified) {
                            setShowAdminLogin(false);
                            setViewMode('admin');
                          } else {
                            setLoginError('האימייל עדיין לא אומת. אנא ודא שלחצת על הקישור במייל שלך.');
                          }
                        }
                      }}
                      className="w-full bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                     >
                       בדקתי ואישרתי, היכנס לעמוד הניהול
                     </button>

                     <button 
                      onClick={() => { signOut(auth); setLoginError(''); setVerificationSent(false); }}
                      className="text-zinc-500 hover:text-white transition-colors text-xs uppercase font-black tracking-widest pt-2"
                     >
                       התחבר עם משתמש אחר / התנתק
                     </button>
                   </div>
                </div>
              ) : (
                <form onSubmit={handleLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">אימייל מורשה</label>
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="sleek-input"
                      placeholder="admin@rubitennis.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                       <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">סיסמה</label>
                       {!isRegistering && (
                         <button 
                          type="button"
                          onClick={handleResetPassword}
                          className="text-[10px] uppercase font-bold text-gold hover:underline"
                         >
                           שכחתי סיסמה
                         </button>
                       )}
                    </div>
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="sleek-input"
                      placeholder="••••••••"
                      required
                    />
                  </div>

                  {loginError && (
                    <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-2 text-red-500 text-sm">
                      <AlertCircle size={16} />
                      {loginError}
                    </div>
                  )}

                  <div className="space-y-4">
                    <button 
                      type="submit"
                      disabled={loginLoading}
                      className="sleek-btn flex items-center justify-center gap-2 disabled:opacity-50 animate-pulse-once"
                    >
                      {loginLoading ? 'מבצע פעולה...' : (
                        <>
                          {isRegistering ? <Plus size={18} /> : <ArrowRight size={18} />}
                          {isRegistering ? 'צור חשבון מנהל' : 'כניסה למערכת'}
                        </>
                      )}
                    </button>

                    {ADMIN_EMAILS.includes(email.trim().toLowerCase()) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsRegistering(!isRegistering);
                          setLoginError('');
                        }}
                        className="w-full text-center text-[10px] uppercase font-bold tracking-[0.2em] text-zinc-500 hover:text-gold transition-colors"
                      >
                        {isRegistering ? 'כבר יש לך חשבון? התחבר' : 'פעם ראשונה כאן? הירשם כמנהל'}
                      </button>
                    )}
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Navbar ---
function Navbar({ onAdminClick, content, cartCount, onCartClick, onContactClick, onAboutClick, onCategorySelect, activeCategoryId }: { 
  onAdminClick: () => void, 
  content: SiteContent,
  cartCount: number,
  onCartClick: () => void,
  onContactClick: () => void,
  onAboutClick: () => void,
  onCategorySelect: (id: string) => void,
  activeCategoryId: string
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur-xl border-b border-white/10 shadow-2xl transition-all duration-300" dir="rtl">
      {/* Container to handle mobile two-row vs desktop one-row */}
      <div className="max-w-7xl mx-auto px-4 md:px-12 py-2 md:py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        
        {/* Mobile Top Row / Desktop Side 1: Logo and Actions */}
        <div className="w-full md:w-auto flex justify-between items-center md:gap-8 order-1 md:order-1">
          {/* Logo Section */}
          <div className="flex items-center">
            {content.logo ? (
              <img 
                src={content.logo} 
                alt="Logo" 
                className="h-10 md:h-12 w-auto object-contain cursor-pointer hover:scale-105 transition-transform" 
                onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})} 
                referrerPolicy="no-referrer" 
              />
            ) : (
              <h1 className="text-xl md:text-2xl font-serif font-bold text-tennis-yellow uppercase tracking-widest">{content.siteName}</h1>
            )}
          </div>

          {/* Desktop Actions (Hidden on Mobile row 1, will show in actions group) */}
          <div className="flex items-center gap-2 md:gap-4 md:order-3">
             <div className="hidden sm:flex items-center gap-2 border-r border-white/10 pr-4 mr-2">
              <a 
                href={`https://wa.me/${content.contact.whatsapp}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 text-green-500 hover:bg-green-500/10 rounded-full transition-colors"
                title="WhatsApp"
              >
                <MessageCircle size={22} />
              </a>
              <a 
                href={content.contact.facebook} 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full transition-colors"
                title="Facebook"
              >
                <Facebook size={22} />
              </a>
            </div>

            <button 
              onClick={onAdminClick}
              className="p-2 text-gold hover:bg-gold/10 rounded-full transition-colors"
              title="ניהול אתר"
            >
              <Settings size={22} />
            </button>
            
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 text-gold hover:bg-gold/10 rounded-full transition-all relative z-[70]"
              title="תפריט"
            >
              {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>

            <button 
              onClick={onCartClick}
              className="relative p-2 text-gold hover:bg-gold/10 rounded-full transition-colors"
              title="סל קניות"
            >
              <ShoppingCart size={22} />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-zinc-900 shadow-lg">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Categories: Full width on mobile bottom row, middle on desktop */}
        <div className="w-full flex-grow overflow-x-auto md:overflow-visible order-2 md:order-2 py-1">
          <div className="flex flex-wrap md:flex-nowrap justify-center gap-3 md:gap-8 items-center min-w-max md:min-w-0">
            <button 
              onClick={() => onCategorySelect('all')}
              className={`text-sm md:text-base uppercase font-black tracking-widest transition-all border-b-2 py-1 ${activeCategoryId === 'all' ? 'text-gold border-gold' : 'text-white/30 border-transparent hover:text-white/60'}`}
            >
              הכל
            </button>
            {content.categories.map(cat => (
              <button 
                key={`nav-cat-${cat.id}`}
                onClick={() => onCategorySelect(cat.id)}
                className={`text-sm md:text-base uppercase font-black tracking-widest transition-all border-b-2 py-1 ${activeCategoryId === cat.id ? 'text-gold border-gold' : 'text-white/30 border-transparent hover:text-white/60'}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Hamburger Sidebar Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            key="menu-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMenuOpen(false)}
            className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm"
          />
        )}
        {isMenuOpen && (
          <motion.div
            key="menu-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-[80] w-[85%] max-w-[400px] bg-zinc-900 border-l border-white/5 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] flex flex-col p-8 md:p-12"
          >
            <div className="flex justify-between items-center mb-16">
               <p className="text-gold text-[10px] uppercase font-black tracking-[0.4em] opacity-40">ניווט תפריט</p>
               <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-2 text-white hover:text-gold transition-colors"
               >
                 <X size={24} />
               </button>
            </div>

            <div className="flex-grow flex flex-col justify-center space-y-12" dir="rtl">
              <nav className="flex flex-col gap-10">
                 <a 
                  href="#hero" 
                  onClick={() => setIsMenuOpen(false)} 
                  className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic hover:text-gold transition-all hover:translate-x-[-10px] inline-block"
                 >
                   {content.labels.home}
                 </a>
                 <button 
                   onClick={() => { setIsMenuOpen(false); onAboutClick(); }} 
                   className="text-right text-4xl md:text-5xl font-black uppercase tracking-tighter italic hover:text-gold transition-all hover:translate-x-[-10px] inline-block"
                 >
                   {content.labels.about}
                 </button>
                 <a 
                  href="#products" 
                  onClick={() => setIsMenuOpen(false)} 
                  className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic hover:text-gold transition-all hover:translate-x-[-10px] inline-block"
                 >
                   {content.labels.collection}
                 </a>
                 <button 
                   onClick={() => { setIsMenuOpen(false); onContactClick(); }} 
                   className="text-right text-4xl md:text-5xl font-black uppercase tracking-tighter italic hover:text-gold transition-all hover:translate-x-[-10px] inline-block"
                 >
                   {content.labels.contact}
                 </button>
              </nav>

              {content.labels && (
                <div className="pt-12 border-t border-white/5 space-y-6">
                  <p className="text-zinc-600 text-[10px] uppercase font-black tracking-[0.4em]">{content.labels.categoriesTitle || "Labels"}</p>
                  <p className="text-sm text-zinc-400 font-light italic leading-loose">
                    {content.siteName} - בחירה מקצועית של ציוד טניס איכותי עבור שחקנים בכל הרמות.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-12 border-t border-white/5 flex gap-6 mt-auto">
               <a href={`https://wa.me/${content.contact.whatsapp}`} className="bg-white/5 p-3 rounded-full text-gold hover:bg-gold hover:text-black transition-all"><MessageCircle size={24} /></a>
               <a href={content.contact.facebook} className="bg-white/5 p-3 rounded-full text-gold hover:bg-gold hover:text-black transition-all"><Facebook size={24} /></a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function ProductCard({ product, onClick }: { product: Product, onClick: () => void, key?: any }) {
  const images = useMemo(() => {
    return product.images && product.images.length > 0 ? product.images : [product.image];
  }, [product.images, product.image]);

  const [currentIdx, setCurrentIdx] = useState(0);

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="group relative cursor-pointer"
      onClick={onClick}
    >
      <div className="aspect-[4/5] overflow-hidden rounded-xl mb-4 bg-zinc-900 border border-white/5 relative shadow-2xl shadow-black/40">
        <AnimatePresence mode="wait">
          <motion.img 
            key={currentIdx}
            src={images[currentIdx] || null} 
            alt={product.name} 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4 }}
            className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
        </AnimatePresence>
        
        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Quick Add/View Button - Desktop Only */}
        <div className="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hidden md:block z-30">
          <button className="w-full bg-white text-black py-3 rounded-full font-bold text-xs uppercase tracking-widest hover:bg-gold transition-colors shadow-xl">
            פרטים נוספים
          </button>
        </div>
        
        {images.length > 1 && (
          <>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-1.5 z-10 md:group-hover:bottom-20 transition-all">
              {images.map((_, i) => (
                <button 
                  key={i} 
                  onClick={(e) => { e.stopPropagation(); setCurrentIdx(i); }}
                  className={`h-1 rounded-full transition-all ${i === currentIdx ? 'bg-gold w-4' : 'bg-white/30 w-1'}`}
                />
              ))}
            </div>
            
            <button 
              onClick={(e) => { e.stopPropagation(); setCurrentIdx((prev) => (prev > 0 ? prev - 1 : images.length - 1)); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-black/60"
            >
              <ChevronLeft size={16} />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); setCurrentIdx((prev) => (prev < images.length - 1 ? prev + 1 : 0)); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-black/60"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 px-1">
        <h4 className="text-xs md:text-sm font-bold uppercase tracking-tight text-zinc-100 line-clamp-1 group-hover:text-gold transition-colors">{product.name}</h4>
        <div className="flex justify-between items-baseline">
           <span className="text-sm md:text-base font-black text-white">₪{product.price}</span>
           {product.sizes && product.sizes.length > 0 && (
             <span className="text-[9px] text-zinc-500 font-bold">{product.sizes.length} מידות</span>
           )}
        </div>
      </div>
    </motion.div>
  );
}

// --- Accessibility Menu ---
function AccessibilityMenu({ content }: { content: SiteContent }) {
  const [isOpen, setIsOpen] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [grayscale, setGrayscale] = useState(false);
  const [fontSize, setFontSize] = useState(1);
  const [readableFont, setReadableFont] = useState(false);
  const [underlineLinks, setUnderlineLinks] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    if (contrast) html.classList.add('high-contrast');
    else html.classList.remove('high-contrast');

    if (grayscale) html.classList.add('grayscale-filter');
    else html.classList.remove('grayscale-filter');

    if (readableFont) html.classList.add('readable-font');
    else html.classList.remove('readable-font');

    if (underlineLinks) html.classList.add('underline-links');
    else html.classList.remove('underline-links');

    html.style.fontSize = `${fontSize * 100}%`;

    return () => {
      html.classList.remove('high-contrast', 'grayscale-filter', 'readable-font', 'underline-links');
      html.style.fontSize = '';
    };
  }, [contrast, grayscale, fontSize, readableFont, underlineLinks]);

  const reset = () => {
    setContrast(false);
    setGrayscale(false);
    setFontSize(1);
    setReadableFont(false);
    setUnderlineLinks(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3" dir="rtl">
      {/* Floating WhatsApp Button */}
      <motion.a
        href={`https://wa.me/${content.contact.whatsapp}?text=${encodeURIComponent('היי, אשמח לקבל פרטים נוספים')}`}
        target="_blank"
        rel="noopener noreferrer"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="w-14 h-14 bg-green-500 text-white rounded-full flex items-center justify-center shadow-2xl shadow-green-500/40 relative group"
      >
        <MessageCircle size={28} />
        <span className="absolute right-full mr-4 bg-white text-black px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
          צרו קשר ב-WhatsApp
        </span>
      </motion.a>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="accessibility-menu"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="bg-zinc-900 border border-gold/30 p-6 rounded-2xl shadow-2xl w-72 mb-2"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-gold font-bold text-lg">תפריט נגישות</h3>
              <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <button 
                onClick={() => setContrast(!contrast)}
                className={`w-full flex items-center justify-between p-3 rounded border transition-all ${contrast ? 'bg-gold text-black border-gold' : 'bg-white/5 border-white/10 hover:border-gold/50'}`}
              >
                <span className="text-xs font-bold uppercase tracking-widest">ניגודיות גבוהה</span>
                <Check size={14} className={contrast ? 'opacity-100' : 'opacity-0'} />
              </button>

              <button 
                onClick={() => setGrayscale(!grayscale)}
                className={`w-full flex items-center justify-between p-3 rounded border transition-all ${grayscale ? 'bg-gold text-black border-gold' : 'bg-white/5 border-white/10 hover:border-gold/50'}`}
              >
                <span className="text-xs font-bold uppercase tracking-widest">גווני אפור</span>
                <Check size={14} className={grayscale ? 'opacity-100' : 'opacity-0'} />
              </button>

              <button 
                onClick={() => setReadableFont(!readableFont)}
                className={`w-full flex items-center justify-between p-3 rounded border transition-all ${readableFont ? 'bg-gold text-black border-gold' : 'bg-white/5 border-white/10 hover:border-gold/50'}`}
              >
                <span className="text-xs font-bold uppercase tracking-widest">גופן קריא</span>
                <Check size={14} className={readableFont ? 'opacity-100' : 'opacity-0'} />
              </button>

              <button 
                onClick={() => setUnderlineLinks(!underlineLinks)}
                className={`w-full flex items-center justify-between p-3 rounded border transition-all ${underlineLinks ? 'bg-gold text-black border-gold' : 'bg-white/5 border-white/10 hover:border-gold/50'}`}
              >
                <span className="text-xs font-bold uppercase tracking-widest">הדגשת קישורים</span>
                <Check size={14} className={underlineLinks ? 'opacity-100' : 'opacity-0'} />
              </button>

              <div className="pt-4 border-t border-white/5">
                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-3">גודל גופן</p>
                <div className="flex gap-2">
                  <button onClick={() => setFontSize(Math.min(fontSize + 0.1, 1.5))} className="flex-grow p-2 bg-white/5 border border-white/10 rounded hover:border-gold/50">+</button>
                  <button onClick={() => setFontSize(Math.max(fontSize - 0.1, 0.8))} className="flex-grow p-2 bg-white/5 border border-white/10 rounded hover:border-gold/50">-</button>
                </div>
              </div>

              <button onClick={reset} className="w-full text-center text-gold text-[10px] font-black uppercase tracking-widest mt-4 hover:underline">
                אפס הגדרות
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gold text-black p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all z-[101]"
        title="תפריט נגישות"
      >
        <Accessibility size={24} />
      </button>
    </div>
  );
}

// --- About Modal ---
function AboutModal({ onClose, content }: { key?: string, onClose: () => void, content: SiteContent }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[160] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="bg-luxury-dark-gray border border-gold/20 p-8 md:p-12 rounded-2xl w-full max-w-3xl relative my-auto shadow-2xl flex flex-col md:flex-row gap-8"
      >
        <button 
          onClick={onClose}
          className="absolute top-6 left-6 text-zinc-500 hover:text-gold transition-colors z-10"
        >
          <X size={24} />
        </button>

        <div className="w-full md:w-1/2 overflow-hidden rounded-xl border border-white/5">
          <img 
            src={content.about.image || "https://images.unsplash.com/photo-1595435064212-472178396010?auto=format&fit=crop&q=80&w=800"} 
            alt="About us" 
            className="w-full h-full object-cover aspect-square md:aspect-auto"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="w-full md:w-1/2 flex flex-col justify-center" dir="rtl">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-gold mb-6">{content.about.title}</h2>
          <p className="text-zinc-300 leading-loose whitespace-pre-wrap text-lg">
            {content.about.content}
          </p>
          <div className="mt-8 pt-8 border-t border-white/5">
            <h3 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-500 mb-4">מוזמנים לבקר אותנו</h3>
            <p className="text-sm text-zinc-400 italic">{content.contact.address}</p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Contact Modal ---
function ContactModal({ onClose, onAddLead, content }: { key?: string, onClose: () => void, onAddLead: (lead: Omit<Lead, 'id' | 'timestamp'>) => void, content: SiteContent }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[160] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-luxury-dark-gray border border-gold/20 p-8 md:p-12 rounded-2xl w-full max-w-xl relative my-auto shadow-2xl"
      >
        <button onClick={onClose} className="absolute top-6 left-6 text-zinc-500 hover:text-white transition-colors">
          <X size={24} />
        </button>
        
        <h2 className="text-4xl font-black text-gold uppercase tracking-tighter mb-2 italic">ייעוץ מקצועי</h2>
        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-[0.2em] mb-10">השאירו פרטים ונחזור אליכם בהקדם</p>
        
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            onAddLead({
              name: formData.get('name') as string,
              email: formData.get('email') as string,
              message: formData.get('message') as string,
            });
            onClose();
          }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">שם מלא</label>
            <input name="name" required placeholder="ישראל ישראלי" className="sleek-input bg-black/40" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">טלפון / אימייל</label>
            <input name="email" required type="text" placeholder="050-0000000" className="sleek-input bg-black/40" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">הודעה</label>
            <textarea name="message" required rows={4} placeholder="איך נוכל לעזור?" className="sleek-input bg-black/40" />
          </div>
          <button type="submit" className="sleek-btn uppercase tracking-widest h-16 text-xs bg-gold text-black border-gold hover:bg-gold/90 scale-100 hover:scale-[1.02] transition-all">
            שלח פרטים עכשיו
          </button>
        </form>

        <div className="mt-12 flex gap-4">
          <a href={`https://wa.me/${content.contact.whatsapp}`} className="flex-grow text-center py-4 bg-white/5 text-[10px] uppercase font-bold tracking-widest border border-white/10 hover:border-gold transition-all">WhatsApp</a>
          <a href={content.contact.facebook} className="flex-grow text-center py-4 bg-white/5 text-[10px] uppercase font-bold tracking-widest border border-white/10 hover:border-gold transition-all">Facebook</a>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Landing Page ---
function LandingPage({ 
  content, 
  products: allProducts, 
  onAddLead, 
  onAdminClick, 
  onProductClick, 
  cartCount, 
  onCartClick, 
  onContactClick, 
  onAboutClick,
  selectedCategory,
  onCategorySelect
}: { 
    content: SiteContent, 
    products: Product[],
    onAddLead: (lead: Omit<Lead, 'id' | 'timestamp'>) => void,
    onAdminClick: () => void,
    onProductClick: (product: Product) => void,
    cartCount: number,
    onCartClick: () => void,
    onContactClick: () => void,
    onAboutClick: () => void,
    selectedCategory: string,
    onCategorySelect: (id: string) => void
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  useEffect(() => {
    setSelectedTags([]);
    setSelectedSizes([]);
    if (selectedCategory !== 'all') {
      const el = document.getElementById('products');
      if (el) {
        const offset = window.innerWidth < 768 ? 160 : 100; // Dynamic offset for taller mobile navbar
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = el.getBoundingClientRect().top;
        const elementPosition = elementRect - bodyRect;
        const offsetPosition = elementPosition - offset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    }
  }, [selectedCategory]);

  const activeCategory = useMemo(() => {
    return content.categories.find(c => c.id === selectedCategory);
  }, [selectedCategory, content.categories]);

  // Split the tags into brand tags and weight tags for the SELECTED CATEGORY ONLY
  const { brandTags, weightTags } = useMemo(() => {
    if (selectedCategory === 'all') {
      return { brandTags: [], weightTags: [] };
    }
    
    const productsInScope = allProducts.filter(
      p => p.categoryId === selectedCategory && p.inStock !== false
    );
    
    const brands = new Set<string>();
    const weights = new Set<string>();
    
    productsInScope.forEach(p => {
      (p.tags || []).forEach(tag => {
        const trimmed = tag.trim();
        if (!trimmed) return;
        
        // Weight tags end with 'g' or 'G' or 'גרם' or are numeric + 'ג'
        const isWeight = trimmed.toLowerCase().endsWith('g') || 
                         trimmed.endsWith('גרם') || 
                         (trimmed.endsWith('ג') && /\d+/.test(trimmed));
        if (isWeight) {
          weights.add(trimmed);
        } else {
          brands.add(trimmed);
        }
      });
    });
    
    return {
      brandTags: Array.from(brands).sort(),
      weightTags: Array.from(weights).sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      })
    };
  }, [selectedCategory, allProducts]);

  // Extract unique sizes for the products in the selected category ONLY
  const availableSizes = useMemo(() => {
    if (selectedCategory === 'all') {
      return [];
    }
    
    const productsInScope = allProducts.filter(
      p => p.categoryId === selectedCategory && p.inStock !== false
    );
    
    const sizes = new Set<string>();
    productsInScope.forEach(p => {
      (p.sizes || []).forEach(size => {
        if (size.trim()) sizes.add(size.trim());
      });
    });
    
    return Array.from(sizes).sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [selectedCategory, allProducts]);

  const filteredProducts = useMemo(() => {
    let prods = allProducts.filter(p => p.inStock !== false);
    if (selectedCategory !== 'all') {
      prods = prods.filter(p => p.categoryId === selectedCategory);
    }
    
    // Split selected tags into brand selections and weight selections
    const isWeightStr = (t: string) => t.toLowerCase().endsWith('g') || 
                                       t.endsWith('גרם') || 
                                       (t.endsWith('ג') && /\d+/.test(t));
    const selectedBrands = selectedTags.filter(tag => !isWeightStr(tag));
    const selectedWeights = selectedTags.filter(tag => isWeightStr(tag));

    // Multiple brands: OR logic within category tags
    if (selectedBrands.length > 0) {
      prods = prods.filter(p => 
        selectedBrands.some(brand => (p.tags || []).includes(brand))
      );
    }

    // Multiple weights: OR logic within category tags
    if (selectedWeights.length > 0) {
      prods = prods.filter(p => 
        selectedWeights.some(weight => (p.tags || []).includes(weight))
      );
    }

    // Multiple sizes: OR logic within category sizes
    if (selectedSizes.length > 0) {
      prods = prods.filter(p => 
        selectedSizes.some(size => (p.sizes || []).includes(size))
      );
    }
    
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      prods = prods.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.description.toLowerCase().includes(q)
      );
    }
    
    return prods;
  }, [selectedCategory, selectedTags, selectedSizes, allProducts, searchTerm]);

  return (
    <div className="w-full min-h-screen bg-luxury-black relative overflow-x-hidden pt-36 md:pt-40">
      <AccessibilityMenu content={content} />

      {/* Main Luxury Banner (Left) */}
      <div className="hidden xl:flex fixed left-0 top-0 bottom-0 w-24 items-center justify-center border-r border-white/5 bg-black/40 backdrop-blur-2xl z-20 pointer-events-none">
         <div className="-rotate-90 whitespace-nowrap">
           <span className="text-gold font-serif text-[10px] tracking-[0.8em] uppercase opacity-40 mr-12 italic">SINCE 2026</span>
           <span className="text-luxury-white font-black text-4xl uppercase tracking-[0.2em] drop-shadow-[0_0_20px_rgba(255,255,255,0.1)]">
             {content.siteName}
           </span>
         </div>
      </div>

      <main className="w-full flex-grow flex flex-col items-center pt-24 md:pt-32 pb-24 px-6 md:px-12 lg:px-24">
        {/* Hero Section */}
        <div id="hero" className="w-full max-w-6xl mb-24 text-center md:text-right flex flex-col items-center md:items-end">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full overflow-hidden rounded-3xl border border-gold/20 bg-black/40 mb-12"
          >
             {content.logo && (
               <img src={content.logo} alt="Elite Collection" className="w-full h-auto max-h-[300px] object-contain md:object-cover" referrerPolicy="no-referrer" />
             )}
          </motion.div>

          <div className="max-w-3xl">
            <motion.h1 
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-5xl md:text-8xl font-black leading-[0.9] mb-6 uppercase tracking-tighter"
            >
              <span className="block">{content.hero.title.split(' ').slice(0, -1).join(' ')}</span>
              <span className="text-gold italic block mt-2">{content.hero.title.split(' ').slice(-1)}</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-xl md:text-2xl text-zinc-400 mb-10 max-w-2xl leading-relaxed font-light"
            >
              {content.hero.subtitle}
            </motion.p>

            {/* Search Bar */}
            <div className="relative w-full max-w-xl group mt-8">
              <div className="absolute right-6 top-1/2 -translate-y-1/2 text-gold transition-all group-focus-within:scale-110">
                <Search size={22} strokeWidth={3} />
              </div>
              <input 
                dir="rtl"
                type="text" 
                placeholder="חפש דגם, קטגוריה או מידה..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-full py-6 pr-16 pl-8 text-lg focus:outline-none focus:border-gold focus:bg-white/10 transition-all placeholder:text-zinc-700 font-medium shadow-2xl"
              />
              <div className="absolute left-4 top-1/2 -translate-y-1/2 hidden md:block">
                 <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/5">Press Enter</span>
              </div>
            </div>
          </div>
        </div>

        {/* Categories Section - Relocated & Restyled */}
        <section id="categories" className="w-full max-w-6xl mb-32" dir="rtl">
          <div className="flex justify-between items-end mb-10 border-b border-white/5 pb-6">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tighter italic text-gold">{content.labels?.categoriesTitle || "קולקציות מובילות"}</h2>
              <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-[0.3em] mt-2">בחרו סגנון אישי</p>
            </div>
            <div className="hidden md:flex gap-4">
              <div className="w-12 h-[1px] bg-gold opacity-30 mt-4"></div>
            </div>
          </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-8">
             {content.categories.map(cat => {
               const minPrice = allProducts.filter(p => p.categoryId === cat.id && p.inStock !== false).reduce((min, p) => {
                 const priceText = p.price.replace(/[^\d]/g, '');
                 if (!priceText) return min;
                 const price = parseInt(priceText);
                 return !min || price < min ? price : min;
               }, 0);
               
               return (
                 <motion.div 
                  key={cat.id} 
                  whileHover={{ y: -5 }}
                  onClick={() => onCategorySelect(cat.id)}
                  className={`relative overflow-hidden aspect-[4/3] md:aspect-[4/3] rounded-xl cursor-pointer group border transition-all duration-500 ${selectedCategory === cat.id ? 'border-gold ring-4 ring-gold/10' : 'border-white/5 hover:border-gold/40'}`}
                 >
                   {cat.image ? (
                     <img 
                      src={cat.image} 
                      className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-1000 group-hover:scale-110" 
                      referrerPolicy="no-referrer"
                     />
                   ) : (
                     <div className="absolute inset-0 bg-zinc-900"></div>
                   )}
                   <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
                   <div className="absolute inset-x-4 bottom-4 md:inset-x-8 md:bottom-8 z-10">
                      <p className="text-[8px] md:text-[10px] text-gold uppercase font-black tracking-[0.2em] mb-1">{cat.name}</p>
                      <p className="text-sm md:text-xl font-black uppercase tracking-tighter italic text-white line-clamp-1">{cat.subtitle || `מ-₪${minPrice || '---'}`}</p>
                   </div>
                 </motion.div>
               );
             })}
          </div>
        </section>

        {/* Products Grid */}
        <section id="products" className="w-full max-w-6xl scroll-mt-24 md:scroll-mt-32" dir="rtl">
          <div className="sticky top-14 md:top-20 z-40 bg-luxury-black/90 backdrop-blur-md py-4 mb-8 border-b border-white/5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h2 className="text-xl md:text-3xl font-black uppercase tracking-tighter italic text-white flex items-center gap-3">
                <span className="w-2 h-8 bg-gold rounded-full block"></span>
                {selectedCategory === 'all' ? 'הקולקציה המלאה' : `מוצרי ${activeCategory?.name}`}
              </h2>

              {(brandTags.length > 0 || weightTags.length > 0 || availableSizes.length > 0) && (
                <div className="relative w-full md:w-auto flex items-center justify-end gap-3 self-stretch md:self-auto">
                  
                  {/* Cancel All Selection Button */}
                  {(selectedTags.length > 0 || selectedSizes.length > 0) && (
                    <button 
                      onClick={() => { setSelectedTags([]); setSelectedSizes([]); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(239,68,68,0.1)] active:scale-95 cursor-pointer"
                    >
                      <X size={12} strokeWidth={3} />
                      <span>ביטול בחירות ({selectedTags.length + selectedSizes.length})</span>
                    </button>
                  )}

                  {/* Filter Dropdown Toggle Button */}
                  <div className="relative">
                    <button 
                      onClick={() => setShowFilter(!showFilter)}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border cursor-pointer ${showFilter || selectedTags.length > 0 || selectedSizes.length > 0 ? 'bg-gold text-black border-gold shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'bg-white/5 text-zinc-500 border-white/10 hover:border-gold/50'}`}
                    >
                      <Filter size={14} strokeWidth={3} />
                      <span>סינון מוצרים</span>
                      {selectedTags.length + selectedSizes.length > 0 && (
                        <span className="bg-black text-gold px-1.5 py-0.5 rounded-full text-[8px] font-black">
                          {selectedTags.length + selectedSizes.length}
                        </span>
                      )}
                    </button>

                    <AnimatePresence>
                      {showFilter && (
                        <div 
                          key="filter-backdrop"
                          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:backdrop-blur-none" 
                          onClick={() => setShowFilter(false)} 
                        />
                      )}
                      {showFilter && (
                        <motion.div 
                          key="filter-dropdown"
                          initial={{ opacity: 0, y: 15, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 15, scale: 0.95 }}
                          className="fixed md:absolute bottom-4 left-4 right-4 md:bottom-auto md:top-full md:left-auto md:right-0 mt-4 z-50 w-[calc(100vw-2rem)] sm:w-[350px] md:w-[360px] bg-zinc-950/98 border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-5 backdrop-blur-3xl flex flex-col max-h-[85vh] md:max-h-[550px] overflow-hidden"
                        >
                           <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/5 shrink-0">
                             <h4 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">סינונים מרובים</h4>
                             <button 
                              onClick={() => { setSelectedTags([]); setSelectedSizes([]); }}
                              className="text-[9px] text-zinc-500 hover:text-red-400 font-bold uppercase tracking-widest transition-all cursor-pointer"
                             >
                               נקה הכל
                             </button>
                           </div>

                           <div className="space-y-6 overflow-y-auto overflow-x-hidden pr-1 pb-2 flex-1 scrollbar-thin">
                             {/* BRAND SECTION */}
                             {brandTags.length > 0 && (
                               <div className="space-y-2.5">
                                 <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">מותגים מורשים:</span>
                                    {selectedTags.filter(t => brandTags.includes(t)).length > 0 && (
                                      <span className="text-[9px] text-gold font-bold">({selectedTags.filter(t => brandTags.includes(t)).length} נבחרו)</span>
                                    )}
                                 </div>
                                 <div className="space-y-1">
                                   {brandTags.map((tag, i) => {
                                     const isSelected = selectedTags.includes(tag);
                                     return (
                                       <button 
                                         key={`drop-brand-${i}`}
                                         onClick={() => {
                                           if (isSelected) {
                                             setSelectedTags(selectedTags.filter(t => t !== tag));
                                           } else {
                                             setSelectedTags([...selectedTags, tag]);
                                           }
                                         }}
                                         className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold uppercase transition-all cursor-pointer ${isSelected ? 'bg-gold/10 border-gold/40 text-gold' : 'border-transparent hover:bg-white/5 text-zinc-400'}`}
                                       >
                                         <span className="font-extrabold">{tag}</span>
                                         <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-gold border-gold text-black' : 'border-white/20'}`}>
                                           {isSelected && <Check size={10} strokeWidth={4} />}
                                         </div>
                                       </button>
                                     );
                                   })}
                                 </div>
                               </div>
                             )}

                             {/* WEIGHT SECTION */}
                             {weightTags.length > 0 && (
                               <div className="space-y-2.5">
                                 <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">משקלים זמינים:</span>
                                    {selectedTags.filter(t => weightTags.includes(t)).length > 0 && (
                                      <span className="text-[9px] text-gold font-bold">({selectedTags.filter(t => weightTags.includes(t)).length} נבחרו)</span>
                                    )}
                                 </div>
                                 <div className="space-y-1">
                                   {weightTags.map((weight, i) => {
                                     const isSelected = selectedTags.includes(weight);
                                     return (
                                       <button 
                                         key={`drop-weight-${i}`}
                                         onClick={() => {
                                           if (isSelected) {
                                             setSelectedTags(selectedTags.filter(t => t !== weight));
                                           } else {
                                             setSelectedTags([...selectedTags, weight]);
                                           }
                                         }}
                                         className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold uppercase transition-all cursor-pointer ${isSelected ? 'bg-gold/10 border-gold/40 text-gold' : 'border-transparent hover:bg-white/5 text-zinc-400'}`}
                                       >
                                         <span className="font-extrabold">{weight}</span>
                                         <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-gold border-gold text-black' : 'border-white/20'}`}>
                                           {isSelected && <Check size={10} strokeWidth={4} />}
                                         </div>
                                       </button>
                                     );
                                   })}
                                 </div>
                               </div>
                             )}

                             {/* SIZES SECTION */}
                             {availableSizes.length > 0 && (
                               <div className="space-y-2.5">
                                 <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">מידות זמינות:</span>
                                    {selectedSizes.length > 0 && (
                                      <span className="text-[9px] text-gold font-bold">({selectedSizes.length} נבחרו)</span>
                                    )}
                                 </div>
                                 <div className="space-y-1">
                                   {availableSizes.map((size, i) => {
                                     const isSelected = selectedSizes.includes(size);
                                     return (
                                       <button 
                                         key={`drop-size-${i}`}
                                         onClick={() => {
                                           if (isSelected) {
                                             setSelectedSizes(selectedSizes.filter(s => s !== size));
                                           } else {
                                             setSelectedSizes([...selectedSizes, size]);
                                           }
                                         }}
                                         className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold uppercase transition-all cursor-pointer ${isSelected ? 'bg-gold/10 border-gold/40 text-gold' : 'border-transparent hover:bg-white/5 text-zinc-400'}`}
                                       >
                                         <span className="font-extrabold">{size}</span>
                                         <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-gold border-gold text-black' : 'border-white/20'}`}>
                                           {isSelected && <Check size={10} strokeWidth={4} />}
                                         </div>
                                       </button>
                                     );
                                   })}
                                 </div>
                               </div>
                             )}
                           </div>

                           <div className="mt-4 pt-3 border-t border-white/5 shrink-0">
                              <button 
                                onClick={() => setShowFilter(false)}
                                className="w-full bg-white hover:bg-gold text-black py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 cursor-pointer"
                              >
                                החל סננים
                              </button>
                           </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-x-4 gap-y-10 md:gap-x-8 md:gap-y-16">
            {filteredProducts.map(product => <ProductCard key={`prod-main-${product.id}`} product={product} onClick={() => onProductClick(product)} />)}
          </div>
          
          {filteredProducts.length === 0 && (
            <div className="py-32 text-center">
              <Search className="mx-auto mb-6 text-zinc-700" size={48} />
              <p className="text-zinc-500 uppercase font-black tracking-widest">לא נמצאו פריטים תואמים</p>
              <button 
                onClick={() => { setSearchTerm(''); onCategorySelect('all'); setSelectedTags([]); setSelectedSizes([]); }}
                className="mt-6 text-gold underline font-bold uppercase tracking-widest text-[10px]"
              >
                נקה חיפוש וסננים
              </button>
            </div>
          )}
        </section>
      </main>

      <Footer content={content} />
    </div>
  );
}

function Footer({ content }: { content: SiteContent }) {
  return (
    <footer className="bg-zinc-900 border-t border-tennis-yellow/20 py-12 px-6 md:px-24 text-white">
      <div className="flex flex-col md:flex-row justify-between items-center gap-12">
        <div className="text-center md:text-right">
           {content.logo && (
             <img src={content.logo} alt="Logo" className="h-16 w-auto mb-4 mx-auto md:mx-0 object-contain" referrerPolicy="no-referrer" />
           )}
           <h2 className="text-3xl font-serif font-bold text-tennis-yellow mb-2">RUBI'S</h2>
           <p className="text-zinc-500 italic max-w-sm">מצוינות שירותית ומוצרים באיכות ללא פשרות בעולם הטניס.</p>
           <div className="mt-4 text-[10px] text-zinc-600 uppercase tracking-widest space-y-1">
             <p>{content.contact.address}</p>
             {content.contact.phone && <p>טלפון: {content.contact.phone}</p>}
           </div>
        </div>
        <div className="flex gap-6">
           <a 
            href={`https://wa.me/${content.contact.whatsapp}`} 
            className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-tennis-yellow hover:border-tennis-yellow hover:text-black transition-all"
           >
              <MessageCircle size={24} />
           </a>
           <a 
            href={content.contact.facebook} 
            className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-tennis-yellow hover:border-tennis-yellow hover:text-black transition-all"
           >
              <Facebook size={24} />
           </a>
        </div>
      </div>
      <div className="border-t border-zinc-800 mt-12 pt-8 text-center text-zinc-600 text-sm">
         © 2026 {(content.siteName || '').toUpperCase()} STORE. כל הזכויות שמורות.
      </div>
    </footer>
  );
}

// --- Admin Product Card ---
function AdminProductCard({ 
  product, 
  onSaveProduct, 
  onDeleteProduct, 
  categories
}: { 
  product: Product, 
  onSaveProduct: (p: Product) => Promise<void>, 
  onDeleteProduct: (id: string) => void,
  categories: any[],
  key?: any
}) {
  const [localProduct, setLocalProduct] = useState<Product>(product);
  const [tagInput, setTagInput] = useState('');
  const [sizeInput, setSizeInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLocallyDeleted, setIsLocallyDeleted] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  // Sync with prop when server data changes AND we don't have local changes
  useEffect(() => {
    const isLocalDirty = JSON.stringify(localProduct) !== JSON.stringify(product);
    if (!isLocalDirty) {
      setLocalProduct(product);
    }
  }, [product, localProduct]);

  // Deep comparison to show save button only if changed
  const hasChanges = useMemo(() => {
    // Basic fields comparison
    if (localProduct.name !== product.name) return true;
    if (localProduct.price !== product.price) return true;
    if (localProduct.description !== product.description) return true;
    if (localProduct.categoryId !== product.categoryId) return true;
    if (localProduct.image !== product.image) return true;
    if (localProduct.inStock !== product.inStock) return true;
    
    // Arrays comparison
    const tagsChanged = JSON.stringify([...(localProduct.tags || [])].sort()) !== JSON.stringify([...(product.tags || [])].sort());
    if (tagsChanged) return true;
    
    const sizesChanged = JSON.stringify([...(localProduct.sizes || [])].sort()) !== JSON.stringify([...(product.sizes || [])].sort());
    if (sizesChanged) return true;
    
    const imagesChanged = JSON.stringify([...(localProduct.images || [])]) !== JSON.stringify([...(product.images || [])]);
    if (imagesChanged) return true;

    return false;
  }, [localProduct, product]);

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      await onSaveProduct(localProduct);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      // Error handled by onSaveProduct alert
    } finally {
      setIsUpdating(false);
    }
  };

  const images = localProduct.images || (localProduct.image ? [localProduct.image] : []);

  if (isLocallyDeleted) return null;

  return (
    <div className={`bg-luxury-dark-gray p-8 rounded border ${hasChanges ? 'border-gold/50 shadow-[0_0_15px_rgba(212,175,55,0.1)]' : 'border-white/5'} flex flex-col gap-8 hover:border-gold/30 transition-all relative`}>
      {hasChanges && (
        <div className="absolute -top-px -left-px -right-px h-1 bg-gold rounded-t z-10"></div>
      )}
      
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-2/5 space-y-6">
           <div className="space-y-4">
              <label className="text-[10px] uppercase font-bold tracking-widest text-gold italic">גלריית תמונות ({images.length})</label>
              <div className="grid grid-cols-2 gap-2">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group/img aspect-square border border-white/10 rounded overflow-hidden">
                     {img ? (
                       <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                     ) : (
                       <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-700">
                         <ImageIcon size={20} />
                       </div>
                     )}
                     <button 
                      onClick={() => {
                        const newImages = images.filter((_, i) => i !== idx);
                        setLocalProduct({ ...localProduct, images: newImages, image: newImages[0] || '' });
                      }}
                      className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"
                     >
                       <X size={12} />
                     </button>
                  </div>
                ))}
                <div 
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = async () => {
                          const base64 = reader.result as string;
                          const compressed = await compressImage(base64);
                          const newImages = [...images, compressed];
                          setLocalProduct({ ...localProduct, images: newImages, image: newImages[0] || '' });
                        };
                        reader.readAsDataURL(file);
                      }
                    };
                    input.click();
                  }}
                  className="aspect-square border-2 border-dashed border-white/10 rounded flex flex-col items-center justify-center gap-1 hover:border-gold cursor-pointer bg-black/20 text-zinc-500 hover:text-gold transition-all"
                >
                  <Plus size={16} />
                  <span className="text-[8px] uppercase font-bold">הוסף</span>
                </div>
              </div>
           </div>
        </div>
        <div className="flex-grow space-y-4">
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-1 flex-grow">
              <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת המוצר (שם)</label>
              <input 
                value={localProduct.name}
                onChange={e => setLocalProduct({ ...localProduct, name: e.target.value })}
                className="sleek-input font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">מלאי</label>
              <button 
                onClick={() => setLocalProduct({ ...localProduct, inStock: localProduct.inStock === false ? true : false })}
                className={`flex items-center gap-2 p-2 px-4 rounded border transition-all ${localProduct.inStock === false ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-green-500/10 border-green-500/30 text-green-500'}`}
              >
                {localProduct.inStock === false ? <XCircle size={14} /> : <CheckCircle size={14} />}
                <span className="text-[10px] font-black uppercase tracking-tighter">
                  {localProduct.inStock === false ? 'אזל מהמלאי' : 'קיים במלאי'}
                </span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">מחיר</label>
              <input 
                value={localProduct.price}
                onChange={e => setLocalProduct({ ...localProduct, price: e.target.value })}
                onBlur={e => {
                  let val = e.target.value.trim();
                  if (val && !val.includes('₪')) {
                    setLocalProduct({ ...localProduct, price: `₪${val}` });
                  }
                }}
                className="w-full bg-black border border-white/10 p-2 text-gold font-bold focus:border-gold outline-none rounded"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">קטגוריה ראשית</label>
              <select 
                value={localProduct.categoryId}
                onChange={e => setLocalProduct({ ...localProduct, categoryId: e.target.value })}
                className="w-full bg-black border border-white/10 p-2 focus:border-gold outline-none rounded appearance-none"
              >
                <option value="">בחר קטגוריה</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Tag Management */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <label className="text-[10px] uppercase font-bold tracking-widest text-gold italic">תגיות (סינון ללקוח)</label>
            <div className="flex gap-2">
              <input 
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    e.preventDefault();
                    const currentTags = localProduct.tags || [];
                    const newTag = tagInput.trim();
                    if (!currentTags.includes(newTag)) {
                      setLocalProduct({ ...localProduct, tags: [...currentTags, newTag] });
                    }
                    setTagInput('');
                  }
                }}
                className="flex-grow bg-black border border-white/10 p-2 text-xs rounded focus:border-gold outline-none"
                placeholder="הזן תגית ולחץ Enter"
              />
              <button 
                type="button"
                onClick={() => {
                  if (tagInput.trim()) {
                    const currentTags = localProduct.tags || [];
                    const newTag = tagInput.trim();
                    if (!currentTags.includes(newTag)) {
                      setLocalProduct({ ...localProduct, tags: [...currentTags, newTag] });
                    }
                    setTagInput('');
                  }
                }}
                className="p-2 text-gold hover:bg-gold/10 rounded border border-gold/20"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(localProduct.tags || []).map((tag, idx) => (
                <div key={idx} className="bg-zinc-800 border border-white/10 px-3 py-1 rounded-full flex items-center gap-2">
                  <span className="text-[9px] font-bold text-white uppercase">{tag}</span>
                  <button 
                    onClick={() => setLocalProduct({ ...localProduct, tags: (localProduct.tags || []).filter((_, i) => i !== idx) })}
                    className="text-white/40 hover:text-red-500 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Size Management */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <label className="text-[10px] uppercase font-bold tracking-widest text-gold italic">מידות במלאי (אופציונלי)</label>
            <div className="flex gap-2">
              <input 
                value={sizeInput}
                onChange={(e) => setSizeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && sizeInput.trim()) {
                    e.preventDefault();
                    const currentSizes = localProduct.sizes || [];
                    const newSize = sizeInput.trim();
                    if (!currentSizes.includes(newSize)) {
                      setLocalProduct({ ...localProduct, sizes: [...currentSizes, newSize] });
                    }
                    setSizeInput('');
                  }
                }}
                className="flex-grow bg-black border border-white/10 p-2 text-xs rounded focus:border-gold outline-none"
                placeholder="הזן מידה (למשל: 42) ולחץ Enter"
              />
              <button 
                type="button"
                onClick={() => {
                  if (sizeInput.trim()) {
                    const currentSizes = localProduct.sizes || [];
                    const newSize = sizeInput.trim();
                    if (!currentSizes.includes(newSize)) {
                      setLocalProduct({ ...localProduct, sizes: [...currentSizes, newSize] });
                    }
                    setSizeInput('');
                  }
                }}
                className="p-2 text-gold hover:bg-gold/10 rounded border border-gold/20"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(localProduct.sizes || []).map((size, idx) => (
                <div key={idx} className="bg-gold/10 border border-gold/30 px-3 py-1 rounded flex items-center gap-2">
                  <span className="text-[9px] font-bold text-gold uppercase">{size}</span>
                  <button 
                    onClick={() => setLocalProduct({ ...localProduct, sizes: (localProduct.sizes || []).filter((_, i) => i !== idx) })}
                    className="text-gold/40 hover:text-red-500 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">תת-כותרת (תיאור)</label>
            <textarea 
              value={localProduct.description}
              rows={3}
              className="sleek-input text-sm text-zinc-300"
              onChange={e => setLocalProduct({ ...localProduct, description: e.target.value })}
            />
          </div>

          {/* Supplier & Stock Sync Detail Note */}
          {(localProduct.supplierSite || localProduct.stockStatusDetail || localProduct.lastStockCheck) && (
            <div className="bg-black/40 border border-white/5 rounded-lg p-3 text-[10px] space-y-1">
              <div className="flex justify-between items-center text-zinc-400">
                <span className="font-bold text-gold">מידע סנכרון מאתר הספק:</span>
                {localProduct.lastStockCheck && (
                  <span className="font-mono text-zinc-500">
                    נבדק: {new Date(localProduct.lastStockCheck).toLocaleDateString('he-IL')} {new Date(localProduct.lastStockCheck).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {localProduct.stockStatusDetail && (
                <p className="text-zinc-300">{localProduct.stockStatusDetail}</p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between items-center pt-6 gap-4 border-t border-white/5">
            {showConfirmDelete ? (
              <div className="flex items-center gap-2 w-full sm:w-auto bg-red-500/10 p-2 px-4 rounded border border-red-500/20">
                <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest whitespace-nowrap">בטוח?</span>
                <button 
                  onClick={() => {
                    setIsLocallyDeleted(true);
                    onDeleteProduct(product.id);
                  }}
                  className="bg-red-500 text-white p-1 px-3 rounded text-[10px] font-bold uppercase transition-colors hover:bg-red-600"
                >
                  כן, מחק
                </button>
                <button 
                  onClick={() => setShowConfirmDelete(false)}
                  className="bg-zinc-800 text-white p-1 px-3 rounded text-[10px] font-bold uppercase transition-colors hover:bg-zinc-700"
                >
                  ביטול
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowConfirmDelete(true)}
                className="w-full sm:w-auto text-red-500 flex items-center justify-center gap-2 hover:bg-red-500/10 p-2 px-4 rounded transition-colors text-[10px] uppercase font-bold tracking-widest border border-red-500/20 animate-in fade-in duration-200"
              >
                <Trash2 size={14} /> מחק מוצר
              </button>
            )}
            
            <div className="flex items-center gap-3 w-full sm:w-auto">
               <button 
                onClick={() => setLocalProduct(product)}
                disabled={!hasChanges || isUpdating}
                className="flex-grow sm:flex-initial text-zinc-400 hover:text-white disabled:opacity-30 p-2 px-4 text-[10px] uppercase font-bold tracking-widest transition-colors"
               >
                 ביטול שינויים
               </button>
               <button 
                onClick={handleSave}
                disabled={!hasChanges || isUpdating}
                className={`flex-grow sm:flex-initial flex items-center justify-center gap-2 p-2 px-8 rounded text-[10px] uppercase font-bold tracking-widest transition-all ${saveSuccess ? 'bg-green-600 text-white' : hasChanges ? 'bg-gold text-black shadow-lg shadow-gold/20' : 'bg-white/5 text-zinc-500 cursor-not-allowed'}`}
               >
                 {isUpdating ? 'שומר...' : saveSuccess ? <><Check size={14} /> נשמר!</> : <><Save size={14} /> שמור שינויים</>}
               </button>
            </div>
          </div>
          <div className="text-center sm:text-right">
            <span className="text-[8px] text-zinc-600 uppercase tracking-widest">Product ID: {product.id.slice(-6)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Admin Panel ---
function AdminPanel({ 
    content, 
    products,
    setContent, 
    onSaveProduct,
    onDeleteProduct,
    onLogout, 
    onReturn,
    leads,
    onDeleteLead
  }: { 
    content: SiteContent, 
    products: Product[],
    setContent: (c: SiteContent) => Promise<boolean>, 
    onSaveProduct: (p: Product) => Promise<void>,
    onDeleteProduct: (id: string) => void,
    onLogout: () => void,
    onReturn: () => void,
    leads: Lead[],
    onDeleteLead: (id: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'content' | 'categories' | 'products' | 'inventory' | 'leads'>('products');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<Category[]>(content.categories);
  const [tempContent, setTempContent] = useState<SiteContent>(content);
  
  // Custom Modals State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySubtitle, setNewCategorySubtitle] = useState('');
  const [newCategoryImage, setNewCategoryImage] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [showAiImporter, setShowAiImporter] = useState(false);

  // Sync local states when database updates externally
  useEffect(() => {
    setLocalCategories(content.categories);
    setTempContent(content);
  }, [content]);

  const isOrderDirty = JSON.stringify(localCategories) !== JSON.stringify(content.categories);
  const isContentDirty = JSON.stringify(tempContent) !== JSON.stringify(content);

  const filteredProducts = useMemo(() => {
    let prods = products;
    if (selectedCategoryId) {
      prods = prods.filter(p => p.categoryId === selectedCategoryId);
    }
    
    if (productSearchTerm.trim()) {
      const q = productSearchTerm.toLowerCase();
      prods = prods.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }
    
    return prods;
  }, [selectedCategoryId, products, productSearchTerm]);

  const selectedCategoryName = useMemo(() => {
    return content.categories.find(c => c.id === selectedCategoryId)?.name;
  }, [selectedCategoryId, content.categories]);

  return (
    <div className="flex h-screen bg-luxury-black text-white overflow-hidden w-full">
      {/* Sidebar */}
      <aside className="w-64 bg-luxury-dark-gray border-l border-white/5 flex flex-col p-6">
        <div className="mb-6 space-y-2">
          <button 
            onClick={() => onReturn()}
            className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 text-luxury-white border border-white/10 rounded hover:bg-white/10 transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <ArrowLeft size={16} />
            <span>חזרה לחנות</span>
          </button>
          
          <button 
            onClick={() => {
              if (confirm('בטוח שברצונך להתנתק?')) onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded hover:bg-red-500/20 transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <LogOut size={16} />
            <span>התנתק מהמערכת</span>
          </button>
        </div>
        <div className="mb-10 text-center">
          {content.logo && (
            <img src={content.logo} alt="Logo" className="h-10 w-auto mx-auto mb-4 object-contain" referrerPolicy="no-referrer" />
          )}
          <h2 className="text-xl font-black text-gold uppercase tracking-tighter italic">{content.siteName || "RUBI'S TENNIS STORE"}</h2>
          <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold mt-1">הגדרות אתר</p>
        </div>
        <nav className="flex-grow space-y-2">
          <button 
            onClick={() => setActiveTab('content')}
            className={`w-full text-right p-4 rounded flex items-center justify-between group transition-all border border-transparent ${activeTab === 'content' ? 'border-gold text-gold bg-gold/5' : 'hover:bg-white/5'}`}
          >
            <span>תוכן כללי</span>
            <Edit2 size={16} />
          </button>
          <button 
            onClick={() => setActiveTab('categories')}
            className={`w-full text-right p-4 rounded flex items-center justify-between group transition-all border border-transparent ${activeTab === 'categories' ? 'border-gold text-gold bg-gold/5' : 'hover:bg-white/5'}`}
          >
            <span>קטגוריות</span>
            <Menu size={16} />
          </button>
          <button 
            onClick={() => setActiveTab('products')}
            className={`w-full text-right p-4 rounded flex items-center justify-between group transition-all border border-transparent ${activeTab === 'products' ? 'border-gold text-gold bg-gold/5' : 'hover:bg-white/5'}`}
          >
            <span>מוצרים</span>
            <ImageIcon size={16} />
          </button>
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`w-full text-right p-4 rounded flex items-center justify-between group transition-all border border-transparent ${activeTab === 'inventory' ? 'border-gold text-gold bg-gold/5' : 'hover:bg-white/5'}`}
          >
            <div className="flex items-center gap-2">
              <span>סנכרון מלאי ספקים</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <Globe size={16} />
          </button>
          <button 
            onClick={() => setActiveTab('leads')}
            className={`w-full text-right p-4 rounded flex items-center justify-between group transition-all border border-transparent ${activeTab === 'leads' ? 'border-gold text-gold bg-gold/5' : 'hover:bg-white/5'}`}
          >
            <span>לידים ({leads.length})</span>
            <Mail size={16} />
          </button>
        </nav>
        <button 
          onClick={() => {
            if (confirm('בטוח שברצונך להתנתק?')) onLogout();
          }}
          className="mt-auto p-4 flex items-center justify-between text-zinc-500 hover:text-red-500 transition-colors uppercase text-[10px] font-bold tracking-widest border-t border-white/5 pt-6"
        >
          <span>התנתקות מלאה</span>
          <LogOut size={16} />
        </button>
      </aside>

      {/* Content Area */}
      <main className="flex-grow overflow-y-auto p-8 md:p-12 custom-scrollbar" dir="rtl">
        <header className="flex justify-between items-center mb-12 border-b border-white/10 pb-6">
           <h3 className="text-3xl font-black uppercase tracking-tighter italic">
            {activeTab === 'content' && 'עריכת תוכן כללי'}
            {activeTab === 'categories' && 'ניהול קטגוריות'}
            {activeTab === 'products' && 'ניהול מוצרים'}
            {activeTab === 'inventory' && 'סנכרון מלאי יומי מאתרי היבואנים'}
            {activeTab === 'leads' && 'לידים שהתקבלו'}
           </h3>
           <div className="flex items-center gap-4 text-xs text-text-muted">
             <span>{(content.siteName || '').toUpperCase()} STORE</span>
           </div>
        </header>

        {activeTab === 'content' && (
          <div className="max-w-3xl space-y-10 relative pb-20">
            <AnimatePresence>
               {isContentDirty && (
                 <motion.div 
                  key="unsaved-changes-banner"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="sticky top-4 z-10 bg-gold text-black p-4 rounded-xl shadow-2xl flex items-center justify-between gap-6 border border-gold/50 backdrop-blur-md"
                 >
                    <div className="flex items-center gap-3">
                      <div className="bg-black/10 p-2 rounded-full animate-pulse">
                        <AlertCircle size={20} />
                      </div>
                      <div>
                        <p className="font-black text-[10px] uppercase tracking-widest">שינויים שטרם נשמרו</p>
                        <p className="text-xs font-bold">ערכת את תוכן האתר, אל תשכח לשמור את השינויים.</p>
                      </div>
                    </div>
                    <button 
                      onClick={async () => {
                        setIsSaving(true);
                        const success = await setContent(tempContent);
                        setIsSaving(false);
                        if (success) {
                          alert('תוכן האתר והגדרות המיתוג נשמרו בהצלחה!');
                        }
                      }}
                      className="bg-black text-gold px-8 h-12 rounded-lg font-black uppercase tracking-widest text-[10px] hover:bg-black/80 transition-all flex items-center gap-2 whitespace-nowrap shadow-xl"
                    >
                      <Save size={16} />
                      {isSaving ? 'שומר שינויים...' : 'שמור הכל עכשיו'}
                    </button>
                 </motion.div>
               )}
            </AnimatePresence>

            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Settings size={14} /> הגדרות מיתוג
              </h4>
              <div className="grid gap-6">
                <FilePicker 
                  label="העלאת לוגו חדש (תמונה)"
                  value={tempContent.logo}
                  onChange={(val) => setTempContent({...tempContent, logo: val})}
                />
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">או הזן כתובת URL ללוגו</label>
                  <input 
                    value={tempContent.logo}
                    onChange={e => setTempContent({...tempContent, logo: e.target.value})}
                    className="sleek-input"
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="space-y-2 mt-4">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">שם האתר (ליד הלוגו)</label>
                  <input 
                    value={tempContent.siteName}
                    onChange={e => setTempContent({...tempContent, siteName: e.target.value})}
                    className="sleek-input"
                    placeholder="הזן את שם המותג..."
                  />
                </div>
              </div>
            </section>

            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Mail size={14} /> פרטי התקשרות
              </h4>
              <div className="grid gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כתובת העסק</label>
                  <input 
                    value={tempContent.contact?.address || ""}
                    onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, address: e.target.value}})}
                    className="sleek-input"
                    placeholder="הזן כתובת מלאה..."
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">מספר WhatsApp (ללא מקפים)</label>
                    <input 
                      value={tempContent.contact?.whatsapp || ""}
                      onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, whatsapp: e.target.value}})}
                      className="sleek-input text-green-500 font-bold"
                      placeholder="972501234567"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">טלפון להצגה (אופציונלי)</label>
                    <input 
                      value={tempContent.contact?.phone || ""}
                      onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, phone: e.target.value}})}
                      className="sleek-input"
                      placeholder="050-0000000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כתובת אימייל</label>
                    <input 
                      value={tempContent.contact?.email || ""}
                      onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, email: e.target.value}})}
                      className="sleek-input"
                      placeholder="contact@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">קישור לפייסבוק</label>
                    <input 
                      value={tempContent.contact?.facebook || ""}
                      onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, facebook: e.target.value}})}
                      className="sleek-input text-blue-500"
                      placeholder="https://facebook.com/your-page"
                    />
                  </div>
                </div>
              </div>
            </section>


            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Settings size={14} /> עריכת הירו (Hero)
              </h4>
              <div className="grid gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת ראשית</label>
                  <input 
                    value={tempContent.hero.title}
                    onChange={e => setTempContent({...tempContent, hero: {...tempContent.hero, title: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">תת כותרת</label>
                  <textarea 
                    value={tempContent.hero.subtitle}
                    onChange={e => setTempContent({...tempContent, hero: {...tempContent.hero, subtitle: e.target.value}})}
                    className="sleek-input"
                    rows={3}
                  />
                </div>
              </div>
            </section>

            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Settings size={14} /> כותרות ותוויות (Labels)
              </h4>
              <div className="grid gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת "בית" בתפריט הצדי</label>
                  <input 
                    value={tempContent.labels?.home || ""}
                    onChange={e => setTempContent({...tempContent, labels: {...tempContent.labels, home: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת "קולקציה" בתפריט הצדי</label>
                  <input 
                    value={tempContent.labels?.collection || ""}
                    onChange={e => setTempContent({...tempContent, labels: {...tempContent.labels, collection: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת "צור קשר" בתפריט הצדי</label>
                  <input 
                    value={tempContent.labels?.contact || ""}
                    onChange={e => setTempContent({...tempContent, labels: {...tempContent.labels, contact: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת מדור הקטגוריות</label>
                  <input 
                    value={tempContent.labels?.categoriesTitle || ""}
                    onChange={e => setTempContent({...tempContent, labels: {...tempContent.labels, categoriesTitle: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
              </div>
            </section>

            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Edit2 size={14} /> עריכת "אודותינו"
              </h4>
              <div className="grid gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כותרת סעיף אודות</label>
                  <input 
                    value={tempContent.about?.title || ""}
                    onChange={e => setTempContent({...tempContent, about: {...tempContent.about, title: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">תוכן "אודותינו"</label>
                  <textarea 
                    value={tempContent.about?.content || ""}
                    onChange={e => setTempContent({...tempContent, about: {...tempContent.about, content: e.target.value}})}
                    className="sleek-input"
                    rows={6}
                  />
                </div>
                <FilePicker 
                  label="תמונה לסעיף אודות"
                  value={tempContent.about?.image || ""}
                  onChange={(val) => setTempContent({...tempContent, about: {...tempContent.about, image: val}})}
                />
              </div>
            </section>

            <section className="bg-luxury-dark-gray p-8 rounded border border-white/5">
              <h4 className="text-gold font-bold mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                <Phone size={14} /> פרטי קשר
              </h4>
              <div className="grid gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">מספר וואטסאפ (ללא +)</label>
                  <input 
                    value={tempContent.contact.whatsapp}
                    onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, whatsapp: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">קישור פייסבוק</label>
                  <input 
                    value={tempContent.contact.facebook}
                    onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, facebook: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">אימייל</label>
                  <input 
                    value={tempContent.contact.email}
                    onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, email: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">כתובת</label>
                  <input 
                    value={tempContent.contact.address}
                    onChange={e => setTempContent({...tempContent, contact: {...tempContent.contact, address: e.target.value}})}
                    className="sleek-input"
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-luxury-dark-gray p-4 rounded border border-white/5">
              <button 
                onClick={() => {
                  setNewCategoryName('');
                  setNewCategorySubtitle('');
                  setNewCategoryImage('');
                  setIsAddingCategory(true);
                }}
                className="bg-gold text-black px-6 py-3 rounded font-bold flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-gold/90 transition-all shadow-xl shadow-gold/10"
              >
                <Plus size={14} /> הוסף קטגוריה
              </button>

              <AnimatePresence>
                {isOrderDirty && (
                  <motion.button
                    key="save-category-order-btn"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    onClick={async () => {
                      setIsSaving(true);
                      const success = await setContent({ ...content, categories: localCategories });
                      setIsSaving(false);
                      if (success) {
                        alert('סדר הקטגוריות החדש נשמר בהצלחה!');
                      }
                    }}
                    className="bg-white text-black px-6 py-3 rounded font-bold flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-white/90 transition-all border border-white"
                  >
                    <Save size={14} /> {isSaving ? 'מעדכן סדר...' : 'שמור סדר חדש'}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-4 max-w-xl">
              <Reorder.Group 
                axis="y" 
                values={localCategories} 
                onReorder={setLocalCategories}
                className="space-y-4"
              >
                {localCategories.map(cat => (
                  <Reorder.Item 
                    key={cat.id} 
                    value={cat}
                    className="bg-luxury-dark-gray p-6 rounded flex justify-between items-center border border-white/5 transition-colors hover:border-gold/30 cursor-default select-none group"
                  >
                    <div className="flex items-center gap-4 flex-grow">
                      <div className="cursor-grab active:cursor-grabbing text-white/20 group-hover:text-gold/50 transition-colors">
                        <GripVertical size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-lg font-bold uppercase tracking-wide">{cat.name}</span>
                        {cat.subtitle && <span className="text-[10px] text-text-muted uppercase tracking-widest">{cat.subtitle}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setSelectedCategoryId(cat.id);
                          setActiveTab('products');
                        }}
                        className="p-3 bg-gold text-black rounded border border-gold hover:bg-gold/90 transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                        title="ניהול מוצרים בקטגוריה"
                      >
                        <ChevronRight size={16} />
                        <span className="hidden sm:inline">ניהול מוצרים</span>
                      </button>
                      <button 
                        onClick={() => {
                          setEditCategory(cat);
                          setNewCategoryName(cat.name);
                          setNewCategorySubtitle(cat.subtitle || '');
                          setNewCategoryImage(cat.image || '');
                        }}
                        className="p-3 bg-white/5 text-gold rounded border border-white/10 hover:border-gold transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => setDeleteConfirmId(cat.id)}
                        className="p-3 bg-white/5 text-red-500 rounded border border-white/10 hover:border-red-500/50 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </div>

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
              {deleteConfirmId && (
                <motion.div 
                  key="delete-confirm-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
                >
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-luxury-dark-gray border border-white/10 p-8 rounded-lg max-w-sm w-full text-center space-y-6 shadow-2xl my-auto max-h-[90vh] overflow-y-auto custom-scrollbar"
                  >
                    <h3 className="text-xl font-bold uppercase tracking-tighter italic">בחרת למחוק קטגוריה זו , האם אתה בטוח?</h3>
                    <p className="text-xs text-text-muted uppercase tracking-widest font-bold">שימו לב: המוצרים המשויכים לקטגוריה זו יישארו ללא קטגוריה.</p>
                    <div className="flex gap-4">
                      <button 
                        onClick={async () => {
                          const success = await setContent({
                            ...content,
                            categories: content.categories.filter(c => c.id !== deleteConfirmId)
                          });
                          if (success) {
                            alert('הקטגוריה נמחקה בהצלחה!');
                          }
                          setDeleteConfirmId(null);
                        }}
                        className="flex-grow bg-red-500 text-white py-3 rounded font-bold uppercase tracking-widest text-xs hover:bg-red-600 transition-colors"
                      >
                        כן
                      </button>
                      <button 
                        onClick={() => setDeleteConfirmId(null)}
                        className="flex-grow bg-white/10 text-white py-3 rounded font-bold uppercase tracking-widest text-xs hover:bg-white/20 transition-colors"
                      >
                        לא
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Edit/Add Category Modal */}
            <AnimatePresence>
              {(editCategory || isAddingCategory) && (
                <motion.div 
                  key="edit-category-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
                >
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-luxury-dark-gray border border-white/10 p-8 rounded-lg max-w-md w-full space-y-6 shadow-2xl my-auto max-h-[90vh] overflow-y-auto custom-scrollbar"
                  >
                    <h3 className="text-2xl font-black uppercase tracking-tighter italic text-center">
                      {isAddingCategory ? 'הוספת קטגוריה חדשה' : 'עריכת קטגוריה'}
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
                         <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">שם הקטגוריה</label>
                         <input 
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          className="sleek-input font-bold"
                          autoFocus
                         />
                      </div>

                      <div className="space-y-2">
                         <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">תת כותרת (לדוגמא: "החל מ-")</label>
                         <input 
                          value={newCategorySubtitle}
                          onChange={(e) => setNewCategorySubtitle(e.target.value)}
                          className="sleek-input text-sm"
                          placeholder="לדוגמא: החל מ-199 ₪"
                         />
                      </div>

                      <FilePicker 
                        label="תמונת רקע לקטגוריה"
                        value={newCategoryImage}
                        onChange={(val) => setNewCategoryImage(val)}
                      />

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-text-muted">או הזן כתובת URL לתמונה</label>
                        <input 
                          value={newCategoryImage}
                          onChange={(e) => setNewCategoryImage(e.target.value)}
                          className="sleek-input text-[10px]"
                          placeholder="https://example.com/image.jpg"
                        />
                      </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                      <button 
                        disabled={isSaving}
                        onClick={async () => {
                          if (!newCategoryName.trim() || isSaving) return;
                          setIsSaving(true);
                          try {
                            let success = false;
                            if (isAddingCategory) {
                              success = await setContent({
                                ...content,
                                categories: [...content.categories, { 
                                  id: Math.random().toString(36).substr(2, 9), 
                                  name: newCategoryName,
                                  subtitle: newCategorySubtitle,
                                  image: newCategoryImage
                                }]
                              });
                              if (success) {
                                alert('הקטגוריה נוספה בהצלחה!');
                              }
                            } else if (editCategory) {
                              success = await setContent({
                                ...content,
                                categories: content.categories.map(c => c.id === editCategory.id ? { 
                                  ...c, 
                                  name: newCategoryName,
                                  subtitle: newCategorySubtitle,
                                  image: newCategoryImage
                                } : c)
                              });
                              if (success) {
                                alert('הקטגוריה עודכנה בהצלחה!');
                              }
                            }
                            if (success) {
                              setEditCategory(null);
                              setIsAddingCategory(false);
                              setNewCategorySubtitle('');
                              setNewCategoryImage('');
                            }
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        className="flex-grow bg-gold text-black py-3 rounded font-bold uppercase tracking-widest text-xs hover:bg-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSaving ? 'שומר...' : 'שמור שינויים'}
                      </button>
                      <button 
                        disabled={isSaving}
                        onClick={() => {
                          setEditCategory(null);
                          setIsAddingCategory(false);
                          setNewCategorySubtitle('');
                          setNewCategoryImage('');
                        }}
                        className="flex-grow bg-white/10 text-white py-3 rounded font-bold uppercase tracking-widest text-xs hover:bg-white/20 transition-colors disabled:opacity-50"
                      >
                        ביטול
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="space-y-10">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full">
                  <div className="flex items-center gap-4">
                    {selectedCategoryId && (
                      <button 
                        onClick={() => setSelectedCategoryId(null)}
                        className="p-2 bg-white/5 text-gold rounded border border-white/10 hover:border-gold transition-colors"
                        title="חזרה לכל הקטגוריות"
                      >
                        <ChevronLeft size={20} />
                      </button>
                    )}
                    <h4 className="text-xl font-bold uppercase tracking-widest whitespace-nowrap">
                      {selectedCategoryId ? `מוצרים בקטגוריית: ${selectedCategoryName}` : 'כל המוצרים'}
                    </h4>
                  </div>
                  
                  {/* Search Bar in Admin */}
                  <div className="relative flex-grow max-w-md w-full group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-gold transition-colors">
                      <Search size={14} />
                    </div>
                    <input 
                      type="text"
                      placeholder="חיפוש לפי שם, תיאור או ID..."
                      value={productSearchTerm}
                      onChange={(e) => setProductSearchTerm(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded py-2 pr-4 pl-10 text-xs focus:outline-none focus:border-gold/50 transition-all placeholder:text-zinc-600"
                    />
                    {productSearchTerm && (
                      <button 
                        onClick={() => setProductSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 shrink-0 w-full lg:w-auto">
                  <button 
                    onClick={() => setActiveTab('inventory')}
                    className="flex-grow lg:flex-initial flex items-center justify-center gap-2 px-5 py-3 rounded font-bold text-xs uppercase tracking-widest bg-zinc-900 border border-emerald-500/30 text-emerald-400 hover:border-emerald-500 hover:bg-emerald-500/10 transition-all shadow-lg active:scale-95 cursor-pointer"
                    title="פתח את מרכז סנכרון המלאי היומי"
                  >
                    <Globe size={14} />
                    <span>סנכרון מלאי ספקים</span>
                  </button>
                  <button 
                    onClick={() => setShowAiImporter(!showAiImporter)}
                    className={`flex-grow lg:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded font-bold text-xs uppercase tracking-widest transition-all border ${showAiImporter ? 'bg-gold/10 border-gold text-gold shadow-[0_0_15px_rgba(212,175,55,0.15)]' : 'bg-zinc-900 border-gold/20 text-gold hover:border-gold hover:bg-gold/5'} shadow-lg active:scale-95 cursor-pointer`}
                  >
                    <Sparkles size={14} /> 
                    <span>ייבוא מהיר בעזרת AI</span>
                  </button>
                  <button 
                    onClick={() => {
                      const targetCategoryId = selectedCategoryId || content.categories[content.categories.length - 1]?.id || '';
                      const targetCategoryName = content.categories.find(c => c.id === targetCategoryId)?.name || '';
                      
                      const newProduct: Product = {
                        id: Math.random().toString(36).substr(2, 9),
                        name: 'מוצר חדש',
                        price: '₪0',
                        image: '',
                        images: [],
                        description: 'אנא הזן תיאור למוצר...',
                        categoryId: targetCategoryId,
                        inStock: true
                      };
                      
                      setProductSearchTerm('');
                      onSaveProduct(newProduct);
                      alert(`מוצר חדש נוסף בהצלחה לקטגוריה: ${targetCategoryName}`);
                    }}
                    className="flex-grow lg:flex-initial bg-gold text-black px-6 py-3 rounded font-bold flex items-center justify-center gap-2 text-xs uppercase tracking-widest hover:bg-gold/90 transition-all shadow-lg active:scale-95 whitespace-nowrap cursor-pointer"
                  >
                    <Plus size={14} /> הוסף מוצר חדש
                  </button>
                </div>
              </div>

              {showAiImporter && (
                <AiProductImporter 
                  categories={content.categories}
                  onClose={() => setShowAiImporter(false)}
                  onAddProduct={async (p) => {
                    await onSaveProduct(p);
                  }}
                />
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {filteredProducts.map(product => (
                  <AdminProductCard 
                    key={`admin-prod-${product.id}`}
                    product={product}
                    onSaveProduct={onSaveProduct}
                    onDeleteProduct={onDeleteProduct}
                    categories={content.categories}
                  />
                ))}
              </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <InventorySyncManager 
            products={products}
            onUpdateProduct={onSaveProduct}
          />
        )}

        {activeTab === 'leads' && (
          <div className="grid gap-6">
            {leads.length === 0 ? (
              <p className="text-text-muted">אין לידים עדיין.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {leads.map((lead, i) => (
                  <div key={`lead-${lead.id}-${i}`} className="bg-luxury-dark-gray p-8 rounded border border-white/5 hover:border-gold/30 transition-colors">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h4 className="text-xl font-bold uppercase tracking-tight italic">{lead.name}</h4>
                        <p className="text-gold text-xs font-bold tracking-widest">{lead.email}</p>
                      </div>
                      <div className="text-left">
                        <p className="text-[10px] text-text-muted uppercase tracking-widest mb-2">{lead.timestamp}</p>
                        <button 
                          onClick={() => onDeleteLead(lead.id)}
                          className="text-red-500 hover:text-red-400 text-[10px] font-bold uppercase tracking-widest"
                        >
                          מחק ליד
                        </button>
                      </div>
                    </div>
                    <div className="bg-black p-4 rounded text-sm text-zinc-300 border border-white/5 leading-relaxed">
                      {lead.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// --- Product Details Modal ---
function ProductDetailsModal({ product, onClose, onAddToCart }: { 
    key?: string,
    product: Product, 
    onClose: () => void,
    onAddToCart: (p: Product, q: number, s?: string) => void
}) {
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | undefined>(product.sizes?.[0]);
  const images = useMemo(() => product.images && product.images.length > 0 ? product.images : [product.image], [product]);
  const [activeImg, setActiveImg] = useState(0);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-start md:items-center justify-center p-0 md:p-8 bg-black/95 backdrop-blur-xl overflow-y-auto"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-zinc-900 w-full max-w-5xl md:rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col md:flex-row relative my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white hover:bg-gold hover:text-black transition-all"
        >
          <X size={20} />
        </button>

        {/* Image Gallery */}
        <div className="w-full md:w-1/2 bg-black flex flex-col min-h-[300px] md:min-h-0">
          <div className="flex-grow relative overflow-hidden aspect-square md:aspect-auto h-full">
            <AnimatePresence mode="wait">
              <motion.img 
                key={activeImg}
                src={images[activeImg] || null} 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full h-full object-contain md:object-cover"
                referrerPolicy="no-referrer"
              />
            </AnimatePresence>
            
            {images.length > 1 && (
              <>
                <button 
                  onClick={() => setActiveImg(prev => (prev > 0 ? prev - 1 : images.length - 1))}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-gold transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
                <button 
                  onClick={() => setActiveImg(prev => (prev < images.length - 1 ? prev + 1 : 0))}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-gold transition-colors"
                >
                  <ChevronRight size={24} />
                </button>
              </>
            )}
          </div>
          
          {images.length > 1 && (
            <div className="p-4 flex gap-2 overflow-x-auto bg-zinc-950/50 scrollbar-hide">
              {images.map((img, i) => (
                <button 
                  key={i} 
                  onClick={() => setActiveImg(i)}
                  className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${i === activeImg ? 'border-gold' : 'border-transparent opacity-50 hover:opacity-100'}`}
                >
                  <img src={img} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center text-right">
          <div className="mb-8">
            <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter italic mb-2 leading-tight">{product.name}</h2>
            <p className="text-2xl font-bold text-gold">{product.price}</p>
          </div>

          <div className="mb-8 space-y-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">תיאור המוצר</h3>
            <p className="text-zinc-300 leading-relaxed text-sm md:text-base whitespace-pre-wrap">{product.description}</p>
          </div>

          {product.sizes && product.sizes.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">בחר מידה</h3>
              <div className="flex flex-wrap gap-2 justify-end">
                {product.sizes.map((size, i) => (
                  <button 
                    key={`${size}-${i}`}
                    onClick={() => setSelectedSize(size)}
                    className={`px-4 py-2 rounded-lg border text-sm font-bold transition-all ${selectedSize === size ? 'bg-gold text-black border-gold shadow-lg shadow-gold/20' : 'bg-white/5 border-white/10 text-white hover:border-white/30'}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-4 mt-auto">
            <div className="flex items-center bg-white/5 border border-white/10 rounded-xl overflow-hidden h-14 w-full sm:w-auto">
              <button 
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-14 h-full flex items-center justify-center hover:bg-white/10 transition-colors text-white"
              >
                <Minus size={20} />
              </button>
              <div className="w-14 h-full flex items-center justify-center font-bold text-xl border-x border-white/10">
                {quantity}
              </div>
              <button 
                onClick={() => setQuantity(quantity + 1)}
                className="w-14 h-full flex items-center justify-center hover:bg-white/10 transition-colors text-white"
              >
                <Plus size={20} />
              </button>
            </div>
            
            <button 
              onClick={() => onAddToCart(product, quantity, selectedSize)}
              className="flex-grow h-14 bg-gold text-black rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-gold/10 hover:shadow-gold/20 hover:scale-[1.02] active:scale-95 transition-all w-full"
            >
              <ShoppingCart size={20} />
              הוסף לסל קניות
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Cart Drawer ---
function CartDrawer({ items, onClose, onUpdateQuantity, onRemove, siteName }: {
  key?: string,
  items: CartItem[],
  onClose: () => void,
  onUpdateQuantity: (id: string, q: number, s?: string) => void,
  onRemove: (id: string, s?: string) => void,
  siteName: string
}) {
  const total = items.reduce((acc, item) => {
    const priceStr = item.product.price.replace(/[^\d.]/g, '');
    const price = parseFloat(priceStr) || 0;
    return acc + (price * item.quantity);
  }, 0);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[170] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        className="absolute inset-y-0 right-0 w-full max-w-md bg-zinc-900 shadow-2xl flex flex-col text-right"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-zinc-950/30">
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X size={24} />
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black uppercase tracking-tighter italic">סל הקניות שלך</h2>
            <ShoppingCart className="text-gold" />
          </div>
        </div>

        <div className="flex-grow overflow-y-auto p-6 space-y-6 scrollbar-hide">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <ShoppingCart size={64} className="mb-4" />
              <p className="text-xl font-bold uppercase tracking-widest">הסל ריק</p>
              <button 
                onClick={onClose}
                className="mt-6 text-gold underline font-bold uppercase tracking-widest text-xs"
              >
                חזור לקולקציה
              </button>
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={`${item.product.id}-${item.selectedSize}-${idx}`} className="flex gap-4 group">
                <div className="w-20 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-black border border-white/5">
                  <img src={item.product.image} className="w-full h-full object-cover" />
                </div>
                <div className="flex-grow">
                  <div className="flex justify-between items-start mb-1">
                    <button 
                      onClick={() => onRemove(item.product.id, item.selectedSize)}
                      className="text-white/20 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                    <h4 className="font-bold uppercase tracking-tight">{item.product.name}</h4>
                  </div>
                  {item.selectedSize && (
                    <p className="text-[10px] text-gold font-bold uppercase tracking-widest mb-2">מידה: {item.selectedSize}</p>
                  )}
                  <div className="flex justify-between items-center mt-2 flex-row-reverse">
                    <div className="flex items-center bg-white/5 border border-white/10 rounded-lg scale-90 -mr-2">
                      <button 
                        onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1, item.selectedSize)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-xs font-bold leading-none">{item.quantity}</span>
                      <button 
                        onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1, item.selectedSize)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="font-bold text-gold">{item.product.price}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="p-8 border-t border-white/10 bg-zinc-950/50">
            <div className="flex justify-between items-center mb-6">
              <span className="text-3xl font-black text-gold italic">₪{total.toLocaleString()}</span>
              <span className="text-zinc-500 uppercase font-bold tracking-widest text-xs">סה"כ לתשלום</span>
            </div>
            <button className="w-full h-16 bg-gold text-black rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-gold/10 hover:shadow-gold/20 hover:scale-[1.02] active:scale-95 transition-all">
              <ArrowLeft size={20} />
              המשך לתשלום
            </button>
            <p className="text-[10px] text-center text-zinc-500 mt-4 uppercase tracking-widest font-bold">
              התשלום יבוצע מול מנהל החנות {siteName}
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
