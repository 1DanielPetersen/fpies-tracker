import React, { useState, useEffect, useRef } from 'react';
import { Camera, List, ShieldCheck, ShieldAlert, Plus, CheckCircle, XCircle, Info, ScanLine, LogOut, Users, Image as ImageIcon, Copy, Sparkles, ChevronDown, ArrowUpDown, Clock, RefreshCw } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';

// --- BUILD VERSION ---
// Injected by Vite at build time (see vite.config.js). Falls back to 'dev'
// when running locally so updates aren't falsely flagged in dev.
const APP_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

// --- PWA UPDATE HOOK ---
// Registers the service worker, polls /version.json, and exposes an
// applyUpdate() that activates the waiting SW and reloads the page.
function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const registrationRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    const trackInstalling = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }
      });
    };

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (cancelled) return;
      registrationRef.current = reg;
      if (reg.waiting && navigator.serviceWorker.controller) setUpdateAvailable(true);
      if (reg.installing) trackInstalling(reg.installing);
      reg.addEventListener('updatefound', () => trackInstalling(reg.installing));
    }).catch((err) => {
      console.log('Service Worker registration failed:', err);
    });

    const checkVersion = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.version && data.version !== APP_VERSION) {
          setUpdateAvailable(true);
          if (registrationRef.current) {
            registrationRef.current.update().catch(() => {});
          }
        }
      } catch (_) {
        // Offline or version.json missing — ignore.
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 60_000);
    const onFocus = () => checkVersion();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const applyUpdate = async () => {
    try {
      const reg = registrationRef.current;
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } finally {
      window.location.reload();
    }
  };

  return { updateAvailable, applyUpdate };
}

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyD2E87KHJCxzYzkTrxtinnEHUQR_i0bAYE",
  authDomain: "fpies-tracker.firebaseapp.com",
  projectId: "fpies-tracker",
  storageBucket: "fpies-tracker.firebasestorage.app",
  messagingSenderId: "824186924382",
  appId: "1:824186924382:web:2c8782cc29f74490b933cf"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : '1:824186924382:web:2c8782cc29f74490b933cf';

// --- GEMINI API SETUP ---
// Remember to paste your Gemini API key here if you aren't using Vercel Environment Variables!
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// --- LIST NORMALIZATION ---
// Legacy entries were plain strings; new entries are { name, addedAt } objects.
const normalizeFood = (item, fallbackDate) =>
  typeof item === 'string' ? { name: item, addedAt: fallbackDate || null } : item;

const normalizeList = (list, fallbackDate) =>
  (list || []).map((it) => normalizeFood(it, fallbackDate));

function sortFoods(list, mode) {
  const arr = [...list];
  switch (mode) {
    case 'az':
      return arr.sort((a, b) => a.name.localeCompare(b.name, 'da'));
    case 'za':
      return arr.sort((a, b) => b.name.localeCompare(a.name, 'da'));
    case 'oldest':
      return arr.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
    case 'newest':
    default:
      return arr.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [familyCode, setFamilyCode] = useState(localStorage.getItem('fpiesFamilyCode') || null);
  const [familyData, setFamilyData] = useState(null);
  const [activeTab, setActiveTab] = useState('scanner');
  const [joinError, setJoinError] = useState("");
  const { updateAvailable, applyUpdate } = useAppUpdate();
  
  // Auth Effect
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Data Sync Effect
  useEffect(() => {
    if (!user || !familyCode) return;

    // RULE 1: Strict Paths -> artifacts/{appId}/public/data/{collectionName}
    const familyDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    
    const unsubscribe = onSnapshot(familyDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setFamilyData(docSnap.data());
      } else {
        setFamilyData(null);
      }
    }, (error) => {
      console.error("Sync error:", error);
    });

    return () => unsubscribe();
  }, [user, familyCode]);

  // --- FAMILY SETUP HANDLERS ---
  const handleCreateFamily = async () => {
    if (!user) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const familyDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', newCode);
    
    const now = new Date().toISOString();
    const initialData = {
      createdAt: now,
      safeFoods: [],
      dangerFoods: [
        "Majsmel (Cornmeal)",
        "Hirse (Millet)",
        "Majs (Corn)",
        "Majsstivelse (Corn Starch)",
        "Glukosesirup (Glucose Syrup)",
        "Maltodextrin",
        "Dextrose"
      ].map((name) => ({ name, addedAt: now })),
      trials: []
    };

    try {
      await setDoc(familyDocRef, initialData);
      localStorage.setItem('fpiesFamilyCode', newCode);
      setFamilyCode(newCode);
    } catch (err) {
      console.error("Failed to create family", err);
    }
  };

  const handleJoinFamily = async (code) => {
    if (!user || !code) return;
    setJoinError("");
    const cleanCode = code.trim().toUpperCase();
    const familyDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', cleanCode);
    try {
      const snap = await getDoc(familyDocRef);
      if (snap.exists()) {
        localStorage.setItem('fpiesFamilyCode', cleanCode);
        setFamilyCode(cleanCode);
      } else {
        setJoinError("Familiekode ikke fundet. Prøv venligst igen.");
      }
    } catch (err) {
      console.error("Failed to join family", err);
      setJoinError("Der opstod en fejl. Prøv igen.");
    }
  };

  const handleLeaveFamily = () => {
    localStorage.removeItem('fpiesFamilyCode');
    setFamilyCode(null);
    setFamilyData(null);
  };

  // --- APP UI ---
  if (!authReady) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 via-orange-50 to-rose-100 text-rose-700 font-semibold">
        <UpdateBanner show={updateAvailable} onUpdate={applyUpdate} />
        <div className="flex-1 flex items-center justify-center">Indlæser FPIES Beskytter...</div>
      </div>
    );
  }

  if (!familyCode || !familyData) {
    return (
      <>
        <UpdateBanner show={updateAvailable} onUpdate={applyUpdate} />
        <FamilySetup onCreate={handleCreateFamily} onJoin={handleJoinFamily} error={joinError} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-100 flex flex-col font-sans pb-24">
      <UpdateBanner show={updateAvailable} onUpdate={applyUpdate} />
      {/* Header */}
      <header className="bg-white/80 backdrop-blur p-4 shadow-sm shadow-rose-200/40 border-b border-rose-100/60 sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
            <span className="inline-flex w-8 h-8 rounded-2xl bg-gradient-to-br from-rose-400 to-orange-400 text-white items-center justify-center shadow-md shadow-rose-400/30">
              <ShieldCheck size={18} />
            </span>
            FPIES Beskytter
          </h1>
          <p className="text-xs text-slate-500 font-semibold ml-10">Familiekode: <span className="text-rose-500 tracking-wider">{familyCode}</span></p>
        </div>
        <button onClick={handleLeaveFamily} className="p-2 text-slate-400 hover:text-rose-500 rounded-full transition-colors">
          <LogOut size={20} />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        {activeTab === 'scanner' && <ScannerView familyData={familyData} />}
        {activeTab === 'trials' && <TrialsView familyCode={familyCode} familyData={familyData} />}
        {activeTab === 'foods' && <FoodsView familyCode={familyCode} familyData={familyData} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-rose-100/60 flex justify-around p-2 pb-safe z-20 shadow-[0_-4px_24px_-8px_rgba(244,63,94,0.12)]">
        <NavButton active={activeTab === 'scanner'} onClick={() => setActiveTab('scanner')} icon={<Camera />} label="Scanner" />
        <NavButton active={activeTab === 'trials'} onClick={() => setActiveTab('trials')} icon={<List />} label="4-Dages Test" />
        <NavButton active={activeTab === 'foods'} onClick={() => setActiveTab('foods')} icon={<ShieldCheck />} label="Madlister" />
      </nav>
    </div>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function UpdateBanner({ show, onUpdate }) {
  const [busy, setBusy] = useState(false);
  if (!show) return null;
  const handleClick = () => {
    setBusy(true);
    onUpdate();
  };
  return (
    <div className="sticky top-0 z-30 bg-gradient-to-r from-rose-400 to-orange-400 text-white px-4 py-2 flex items-center justify-between gap-3 shadow-md shadow-rose-400/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        <span>En ny version af appen er tilgængelig.</span>
      </div>
      <button
        onClick={handleClick}
        disabled={busy}
        className="bg-white text-rose-600 font-semibold text-sm px-3 py-1 rounded-full hover:bg-rose-50 disabled:opacity-60 transition-colors"
      >
        {busy ? 'Opdaterer…' : 'Opdater app'}
      </button>
    </div>
  );
}

function FamilySetup({ onCreate, onJoin, error }) {
  const [joinCode, setJoinCode] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-100 flex flex-col items-center justify-center p-6">
      <div className="bg-white/90 backdrop-blur p-8 rounded-3xl shadow-2xl shadow-rose-500/10 w-full max-w-md text-center border border-rose-100/60">
        <div className="bg-gradient-to-br from-rose-400 to-orange-400 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-400/30">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-800 mb-2">FPIES Beskytter</h1>
        <p className="text-slate-600 mb-8">Synkroniser sikre fødevarer, forbudte lister og 4-dages tests på tværs af enheder med din partner.</p>

        <button
          onClick={onCreate}
          className="w-full bg-gradient-to-br from-rose-400 to-orange-400 hover:from-rose-500 hover:to-orange-500 text-white font-extrabold py-3.5 px-4 rounded-2xl shadow-lg shadow-rose-400/30 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mb-6"
        >
          <Plus size={20} /> Opret Ny Familie
        </button>

        <div className="relative flex items-center py-5">
          <div className="flex-grow border-t border-rose-100"></div>
          <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-semibold">ELLER</span>
          <div className="flex-grow border-t border-rose-100"></div>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Indtast Familiekode"
            className="w-full border-2 border-rose-100 rounded-2xl px-4 py-3 text-center text-lg uppercase tracking-widest focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
          <button
            onClick={() => onJoin(joinCode)}
            disabled={!joinCode.trim()}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-extrabold py-3.5 px-4 rounded-2xl shadow-lg shadow-slate-500/20 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            <Users size={20} /> Deltag i Familie
          </button>
        </div>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-24 py-2 transition-all ${active ? 'text-rose-500 scale-105' : 'text-slate-400 hover:text-slate-600'}`}
    >
      <span className={`inline-flex items-center justify-center rounded-2xl p-1.5 mb-0.5 transition-all ${active ? 'bg-gradient-to-br from-rose-100 to-orange-50 shadow-sm shadow-rose-200/60' : ''}`}>
        {React.cloneElement(icon, { size: 22 })}
      </span>
      <span className="text-[10px] font-extrabold tracking-wide">{label}</span>
    </button>
  );
}

// ============================================================================
// SCANNER VIEW
// ============================================================================
function ScannerView({ familyData }) {
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleImageCapture = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result);
      analyzeImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async (base64Image) => {
    setLoading(true);
    setResult(null);

    // Remove the data URL prefix for Gemini API
    const base64Data = base64Image.split(',')[1];
    
    // Construct the safe + danger lists for the prompt
    const safeListString   = normalizeList(familyData.safeFoods, familyData.createdAt).map((f) => f.name).join(", ");
    const dangerListString = normalizeList(familyData.dangerFoods, familyData.createdAt).map((f) => f.name).join(", ");

      const prompt = `
      You are an expert in pediatric FPIES (Food Protein-Induced Enterocolitis Syndrome) and clinical nutrition.
      Here is an image of an ingredient label, likely in Danish, English or Polish.

      The baby's STRICT DANGER LIST is: ${dangerListString || "(none)"}.
      The baby's KNOWN SAFE LIST is: ${safeListString || "(none)"}.

      CRITICAL INSTRUCTIONS:
      1. Extract every ingredient from the label.
      2. For each ingredient, decide which bucket it belongs to:
         - "knownDanger": it matches the danger list OR is a derivative/byproduct/sub-category of a danger list item.
         - "knownSafe":   it matches the safe list (allow translations between Danish / English / Polish; e.g. "Sucre" ≈ "Sukker").
         - "unknown":     it is neither known-safe nor known-dangerous (new/untested ingredient).
      3. Derivative rules you MUST apply for knownDanger:
         - If "Majs" (Corn) is on the danger list, flag Majsmel, Majsstivelse, Maltodextrin, Glukosesirup, Dextrose, Modificeret stivelse.
         - If "Hvede" (Wheat) or "Korn" (Grains) is on the danger list, flag Hvedemel, Havregryn, Rugmel, Byg, Spelt, and any other grain flours.
         - If "Mælk" (Dairy) is on the danger list, flag Valle, Kasein, Mælkesukker, Laktose, etc.
      4. Compute "status":
         - "red"    if knownDanger is non-empty.
         - "orange" if knownDanger is empty AND unknown is non-empty.
         - "green"  if knownDanger is empty AND unknown is empty.
      5. Trivial things like "water" / "vand" / "salt" count as unknown unless they explicitly appear on a list.

      Respond ONLY with a valid JSON object matching this schema exactly:
      {
        "ingredientsFound": ["list", "of", "all", "extracted", "ingredients"],
        "knownSafe":   ["ingredients matching the safe list"],
        "knownDanger": ["ingredients matching the danger list or derivatives"],
        "unknown":     ["ingredients not on either list"],
        "status": "green" | "orange" | "red",
        "reasoning": "A short, clear sentence IN DANISH explaining the result."
      }
    `;

    try {
const payload = {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "low" }
        }
      };

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error("Gemini API error:", response.status, errBody);
        throw new Error(`API Request Failed: ${response.status}`);
      }

      const data = await response.json();
      // Gemini 3 models include thinking parts — find the text part with JSON
      const parts = data.candidates?.[0]?.content?.parts || [];
      const textResponse = parts.filter(p => p.text && !p.thought).map(p => p.text).pop();
      
      if (textResponse) {
        const parsedResult = JSON.parse(textResponse);
        setResult(parsedResult);
      } else {
        throw new Error("No text in response");
      }

    } catch (error) {
      console.error("Scanning Error:", error);
      setResult({
        isSafe: false,
        error: true,
        reasoning: "Kunne ikke analysere billedet. Prøv igen eller tjek ingredienserne manuelt."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center max-w-md mx-auto h-full">
      <div className="w-full bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-2xl border border-amber-100 mb-6 flex items-start gap-3 shadow-sm shadow-rose-200/40">
        <Info className="text-orange-500 shrink-0 mt-0.5" size={20} />
        <p className="text-sm text-orange-900 font-medium leading-relaxed">
          Tag et billede eller upload en ingrediensliste. AI'en vil lede efter ingredienser, der matcher din Forbudt-liste, og specielt lede efter skjulte majsderivater.
        </p>
      </div>

      {!image && !loading && (
        <div className="flex flex-col gap-4 w-full">
          {/* Main Camera Button */}
          <label className="w-full h-64 bg-gradient-to-br from-rose-400 to-orange-400 hover:from-rose-500 hover:to-orange-500 rounded-3xl flex flex-col items-center justify-center text-white transition-all hover:scale-[1.01] shadow-xl shadow-rose-400/30 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageCapture}
            />
            <Camera size={64} className="mb-4" />
            <span className="font-extrabold text-lg tracking-tight">Åbn Kamera for at Scanne</span>
          </label>

          {/* Secondary Gallery Button */}
          <label className="w-full py-4 bg-white/90 backdrop-blur border-2 border-rose-100 text-slate-600 font-extrabold rounded-2xl flex items-center justify-center gap-2 hover:bg-white hover:border-rose-200 transition-colors cursor-pointer shadow-sm shadow-rose-200/40">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageCapture}
            />
            <ImageIcon size={20} className="text-rose-300" /> Upload Billede fra Galleri
          </label>
        </div>
      )}

      {image && (
        <div className="w-full space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-rose-100 shadow-sm shadow-rose-200/40 max-h-64 flex justify-center bg-black">
            <img src={image} alt="Scannet etiket" className="object-contain h-64" />
            {loading && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white">
                <ScanLine size={48} className="animate-pulse mb-2 text-orange-300" />
                <span className="font-medium animate-pulse">Analyserer AI...</span>
              </div>
            )}
          </div>

          {result && !result.error && (() => {
            const status = result.status ?? (result.isSafe ? 'green' : 'red');
            const dangerList = result.knownDanger ?? result.flaggedIngredients ?? [];
            const unknownList = result.unknown ?? [];
            const safeMatches = result.knownSafe ?? [];

            const palette = {
              green: {
                card: 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200',
                title: 'text-emerald-800',
                icon: <ShieldCheck size={32} className="text-emerald-500" />,
                heading: 'Alle ingredienser er kendte og sikre',
              },
              orange: {
                card: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200',
                title: 'text-orange-900',
                icon: <Sparkles size={32} className="text-orange-400" />,
                heading: 'Nye ingredienser fundet',
              },
              red: {
                card: 'bg-gradient-to-br from-rose-50 to-red-50 border-rose-200',
                title: 'text-rose-900',
                icon: <ShieldAlert size={32} className="text-rose-500" />,
                heading: 'FARE REGISTRERET',
              },
            }[status];

            return (
              <div key={status} className={`fpies-fade-in p-5 rounded-3xl shadow-lg shadow-rose-200/40 border ${palette.card}`}>
                <div className="flex items-center gap-3 mb-3">
                  {palette.icon}
                  <h3 className={`text-xl font-extrabold tracking-tight ${palette.title}`}>{palette.heading}</h3>
                </div>

                <p className="text-slate-700 font-medium mb-4">{result.reasoning}</p>

                {status === 'red' && dangerList.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-bold text-rose-900 uppercase tracking-wider block mb-1">På Forbudt-Listen:</span>
                    <div className="flex flex-wrap gap-2">
                      {dangerList.map((ing, idx) => (
                        <span key={idx} className="bg-rose-100 text-rose-800 px-3 py-1 rounded-full text-sm font-semibold">{ing}</span>
                      ))}
                    </div>
                  </div>
                )}

                {status !== 'red' && unknownList.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-bold text-orange-900 uppercase tracking-wider block mb-1">Nye / Ikke Testede:</span>
                    <div className="flex flex-wrap gap-2">
                      {unknownList.map((ing, idx) => (
                        <span key={idx} className="bg-orange-100 text-orange-900 px-3 py-1 rounded-full text-sm font-semibold">{ing}</span>
                      ))}
                    </div>
                  </div>
                )}

                {safeMatches.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-1">Kendt Sikre:</span>
                    <div className="flex flex-wrap gap-2">
                      {safeMatches.map((ing, idx) => (
                        <span key={idx} className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-sm font-medium">{ing}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-rose-200/40">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Registrerede Ingredienser:</span>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {result.ingredientsFound?.join(', ')}
                  </p>
                </div>
              </div>
            );
          })()}

          {result?.error && (
             <div className="p-4 bg-amber-50 border border-amber-200 text-orange-900 rounded-2xl shadow-sm shadow-rose-200/40">
               {result.reasoning}
             </div>
          )}

          {!loading && (
            <div className="flex gap-2">
              <label className="flex-1 bg-white/90 backdrop-blur border-2 border-rose-100 text-slate-700 font-bold py-3 px-2 rounded-2xl shadow-sm shadow-rose-200/40 hover:bg-white hover:border-rose-200 flex items-center justify-center gap-2 text-sm cursor-pointer transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleImageCapture}
                />
                <Camera size={18} /> Nyt Kamera Scan
              </label>
              <label className="flex-1 bg-white/90 backdrop-blur border-2 border-rose-100 text-slate-700 font-bold py-3 px-2 rounded-2xl shadow-sm shadow-rose-200/40 hover:bg-white hover:border-rose-200 flex items-center justify-center gap-2 text-sm cursor-pointer transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageCapture}
                />
                <ImageIcon size={18} /> Nyt Upload
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TRIALS VIEW
// ============================================================================
function TrialsView({ familyCode, familyData }) {
  const [newFood, setNewFood] = useState("");
  const [confirmFail, setConfirmFail] = useState(null);

  const handleAddTrial = async (e) => {
    e.preventDefault();
    if (!newFood.trim()) return;

    const newTrial = {
      id: Date.now().toString(),
      foodName: newFood.trim(),
      daysPassed: 0,
      status: 'active', // active, passed, failed
      startDate: new Date().toISOString()
    };

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    await updateDoc(docRef, {
      trials: [...familyData.trials, newTrial]
    });
    setNewFood("");
  };

  const updateTrial = async (trialId, updates, additionalUpdates = {}) => {
    const updatedTrials = familyData.trials.map(t => 
      t.id === trialId ? { ...t, ...updates } : t
    );
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    await updateDoc(docRef, { trials: updatedTrials, ...additionalUpdates });
  };

  const handleDayPassed = async (trial) => {
    const newDays = trial.daysPassed + 1;
    if (newDays === 4) {
      const existing = normalizeList(familyData.safeFoods, familyData.createdAt);
      const entry = { name: trial.foodName, addedAt: new Date().toISOString() };
      const merged = existing.some((f) => f.name === trial.foodName) ? existing : [...existing, entry];
      await updateTrial(trial.id, { daysPassed: 4, status: 'passed' }, {
        safeFoods: merged
      });
    } else {
      await updateTrial(trial.id, { daysPassed: newDays });
    }
  };

  const handleDayUndo = async (trial) => {
    if (trial.daysPassed > 0) {
      await updateTrial(trial.id, { daysPassed: trial.daysPassed - 1 });
    }
  };

  const handleFailTrial = async (trial) => {
    const existing = normalizeList(familyData.dangerFoods, familyData.createdAt);
    const entry = { name: trial.foodName, addedAt: new Date().toISOString() };
    const merged = existing.some((f) => f.name === trial.foodName) ? existing : [...existing, entry];
    await updateTrial(trial.id, { status: 'failed' }, {
      dangerFoods: merged
    });
    setConfirmFail(null);
  };

  const activeTrials = familyData.trials.filter(t => t.status === 'active');
  const pastTrials = familyData.trials.filter(t => t.status !== 'active').slice(-5); // Show last 5

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-white/90 backdrop-blur p-5 rounded-3xl shadow-md shadow-rose-200/40 border border-rose-100/60">
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800 mb-3">Start 4-Dages Test</h2>
        <form onSubmit={handleAddTrial} className="flex gap-2">
          <input
            type="text"
            placeholder="f.eks. Sød kartoffel"
            value={newFood}
            onChange={(e) => setNewFood(e.target.value)}
            className="flex-1 border-2 border-rose-100 rounded-2xl px-4 py-2.5 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none bg-white"
          />
          <button
            type="submit"
            disabled={!newFood.trim()}
            className="bg-gradient-to-br from-rose-400 to-orange-400 hover:from-rose-500 hover:to-orange-500 disabled:opacity-50 text-white p-2.5 rounded-2xl shadow-md shadow-rose-400/30 transition-all"
          >
            <Plus size={24} />
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <h3 className="font-bold text-slate-500 uppercase text-sm tracking-wider px-1">Aktive Tests</h3>
        {activeTrials.length === 0 ? (
          <p className="text-slate-400 text-center py-8">Ingen aktive tests. Start med at teste en ny madvare ovenfor!</p>
        ) : (
          activeTrials.map(trial => (
            <div key={trial.id} className="bg-white/90 backdrop-blur p-4 rounded-3xl shadow-md shadow-rose-200/40 border border-rose-100/60">
              <div className="flex justify-between items-start mb-4">
                <h4 className="text-lg font-bold text-slate-800">{trial.foodName}</h4>
                {confirmFail === trial.id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFailTrial(trial)}
                      className="text-xs font-bold text-white bg-gradient-to-br from-rose-400 to-red-500 hover:from-rose-500 hover:to-red-600 px-3 py-1.5 rounded-full shadow-sm shadow-rose-400/30"
                    >
                      Bekræft
                    </button>
                    <button
                      onClick={() => setConfirmFail(null)}
                      className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full shadow-sm"
                    >
                      Fortryd
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmFail(trial.id)}
                    className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-full flex items-center gap-1 transition-colors"
                  >
                    <XCircle size={14} /> Mislykkedes (Forbyd)
                  </button>
                )}
              </div>

              <div className="flex justify-between items-center px-2 relative">
                <div className="absolute top-1/2 left-4 right-4 h-1 bg-slate-100 -z-10 -translate-y-1/2 rounded-full"></div>
                {[1, 2, 3, 4].map((day) => {
                  const isPassed = day <= trial.daysPassed;
                  const isNext = day === trial.daysPassed + 1;
                  const canUndo = day === trial.daysPassed; 

                  return (
                    <div key={day} className="flex flex-col items-center gap-2">
                      <button
                        onClick={() => {
                          if (isNext) handleDayPassed(trial);
                          else if (canUndo) handleDayUndo(trial);
                        }}
                        disabled={!isNext && !canUndo}
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-sm
                          ${isPassed ? 'bg-gradient-to-br from-emerald-400 to-teal-400 text-white shadow-emerald-200 hover:from-emerald-500 hover:to-teal-500' :
                            isNext ? 'bg-amber-100 text-amber-700 border-2 border-amber-400 hover:bg-amber-200 scale-110' :
                            'bg-slate-50 text-slate-300 border border-slate-200'}`}
                      >
                        {isPassed ? <CheckCircle size={20} /> : day}
                      </button>
                      <span className={`text-[10px] font-bold uppercase ${isPassed ? 'text-emerald-600' : isNext ? 'text-amber-600' : 'text-slate-400'}`}>
                        Dag {day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {pastTrials.length > 0 && (
        <div className="space-y-3 pt-6">
          <h3 className="font-bold text-slate-500 uppercase text-sm tracking-wider px-1">Nyligt Afsluttede</h3>
          {pastTrials.map(trial => (
            <div key={trial.id} className="bg-white/80 backdrop-blur p-3 rounded-2xl border border-rose-100/60 flex items-center justify-between opacity-80">
              <span className="font-medium text-slate-700">{trial.foodName}</span>
              {trial.status === 'passed' ? (
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">Godkendt til Sikker</span>
              ) : (
                <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-full">Fejlet til Forbudt</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FOODS VIEW (SAFE & DANGER LISTS)
// ============================================================================
function FoodsView({ familyCode, familyData }) {
  const [activeList, setActiveList] = useState('danger');
  const [newItem, setNewItem] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('fpiesSortMode') || 'newest');
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const copyMenuRef = useRef(null);

  useEffect(() => { localStorage.setItem('fpiesSortMode', sortMode); }, [sortMode]);

  // Close copy menu when clicking outside
  useEffect(() => {
    if (!copyMenuOpen) return;
    const onClick = (e) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target)) setCopyMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [copyMenuOpen]);

  const targetKey = activeList === 'danger' ? 'dangerFoods' : 'safeFoods';
  const rawList = familyData[targetKey];
  const normalized = normalizeList(rawList, familyData.createdAt);
  const sortedList = sortFoods(normalized, sortMode);

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;

    const trimmed = newItem.trim();
    if (normalized.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewItem('');
      return;
    }

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    await updateDoc(docRef, {
      [targetKey]: [...normalized, { name: trimmed, addedAt: new Date().toISOString() }]
    });
    setNewItem('');
  };

  const removeFood = async (foodName) => {
    const updatedList = normalized.filter((item) => item.name !== foodName);
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    await updateDoc(docRef, { [targetKey]: updatedList });
    setConfirmRemove(null);
  };

  const copyList = async (format) => {
    const items = sortedList.map((f) => f.name);
    const header = activeList === 'danger' ? 'Forbudt Liste' : 'Sikker Liste';
    const text = format === 'markdown'
      ? `## ${header}\n${items.map((n) => `- ${n}`).join('\n')}`
      : items.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 1600);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
    setCopyMenuOpen(false);
  };

  const isDanger = activeList === 'danger';
  const accentText = isDanger ? 'text-rose-600' : 'text-emerald-600';
  const accentBtn = isDanger
    ? 'bg-gradient-to-br from-rose-400 to-red-500 hover:from-rose-500 hover:to-red-600 shadow-rose-400/30'
    : 'bg-gradient-to-br from-emerald-400 to-teal-400 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-400/30';
  const underlineColor = isDanger ? 'bg-gradient-to-r from-rose-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-teal-400';

  return (
    <div className="max-w-md mx-auto flex flex-col h-full">
      {/* Tabs */}
      <div className="relative flex bg-white/80 backdrop-blur p-1 rounded-2xl mb-4 shadow-sm shadow-rose-200/40 border border-rose-100/60">
        <button
          onClick={() => setActiveList('danger')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-xl transition-colors relative z-10 ${activeList === 'danger' ? 'text-rose-700' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Forbudt Liste
        </button>
        <button
          onClick={() => setActiveList('safe')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-xl transition-colors relative z-10 ${activeList === 'safe' ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Sikker Liste
        </button>
        <span
          aria-hidden
          className={`absolute bottom-1 left-1 h-0.5 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-200 ease-out ${underlineColor} ${isDanger ? 'translate-x-0' : 'translate-x-full'}`}
        />
      </div>

      {/* Toolbar: sort + copy */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur rounded-xl border border-rose-100/60 px-2 py-1.5 shadow-sm hover:shadow-rose-200/50 transition-shadow">
          <ArrowUpDown size={14} className="text-slate-400" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="text-xs font-semibold text-slate-600 bg-transparent outline-none"
          >
            <option value="newest">Nyeste først</option>
            <option value="oldest">Ældste først</option>
            <option value="az">A – Å</option>
            <option value="za">Å – A</option>
          </select>
        </div>

        <div className="relative" ref={copyMenuRef}>
          <button
            onClick={() => setCopyMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 bg-white/90 backdrop-blur rounded-xl border border-rose-100/60 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white hover:shadow-rose-200/50 shadow-sm transition-shadow"
          >
            <Copy size={14} /> Kopier
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {copyMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-rose-100 rounded-2xl shadow-lg shadow-rose-200/50 z-30 overflow-hidden">
              <button onClick={() => copyList('plain')} className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-rose-50">
                Almindelig tekst
              </button>
              <button onClick={() => copyList('markdown')} className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-rose-50 border-t border-rose-100">
                Markdown (til LLM-chat)
              </button>
            </div>
          )}
          {copiedToast && (
            <span className="absolute right-0 top-full mt-2 bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg shadow-emerald-500/30 z-30 whitespace-nowrap flex items-center gap-1">
              <CheckCircle size={12} /> Kopieret!
            </span>
          )}
        </div>
      </div>

      {/* Add form */}
      <form onSubmit={handleAddItem} className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder={`Tilføj til ${isDanger ? 'Forbudt' : 'Sikker'} liste...`}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          className="flex-1 border-2 border-rose-100 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none shadow-sm shadow-rose-200/40 bg-white/90 backdrop-blur"
        />
        <button
          type="submit"
          disabled={!newItem.trim()}
          className={`px-5 rounded-2xl font-extrabold text-white shadow-lg disabled:opacity-50 transition-all hover:scale-[1.02] ${accentBtn}`}
        >
          <Plus size={20} />
        </button>
      </form>

      {/* List */}
      <div className="flex-1 bg-white/90 backdrop-blur rounded-3xl shadow-md shadow-rose-200/40 border border-rose-100/60 overflow-hidden">
        <div className="h-full overflow-y-auto p-3 space-y-1.5">
          {sortedList.length === 0 ? (
            <p className="text-center text-slate-400 py-12 font-medium">Ingen madvarer på denne liste endnu.</p>
          ) : (
            sortedList.map((food) => {
              const dateLabel = food.addedAt
                ? new Date(food.addedAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';
              return (
                <div key={food.name} className="flex justify-between items-center p-3 hover:bg-rose-50/60 border border-rose-100/60 rounded-2xl group transition-colors">
                  <div className="flex flex-col">
                    <span className={`font-bold ${accentText}`}>{food.name}</span>
                    <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                      <Clock size={10} /> Tilføjet {dateLabel}
                    </span>
                  </div>
                  {confirmRemove === food.name ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => removeFood(food.name)}
                        className="text-xs font-bold text-white bg-gradient-to-br from-rose-400 to-red-500 hover:from-rose-500 hover:to-red-600 px-3 py-1.5 rounded-full shadow-sm shadow-rose-400/30"
                      >
                        Slet
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full shadow-sm"
                      >
                        Fortryd
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(food.name)}
                      className="text-slate-300 hover:text-rose-500 p-1 rounded-md transition-colors"
                    >
                      <XCircle size={18} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
