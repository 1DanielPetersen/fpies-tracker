import React, { useState, useEffect, useRef } from 'react';
import { Camera, List, ShieldCheck, ShieldAlert, Plus, CheckCircle, XCircle, Info, ScanLine, LogOut, Users, Image as ImageIcon } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';

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
const GEMINI_API_KEY = ""; 

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
    
    const initialData = {
      createdAt: new Date().toISOString(),
      safeFoods: [],
      dangerFoods: [
        "Majsmel (Cornmeal)", 
        "Hirse (Millet)", 
        "Majs (Corn)",
        "Majsstivelse (Corn Starch)",
        "Glukosesirup (Glucose Syrup)",
        "Maltodextrin",
        "Dextrose"
      ],
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
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans pb-20">
      {/* Header */}
      <header className="bg-white p-4 shadow-sm border-b sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-800">FPIES Beskytter</h1>
          <p className="text-xs text-slate-500 font-medium">Familiekode: <span className="text-blue-600 tracking-wider">{familyCode}</span></p>
        </div>
        <button onClick={handleLeaveFamily} className="p-2 text-slate-400 hover:text-red-500 rounded-full">
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 pb-safe z-20">
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
    <div className="min-h-screen bg-blue-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center">
        <div className="bg-blue-100 text-blue-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">FPIES Beskytter</h1>
        <p className="text-slate-600 mb-8">Synkroniser sikre fødevarer, forbudte lister og 4-dages tests på tværs af enheder med din partner.</p>
        
        <button 
          onClick={onCreate}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 mb-6"
        >
          <Plus size={20} /> Opret Ny Familie
        </button>

        <div className="relative flex items-center py-5">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink-0 mx-4 text-slate-400 text-sm">ELLER</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <div className="space-y-3">
          <input 
            type="text" 
            placeholder="Indtast Familiekode" 
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-center text-lg uppercase tracking-widest focus:ring-2 focus:ring-blue-500 outline-none"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
          <button 
            onClick={() => onJoin(joinCode)}
            disabled={!joinCode.trim()}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
      className={`flex flex-col items-center justify-center w-24 py-2 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
    >
      {React.cloneElement(icon, { size: 24, className: 'mb-1' })}
      <span className="text-[10px] font-semibold">{label}</span>
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
    
    // Construct the danger list for the prompt
    const dangerListString = familyData.dangerFoods.join(", ");

    const prompt = `
      You are an expert in pediatric FPIES (Food Protein-Induced Enterocolitis Syndrome). 
      Here is an image of an ingredient label, likely in Danish or English.
      
      The baby's STRICT DANGER LIST is: ${dangerListString}.
      
      CRITICAL INSTRUCTION: You must intensely scan for ANY hidden corn derivatives. In Danish, this includes (but is not limited to): Majs, Majsmel, Majsstivelse, Maltodextrin, Glukosesirup, Dextrose, Modificeret stivelse (if source unknown, flag it). Also look for Hirse (Millet).
      
      Extract the ingredients and check if any ingredient from the danger list or any corn derivative is present.
      
      Respond ONLY with a valid JSON object matching this schema exactly:
      {
        "ingredientsFound": ["list", "of", "all", "extracted", "ingredients"],
        "isSafe": boolean (true if NO dangers found, false if ANY danger/derivative is found),
        "flaggedIngredients": ["list", "of", "ingredients", "that", "triggered", "the", "warning"],
        "reasoning": "A short, clear sentence IN DANISH explaining the result (e.g. 'Maltodextrin er et majsderivat.')"
      }
    `;

    try {
      const fetchWithRetry = async (retries = 3) => {
        const payload = {
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("API Request Failed");
        return await response.json();
      };

      const data = await fetchWithRetry();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
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
      <div className="w-full bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6 flex items-start gap-3">
        <Info className="text-blue-500 shrink-0 mt-0.5" size={20} />
        <p className="text-sm text-blue-800">
          Tag et billede eller upload en ingrediensliste. AI'en vil lede efter ingredienser, der matcher din Forbudt-liste, og specielt lede efter skjulte majsderivater.
        </p>
      </div>

      {!image && !loading && (
        <div className="flex flex-col gap-4 w-full">
          {/* Main Camera Button */}
          <label className="w-full h-64 bg-slate-100 hover:bg-slate-200 border-4 border-dashed border-slate-300 rounded-3xl flex flex-col items-center justify-center text-slate-500 transition-colors cursor-pointer">
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              className="hidden" 
              onChange={handleImageCapture}
            />
            <Camera size={64} className="mb-4 text-slate-400" />
            <span className="font-semibold text-lg">Åbn Kamera for at Scanne</span>
          </label>
          
          {/* Secondary Gallery Button */}
          <label className="w-full py-4 bg-white border-2 border-slate-200 text-slate-600 font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors cursor-pointer">
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

          {result && !result.error && (
            <div className={`p-5 rounded-2xl shadow-sm border ${result.isSafe ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-3 mb-3">
                {result.isSafe ? (
                  <ShieldCheck size={32} className="text-emerald-500" />
                ) : (
                  <ShieldAlert size={32} className="text-red-500" />
                )}
                <h3 className={`text-xl font-bold ${result.isSafe ? 'text-emerald-800' : 'text-red-800'}`}>
                  {result.isSafe ? 'Ser Sikker Ud' : 'FARE REGISTRERET'}
                </h3>
              </div>
              
              <p className="text-slate-700 font-medium mb-4">{result.reasoning}</p>

              {!result.isSafe && result.flaggedIngredients?.length > 0 && (
                <div className="mb-4">
                  <span className="text-xs font-bold text-red-800 uppercase tracking-wider block mb-1">Markerede Ingredienser:</span>
                  <div className="flex flex-wrap gap-2">
                    {result.flaggedIngredients.map((ing, idx) => (
                      <span key={idx} className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">{ing}</span>
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
          )}

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
      await updateTrial(trial.id, { daysPassed: 4, status: 'passed' }, {
        safeFoods: arrayUnion(trial.foodName)
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
    await updateTrial(trial.id, { status: 'failed' }, {
      dangerFoods: arrayUnion(trial.foodName)
    });
    setConfirmFail(null);
  };

  const activeTrials = familyData.trials.filter(t => t.status === 'active');
  const pastTrials = familyData.trials.filter(t => t.status !== 'active').slice(-5); // Show last 5

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-800 mb-3">Start 4-Dages Test</h2>
        <form onSubmit={handleAddTrial} className="flex gap-2">
          <input 
            type="text" 
            placeholder="f.eks. Sød kartoffel" 
            value={newFood}
            onChange={(e) => setNewFood(e.target.value)}
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button 
            type="submit"
            disabled={!newFood.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white p-2 rounded-xl"
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
            <div key={trial.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
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

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;

    const targetList = activeList === 'danger' ? 'dangerFoods' : 'safeFoods';
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    
    await updateDoc(docRef, {
      [targetList]: arrayUnion(newItem.trim())
    });
    setNewItem('');
  };

  const removeFood = async (food, listType) => {
    const targetList = listType === 'danger' ? 'dangerFoods' : 'safeFoods';
    const updatedList = familyData[targetList].filter(item => item !== food);
    
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'families', familyCode);
    await updateDoc(docRef, {
      [targetList]: updatedList
    });
    setConfirmRemove(null);
  };

  const displayList = activeList === 'danger' ? familyData.dangerFoods : familyData.safeFoods;

  return (
    <div className="max-w-md mx-auto flex flex-col h-full">
      <div className="flex bg-slate-200 p-1 rounded-xl mb-6">
        <button 
          onClick={() => setActiveList('danger')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeList === 'danger' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
        >
          Forbudt Liste
        </button>
        <button 
          onClick={() => setActiveList('safe')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeList === 'safe' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
        >
          Sikker Liste
        </button>
      </div>

      <form onSubmit={handleAddItem} className="mb-4 flex gap-2">
        <input 
          type="text" 
          placeholder={`Tilføj til ${activeList === 'danger' ? 'Forbudt' : 'Sikker'} liste...`}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          className="flex-1 border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
        />
        <button 
          type="submit"
          disabled={!newItem.trim()}
          className={`px-4 rounded-xl font-bold text-white shadow-sm disabled:opacity-50 transition-colors
            ${activeList === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          Tilføj
        </button>
      </form>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="h-full overflow-y-auto p-4 space-y-2">
          {displayList.length === 0 ? (
            <p className="text-center text-slate-400 py-8">Ingen madvarer på denne liste endnu.</p>
          ) : (
            displayList.map((food, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 hover:bg-slate-50 border border-slate-100 rounded-xl group">
                <span className="font-medium text-slate-700">{food}</span>
                {confirmRemove === food ? (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => removeFood(food, activeList)}
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
                    onClick={() => setConfirmRemove(food)}
                    className="text-slate-300 hover:text-red-500 p-1 rounded-md transition-colors"
                  >
                    <XCircle size={18} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
