import React, { useState, useEffect, useRef } from 'react';
import { Camera, List, ShieldCheck, ShieldAlert, Plus, CheckCircle, XCircle, Info, ScanLine, LogOut, Users, Image as ImageIcon, Copy, Sparkles, ChevronDown, ArrowUpDown, Clock } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';

// --- PWA SERVICE WORKER REGISTRATION ---
// Browsers strictly require a Service Worker to trigger the native "Install App" prompt.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('Service Worker registered successfully for PWA.');
    }).catch((err) => {
      console.log('Service Worker registration failed:', err);
    });
  });
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
    return <div className="min-h-screen flex items-center justify-center bg-blue-50 text-blue-800">Indlæser FPIES Beskytter...</div>;
  }

  if (!familyCode || !familyData) {
    return <FamilySetup onCreate={handleCreateFamily} onJoin={handleJoinFamily} error={joinError} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-rose-50 flex flex-col font-sans pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur p-4 shadow-sm border-b border-white sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
            <span className="inline-flex w-8 h-8 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white items-center justify-center shadow-md shadow-blue-500/30">
              <ShieldCheck size={18} />
            </span>
            FPIES Beskytter
          </h1>
          <p className="text-xs text-slate-500 font-semibold ml-10">Familiekode: <span className="text-blue-600 tracking-wider">{familyCode}</span></p>
        </div>
        <button onClick={handleLeaveFamily} className="p-2 text-slate-400 hover:text-red-500 rounded-full transition-colors">
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-slate-100 flex justify-around p-2 pb-safe z-20 shadow-[0_-4px_24px_-8px_rgba(15,23,42,0.08)]">
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

function FamilySetup({ onCreate, onJoin, error }) {
  const [joinCode, setJoinCode] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 via-rose-50 to-amber-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white p-8 rounded-3xl shadow-2xl shadow-blue-500/10 w-full max-w-md text-center border border-white">
        <div className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/30">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-800 mb-2">FPIES Beskytter</h1>
        <p className="text-slate-600 mb-8">Synkroniser sikre fødevarer, forbudte lister og 4-dages tests på tværs af enheder med din partner.</p>

        <button
          onClick={onCreate}
          className="w-full bg-gradient-to-br from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-extrabold py-3.5 px-4 rounded-2xl shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mb-6"
        >
          <Plus size={20} /> Opret Ny Familie
        </button>

        <div className="relative flex items-center py-5">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-semibold">ELLER</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Indtast Familiekode"
            className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-center text-lg uppercase tracking-widest focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
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
      className={`flex flex-col items-center justify-center w-24 py-2 transition-all ${active ? 'text-blue-600 scale-105' : 'text-slate-400 hover:text-slate-600'}`}
    >
      <span className={`inline-flex items-center justify-center rounded-2xl p-1.5 mb-0.5 transition-all ${active ? 'bg-gradient-to-br from-blue-100 to-indigo-50 shadow-sm' : ''}`}>
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
      <div className="w-full bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-2xl border border-blue-100 mb-6 flex items-start gap-3 shadow-sm">
        <Info className="text-blue-500 shrink-0 mt-0.5" size={20} />
        <p className="text-sm text-blue-800 font-medium leading-relaxed">
          Tag et billede eller upload en ingrediensliste. AI'en vil lede efter ingredienser, der matcher din Forbudt-liste, og specielt lede efter skjulte majsderivater.
        </p>
      </div>

      {!image && !loading && (
        <div className="flex flex-col gap-4 w-full">
          {/* Main Camera Button */}
          <label className="w-full h-64 bg-gradient-to-br from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 rounded-3xl flex flex-col items-center justify-center text-white transition-all hover:scale-[1.01] shadow-xl shadow-blue-500/30 cursor-pointer">
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
          <label className="w-full py-4 bg-white border-2 border-slate-200 text-slate-600 font-extrabold rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer shadow-sm">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageCapture}
            />
            <ImageIcon size={20} className="text-slate-400" /> Upload Billede fra Galleri
          </label>
        </div>
      )}

      {image && (
        <div className="w-full space-y-4">
          <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm max-h-64 flex justify-center bg-black">
            <img src={image} alt="Scannet etiket" className="object-contain h-64" />
            {loading && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white">
                <ScanLine size={48} className="animate-pulse mb-2 text-blue-400" />
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
                card: 'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200',
                title: 'text-orange-800',
                icon: <Sparkles size={32} className="text-orange-500" />,
                heading: 'Nye ingredienser fundet',
              },
              red: {
                card: 'bg-gradient-to-br from-red-50 to-rose-50 border-red-200',
                title: 'text-red-800',
                icon: <ShieldAlert size={32} className="text-red-500" />,
                heading: 'FARE REGISTRERET',
              },
            }[status];

            return (
              <div className={`p-5 rounded-3xl shadow-md shadow-slate-200/60 border ${palette.card}`}>
                <div className="flex items-center gap-3 mb-3">
                  {palette.icon}
                  <h3 className={`text-xl font-extrabold tracking-tight ${palette.title}`}>{palette.heading}</h3>
                </div>

                <p className="text-slate-700 font-medium mb-4">{result.reasoning}</p>

                {status === 'red' && dangerList.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-bold text-red-800 uppercase tracking-wider block mb-1">På Forbudt-Listen:</span>
                    <div className="flex flex-wrap gap-2">
                      {dangerList.map((ing, idx) => (
                        <span key={idx} className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">{ing}</span>
                      ))}
                    </div>
                  </div>
                )}

                {status !== 'red' && unknownList.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-bold text-orange-800 uppercase tracking-wider block mb-1">Nye / Ikke Testede:</span>
                    <div className="flex flex-wrap gap-2">
                      {unknownList.map((ing, idx) => (
                        <span key={idx} className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-semibold">{ing}</span>
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

                <div className="mt-4 pt-4 border-t border-slate-200/50">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Registrerede Ingredienser:</span>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {result.ingredientsFound?.join(', ')}
                  </p>
                </div>
              </div>
            );
          })()}

          {result?.error && (
             <div className="p-4 bg-orange-50 border border-orange-200 text-orange-800 rounded-xl">
               {result.reasoning}
             </div>
          )}

          {!loading && (
            <div className="flex gap-2">
              <label className="flex-1 bg-white border-2 border-slate-200 text-slate-700 font-bold py-3 px-2 rounded-xl shadow-sm hover:bg-slate-50 flex items-center justify-center gap-2 text-sm cursor-pointer">
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  className="hidden" 
                  onChange={handleImageCapture}
                />
                <Camera size={18} /> Nyt Kamera Scan
              </label>
              <label className="flex-1 bg-white border-2 border-slate-200 text-slate-700 font-bold py-3 px-2 rounded-xl shadow-sm hover:bg-slate-50 flex items-center justify-center gap-2 text-sm cursor-pointer">
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
      <div className="bg-white p-5 rounded-3xl shadow-md shadow-slate-200/60 border border-slate-100">
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800 mb-3">Start 4-Dages Test</h2>
        <form onSubmit={handleAddTrial} className="flex gap-2">
          <input
            type="text"
            placeholder="f.eks. Sød kartoffel"
            value={newFood}
            onChange={(e) => setNewFood(e.target.value)}
            className="flex-1 border-2 border-slate-200 rounded-2xl px-4 py-2.5 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
          />
          <button
            type="submit"
            disabled={!newFood.trim()}
            className="bg-gradient-to-br from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 text-white p-2.5 rounded-2xl shadow-md shadow-blue-500/30 transition-all"
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
            <div key={trial.id} className="bg-white p-4 rounded-3xl shadow-md shadow-slate-200/60 border border-slate-100">
              <div className="flex justify-between items-start mb-4">
                <h4 className="text-lg font-bold text-slate-800">{trial.foodName}</h4>
                {confirmFail === trial.id ? (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleFailTrial(trial)}
                      className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg shadow-sm"
                    >
                      Bekræft
                    </button>
                    <button 
                      onClick={() => setConfirmFail(null)}
                      className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg shadow-sm"
                    >
                      Fortryd
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setConfirmFail(trial.id)}
                    className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
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
                          ${isPassed ? 'bg-emerald-500 text-white shadow-emerald-200 hover:bg-emerald-600' : 
                            isNext ? 'bg-blue-100 text-blue-700 border-2 border-blue-500 hover:bg-blue-200 scale-110' : 
                            'bg-slate-50 text-slate-300 border border-slate-200'}`}
                      >
                        {isPassed ? <CheckCircle size={20} /> : day}
                      </button>
                      <span className={`text-[10px] font-bold uppercase ${isPassed ? 'text-emerald-600' : isNext ? 'text-blue-600' : 'text-slate-400'}`}>
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
            <div key={trial.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between opacity-70">
              <span className="font-medium text-slate-700">{trial.foodName}</span>
              {trial.status === 'passed' ? (
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">Godkendt til Sikker</span>
              ) : (
                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">Fejlet til Forbudt</span>
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
    ? 'bg-gradient-to-br from-rose-500 to-red-500 hover:from-rose-600 hover:to-red-600'
    : 'bg-gradient-to-br from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600';

  return (
    <div className="max-w-md mx-auto flex flex-col h-full">
      {/* Tabs */}
      <div className="flex bg-white/70 backdrop-blur p-1 rounded-2xl mb-4 shadow-sm shadow-slate-200/60 border border-white">
        <button
          onClick={() => setActiveList('danger')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-xl transition-all ${activeList === 'danger' ? 'bg-gradient-to-br from-rose-100 to-red-50 text-rose-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Forbudt Liste
        </button>
        <button
          onClick={() => setActiveList('safe')}
          className={`flex-1 py-2.5 text-sm font-extrabold rounded-xl transition-all ${activeList === 'safe' ? 'bg-gradient-to-br from-emerald-100 to-teal-50 text-emerald-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Sikker Liste
        </button>
      </div>

      {/* Toolbar: sort + copy */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-white rounded-xl border border-slate-200 px-2 py-1.5 shadow-sm">
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
            className="flex items-center gap-1.5 bg-white rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 shadow-sm"
          >
            <Copy size={14} /> Kopier
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {copyMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
              <button onClick={() => copyList('plain')} className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                Almindelig tekst
              </button>
              <button onClick={() => copyList('markdown')} className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100">
                Markdown (til LLM-chat)
              </button>
            </div>
          )}
          {copiedToast && (
            <span className="absolute right-0 top-full mt-2 bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-lg z-30 whitespace-nowrap">
              Kopieret!
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
          className="flex-1 border-2 border-slate-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none shadow-sm bg-white"
        />
        <button
          type="submit"
          disabled={!newItem.trim()}
          className={`px-5 rounded-2xl font-extrabold text-white shadow-lg shadow-slate-200 disabled:opacity-50 transition-all ${accentBtn}`}
        >
          <Plus size={20} />
        </button>
      </form>

      {/* List */}
      <div className="flex-1 bg-white rounded-3xl shadow-md shadow-slate-200/60 border border-slate-100 overflow-hidden">
        <div className="h-full overflow-y-auto p-3 space-y-1.5">
          {sortedList.length === 0 ? (
            <p className="text-center text-slate-400 py-12 font-medium">Ingen madvarer på denne liste endnu.</p>
          ) : (
            sortedList.map((food) => {
              const dateLabel = food.addedAt
                ? new Date(food.addedAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';
              return (
                <div key={food.name} className="flex justify-between items-center p-3 hover:bg-slate-50 border border-slate-100 rounded-2xl group transition-colors">
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
                        className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg shadow-sm"
                      >
                        Slet
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg shadow-sm"
                      >
                        Fortryd
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(food.name)}
                      className="text-slate-300 hover:text-red-500 p-1 rounded-md transition-colors"
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
