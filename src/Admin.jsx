import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, List, Eye, Check, Loader2, ArrowLeft, Lock, Trophy, Flag, Users, Megaphone, Home, LayoutGrid, FileText, Edit3, RefreshCw, Gift, Save, Clock, Calendar, Star, AlertTriangle } from 'lucide-react';
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

const compareAnswers = (a, b) => a?.trim() === b?.trim();

const getBonusPoints = (correctCount, riddle) => {
  const bonus = riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 };
  if (correctCount === 1) return bonus.uno || 0;
  if (correctCount >= 2 && correctCount <= 5) return bonus.finoCinque || 0;
  if (correctCount >= 6 && correctCount <= 10) return bonus.seiDieci || 0;
  return 0;
};

const recalculateRiddlePoints = async (riddleId, riddle, onLog) => {
  const log = onLog || console.log;
  try {
    log(`\n📝 Ricalcolo: "${riddle.titolo}"`);
    const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
    const answers = [];
    answersSnap.forEach(d => answers.push({ id: d.id, ref: d.ref, ...d.data() }));
    if (answers.length === 0) {
      await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, correctCount: 0 });
      return { success: true, processed: 0 };
    }
    answers.sort((a, b) => {
      const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0);
      const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0);
      return timeA - timeB;
    });
    const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
    const getPoints = (pos) => pos === 0 ? punti.primo : pos === 1 ? punti.secondo : pos === 2 ? punti.terzo : punti.altri;
    const correctAnswers = answers.filter(ans => compareAnswers(ans.answer, riddle.risposta));
    const correctCount = correctAnswers.length;
    const bonus = getBonusPoints(correctCount, riddle);
    log(`   Risposte corrette: ${correctCount}, Bonus: +${bonus}`);
    if (riddle.competitionId) {
      for (const oldAns of answers.filter(a => a.points > 0)) {
        const oderId = oldAns.userId || oldAns.oderId;
        const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`);
        const scoreDoc = await getDoc(scoreRef);
        if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - oldAns.points) });
      }
    }
    let correctPosition = 0;
    for (const ans of answers) {
      const isCorrect = compareAnswers(ans.answer, riddle.risposta);
      let points = 0, ansBonus = 0;
      if (isCorrect) { ansBonus = bonus; points = getPoints(correctPosition) + ansBonus; correctPosition++; }
      await updateDoc(ans.ref, { points, isCorrect, bonus: ansBonus });
      if (points > 0 && riddle.competitionId) {
        const oderId = ans.userId || ans.oderId;
        const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`);
        const scoreDoc = await getDoc(scoreRef);
        if (scoreDoc.exists()) await updateDoc(scoreRef, { points: (scoreDoc.data().points || 0) + points });
      }
    }
    await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, processedAt: serverTimestamp(), correctCount });
    log(`   ✅ Completato! ${correctPosition} corrette`);
    return { success: true, processed: answers.length, correct: correctPosition };
  } catch (e) { log(`   ❌ ERRORE: ${e.message}`); return { success: false, error: e.message }; }
};

const AdminBottomNav = ({ activeTab, setActiveTab }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-2 py-2 z-50">
    <div className="max-w-4xl mx-auto flex justify-around">
      {[{ id: 'dashboard', icon: Home, label: 'Home' }, { id: 'competitions', icon: Flag, label: 'Gare' }, { id: 'riddles', icon: LayoutGrid, label: 'Quiz' }, { id: 'announcements', icon: Megaphone, label: 'Avvisi' }, { id: 'users', icon: Users, label: 'Utenti' }].map(tab => (
        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center px-2 py-1 rounded-lg ${activeTab === tab.id ? 'text-purple-600' : 'text-gray-500'}`}>
          <tab.icon size={22} /><span className="text-xs mt-1">{tab.label}</span>
        </button>
      ))}
    </div>
  </div>
);

const CompetitionDetailTabs = ({ activeTab, setActiveTab, counts }) => (
  <div className="flex bg-gray-100 rounded-xl p-1 mb-4 overflow-x-auto">
    {[{ id: 'active', icon: Star, label: 'Attivi', count: counts.active }, { id: 'scheduled', icon: Calendar, label: 'Futuri', count: counts.scheduled }, { id: 'past', icon: Clock, label: 'Passati', count: counts.past }, { id: 'leaderboard', icon: Trophy, label: 'Classifica' }, { id: 'settings', icon: Settings, label: 'Info' }].map(tab => (
      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-xs font-medium whitespace-nowrap ${activeTab === tab.id ? 'bg-white shadow text-purple-600' : 'text-gray-600'}`}>
        <tab.icon size={14} /><span className="hidden sm:inline">{tab.label}</span>{tab.count !== undefined && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-purple-100' : 'bg-gray-200'}`}>{tab.count}</span>}
      </button>
    ))}
  </div>
);

const RichTextEditor = ({ editorRef, placeholder, initialContent }) => {
  useEffect(() => { if (editorRef.current && initialContent !== undefined) editorRef.current.innerHTML = initialContent; }, [initialContent, editorRef]);
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
    <p className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1"><Gift size={16} /> {label || 'Bonus pochi rispondenti'}</p>
    <div className="grid grid-cols-3 gap-2">
      <div><label className="text-xs text-green-600">Solo 1</label><input type="number" min="0" value={bonus.uno} onChange={e => onChange({ ...bonus, uno: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div>
      <div><label className="text-xs text-green-600">Max 5</label><input type="number" min="0" value={bonus.finoCinque} onChange={e => onChange({ ...bonus, finoCinque: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div>
      <div><label className="text-xs text-green-600">6-10</label><input type="number" min="0" value={bonus.seiDieci} onChange={e => onChange({ ...bonus, seiDieci: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div>
    </div>
  </div>
);

const DeleteUserModal = ({ user, onClose, onConfirm, deleting }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl p-6 max-w-md w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center"><AlertTriangle className="text-red-600" size={24} /></div>
        <div><h3 className="text-lg font-bold text-red-700">Eliminazione completa</h3><p className="text-sm text-gray-500">Azione irreversibile!</p></div>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
        <p className="text-sm text-red-700"><strong>Utente:</strong> {user?.username}</p>
        <p className="text-sm text-red-700"><strong>Email:</strong> {user?.email}</p>
      </div>
      <p className="text-sm text-gray-600 mb-2">Verranno eliminati:</p>
      <ul className="text-sm text-gray-600 mb-4 list-disc list-inside">
        <li>Profilo dal database</li><li>Tutte le risposte</li><li>Tutti i punteggi</li>
      </ul>
      <p className="text-xs text-orange-600 mb-4 bg-orange-50 p-2 rounded">⚠️ Per eliminare l'account Auth, usa la Console Firebase.</p>
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button>
        <button onClick={() => onConfirm(user)} disabled={deleting} className="flex-1 bg-red-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
          {deleting ? <Loader2 size={18} className="animate-spin" /> : <><Trash2 size={18} /> Elimina</>}
        </button>
      </div>
    </div>
  </div>
);

const RiddleQuickCard = ({ riddle, onViewAnswers, onEdit, onDelete, status }) => {
  const statusColors = { active: 'bg-green-100 border-green-300', scheduled: 'bg-blue-50 border-blue-200 border-dashed', past: 'bg-gray-50 border-gray-200' };
  const statusBadge = { active: <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Live</span>, scheduled: <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">Programmato</span>, past: riddle.pointsAssigned ? <span className="text-xs bg-gray-500 text-white px-2 py-0.5 rounded-full">Completato</span> : <span className="text-xs bg-yellow-500 text-white px-2 py-0.5 rounded-full">Da elaborare</span> };
  const bonus = riddle.bonusPunti || {};
  const hasBonus = bonus.uno > 0 || bonus.finoCinque > 0 || bonus.seiDieci > 0;
  return (
    <div className={`p-4 rounded-xl border-2 ${statusColors[status]}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1"><div className="flex items-center gap-2"><h4 className="font-semibold text-gray-800">{riddle.titolo}</h4>{hasBonus && <Gift size={14} className="text-green-600" />}</div><p className="text-xs text-gray-500 mt-1">{formatDateTime(riddle.dataInizio)} → {formatDateTime(riddle.dataFine)}</p></div>
        {statusBadge[status]}
      </div>
      <p className="text-sm text-purple-700 mb-2">Risposta: <strong>{riddle.risposta}</strong></p>
      {riddle.correctCount !== undefined && <p className="text-xs text-gray-500 mb-2">✓ {riddle.correctCount} corrette</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={() => onViewAnswers(riddle)} className="flex-1 text-xs bg-blue-50 text-blue-600 px-3 py-2 rounded-lg flex items-center justify-center gap-1"><Eye size={14} /> Risposte</button>
        <button onClick={() => onEdit(riddle)} className="flex-1 text-xs bg-purple-50 text-purple-600 px-3 py-2 rounded-lg flex items-center justify-center gap-1"><Edit3 size={14} /> Modifica</button>
        <button onClick={() => onDelete(riddle)} className="text-xs bg-red-50 text-red-600 px-3 py-2 rounded-lg"><Trash2 size={14} /></button>
      </div>
    </div>
  );
};

const RiddleAnswersView = ({ riddle, answers, users, onBack, onRecalculate, recalculating }) => {
  const sorted = [...answers].sort((a, b) => { const timeA = a.time?.toDate ? a.time.toDate().getTime() : 0; const timeB = b.time?.toDate ? b.time.toDate().getTime() : 0; return timeA - timeB; });
  const userMap = {}; users.forEach(u => { if (u.oderId) userMap[u.oderId] = u.username; if (u.id) userMap[u.id] = u.username; });
  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700 flex-1">{riddle.titolo}</h3>
        <button onClick={() => onRecalculate(riddle)} disabled={recalculating} className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-xl disabled:opacity-50">
          <RefreshCw size={16} className={recalculating ? 'animate-spin' : ''} />{recalculating ? '...' : 'Ricalcola'}
        </button>
      </div>
      <div className="mb-4 p-4 bg-purple-50 rounded-xl">
        <p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p>
        {riddle.correctCount !== undefined && <p className="text-xs text-gray-500 mt-1">Corrette: {riddle.correctCount}</p>}
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
                    <div><span className="font-medium">{userMap[oderId] || 'Utente'}</span><p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p><p className={`text-sm ${correct ? 'text-green-700' : 'text-red-600'}`}>"{ans.answer}"</p></div>
                  </div>
                  <span className={`font-bold text-lg ${ans.points > 0 ? 'text-green-600' : 'text-gray-400'}`}>{ans.points > 0 ? `+${ans.points}` : '0'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Admin = () => {
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionDetailTab, setCompetitionDetailTab] = useState('active');
  const [editingCompetition, setEditingCompetition] = useState(null);
  const [editingRiddle, setEditingRiddle] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [newCompetition, setNewCompetition] = useState({ nome: '', descrizione: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', competitionId: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntoPrimo: 3, puntoSecondo: 1, puntoTerzo: 1, puntoAltri: 1, bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newAnnouncement, setNewAnnouncement] = useState({ titolo: '' });
  const [showPuntiCustom, setShowPuntiCustom] = useState(false);
  const [showBonusCustom, setShowBonusCustom] = useState(false);
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

  useEffect(() => { return onAuthStateChanged(auth, (u) => { if (u && ADMIN_EMAILS.includes(u.email)) { setUser(u); setIsAdmin(true); } else { setUser(null); setIsAdmin(false); } setLoading(false); }); }, []);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'riddles'), orderBy('dataInizio', 'desc')), (snap) => setRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), (snap) => setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin]);
  useEffect(() => { if (!isAdmin || !selectedCompetition) { setCompetitionScores([]); return; } return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin, selectedCompetition]);

  const handleLogin = async () => { if (authLoading) return; setAuthLoading(true); try { const cred = await signInWithEmailAndPassword(auth, email, password); if (!ADMIN_EMAILS.includes(cred.user.email)) { await signOut(auth); showMsg('Non autorizzato'); } } catch { showMsg('Credenziali errate'); } finally { setAuthLoading(false); } };

  const handleRecalculatePoints = async (riddle) => {
    setRecalculating(true); setRecalcLog([]);
    const logs = []; const logFn = (msg) => { logs.push(msg); setRecalcLog([...logs]); };
    const result = await recalculateRiddlePoints(riddle.id, riddle, logFn);
    if (result.success) {
      showMsg(`✅ ${result.correct || 0} corrette su ${result.processed || 0}`);
      const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
      setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      const riddleDoc = await getDoc(doc(db, 'riddles', riddle.id));
      if (riddleDoc.exists()) setViewingRiddle({ id: riddleDoc.id, ...riddleDoc.data() });
    } else showMsg(`❌ ${result.error}`);
    setRecalculating(false);
  };

  const handleAddCompetition = async () => {
    if (!newCompetition.nome || !newCompetition.dataInizio || !newCompetition.dataFine) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const regolamento = regolamentoEditorRef.current?.innerHTML || '';
      await setDoc(doc(collection(db, 'competitions')), { nome: newCompetition.nome, descrizione: newCompetition.descrizione || '', regolamento, dataInizio: Timestamp.fromDate(new Date(newCompetition.dataInizio)), dataFine: Timestamp.fromDate(new Date(newCompetition.dataFine)), bonusPunti: newCompetition.bonusPunti, participantsCount: 0, createdAt: serverTimestamp() });
      setNewCompetition({ nome: '', descrizione: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
      if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = '';
      showMsg('✅ Creata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleUpdateCompetition = async () => {
    if (!editingCompetition) return;
    setSubmitting(true);
    try {
      const regolamento = regolamentoEditorRef.current?.innerHTML || '';
      await updateDoc(doc(db, 'competitions', editingCompetition.id), { nome: editingCompetition.nome, descrizione: editingCompetition.descrizione || '', regolamento, bonusPunti: editingCompetition.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 } });
      setEditingCompetition(null);
      showMsg('✅ Aggiornata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleAddRiddle = async () => {
    const domanda = riddleEditorRef.current?.innerHTML || '';
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.competitionId || !newRiddle.dataInizio || !newRiddle.dataFine) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
      const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
      const comp = competitions.find(c => c.id === newRiddle.competitionId);
      const bonusPunti = (newRiddle.bonusPunti.uno > 0 || newRiddle.bonusPunti.finoCinque > 0 || newRiddle.bonusPunti.seiDieci > 0) ? newRiddle.bonusPunti : (comp?.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 });
      await setDoc(doc(collection(db, 'riddles')), { titolo: newRiddle.titolo, domanda, risposta: newRiddle.risposta.trim(), competitionId: newRiddle.competitionId, dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), punti: { primo: parseInt(newRiddle.puntoPrimo) || 3, secondo: parseInt(newRiddle.puntoSecondo) || 1, terzo: parseInt(newRiddle.puntoTerzo) || 1, altri: parseInt(newRiddle.puntoAltri) || 1 }, bonusPunti, pointsAssigned: false, createdAt: serverTimestamp() });
      setNewRiddle({ ...newRiddle, titolo: '', risposta: '', dataInizio: '', dataFine: '', bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
      if (riddleEditorRef.current) riddleEditorRef.current.innerHTML = '';
      showMsg('✅ Creato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleUpdateRiddle = async () => {
    if (!editingRiddle) return;
    const domanda = editRiddleEditorRef.current?.innerHTML || '';
    setSubmitting(true);
    try {
      const start = new Date(`${editingRiddle.dataInizio}T${editingRiddle.oraInizio}:00`);
      const end = new Date(`${editingRiddle.dataFine}T${editingRiddle.oraFine}:00`);
      await updateDoc(doc(db, 'riddles', editingRiddle.id), { titolo: editingRiddle.titolo, domanda, risposta: editingRiddle.risposta.trim(), competitionId: editingRiddle.competitionId, dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), punti: { primo: parseInt(editingRiddle.puntoPrimo) || 3, secondo: parseInt(editingRiddle.puntoSecondo) || 1, terzo: parseInt(editingRiddle.puntoTerzo) || 1, altri: parseInt(editingRiddle.puntoAltri) || 1 }, bonusPunti: editingRiddle.bonusPunti });
      setEditingRiddle(null);
      showMsg('✅ Aggiornato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const startEditRiddle = (riddle) => {
    const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
    setEditingRiddle({ ...riddle, dataInizio: formatDateForInput(riddle.dataInizio), oraInizio: formatTimeForInput(riddle.dataInizio), dataFine: formatDateForInput(riddle.dataFine), oraFine: formatTimeForInput(riddle.dataFine), puntoPrimo: punti.primo, puntoSecondo: punti.secondo, puntoTerzo: punti.terzo, puntoAltri: punti.altri, bonusPunti: riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 } });
  };

  const handleAddAnnouncement = async () => {
    const messaggio = announcementEditorRef.current?.innerHTML || '';
    if (!newAnnouncement.titolo || !messaggio.trim()) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'announcements')), { titolo: newAnnouncement.titolo, messaggio, createdAt: serverTimestamp() });
      setNewAnnouncement({ titolo: '' });
      if (announcementEditorRef.current) announcementEditorRef.current.innerHTML = '';
      showMsg('✅ Inviato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleDeleteUserComplete = async (userToDelete) => {
    if (!userToDelete) return;
    setSubmitting(true);
    try {
      const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', userToDelete.id)));
      for (const d of answersSnap.docs) await deleteDoc(d.ref);
      const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', userToDelete.id)));
      for (const d of scoresSnap.docs) {
        const scoreData = d.data();
        if (scoreData.competitionId) {
          const compRef = doc(db, 'competitions', scoreData.competitionId);
          const compDoc = await getDoc(compRef);
          if (compDoc.exists() && (compDoc.data().participantsCount || 0) > 0) await updateDoc(compRef, { participantsCount: compDoc.data().participantsCount - 1 });
        }
        await deleteDoc(d.ref);
      }
      await deleteDoc(doc(db, 'users', userToDelete.id));
      setDeletingUser(null);
      showMsg('✅ Utente eliminato!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSubmitting(true);
    try {
      if (confirmDelete.type === 'competition') {
        const riddlesSnap = await getDocs(query(collection(db, 'riddles'), where('competitionId', '==', confirmDelete.id)));
        for (const r of riddlesSnap.docs) { const ans = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); for (const a of ans.docs) await deleteDoc(a.ref); await deleteDoc(r.ref); }
        const scores = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', confirmDelete.id)));
        for (const s of scores.docs) await deleteDoc(s.ref);
        await deleteDoc(doc(db, 'competitions', confirmDelete.id));
        if (selectedCompetition?.id === confirmDelete.id) setSelectedCompetition(null);
      } else if (confirmDelete.type === 'riddle') {
        const riddle = riddles.find(r => r.id === confirmDelete.id);
        const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', confirmDelete.id)));
        for (const d of snap.docs) { const ans = d.data(); if (ans.points > 0 && riddle?.competitionId) { const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${ans.userId || ans.oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - ans.points) }); } await deleteDoc(d.ref); }
        await deleteDoc(doc(db, 'riddles', confirmDelete.id));
      } else if (confirmDelete.type === 'announcement') await deleteDoc(doc(db, 'announcements', confirmDelete.id));
      showMsg('✅ Eliminato');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); setConfirmDelete(null); }
  };

  const viewAnswers = async (r) => { setViewingRiddle(r); setRecalcLog([]); const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); };
  const startEditCompetition = (comp) => { setEditingCompetition({ ...comp, bonusPunti: comp.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 } }); setTimeout(() => { if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = comp.regolamento || ''; }, 100); };
  const getCompetitionRiddles = (compId) => riddles.filter(r => r.competitionId === compId).sort((a, b) => {
    const dateA = a.dataInizio?.toDate ? a.dataInizio.toDate().getTime() : new Date(a.dataInizio).getTime();
    const dateB = b.dataInizio?.toDate ? b.dataInizio.toDate().getTime() : new Date(b.dataInizio).getTime();
    return dateA - dateB;
  });
  const categorizeRiddles = (compRiddles) => {
    const now = new Date();
    return {
      active: compRiddles.filter(r => { const s = r.dataInizio?.toDate?.() || new Date(r.dataInizio), e = r.dataFine?.toDate?.() || new Date(r.dataFine); return now >= s && now <= e; }),
      scheduled: compRiddles.filter(r => { const s = r.dataInizio?.toDate?.() || new Date(r.dataInizio); return now < s; }),
      past: compRiddles.filter(r => { const e = r.dataFine?.toDate?.() || new Date(r.dataFine); return now > e; })
    };
  };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (!isAdmin) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6"><div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Lock size={32} className="text-purple-600" /></div><h1 className="text-2xl font-bold">Admin Panel</h1></div>
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
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={[...users, ...competitionScores]} onBack={() => { setViewingRiddle(null); setRecalcLog([]); }} onRecalculate={handleRecalculatePoints} recalculating={recalculating} />
        {recalcLog.length > 0 && <div className="mt-4 bg-gray-900 text-green-400 p-4 rounded-xl font-mono text-xs max-h-60 overflow-y-auto">{recalcLog.map((l, i) => <div key={i}>{l}</div>)}</div>}
      </div>
    </div>
  );

  if (editingRiddle) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6"><button onClick={() => setEditingRiddle(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Modifica Quiz</h2></div>
        <select value={editingRiddle.competitionId} onChange={e => setEditingRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        <input type="text" placeholder="Titolo *" value={editingRiddle.titolo} onChange={e => setEditingRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
        <RichTextEditor editorRef={editRiddleEditorRef} placeholder="Domanda..." initialContent={editingRiddle.domanda} />
        <input type="text" placeholder="Risposta *" value={editingRiddle.risposta} onChange={e => setEditingRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
        <div className="grid grid-cols-2 gap-3 mb-3"><input type="date" value={editingRiddle.dataInizio} onChange={e => setEditingRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /><input type="time" value={editingRiddle.oraInizio} onChange={e => setEditingRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
        <div className="grid grid-cols-2 gap-3 mb-3"><input type="date" value={editingRiddle.dataFine} onChange={e => setEditingRiddle(p => ({ ...p, dataFine: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /><input type="time" value={editingRiddle.oraFine} onChange={e => setEditingRiddle(p => ({ ...p, oraFine: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
        <BonusPointsEditor bonus={editingRiddle.bonusPunti} onChange={b => setEditingRiddle(p => ({ ...p, bonusPunti: b }))} />
        <button onClick={handleUpdateRiddle} disabled={submitting} className="w-full mt-4 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva'}</button>
      </div>
    </div>
  );

  if (editingCompetition) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6"><button onClick={() => setEditingCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Modifica Gara</h2></div>
        <input type="text" placeholder="Nome *" value={editingCompetition.nome} onChange={e => setEditingCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
        <textarea placeholder="Descrizione" value={editingCompetition.descrizione || ''} onChange={e => setEditingCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" />
        <RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." initialContent={editingCompetition.regolamento} />
        <BonusPointsEditor bonus={editingCompetition.bonusPunti} onChange={b => setEditingCompetition(p => ({ ...p, bonusPunti: b }))} />
        <button onClick={handleUpdateCompetition} disabled={submitting} className="w-full mt-4 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva'}</button>
      </div>
    </div>
  );

  if (selectedCompetition) {
    const compRiddles = getCompetitionRiddles(selectedCompetition.id);
    const { active, scheduled, past } = categorizeRiddles(compRiddles);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    return (
      <div className="min-h-screen bg-gray-100 pb-24">
        <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto flex items-center gap-3"><button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><div className="flex-1"><h2 className="text-xl font-bold text-purple-700">{selectedCompetition.nome}</h2><p className="text-sm text-gray-500">{compRiddles.length} quiz • {competitionScores.length} partecipanti</p></div><button onClick={() => startEditCompetition(selectedCompetition)} className="p-2 hover:bg-gray-100 rounded-xl text-purple-600"><Edit3 size={20} /></button></div></div>
        <div className="max-w-4xl mx-auto px-4">
          <CompetitionDetailTabs activeTab={competitionDetailTab} setActiveTab={setCompetitionDetailTab} counts={{ active: active.length, scheduled: scheduled.length, past: past.length }} />
          {competitionDetailTab === 'active' && <div className="space-y-3">{active.length === 0 ? <div className="bg-white rounded-2xl p-8 text-center"><Star size={48} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500">Nessun quiz attivo</p></div> : active.map(r => <RiddleQuickCard key={r.id} riddle={r} status="active" onViewAnswers={viewAnswers} onEdit={startEditRiddle} onDelete={(riddle) => setConfirmDelete({ type: 'riddle', id: riddle.id, name: riddle.titolo })} />)}</div>}
          {competitionDetailTab === 'scheduled' && <div className="space-y-3">{scheduled.length === 0 ? <div className="bg-white rounded-2xl p-8 text-center"><Calendar size={48} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500">Nessun quiz programmato</p></div> : scheduled.map(r => <RiddleQuickCard key={r.id} riddle={r} status="scheduled" onViewAnswers={viewAnswers} onEdit={startEditRiddle} onDelete={(riddle) => setConfirmDelete({ type: 'riddle', id: riddle.id, name: riddle.titolo })} />)}</div>}
          {competitionDetailTab === 'past' && <div className="space-y-3">{past.length === 0 ? <div className="bg-white rounded-2xl p-8 text-center"><Clock size={48} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500">Nessun quiz passato</p></div> : past.map(r => <RiddleQuickCard key={r.id} riddle={r} status="past" onViewAnswers={viewAnswers} onEdit={startEditRiddle} onDelete={(riddle) => setConfirmDelete({ type: 'riddle', id: riddle.id, name: riddle.titolo })} />)}</div>}
          {competitionDetailTab === 'leaderboard' && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifica ({sortedScores.length})</h3>{sortedScores.length === 0 ? <p className="text-gray-500 text-center py-8">Nessun partecipante</p> : <div className="space-y-2 max-h-[60vh] overflow-y-auto">{sortedScores.map((s, i) => <div key={s.id} className={`p-3 rounded-xl border flex justify-between ${i < 3 ? 'bg-yellow-50' : 'bg-white'}`}><div className="flex items-center gap-3"><span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-300' : i === 2 ? 'bg-orange-300' : 'bg-gray-100'}`}>{i + 1}</span><span>{s.username || 'Utente'}</span></div><span className="font-bold text-purple-700">{s.points || 0} pt</span></div>)}</div>}</div>}
          {competitionDetailTab === 'settings' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Informazioni</h3><p className="text-sm"><strong>Data:</strong> {formatDate(selectedCompetition.dataInizio)} - {formatDate(selectedCompetition.dataFine)}</p><p className="text-sm"><strong>Partecipanti:</strong> {selectedCompetition.participantsCount || 0}</p></div>{selectedCompetition.regolamento && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Regolamento</h3><div className="prose prose-sm" dangerouslySetInnerHTML={{ __html: selectedCompetition.regolamento }} /></div>}<button onClick={() => setConfirmDelete({ type: 'competition', id: selectedCompetition.id, name: selectedCompetition.nome })} className="w-full bg-red-100 text-red-600 py-3 rounded-xl font-semibold flex items-center justify-center gap-2"><Trash2 size={18} /> Elimina gara</button></div>}
        </div>
      </div>
    );
  }

  const activeComps = competitions.filter(c => { const now = new Date(), s = c.dataInizio?.toDate?.(), e = c.dataFine?.toDate?.(); return s && e && now >= s && now <= e; });

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      {confirmDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl p-6 max-w-md w-full"><h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3><p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p><div className="flex gap-3"><button onClick={() => setConfirmDelete(null)} className="flex-1 bg-gray-200 py-3 rounded-xl">Annulla</button><button onClick={handleDelete} disabled={submitting} className="flex-1 bg-red-500 text-white py-3 rounded-xl flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Elimina'}</button></div></div></div>}
      {deletingUser && <DeleteUserModal user={deletingUser} onClose={() => setDeletingUser(null)} onConfirm={handleDeleteUserComplete} deleting={submitting} />}
      <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto flex justify-between items-center"><h1 className="text-xl font-bold flex items-center gap-2"><Settings size={24} /> Admin</h1><button onClick={() => signOut(auth)} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={22} /></button></div></div>
      {message && <div className={`mx-4 mb-4 p-4 rounded-xl text-center ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>}
      <div className="max-w-4xl mx-auto px-4">
        {activeTab === 'dashboard' && <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{ icon: Flag, color: 'purple', val: competitions.length, label: 'Gare' }, { icon: LayoutGrid, color: 'blue', val: riddles.length, label: 'Quiz' }, { icon: Users, color: 'green', val: users.length, label: 'Utenti' }, { icon: Megaphone, color: 'orange', val: announcements.length, label: 'Avvisi' }].map(({ icon: I, color, val, label }) => <div key={label} className="bg-white rounded-2xl p-4 text-center"><I className={`mx-auto text-${color}-500 mb-2`} size={28} /><p className="text-2xl font-bold">{val}</p><p className="text-sm text-gray-500">{label}</p></div>)}</div>{activeComps.length > 0 && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Gare attive</h3>{activeComps.map(c => <div key={c.id} onClick={() => setSelectedCompetition(c)} className="p-4 bg-green-50 rounded-xl border border-green-200 cursor-pointer mb-2"><h4 className="font-semibold text-green-800">{c.nome}</h4><p className="text-sm text-green-600">{c.participantsCount || 0} partecipanti</p></div>)}</div>}</div>}
        {activeTab === 'competitions' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuova Gara</h3><input placeholder="Nome *" value={newCompetition.nome} onChange={e => setNewCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><textarea placeholder="Descrizione" value={newCompetition.descrizione} onChange={e => setNewCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" /><RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." /><div className="grid grid-cols-2 gap-3 mb-4"><div><label className="text-sm text-gray-600">Inizio</label><input type="date" value={newCompetition.dataInizio} onChange={e => setNewCompetition(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Fine</label><input type="date" value={newCompetition.dataFine} onChange={e => setNewCompetition(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><BonusPointsEditor bonus={newCompetition.bonusPunti} onChange={b => setNewCompetition(p => ({ ...p, bonusPunti: b }))} /><button onClick={handleAddCompetition} disabled={submitting} className="w-full mt-4 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Tutte ({competitions.length})</h3>{competitions.map(c => <div key={c.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center mb-2"><div className="flex-1 cursor-pointer" onClick={() => setSelectedCompetition(c)}><h4 className="font-semibold text-purple-700">{c.nome}</h4><p className="text-xs text-gray-500">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)} • {c.participantsCount || 0} iscritti</p></div><div className="flex gap-2"><button onClick={() => startEditCompetition(c)} className="text-purple-600 p-2"><Edit3 size={18} /></button><button onClick={() => setConfirmDelete({ type: 'competition', id: c.id, name: c.nome })} className="text-red-500 p-2"><Trash2 size={18} /></button></div></div>)}</div></div>}
        {activeTab === 'riddles' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Quiz</h3><select value={newRiddle.competitionId} onChange={e => setNewRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select><input placeholder="Titolo *" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><RichTextEditor editorRef={riddleEditorRef} placeholder="Domanda..." /><input placeholder="Risposta *" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-xs">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-xs">Ora</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-xs">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-xs">Ora</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="flex gap-3 mb-3"><button type="button" onClick={() => setShowPuntiCustom(!showPuntiCustom)} className="text-sm text-purple-600"><Trophy size={14} className="inline" /> Punteggi</button><button type="button" onClick={() => setShowBonusCustom(!showBonusCustom)} className="text-sm text-green-600"><Gift size={14} className="inline" /> Bonus</button></div>{showPuntiCustom && <div className="mb-3 p-3 bg-purple-50 rounded-xl grid grid-cols-4 gap-2"><div><label className="text-xs">1°</label><input type="number" min="0" value={newRiddle.puntoPrimo} onChange={e => setNewRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">2°</label><input type="number" min="0" value={newRiddle.puntoSecondo} onChange={e => setNewRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">3°</label><input type="number" min="0" value={newRiddle.puntoTerzo} onChange={e => setNewRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div><div><label className="text-xs">Altri</label><input type="number" min="0" value={newRiddle.puntoAltri} onChange={e => setNewRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div></div>}{showBonusCustom && <BonusPointsEditor bonus={newRiddle.bonusPunti} onChange={b => setNewRiddle(p => ({ ...p, bonusPunti: b }))} />}<button onClick={handleAddRiddle} disabled={submitting} className="w-full mt-4 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Tutti ({riddles.length})</h3><div className="space-y-2 max-h-96 overflow-y-auto">{riddles.map(r => { const c = competitions.find(c => c.id === r.competitionId); return <div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between"><div className="flex-1"><span className="font-medium">{r.titolo}</span><span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{c?.nome || 'N/A'}</span><p className="text-xs text-gray-500 mt-1">Risposta: {r.risposta}</p></div><div className="flex gap-1"><button onClick={() => viewAnswers(r)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} /></button><button onClick={() => startEditRiddle(r)} className="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded"><Edit3 size={12} /></button><button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={14} /></button></div></div>; })}</div></div></div>}
        {activeTab === 'announcements' && <div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Avviso</h3><input placeholder="Titolo *" value={newAnnouncement.titolo} onChange={e => setNewAnnouncement(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><RichTextEditor editorRef={announcementEditorRef} placeholder="Messaggio..." /><button onClick={handleAddAnnouncement} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : <><Megaphone size={18} /> Invia</>}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Avvisi ({announcements.length})</h3>{announcements.map(a => <div key={a.id} className="p-4 bg-gray-50 rounded-xl border mb-2 flex justify-between"><div className="flex-1"><h4 className="font-semibold">{a.titolo}</h4><div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: a.messaggio }} /><p className="text-xs text-gray-400 mt-2">{formatDateTime(a.createdAt)}</p></div><button onClick={() => setConfirmDelete({ type: 'announcement', id: a.id, name: a.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button></div>)}</div></div>}
        {activeTab === 'users' && <div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Utenti ({users.length})</h3><div className="space-y-2 max-h-[60vh] overflow-y-auto">{users.map(u => <div key={u.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center"><div className="flex-1"><p className="font-medium">{u.username}</p><p className="text-sm text-gray-500">{u.email}</p><p className="text-xs text-gray-400">Registrato: {formatDate(u.createdAt)}</p></div><button onClick={() => setDeletingUser(u)} className="text-red-500 p-2"><Trash2 size={18} /></button></div>)}</div></div>}
      </div>
      <AdminBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default Admin;
