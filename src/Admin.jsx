import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, List, Eye, Check, Loader2, ArrowLeft, Lock, Trophy, Flag, Users, Megaphone, Home, LayoutGrid, FileText, Edit3, RefreshCw, Gift, Save } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const ADMIN_EMAILS = ['haikuquizofficial@gmail.com'];

const formatDateTime = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('it-IT');
};

const formatDateForInput = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().split('T')[0];
};

const formatTimeForInput = (ts) => {
  if (!ts) return '09:00';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toTimeString().slice(0, 5);
};

const compareAnswers = (a, b) => {
  if (!a || !b) return false;
  return a.trim() === b.trim();
};

// Calcola bonus in base al numero di risposte corrette
const getBonusPoints = (correctCount, riddle) => {
  const bonus = riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 };
  if (correctCount === 1) return bonus.uno || 0;
  if (correctCount >= 2 && correctCount <= 5) return bonus.finoCinque || 0;
  if (correctCount >= 6 && correctCount <= 10) return bonus.seiDieci || 0;
  return 0;
};

// Funzione per ricalcolare i punti di un indovinello
const recalculateRiddlePoints = async (riddleId, riddle, onLog) => {
  const log = onLog || console.log;
  
  try {
    log(`\n📝 Ricalcolo: "${riddle.titolo}"`);
    log(`   Risposta corretta: "${riddle.risposta}"`);
    
    const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
    const answers = [];
    answersSnap.forEach(d => answers.push({ id: d.id, ref: d.ref, ...d.data() }));
    
    log(`   Risposte totali: ${answers.length}`);
    
    if (answers.length === 0) {
      log(`   ⚠️ Nessuna risposta trovata`);
      await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, correctCount: 0 });
      return { success: true, processed: 0 };
    }
    
    answers.sort((a, b) => {
      const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0);
      const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0);
      return timeA - timeB;
    });
    
    const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
    const getPoints = (pos) => {
      if (pos === 0) return punti.primo;
      if (pos === 1) return punti.secondo;
      if (pos === 2) return punti.terzo;
      return punti.altri;
    };
    
    // Prima conta le risposte corrette per calcolare il bonus
    const correctAnswers = answers.filter(ans => compareAnswers(ans.answer, riddle.risposta));
    const correctCount = correctAnswers.length;
    const bonus = getBonusPoints(correctCount, riddle);
    
    log(`   Risposte corrette: ${correctCount}, Bonus applicato: +${bonus}`);
    
    // Rimuovi vecchi punti
    if (riddle.competitionId) {
      const oldAnswersWithPoints = answers.filter(a => a.points > 0);
      for (const oldAns of oldAnswersWithPoints) {
        const oderId = oldAns.userId || oldAns.oderId;
        const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`);
        const scoreDoc = await getDoc(scoreRef);
        if (scoreDoc.exists()) {
          const currentPoints = scoreDoc.data().points || 0;
          const newPoints = Math.max(0, currentPoints - oldAns.points);
          await updateDoc(scoreRef, { points: newPoints });
          log(`   🔄 Rimossi ${oldAns.points} punti da utente ${oderId}`);
        }
      }
    }
    
    // Assegna nuovi punti
    let correctPosition = 0;
    const updates = [];
    
    for (let i = 0; i < answers.length; i++) {
      const ans = answers[i];
      const isCorrect = compareAnswers(ans.answer, riddle.risposta);
      let points = 0;
      let ansBonus = 0;
      
      if (isCorrect) {
        ansBonus = bonus;
        points = getPoints(correctPosition) + ansBonus;
        log(`   ✅ #${i + 1} "${ans.answer}" - CORRETTO (pos ${correctPosition + 1}) → ${points} punti (base + ${ansBonus} bonus)`);
        correctPosition++;
      } else {
        log(`   ❌ #${i + 1} "${ans.answer}" - ERRATO → 0 punti`);
      }
      
      updates.push({
        ref: ans.ref,
        oderId: ans.userId || ans.oderId,
        points,
        isCorrect,
        bonus: ansBonus
      });
    }
    
    for (const upd of updates) {
      await updateDoc(upd.ref, { points: upd.points, isCorrect: upd.isCorrect, bonus: upd.bonus });
    }
    
    if (riddle.competitionId) {
      for (const upd of updates) {
        if (upd.points > 0) {
          const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${upd.oderId}`);
          const scoreDoc = await getDoc(scoreRef);
          if (scoreDoc.exists()) {
            const currentPoints = scoreDoc.data().points || 0;
            await updateDoc(scoreRef, { points: currentPoints + upd.points });
            log(`   📊 Aggiunti ${upd.points} punti a utente ${upd.oderId}`);
          }
        }
      }
    }
    
    await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, processedAt: serverTimestamp(), correctCount });
    
    log(`   ✅ Completato! ${correctPosition} risposte corrette`);
    return { success: true, processed: answers.length, correct: correctPosition };
    
  } catch (e) {
    log(`   ❌ ERRORE: ${e.message}`);
    console.error('Errore ricalcolo:', e);
    return { success: false, error: e.message };
  }
};

// Salvataggio stato navigazione admin
const saveAdminNavState = (state) => {
  try {
    sessionStorage.setItem('haikuAdminNavState', JSON.stringify({
      ...state,
      timestamp: Date.now()
    }));
  } catch (e) {}
};

const loadAdminNavState = () => {
  try {
    const saved = sessionStorage.getItem('haikuAdminNavState');
    if (!saved) return null;
    const state = JSON.parse(saved);
    if (Date.now() - state.timestamp > 3600000) {
      sessionStorage.removeItem('haikuAdminNavState');
      return null;
    }
    return state;
  } catch (e) {
    return null;
  }
};

const AdminBottomNav = ({ activeTab, setActiveTab }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 z-50">
    <div className="max-w-4xl mx-auto flex justify-around">
      {[
        { id: 'dashboard', icon: Home, label: 'Home' },
        { id: 'competitions', icon: Flag, label: 'Gare' },
        { id: 'riddles', icon: LayoutGrid, label: 'Quiz' },
        { id: 'announcements', icon: Megaphone, label: 'Avvisi' },
        { id: 'users', icon: Users, label: 'Utenti' },
      ].map(tab => (
        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center px-2 py-1 rounded-lg ${activeTab === tab.id ? 'text-purple-600' : 'text-gray-500'}`}>
          <tab.icon size={22} /><span className="text-xs mt-1">{tab.label}</span>
        </button>
      ))}
    </div>
  </div>
);

const RichTextEditor = ({ editorRef, placeholder, initialContent }) => {
  useEffect(() => {
    if (editorRef.current && initialContent !== undefined) {
      editorRef.current.innerHTML = initialContent;
    }
  }, [initialContent, editorRef]);

  return (
    <div className="mb-3">
      <div className="flex gap-2 mb-2">
        {[['bold', Bold], ['italic', Italic], ['insertUnorderedList', List]].map(([cmd, Icon]) => (
          <button key={cmd} type="button" onClick={() => { editorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded-lg hover:bg-gray-100"><Icon size={16} /></button>
        ))}
      </div>
      <div ref={editorRef} contentEditable className="w-full min-h-24 px-4 py-3 border-2 border-gray-200 rounded-xl bg-white focus:outline-none focus:border-purple-500" data-placeholder={placeholder} />
    </div>
  );
};

const BonusPointsEditor = ({ bonus, onChange, label }) => (
  <div className="p-3 bg-green-50 rounded-xl border border-green-200">
    <p className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
      <Gift size={16} /> {label || 'Bonus pochi rispondenti'}
    </p>
    <div className="grid grid-cols-3 gap-2">
      <div>
        <label className="text-xs text-green-600">Solo 1</label>
        <input 
          type="number" 
          min="0" 
          value={bonus.uno} 
          onChange={e => onChange({ ...bonus, uno: parseInt(e.target.value) || 0 })} 
          className="w-full px-2 py-2 border rounded text-center text-sm" 
        />
      </div>
      <div>
        <label className="text-xs text-green-600">Max 5</label>
        <input 
          type="number" 
          min="0" 
          value={bonus.finoCinque} 
          onChange={e => onChange({ ...bonus, finoCinque: parseInt(e.target.value) || 0 })} 
          className="w-full px-2 py-2 border rounded text-center text-sm" 
        />
      </div>
      <div>
        <label className="text-xs text-green-600">6-10</label>
        <input 
          type="number" 
          min="0" 
          value={bonus.seiDieci} 
          onChange={e => onChange({ ...bonus, seiDieci: parseInt(e.target.value) || 0 })} 
          className="w-full px-2 py-2 border rounded text-center text-sm" 
        />
      </div>
    </div>
    <p className="text-xs text-green-600 mt-2">Più di 10 risposte corrette = nessun bonus</p>
  </div>
);

const RiddleAnswersView = ({ riddle, answers, users, onBack, onRecalculate, recalculating }) => {
  const sorted = [...answers].sort((a, b) => {
    const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0);
    const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0);
    return timeA - timeB;
  });
  // Crea una mappa che supporta sia oderId che id come chiave
  const userMap = {};
  users.forEach(u => {
    if (u.oderId) userMap[u.oderId] = u.username;
    if (u.id) userMap[u.id] = u.username;
    if (u.userId) userMap[u.userId] = u.username;
  });
  const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
  const bonus = riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 };
  const hasBonus = bonus.uno > 0 || bonus.finoCinque > 0 || bonus.seiDieci > 0;
  
  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700 flex-1">{riddle.titolo}</h3>
        <button 
          onClick={() => onRecalculate(riddle)} 
          disabled={recalculating}
          className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-xl hover:bg-orange-200 disabled:opacity-50"
        >
          <RefreshCw size={16} className={recalculating ? 'animate-spin' : ''} />
          {recalculating ? 'Ricalcolo...' : 'Ricalcola'}
        </button>
      </div>
      <div className="mb-4 p-4 bg-gray-50 rounded-xl border">
        <p className="text-xs text-gray-500 mb-2 font-semibold uppercase">Domanda:</p>
        <div className="text-gray-800" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
      </div>
      <div className="mb-4 p-4 bg-purple-50 rounded-xl">
        <p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p>
        <p className="text-xs text-gray-500 mt-1">Punti base: 1° {punti.primo} | 2° {punti.secondo} | 3° {punti.terzo} | Altri {punti.altri}</p>
        {hasBonus && (
          <p className="text-xs text-green-600 mt-1">Bonus: Solo 1 +{bonus.uno} | Max 5 +{bonus.finoCinque} | 6-10 +{bonus.seiDieci}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">Periodo: {formatDateTime(riddle.dataInizio)} → {formatDateTime(riddle.dataFine)}</p>
        {riddle.correctCount !== undefined && (
          <p className="text-xs text-blue-600 mt-1">Risposte corrette: {riddle.correctCount}</p>
        )}
        <p className="text-xs mt-2">
          Stato: {riddle.pointsAssigned ? 
            <span className="text-green-600 font-medium">✅ Punti assegnati</span> : 
            <span className="text-yellow-600 font-medium">⏳ In attesa</span>
          }
        </p>
      </div>
      <h4 className="font-semibold text-gray-700 mb-3">Risposte ({sorted.length})</h4>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            const oderId = ans.userId || ans.oderId;
            return (
              <div key={ans.id} className={`p-3 rounded-xl border ${correct ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-500 text-white' : 'bg-gray-200'}`}>{i + 1}</span>
                    <div>
                      <span className="font-medium">{userMap[oderId] || 'Utente'}</span>
                      <p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p>
                      <p className={`text-sm ${correct ? 'text-green-700 font-medium' : 'text-red-600'}`}>"{ans.answer}"</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold text-lg ${ans.points > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {ans.points > 0 ? `+${ans.points}` : '0'}
                    </span>
                    {ans.bonus > 0 && (
                      <p className="text-xs text-green-500">incl. +{ans.bonus} bonus</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const UserEditModal = ({ user, onClose, onSave, saving }) => {
  const [newUsername, setNewUsername] = useState(user?.username || '');
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full">
        <h3 className="text-lg font-bold mb-4">Modifica utente</h3>
        <div className="mb-4">
          <label className="text-sm text-gray-600 mb-1 block">Username</label>
          <input 
            type="text" 
            value={newUsername} 
            onChange={e => setNewUsername(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl"
          />
        </div>
        <p className="text-xs text-gray-500 mb-4">Email: {user?.email}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button>
          <button 
            onClick={() => onSave(user.id, newUsername)} 
            disabled={saving || newUsername.trim().length < 3}
            className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <><Save size={18} /> Salva</>}
          </button>
        </div>
      </div>
    </div>
  );
};

const Admin = () => {
  const savedState = useRef(loadAdminNavState());
  
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [competitions, setCompetitions] = useState([]);
  const [riddles, setRiddles] = useState([]);
  const [users, setUsers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [competitionScores, setCompetitionScores] = useState([]);
  const [activeTab, setActiveTab] = useState(savedState.current?.activeTab || 'dashboard');
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [editingCompetition, setEditingCompetition] = useState(null);
  const [editingRiddle, setEditingRiddle] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [newCompetition, setNewCompetition] = useState({ nome: '', descrizione: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', competitionId: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntoPrimo: 3, puntoSecondo: 1, puntoTerzo: 1, puntoAltri: 1, bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newAnnouncement, setNewAnnouncement] = useState({ titolo: '' });
  const [showPuntiCustom, setShowPuntiCustom] = useState(false);
  const [showBonusCustom, setShowBonusCustom] = useState(false);
  const [showEditPuntiCustom, setShowEditPuntiCustom] = useState(false);
  const [showEditBonusCustom, setShowEditBonusCustom] = useState(false);
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcLog, setRecalcLog] = useState([]);
  
  const riddleEditorRef = useRef(null);
  const editRiddleEditorRef = useRef(null);
  const announcementEditorRef = useRef(null);
  const regolamentoEditorRef = useRef(null);

  const showMsg = (msg, dur = 3000) => { setMessage(msg); if (dur > 0) setTimeout(() => setMessage(''), dur); };

  // Salva stato navigazione
  useEffect(() => {
    if (isAdmin) {
      saveAdminNavState({
        activeTab,
        selectedCompetitionId: selectedCompetition?.id || null
      });
    }
  }, [activeTab, selectedCompetition, isAdmin]);

  // Ripristina stato navigazione
  useEffect(() => {
    if (isAdmin && competitions.length > 0 && savedState.current?.selectedCompetitionId) {
      const comp = competitions.find(c => c.id === savedState.current.selectedCompetitionId);
      if (comp && !selectedCompetition) {
        setSelectedCompetition(comp);
      }
    }
  }, [isAdmin, competitions]);

  useEffect(() => { return onAuthStateChanged(auth, (u) => { if (u && ADMIN_EMAILS.includes(u.email)) { setUser(u); setIsAdmin(true); } else { setUser(null); setIsAdmin(false); } setLoading(false); }); }, []);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => { setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'riddles'), orderBy('dataInizio', 'desc')), (snap) => { setRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (snap) => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), (snap) => { setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }); }, [isAdmin]);
  useEffect(() => { if (!isAdmin || !selectedCompetition) { setCompetitionScores([]); return; } return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => { setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }); }, [isAdmin, selectedCompetition]);

  const handleLogin = async () => { if (authLoading) return; setAuthLoading(true); try { const cred = await signInWithEmailAndPassword(auth, email, password); if (!ADMIN_EMAILS.includes(cred.user.email)) { await signOut(auth); showMsg('Accesso non autorizzato'); } } catch { showMsg('Credenziali errate'); } finally { setAuthLoading(false); } };

  const handleRecalculatePoints = async (riddle) => {
    setRecalculating(true);
    setRecalcLog([]);
    
    const logs = [];
    const logFn = (msg) => {
      logs.push(msg);
      setRecalcLog([...logs]);
    };
    
    try {
      const result = await recalculateRiddlePoints(riddle.id, riddle, logFn);
      
      if (result.success) {
        showMsg(`✅ Punti ricalcolati! ${result.correct || 0} risposte corrette su ${result.processed || 0}`);
        const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
        setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        const riddleDoc = await getDoc(doc(db, 'riddles', riddle.id));
        if (riddleDoc.exists()) {
          setViewingRiddle({ id: riddleDoc.id, ...riddleDoc.data() });
        }
      } else {
        showMsg(`❌ Errore: ${result.error}`);
      }
    } catch (e) {
      showMsg(`❌ Errore: ${e.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  const handleAddCompetition = async () => {
    if (!newCompetition.nome || !newCompetition.dataInizio || !newCompetition.dataFine) { showMsg('Compila tutti i campi'); return; }
    const regolamento = regolamentoEditorRef.current?.innerHTML || '';
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'competitions')), { 
        nome: newCompetition.nome, 
        descrizione: newCompetition.descrizione || '', 
        regolamento, 
        dataInizio: Timestamp.fromDate(new Date(newCompetition.dataInizio)), 
        dataFine: Timestamp.fromDate(new Date(newCompetition.dataFine)), 
        bonusPunti: newCompetition.bonusPunti,
        participantsCount: 0, 
        createdAt: serverTimestamp() 
      });
      setNewCompetition({ nome: '', descrizione: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
      if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = '';
      showMsg('✅ Competizione creata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleUpdateCompetition = async () => {
    if (!editingCompetition) return;
    const regolamento = regolamentoEditorRef.current?.innerHTML || '';
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'competitions', editingCompetition.id), { 
        nome: editingCompetition.nome, 
        descrizione: editingCompetition.descrizione || '', 
        regolamento,
        bonusPunti: editingCompetition.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 }
      });
      setEditingCompetition(null);
      showMsg('✅ Competizione aggiornata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleAddRiddle = async () => {
    const domanda = riddleEditorRef.current?.innerHTML || '';
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.competitionId || !newRiddle.dataInizio || !newRiddle.dataFine) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
      const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
      
      // Prendi i bonus dalla gara se non specificati
      const comp = competitions.find(c => c.id === newRiddle.competitionId);
      const bonusPunti = (newRiddle.bonusPunti.uno > 0 || newRiddle.bonusPunti.finoCinque > 0 || newRiddle.bonusPunti.seiDieci > 0) 
        ? newRiddle.bonusPunti 
        : (comp?.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 });
      
      await setDoc(doc(collection(db, 'riddles')), { 
        titolo: newRiddle.titolo, 
        domanda, 
        risposta: newRiddle.risposta.trim(), 
        competitionId: newRiddle.competitionId, 
        dataInizio: Timestamp.fromDate(start), 
        dataFine: Timestamp.fromDate(end), 
        punti: { 
          primo: parseInt(newRiddle.puntoPrimo) || 3, 
          secondo: parseInt(newRiddle.puntoSecondo) || 1, 
          terzo: parseInt(newRiddle.puntoTerzo) || 1, 
          altri: parseInt(newRiddle.puntoAltri) || 1 
        }, 
        bonusPunti,
        pointsAssigned: false, 
        createdAt: serverTimestamp() 
      });
      setNewRiddle({ ...newRiddle, titolo: '', risposta: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
      if (riddleEditorRef.current) riddleEditorRef.current.innerHTML = '';
      showMsg('✅ Indovinello creato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleUpdateRiddle = async () => {
    if (!editingRiddle) return;
    const domanda = editRiddleEditorRef.current?.innerHTML || '';
    if (!editingRiddle.titolo || !domanda || !editingRiddle.risposta) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const start = new Date(`${editingRiddle.dataInizio}T${editingRiddle.oraInizio}:00`);
      const end = new Date(`${editingRiddle.dataFine}T${editingRiddle.oraFine}:00`);
      await updateDoc(doc(db, 'riddles', editingRiddle.id), { 
        titolo: editingRiddle.titolo, 
        domanda, 
        risposta: editingRiddle.risposta.trim(), 
        competitionId: editingRiddle.competitionId, 
        dataInizio: Timestamp.fromDate(start), 
        dataFine: Timestamp.fromDate(end), 
        punti: { 
          primo: parseInt(editingRiddle.puntoPrimo) || 3, 
          secondo: parseInt(editingRiddle.puntoSecondo) || 1, 
          terzo: parseInt(editingRiddle.puntoTerzo) || 1, 
          altri: parseInt(editingRiddle.puntoAltri) || 1 
        },
        bonusPunti: editingRiddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 }
      });
      setEditingRiddle(null);
      setShowEditPuntiCustom(false);
      setShowEditBonusCustom(false);
      showMsg('✅ Indovinello aggiornato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const startEditRiddle = (riddle) => {
    const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
    const bonus = riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 };
    setEditingRiddle({ 
      ...riddle, 
      dataInizio: formatDateForInput(riddle.dataInizio), 
      oraInizio: formatTimeForInput(riddle.dataInizio), 
      dataFine: formatDateForInput(riddle.dataFine), 
      oraFine: formatTimeForInput(riddle.dataFine), 
      puntoPrimo: punti.primo, 
      puntoSecondo: punti.secondo, 
      puntoTerzo: punti.terzo, 
      puntoAltri: punti.altri,
      bonusPunti: bonus
    });
    setShowEditPuntiCustom(false);
    setShowEditBonusCustom(false);
  };

  const handleAddAnnouncement = async () => {
    const messaggio = announcementEditorRef.current?.innerHTML || '';
    if (!newAnnouncement.titolo || !messaggio.trim()) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'announcements')), { titolo: newAnnouncement.titolo, messaggio, createdAt: serverTimestamp() });
      setNewAnnouncement({ titolo: '' });
      if (announcementEditorRef.current) announcementEditorRef.current.innerHTML = '';
      showMsg('✅ Comunicazione inviata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleUpdateUser = async (userId, newUsername) => {
    if (!userId || newUsername.trim().length < 3) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'users', userId), { username: newUsername.trim() });
      
      // Aggiorna anche nei punteggi delle competizioni
      const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('userId', '==', userId)));
      for (const scoreDoc of scoresSnap.docs) {
        await updateDoc(scoreDoc.ref, { username: newUsername.trim() });
      }
      
      setEditingUser(null);
      showMsg('✅ Utente aggiornato!');
    } catch (e) { 
      showMsg('Errore: ' + e.message); 
    } finally { 
      setSubmitting(false); 
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSubmitting(true);
    try {
      if (confirmDelete.type === 'competition') {
        const riddlesSnap = await getDocs(query(collection(db, 'riddles'), where('competitionId', '==', confirmDelete.id)));
        for (const r of riddlesSnap.docs) { const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); for (const a of answersSnap.docs) await deleteDoc(a.ref); await deleteDoc(r.ref); }
        const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', confirmDelete.id)));
        for (const s of scoresSnap.docs) await deleteDoc(s.ref);
        await deleteDoc(doc(db, 'competitions', confirmDelete.id));
        if (selectedCompetition?.id === confirmDelete.id) setSelectedCompetition(null);
      } else if (confirmDelete.type === 'riddle') {
        const riddle = riddles.find(r => r.id === confirmDelete.id);
        const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', confirmDelete.id)));
        for (const d of snap.docs) { const ans = d.data(); if (ans.points > 0 && riddle?.competitionId) { const oderId = ans.userId || ans.oderId; const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - ans.points) }); } await deleteDoc(d.ref); }
        await deleteDoc(doc(db, 'riddles', confirmDelete.id));
      } else if (confirmDelete.type === 'user') {
        const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', confirmDelete.id)));
        for (const d of answersSnap.docs) await deleteDoc(d.ref);
        const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('userId', '==', confirmDelete.id)));
        for (const d of scoresSnap.docs) await deleteDoc(d.ref);
        await deleteDoc(doc(db, 'users', confirmDelete.id));
      } else if (confirmDelete.type === 'announcement') { await deleteDoc(doc(db, 'announcements', confirmDelete.id)); }
      showMsg('✅ Eliminato');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); setConfirmDelete(null); }
  };

  const viewAnswers = async (r) => { 
    setViewingRiddle(r); 
    setRecalcLog([]);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); 
    setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); 
  };
  
  const startEditCompetition = (comp) => { 
    setEditingCompetition({ 
      ...comp,
      bonusPunti: comp.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 }
    }); 
    setTimeout(() => { if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = comp.regolamento || ''; }, 100); 
  };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (!isAdmin) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6"><div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Lock size={32} className="text-purple-600" /></div><h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1></div>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4" />
        <button onClick={handleLogin} disabled={authLoading} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{authLoading ? <Loader2 size={20} className="animate-spin" /> : 'Accedi'}</button>
        {message && <p className="mt-4 text-center text-red-600">{message}</p>}
      </div>
    </div>
  );

  if (viewingRiddle) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <RiddleAnswersView 
          riddle={viewingRiddle} 
          answers={riddleAnswers} 
          users={[...users, ...competitionScores]} 
          onBack={() => { setViewingRiddle(null); setRecalcLog([]); }}
          onRecalculate={handleRecalculatePoints}
          recalculating={recalculating}
        />
        {recalcLog.length > 0 && (
          <div className="mt-4 bg-gray-900 text-green-400 p-4 rounded-xl font-mono text-xs max-h-60 overflow-y-auto">
            {recalcLog.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        )}
      </div>
    </div>
  );

  if (editingRiddle) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6"><button onClick={() => { setEditingRiddle(null); setShowEditPuntiCustom(false); setShowEditBonusCustom(false); }} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold text-gray-800">Modifica Indovinello</h2>{editingRiddle.pointsAssigned && <span className="ml-auto text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full">⚠️ Quiz già concluso</span>}</div>
          <select value={editingRiddle.competitionId} onChange={e => setEditingRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Seleziona gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          <input type="text" placeholder="Titolo *" value={editingRiddle.titolo} onChange={e => setEditingRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
          <div className="mb-3"><label className="text-sm text-gray-600 mb-2 block">Domanda *</label><RichTextEditor editorRef={editRiddleEditorRef} placeholder="Scrivi la domanda..." initialContent={editingRiddle.domanda} /></div>
          <input type="text" placeholder="Risposta (case-sensitive) *" value={editingRiddle.risposta} onChange={e => setEditingRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
          <div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={editingRiddle.dataInizio} onChange={e => setEditingRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Ora inizio</label><input type="time" value={editingRiddle.oraInizio} onChange={e => setEditingRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div>
          <div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={editingRiddle.dataFine} onChange={e => setEditingRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={editingRiddle.oraFine} onChange={e => setEditingRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div>
          <div className="flex gap-3 mb-3">
            <button type="button" onClick={() => setShowEditPuntiCustom(!showEditPuntiCustom)} className="text-sm text-purple-600"><Trophy size={14} className="inline" /> Punteggi</button>
            <button type="button" onClick={() => setShowEditBonusCustom(!showEditBonusCustom)} className="text-sm text-green-600"><Gift size={14} className="inline" /> Bonus</button>
          </div>
          {showEditPuntiCustom && <div className="mb-3 p-3 bg-purple-50 rounded-xl grid grid-cols-4 gap-2"><div><label className="text-xs">1°</label><input type="number" min="0" value={editingRiddle.puntoPrimo} onChange={e => setEditingRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">2°</label><input type="number" min="0" value={editingRiddle.puntoSecondo} onChange={e => setEditingRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">3°</label><input type="number" min="0" value={editingRiddle.puntoTerzo} onChange={e => setEditingRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">Altri</label><input type="number" min="0" value={editingRiddle.puntoAltri} onChange={e => setEditingRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div></div>}
          {showEditBonusCustom && <div className="mb-3"><BonusPointsEditor bonus={editingRiddle.bonusPunti} onChange={b => setEditingRiddle(p => ({ ...p, bonusPunti: b }))} /></div>}
          <button onClick={handleUpdateRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva modifiche'}</button>
        </div>
      </div>
    </div>
  );

  if (editingCompetition) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6"><button onClick={() => setEditingCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold text-gray-800">Modifica Competizione</h2></div>
          <input type="text" placeholder="Nome *" value={editingCompetition.nome} onChange={e => setEditingCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
          <textarea placeholder="Descrizione breve" value={editingCompetition.descrizione || ''} onChange={e => setEditingCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" />
          <div className="mb-4"><label className="text-sm text-gray-600 mb-2 block flex items-center gap-2"><FileText size={16} /> Regolamento</label><RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." initialContent={editingCompetition.regolamento} /></div>
          <div className="mb-4">
            <BonusPointsEditor 
              bonus={editingCompetition.bonusPunti} 
              onChange={b => setEditingCompetition(p => ({ ...p, bonusPunti: b }))} 
              label="Bonus default per nuovi quiz"
            />
          </div>
          <button onClick={handleUpdateCompetition} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva modifiche'}</button>
        </div>
      </div>
    </div>
  );

  if (selectedCompetition) {
    const compRiddles = riddles.filter(r => r.competitionId === selectedCompetition.id);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    return (
      <div className="min-h-screen bg-gray-100 pb-24">
        <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto flex items-center gap-3"><button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><div className="flex-1"><h2 className="text-xl font-bold text-purple-700">{selectedCompetition.nome}</h2><p className="text-sm text-gray-500">{formatDate(selectedCompetition.dataInizio)} - {formatDate(selectedCompetition.dataFine)}</p></div><button onClick={() => startEditCompetition(selectedCompetition)} className="p-2 hover:bg-gray-100 rounded-xl text-purple-600"><Edit3 size={20} /></button></div></div>
        <div className="max-w-4xl mx-auto px-4 grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Indovinelli ({compRiddles.length})</h3><div className="space-y-2 max-h-96 overflow-y-auto">{compRiddles.map(r => (<div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between items-start"><div className="flex-1"><span className="font-medium">{r.titolo}</span><div className="flex gap-1 mt-1"><button onClick={() => viewAnswers(r)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button><button onClick={() => startEditRiddle(r)} className="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded"><Edit3 size={12} className="inline" /> Modifica</button></div><p className="text-xs text-gray-500 mt-1">Risposta: {r.risposta}</p>{r.pointsAssigned ? <span className="text-xs text-green-600"><Check size={12} className="inline" /> Completato</span> : <span className="text-xs text-yellow-600">In corso</span>}</div><button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button></div>))}</div></div>
          <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Classifica ({sortedScores.length})</h3><div className="space-y-2 max-h-96 overflow-y-auto">{sortedScores.map((s, i) => (<div key={s.id} className={`p-3 rounded-xl border flex justify-between ${i < 3 ? 'bg-yellow-50' : 'bg-white'}`}><span>{i + 1}. {s.username || 'Utente'}</span><span className="font-bold text-purple-700">{s.points || 0} pt</span></div>))}</div></div>
        </div>
      </div>
    );
  }

  const activeComps = competitions.filter(c => { const now = new Date(), s = c.dataInizio?.toDate?.(), e = c.dataFine?.toDate?.(); return now >= s && now <= e; });

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      {confirmDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl p-6 max-w-md w-full"><h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3><p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p><div className="flex gap-3"><button onClick={() => setConfirmDelete(null)} className="flex-1 bg-gray-200 py-3 rounded-xl">Annulla</button><button onClick={handleDelete} disabled={submitting} className="flex-1 bg-red-500 text-white py-3 rounded-xl flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Elimina'}</button></div></div></div>}
      {editingUser && <UserEditModal user={editingUser} onClose={() => setEditingUser(null)} onSave={handleUpdateUser} saving={submitting} />}
      <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto flex justify-between items-center"><h1 className="text-xl font-bold flex items-center gap-2"><Settings size={24} /> Admin</h1><button onClick={() => signOut(auth)} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={22} /></button></div></div>
      {message && <div className={`mx-4 mb-4 p-4 rounded-xl text-center ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>}
      <div className="max-w-4xl mx-auto px-4">
        {activeTab === 'dashboard' && <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><div className="bg-white rounded-2xl p-4 text-center"><Flag className="mx-auto text-purple-500 mb-2" size={28} /><p className="text-2xl font-bold">{competitions.length}</p><p className="text-sm text-gray-500">Gare</p></div><div className="bg-white rounded-2xl p-4 text-center"><LayoutGrid className="mx-auto text-blue-500 mb-2" size={28} /><p className="text-2xl font-bold">{riddles.length}</p><p className="text-sm text-gray-500">Quiz</p></div><div className="bg-white rounded-2xl p-4 text-center"><Users className="mx-auto text-green-500 mb-2" size={28} /><p className="text-2xl font-bold">{users.length}</p><p className="text-sm text-gray-500">Utenti</p></div><div className="bg-white rounded-2xl p-4 text-center"><Megaphone className="mx-auto text-orange-500 mb-2" size={28} /><p className="text-2xl font-bold">{announcements.length}</p><p className="text-sm text-gray-500">Avvisi</p></div></div>{activeComps.length > 0 && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Gare attive</h3>{activeComps.map(c => <div key={c.id} onClick={() => setSelectedCompetition(c)} className="p-4 bg-green-50 rounded-xl border border-green-200 cursor-pointer mb-2"><h4 className="font-semibold text-green-800">{c.nome}</h4><p className="text-sm text-green-600">{c.participantsCount || 0} partecipanti</p></div>)}</div>}</div>}
        {activeTab === 'competitions' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuova Gara</h3><input type="text" placeholder="Nome *" value={newCompetition.nome} onChange={e => setNewCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><textarea placeholder="Descrizione breve" value={newCompetition.descrizione} onChange={e => setNewCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" /><div className="mb-4"><label className="text-sm text-gray-600 mb-2 block flex items-center gap-2"><FileText size={16} /> Regolamento</label><RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." /></div><div className="grid grid-cols-2 gap-3 mb-4"><div><label className="text-sm text-gray-600">Inizio</label><input type="date" value={newCompetition.dataInizio} onChange={e => setNewCompetition(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Fine</label><input type="date" value={newCompetition.dataFine} onChange={e => setNewCompetition(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="mb-4"><BonusPointsEditor bonus={newCompetition.bonusPunti} onChange={b => setNewCompetition(p => ({ ...p, bonusPunti: b }))} label="Bonus default per i quiz" /></div><button onClick={handleAddCompetition} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Tutte le gare ({competitions.length})</h3>{competitions.map(c => <div key={c.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center mb-2"><div className="cursor-pointer flex-1" onClick={() => setSelectedCompetition(c)}><h4 className="font-semibold text-purple-700">{c.nome}</h4><p className="text-sm text-gray-500">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)}</p><p className="text-xs text-gray-400">{riddles.filter(r => r.competitionId === c.id).length} quiz • {c.participantsCount || 0} iscritti</p></div><div className="flex gap-2"><button onClick={() => startEditCompetition(c)} className="text-purple-600 p-2"><Edit3 size={18} /></button><button onClick={() => setConfirmDelete({ type: 'competition', id: c.id, name: c.nome })} className="text-red-500 p-2"><Trash2 size={18} /></button></div></div>)}</div></div>}
        {activeTab === 'riddles' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Quiz</h3><select value={newRiddle.competitionId} onChange={e => setNewRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Seleziona gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select><input type="text" placeholder="Titolo *" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="mb-3"><label className="text-sm text-gray-600 mb-2 block">Domanda *</label><RichTextEditor editorRef={riddleEditorRef} placeholder="Scrivi la domanda..." /></div><input type="text" placeholder="Risposta (case-sensitive) *" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Ora inizio</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="flex gap-3 mb-3"><button type="button" onClick={() => setShowPuntiCustom(!showPuntiCustom)} className="text-sm text-purple-600"><Trophy size={14} className="inline" /> Punteggi</button><button type="button" onClick={() => setShowBonusCustom(!showBonusCustom)} className="text-sm text-green-600"><Gift size={14} className="inline" /> Bonus</button></div>{showPuntiCustom && <div className="mb-3 p-3 bg-purple-50 rounded-xl grid grid-cols-4 gap-2"><div><label className="text-xs">1°</label><input type="number" min="0" value={newRiddle.puntoPrimo} onChange={e => setNewRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">2°</label><input type="number" min="0" value={newRiddle.puntoSecondo} onChange={e => setNewRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">3°</label><input type="number" min="0" value={newRiddle.puntoTerzo} onChange={e => setNewRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">Altri</label><input type="number" min="0" value={newRiddle.puntoAltri} onChange={e => setNewRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div></div>}{showBonusCustom && <div className="mb-3"><BonusPointsEditor bonus={newRiddle.bonusPunti} onChange={b => setNewRiddle(p => ({ ...p, bonusPunti: b }))} /><p className="text-xs text-gray-500 mt-1">Se lasci a 0, userà i bonus della gara</p></div>}<button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Tutti i quiz ({riddles.length})</h3><div className="space-y-2 max-h-96 overflow-y-auto">{riddles.map(r => { const comp = competitions.find(c => c.id === r.competitionId); const bonus = r.bonusPunti || {}; const hasBonus = bonus.uno > 0 || bonus.finoCinque > 0 || bonus.seiDieci > 0; return (<div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between items-start"><div className="flex-1"><span className="font-medium">{r.titolo}</span><span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{comp?.nome || 'N/A'}</span>{hasBonus && <span className="ml-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full"><Gift size={10} className="inline" /> Bonus</span>}<div className="flex gap-1 mt-1"><button onClick={() => viewAnswers(r)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button><button onClick={() => startEditRiddle(r)} className="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded"><Edit3 size={12} className="inline" /> Modifica</button></div><p className="text-xs text-gray-500 mt-1">Risposta: {r.risposta}</p><p className="text-xs text-gray-400">{formatDateTime(r.dataInizio)} - {formatDateTime(r.dataFine)}</p></div><button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button></div>); })}</div></div></div>}
        {activeTab === 'announcements' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Avviso</h3><input type="text" placeholder="Titolo *" value={newAnnouncement.titolo} onChange={e => setNewAnnouncement(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="mb-4"><label className="text-sm text-gray-600 mb-2 block">Messaggio *</label><RichTextEditor editorRef={announcementEditorRef} placeholder="Scrivi il messaggio..." /></div><button onClick={handleAddAnnouncement} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : <><Megaphone size={18} /> Invia</>}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Avvisi ({announcements.length})</h3>{announcements.map(a => <div key={a.id} className="p-4 bg-gray-50 rounded-xl border mb-2 flex justify-between"><div className="flex-1"><h4 className="font-semibold">{a.titolo}</h4><div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: a.messaggio }} /><p className="text-xs text-gray-400 mt-2">{formatDateTime(a.createdAt)}</p></div><button onClick={() => setConfirmDelete({ type: 'announcement', id: a.id, name: a.titolo })} className="text-red-500 p-1 ml-2"><Trash2 size={16} /></button></div>)}</div></div>}
        {activeTab === 'users' && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Utenti ({users.length})</h3><div className="space-y-2 max-h-[60vh] overflow-y-auto">{users.map(u => <div key={u.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center"><div className="flex-1"><p className="font-medium">{u.username}</p><p className="text-sm text-gray-500">{u.email}</p>{u.usernameChangedAt && <p className="text-xs text-gray-400">Username cambiato: {formatDate(u.usernameChangedAt)}</p>}</div><div className="flex gap-2"><button onClick={() => setEditingUser(u)} className="text-purple-600 p-2"><Edit3 size={18} /></button><button onClick={() => setConfirmDelete({ type: 'user', id: u.id, name: u.username })} className="text-red-500 p-2"><Trash2 size={18} /></button></div></div>)}</div></div>}
      </div>
      <AdminBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default Admin;
