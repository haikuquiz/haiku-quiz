import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, AlignCenter, AlignLeft, List, Eye, Check, Loader2, ArrowLeft, Clock, Lock, Trophy, Flag, Users, Megaphone, Home, LayoutGrid } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const ADMIN_EMAILS = ['haikuquizofficial@gmail.com'];

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('it-IT');
};

const compareAnswers = (a, b) => a?.trim() === b?.trim();

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
          <tab.icon size={22} />
          <span className="text-xs mt-1">{tab.label}</span>
        </button>
      ))}
    </div>
  </div>
);

const RiddleAnswersView = ({ riddle, answers, users, onBack }) => {
  const sorted = [...answers].sort((a, b) => (a.time?.toDate?.() || 0) - (b.time?.toDate?.() || 0));
  const userMap = Object.fromEntries(users.map(u => [u.oderId || u.id, u.username]));
  const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>
      <div className="mb-4 p-4 bg-purple-50 rounded-xl">
        <p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p>
        <p className="text-xs text-gray-500 mt-1">Punti: 1°{punti.primo} 2°{punti.secondo} 3°{punti.terzo} altri:{punti.altri}</p>
      </div>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            return (
              <div key={ans.id} className="p-3 rounded-xl border bg-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>{i + 1}</span>
                  <div>
                    <span className="font-medium">{userMap[ans.userId] || 'Utente'}</span>
                    <p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p>
                    <p className={`text-sm ${correct ? 'text-green-700' : 'text-red-600'}`}>"{ans.answer}"</p>
                  </div>
                </div>
                <span className={`font-bold ${ans.points > 0 ? 'text-green-600' : 'text-red-500'}`}>{riddle.pointsAssigned ? (ans.points > 0 ? `+${ans.points}` : '0') : '-'}</span>
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
  const [newCompetition, setNewCompetition] = useState({ nome: '', descrizione: '', dataInizio: '', dataFine: '' });
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', competitionId: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntoPrimo: 3, puntoSecondo: 1, puntoTerzo: 1, puntoAltri: 1 });
  const [newAnnouncement, setNewAnnouncement] = useState({ titolo: '', messaggio: '' });
  const [showPuntiCustom, setShowPuntiCustom] = useState(false);
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const editorRef = useRef(null);
  const announcementEditorRef = useRef(null);

  const showMsg = (msg, dur = 3000) => { setMessage(msg); if (dur > 0) setTimeout(() => setMessage(''), dur); };

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u && ADMIN_EMAILS.includes(u.email)) { setUser(u); setIsAdmin(true); }
      else { setUser(null); setIsAdmin(false); }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => {
      setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(query(collection(db, 'riddles'), orderBy('dataInizio', 'desc')), (snap) => {
      setRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), (snap) => {
      setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedCompetition) { setCompetitionScores([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => {
      setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin, selectedCompetition]);

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!ADMIN_EMAILS.includes(cred.user.email)) { await signOut(auth); showMsg('Accesso non autorizzato'); }
    } catch { showMsg('Credenziali errate'); }
    finally { setAuthLoading(false); }
  };

  const handleAddCompetition = async () => {
    if (!newCompetition.nome || !newCompetition.dataInizio || !newCompetition.dataFine) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'competitions')), { nome: newCompetition.nome, descrizione: newCompetition.descrizione || '', dataInizio: Timestamp.fromDate(new Date(newCompetition.dataInizio)), dataFine: Timestamp.fromDate(new Date(newCompetition.dataFine)), participantsCount: 0, createdAt: serverTimestamp() });
      setNewCompetition({ nome: '', descrizione: '', dataInizio: '', dataFine: '' });
      showMsg('✅ Competizione creata!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleAddRiddle = async () => {
    const domanda = editorRef.current?.innerHTML || '';
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.competitionId || !newRiddle.dataInizio || !newRiddle.dataFine) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
      const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
      await setDoc(doc(collection(db, 'riddles')), { titolo: newRiddle.titolo, domanda, risposta: newRiddle.risposta.trim(), competitionId: newRiddle.competitionId, dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), punti: { primo: parseInt(newRiddle.puntoPrimo) || 3, secondo: parseInt(newRiddle.puntoSecondo) || 1, terzo: parseInt(newRiddle.puntoTerzo) || 1, altri: parseInt(newRiddle.puntoAltri) || 1 }, pointsAssigned: false, createdAt: serverTimestamp() });
      setNewRiddle({ ...newRiddle, titolo: '', risposta: '', dataInizio: '', dataFine: '' });
      if (editorRef.current) editorRef.current.innerHTML = '';
      showMsg('✅ Indovinello creato!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleAddAnnouncement = async () => {
    const messaggio = announcementEditorRef.current?.innerHTML || '';
    if (!newAnnouncement.titolo || !messaggio.trim()) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'announcements')), { titolo: newAnnouncement.titolo, messaggio, createdAt: serverTimestamp() });
      setNewAnnouncement({ titolo: '', messaggio: '' });
      if (announcementEditorRef.current) announcementEditorRef.current.innerHTML = '';
      showMsg('✅ Comunicazione inviata!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSubmitting(true);
    try {
      if (confirmDelete.type === 'competition') {
        const riddlesSnap = await getDocs(query(collection(db, 'riddles'), where('competitionId', '==', confirmDelete.id)));
        for (const r of riddlesSnap.docs) {
          const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id)));
          for (const a of answersSnap.docs) await deleteDoc(a.ref);
          await deleteDoc(r.ref);
        }
        const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', confirmDelete.id)));
        for (const s of scoresSnap.docs) await deleteDoc(s.ref);
        await deleteDoc(doc(db, 'competitions', confirmDelete.id));
        if (selectedCompetition?.id === confirmDelete.id) setSelectedCompetition(null);
      } else if (confirmDelete.type === 'riddle') {
        const riddle = riddles.find(r => r.id === confirmDelete.id);
        const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', confirmDelete.id)));
        for (const d of snap.docs) {
          const ans = d.data();
          if (ans.points > 0 && riddle?.competitionId) {
            const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${ans.userId}`);
            const scoreDoc = await getDoc(scoreRef);
            if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - ans.points) });
          }
          await deleteDoc(d.ref);
        }
        await deleteDoc(doc(db, 'riddles', confirmDelete.id));
      } else if (confirmDelete.type === 'user') {
        const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', confirmDelete.id)));
        for (const d of answersSnap.docs) await deleteDoc(d.ref);
        const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', confirmDelete.id)));
        for (const d of scoresSnap.docs) await deleteDoc(d.ref);
        await deleteDoc(doc(db, 'users', confirmDelete.id));
      } else if (confirmDelete.type === 'announcement') {
        await deleteDoc(doc(db, 'announcements', confirmDelete.id));
      }
      showMsg('✅ Eliminato');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); setConfirmDelete(null); }
  };

  const viewAnswers = async (r) => {
    setViewingRiddle(r);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id)));
    setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (!isAdmin) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Lock size={32} className="text-purple-600" /></div>
          <h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1>
        </div>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4" />
        <button onClick={handleLogin} disabled={authLoading} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
          {authLoading ? <Loader2 size={20} className="animate-spin" /> : 'Accedi'}
        </button>
        {message && <p className="mt-4 text-center text-red-600">{message}</p>}
      </div>
    </div>
  );

  if (viewingRiddle) return (
    <div className="min-h-screen bg-gray-100 p-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={[...users, ...competitionScores]} onBack={() => setViewingRiddle(null)} />
      </div>
    </div>
  );

  if (selectedCompetition) {
    const compRiddles = riddles.filter(r => r.competitionId === selectedCompetition.id);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    return (
      <div className="min-h-screen bg-gray-100 pb-24">
        <div className="bg-white p-4 shadow-sm mb-4">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
            <h2 className="text-xl font-bold text-purple-700">{selectedCompetition.nome}</h2>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-5">
            <h3 className="font-bold mb-3">Indovinelli ({compRiddles.length})</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {compRiddles.map(r => (
                <div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between">
                  <div>
                    <span className="font-medium">{r.titolo}</span>
                    <button onClick={() => viewAnswers(r)} className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button>
                    <p className="text-xs text-gray-500">Risposta: {r.risposta}</p>
                    {r.pointsAssigned ? <span className="text-xs text-green-600"><Check size={12} className="inline" /> Completato</span> : <span className="text-xs text-yellow-600">In corso</span>}
                  </div>
                  <button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5">
            <h3 className="font-bold mb-3">Classifica ({sortedScores.length})</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {sortedScores.map((s, i) => (
                <div key={s.id} className={`p-3 rounded-xl border flex justify-between ${i < 3 ? 'bg-yellow-50' : 'bg-white'}`}>
                  <span>{i + 1}. {s.username || 'Utente'}</span>
                  <span className="font-bold text-purple-700">{s.points || 0} pt</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeComps = competitions.filter(c => { const now = new Date(); const s = c.dataInizio?.toDate?.(); const e = c.dataFine?.toDate?.(); return now >= s && now <= e; });

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3>
            <p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 bg-gray-200 py-3 rounded-xl">Annulla</button>
              <button onClick={handleDelete} disabled={submitting} className="flex-1 bg-red-500 text-white py-3 rounded-xl flex items-center justify-center">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-4 shadow-sm mb-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold flex items-center gap-2"><Settings size={24} /> Admin</h1>
          <button onClick={() => signOut(auth)} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={22} /></button>
        </div>
      </div>

      {message && <div className={`mx-4 mb-4 p-4 rounded-xl text-center ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>}

      <div className="max-w-4xl mx-auto px-4">
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-4 text-center"><Flag className="mx-auto text-purple-500 mb-2" size={28} /><p className="text-2xl font-bold">{competitions.length}</p><p className="text-sm text-gray-500">Gare</p></div>
              <div className="bg-white rounded-2xl p-4 text-center"><LayoutGrid className="mx-auto text-blue-500 mb-2" size={28} /><p className="text-2xl font-bold">{riddles.length}</p><p className="text-sm text-gray-500">Quiz</p></div>
              <div className="bg-white rounded-2xl p-4 text-center"><Users className="mx-auto text-green-500 mb-2" size={28} /><p className="text-2xl font-bold">{users.length}</p><p className="text-sm text-gray-500">Utenti</p></div>
              <div className="bg-white rounded-2xl p-4 text-center"><Megaphone className="mx-auto text-orange-500 mb-2" size={28} /><p className="text-2xl font-bold">{announcements.length}</p><p className="text-sm text-gray-500">Avvisi</p></div>
            </div>
            {activeComps.length > 0 && (
              <div className="bg-white rounded-2xl p-5">
                <h3 className="font-bold mb-3">Gare attive</h3>
                {activeComps.map(c => (
                  <div key={c.id} onClick={() => setSelectedCompetition(c)} className="p-4 bg-green-50 rounded-xl border border-green-200 cursor-pointer mb-2">
                    <h4 className="font-semibold text-green-800">{c.nome}</h4>
                    <p className="text-sm text-green-600">{c.participantsCount || 0} partecipanti</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'competitions' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuova Gara</h3>
              <input type="text" placeholder="Nome *" value={newCompetition.nome} onChange={e => setNewCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
              <textarea placeholder="Descrizione" value={newCompetition.descrizione} onChange={e => setNewCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" />
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="text-sm text-gray-600">Inizio</label><input type="date" value={newCompetition.dataInizio} onChange={e => setNewCompetition(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
                <div><label className="text-sm text-gray-600">Fine</label><input type="date" value={newCompetition.dataFine} onChange={e => setNewCompetition(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              </div>
              <button onClick={handleAddCompetition} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}
              </button>
            </div>
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-3">Tutte le gare ({competitions.length})</h3>
              {competitions.map(c => (
                <div key={c.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center mb-2">
                  <div className="cursor-pointer" onClick={() => setSelectedCompetition(c)}>
                    <h4 className="font-semibold text-purple-700">{c.nome}</h4>
                    <p className="text-sm text-gray-500">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)}</p>
                  </div>
                  <button onClick={() => setConfirmDelete({ type: 'competition', id: c.id, name: c.nome })} className="text-red-500 p-2"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'riddles' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Quiz</h3>
              <select value={newRiddle.competitionId} onChange={e => setNewRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3">
                <option value="">-- Seleziona gara --</option>
                {competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <input type="text" placeholder="Titolo *" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
              <div className="mb-3">
                <div className="flex gap-2 mb-2">
                  {[['bold', Bold], ['italic', Italic], ['justifyCenter', AlignCenter], ['justifyLeft', AlignLeft], ['insertUnorderedList', List]].map(([cmd, Icon]) => (
                    <button key={cmd} type="button" onClick={() => { editorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded-lg hover:bg-gray-100"><Icon size={16} /></button>
                  ))}
                </div>
                <div ref={editorRef} contentEditable className="w-full min-h-20 px-4 py-3 border-2 border-gray-200 rounded-xl bg-white" />
              </div>
              <input type="text" placeholder="Risposta (case-sensitive) *" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
                <div><label className="text-sm text-gray-600">Ora inizio</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
                <div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              </div>
              <button type="button" onClick={() => setShowPuntiCustom(!showPuntiCustom)} className="text-sm text-purple-600 mb-3"><Trophy size={14} className="inline" /> Punteggi</button>
              {showPuntiCustom && (
                <div className="mb-3 p-3 bg-purple-50 rounded-xl grid grid-cols-4 gap-2">
                  <div><label className="text-xs">1°</label><input type="number" min="0" value={newRiddle.puntoPrimo} onChange={e => setNewRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div>
                  <div><label className="text-xs">2°</label><input type="number" min="0" value={newRiddle.puntoSecondo} onChange={e => setNewRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div>
                  <div><label className="text-xs">3°</label><input type="number" min="0" value={newRiddle.puntoTerzo} onChange={e => setNewRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div>
                  <div><label className="text-xs">Altri</label><input type="number" min="0" value={newRiddle.puntoAltri} onChange={e => setNewRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-2 border rounded text-center" /></div>
                </div>
              )}
              <button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea'}
              </button>
            </div>
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-3">Tutti i quiz ({riddles.length})</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {riddles.map(r => {
                  const comp = competitions.find(c => c.id === r.competitionId);
                  return (
                    <div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between">
                      <div>
                        <span className="font-medium">{r.titolo}</span>
                        <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{comp?.nome || 'N/A'}</span>
                        <button onClick={() => viewAnswers(r)} className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button>
                        <p className="text-xs text-gray-500">Risposta: {r.risposta}</p>
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'announcements' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Avviso</h3>
              <input type="text" placeholder="Titolo *" value={newAnnouncement.titolo} onChange={e => setNewAnnouncement(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
              <div className="mb-4">
                <label className="text-sm text-gray-600 mb-2 block">Messaggio *</label>
                <div className="flex gap-2 mb-2">
                  {[['bold', Bold], ['italic', Italic], ['insertUnorderedList', List]].map(([cmd, Icon]) => (
                    <button key={cmd} type="button" onClick={() => { announcementEditorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded-lg hover:bg-gray-100"><Icon size={16} /></button>
                  ))}
                </div>
                <div ref={announcementEditorRef} contentEditable className="w-full min-h-32 px-4 py-3 border-2 border-gray-200 rounded-xl bg-white focus:outline-none focus:border-purple-500" />
              </div>
              <button onClick={handleAddAnnouncement} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <><Megaphone size={18} /> Invia</>}
              </button>
            </div>
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold mb-3">Avvisi ({announcements.length})</h3>
              {announcements.map(a => (
                <div key={a.id} className="p-4 bg-gray-50 rounded-xl border mb-2 flex justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold">{a.titolo}</h4>
                    <div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: a.messaggio }} />
                    <p className="text-xs text-gray-400 mt-2">{formatDateTime(a.createdAt)}</p>
                  </div>
                  <button onClick={() => setConfirmDelete({ type: 'announcement', id: a.id, name: a.titolo })} className="text-red-500 p-1 ml-2"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl p-5">
            <h3 className="font-bold mb-3">Utenti ({users.length})</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {users.map(u => (
                <div key={u.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center">
                  <div>
                    <p className="font-medium">{u.username}</p>
                    <p className="text-sm text-gray-500">{u.email}</p>
                  </div>
                  <button onClick={() => setConfirmDelete({ type: 'user', id: u.id, name: u.username })} className="text-red-500 p-2"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AdminBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default Admin;
