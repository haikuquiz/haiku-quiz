import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, AlignCenter, AlignLeft, List, Eye, Check, Loader2, ArrowLeft, Clock, Award, Lock, Trophy, Flag, Users } from 'lucide-react';
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

const RiddleAnswersView = ({ riddle, answers, users, onBack }) => {
  const sorted = [...answers].sort((a, b) => (a.time?.toDate?.() || 0) - (b.time?.toDate?.() || 0));
  const userMap = Object.fromEntries(users.map(u => [u.oderId || u.id, u.username]));
  const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };

  return (
    <div className="bg-white rounded-lg shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>
      <div className="mb-4 p-3 bg-purple-50 rounded-lg">
        <p className="text-sm font-semibold text-purple-700">Risposta: <code className="bg-purple-100 px-2 py-1 rounded">{riddle.risposta}</code></p>
        <p className="text-xs text-gray-500 mt-1">Punteggi: 🥇{punti.primo} 🥈{punti.secondo} 🥉{punti.terzo} altri:{punti.altri}</p>
      </div>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            return (
              <div key={ans.id} className="p-3 rounded-lg border bg-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-100' : 'bg-gray-100'}`}>{i + 1}</span>
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
  const [competitionScores, setCompetitionScores] = useState([]);
  
  const [activeTab, setActiveTab] = useState('competitions');
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [showUsers, setShowUsers] = useState(false);
  
  const [newCompetition, setNewCompetition] = useState({ nome: '', descrizione: '', dataInizio: '', dataFine: '' });
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', competitionId: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntoPrimo: 3, puntoSecondo: 1, puntoTerzo: 1, puntoAltri: 1 });
  const [showPuntiCustom, setShowPuntiCustom] = useState(false);
  
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  
  const editorRef = useRef(null);

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
    if (!newCompetition.nome || !newCompetition.dataInizio || !newCompetition.dataFine) { showMsg('Compila tutti i campi obbligatori'); return; }
    const start = new Date(newCompetition.dataInizio);
    const end = new Date(newCompetition.dataFine);
    if (end <= start) { showMsg('Data fine deve essere dopo data inizio'); return; }
    
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'competitions')), {
        nome: newCompetition.nome,
        descrizione: newCompetition.descrizione || '',
        dataInizio: Timestamp.fromDate(start),
        dataFine: Timestamp.fromDate(end),
        participantsCount: 0,
        createdAt: serverTimestamp()
      });
      setNewCompetition({ nome: '', descrizione: '', dataInizio: '', dataFine: '' });
      showMsg('✅ Competizione creata!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleAddRiddle = async () => {
    const domanda = editorRef.current?.innerHTML || '';
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.competitionId || !newRiddle.dataInizio || !newRiddle.dataFine) { 
      showMsg('Compila tutti i campi'); return; 
    }
    const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
    const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
    if (end <= start) { showMsg('Data fine deve essere dopo data inizio'); return; }
    
    setSubmitting(true);
    try {
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
        pointsAssigned: false,
        firstSolver: null,
        createdAt: serverTimestamp()
      });
      setNewRiddle({ titolo: '', risposta: '', competitionId: newRiddle.competitionId, dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntoPrimo: 3, puntoSecondo: 1, puntoTerzo: 1, puntoAltri: 1 });
      if (editorRef.current) editorRef.current.innerHTML = '';
      setShowPuntiCustom(false);
      showMsg('✅ Indovinello creato!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteCompetition = async (id) => {
    setSubmitting(true);
    try {
      // Elimina tutti i riddles della competizione
      const riddlesSnap = await getDocs(query(collection(db, 'riddles'), where('competitionId', '==', id)));
      for (const r of riddlesSnap.docs) {
        // Elimina risposte del riddle
        const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id)));
        for (const a of answersSnap.docs) await deleteDoc(a.ref);
        await deleteDoc(r.ref);
      }
      // Elimina scores della competizione
      const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', id)));
      for (const s of scoresSnap.docs) await deleteDoc(s.ref);
      // Elimina competizione
      await deleteDoc(doc(db, 'competitions', id));
      showMsg('✅ Competizione eliminata');
      setConfirmDelete(null);
      if (selectedCompetition?.id === id) setSelectedCompetition(null);
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteRiddle = async (id) => {
    setSubmitting(true);
    try {
      const riddle = riddles.find(r => r.id === id);
      const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', id)));
      for (const d of snap.docs) {
        const ans = d.data();
        if (ans.points > 0 && riddle?.competitionId) {
          const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${ans.userId}`);
          const scoreDoc = await getDoc(scoreRef);
          if (scoreDoc.exists()) {
            await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - ans.points) });
          }
        }
        await deleteDoc(d.ref);
      }
      await deleteDoc(doc(db, 'riddles', id));
      showMsg('✅ Eliminato'); setConfirmDelete(null);
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteUser = async (id) => {
    setSubmitting(true);
    try {
      const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', id)));
      for (const d of answersSnap.docs) await deleteDoc(d.ref);
      const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', id)));
      for (const d of scoresSnap.docs) await deleteDoc(d.ref);
      await deleteDoc(doc(db, 'users', id));
      showMsg('✅ Eliminato'); setConfirmDelete(null);
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const viewAnswers = async (r) => {
    setViewingRiddle(r);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id)));
    setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin" size={32} /></div>;

  if (!isAdmin) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><Lock size={24} /> Admin Haiku Quiz</h1>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border rounded-lg mb-3" />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-3 border rounded-lg mb-4" />
        <button onClick={handleLogin} disabled={authLoading} className="w-full bg-gray-800 text-white py-3 rounded-lg font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">
          {authLoading ? <Loader2 size={20} className="animate-spin" /> : 'Accedi'}
        </button>
        {message && <p className="mt-4 text-center text-red-600">{message}</p>}
      </div>
    </div>
  );

  if (viewingRiddle) return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={[...users, ...competitionScores]} onBack={() => setViewingRiddle(null)} />
      </div>
    </div>
  );

  const now = new Date();
  const competitionRiddles = selectedCompetition ? riddles.filter(r => r.competitionId === selectedCompetition.id) : [];
  const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3>
            <p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p>
            {confirmDelete.type === 'competition' && <p className="text-sm text-orange-600 mb-4">Verranno eliminati anche tutti gli indovinelli e i punteggi associati!</p>}
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={submitting} className="flex-1 bg-gray-300 py-2 rounded-lg">Annulla</button>
              <button onClick={() => {
                if (confirmDelete.type === 'competition') handleDeleteCompetition(confirmDelete.id);
                else if (confirmDelete.type === 'riddle') handleDeleteRiddle(confirmDelete.id);
                else handleDeleteUser(confirmDelete.id);
              }} disabled={submitting} className="flex-1 bg-red-600 text-white py-2 rounded-lg flex items-center justify-center">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Settings size={28} /> Admin Panel</h1>
            <button onClick={() => signOut(auth)} className="text-gray-500 hover:text-red-600"><LogOut size={24} /></button>
          </div>

          {message && <div className={`mb-4 p-3 rounded-lg text-center ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{message}</div>}

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b">
            <button onClick={() => { setActiveTab('competitions'); setSelectedCompetition(null); }} className={`px-4 py-2 font-medium ${activeTab === 'competitions' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`}>
              <Flag size={18} className="inline mr-1" /> Competizioni
            </button>
            <button onClick={() => setActiveTab('riddles')} className={`px-4 py-2 font-medium ${activeTab === 'riddles' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`}>
              <Trophy size={18} className="inline mr-1" /> Indovinelli
            </button>
            <button onClick={() => setActiveTab('users')} className={`px-4 py-2 font-medium ${activeTab === 'users' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`}>
              <Users size={18} className="inline mr-1" /> Utenti
            </button>
          </div>

          {/* COMPETIZIONI TAB */}
          {activeTab === 'competitions' && !selectedCompetition && (
            <>
              <div className="mb-6 p-4 bg-green-50 rounded-lg">
                <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus size={20} /> Nuova Competizione</h2>
                <input type="text" placeholder="Nome competizione *" value={newCompetition.nome} onChange={e => setNewCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3" />
                <textarea placeholder="Descrizione (opzionale)" value={newCompetition.descrizione} onChange={e => setNewCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3 h-20" />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div><label className="text-sm text-gray-600">Data inizio *</label><input type="date" value={newCompetition.dataInizio} onChange={e => setNewCompetition(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                  <div><label className="text-sm text-gray-600">Data fine *</label><input type="date" value={newCompetition.dataFine} onChange={e => setNewCompetition(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                </div>
                <button onClick={handleAddCompetition} disabled={submitting} className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Crea Competizione'}
                </button>
              </div>

              <div className="space-y-3">
                <h2 className="font-semibold">Competizioni ({competitions.length})</h2>
                {competitions.map(c => {
                  const riddleCount = riddles.filter(r => r.competitionId === c.id).length;
                  return (
                    <div key={c.id} className="p-4 bg-white rounded-lg border flex justify-between items-center">
                      <div className="flex-1 cursor-pointer" onClick={() => setSelectedCompetition(c)}>
                        <h3 className="font-semibold text-purple-700">{c.nome}</h3>
                        <p className="text-sm text-gray-500">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)}</p>
                        <p className="text-xs text-gray-400">{riddleCount} indovinelli • {c.participantsCount || 0} partecipanti</p>
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'competition', id: c.id, name: c.nome })} className="text-red-500 p-2"><Trash2 size={18} /></button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* COMPETIZIONE SELEZIONATA */}
          {activeTab === 'competitions' && selectedCompetition && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={24} /></button>
                <div>
                  <h2 className="text-xl font-bold text-purple-700">{selectedCompetition.nome}</h2>
                  <p className="text-sm text-gray-500">{formatDate(selectedCompetition.dataInizio)} - {formatDate(selectedCompetition.dataFine)}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">Indovinelli ({competitionRiddles.length})</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {competitionRiddles.map(r => {
                      const end = r.dataFine?.toDate?.() || new Date(r.dataFine);
                      const past = now > end;
                      return (
                        <div key={r.id} className="p-3 bg-gray-50 rounded border">
                          <div className="flex justify-between">
                            <div className="flex-1">
                              <span className="font-medium">{r.titolo}</span>
                              <button onClick={() => viewAnswers(r)} className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button>
                              <p className="text-xs text-gray-500">Risposta: {r.risposta}</p>
                              <p className="text-xs text-gray-400">{formatDate(r.dataInizio)} - {formatDate(r.dataFine)}</p>
                              {r.pointsAssigned ? <span className="text-xs text-green-600"><Check size={12} className="inline" /> Punti assegnati</span> : past ? <span className="text-xs text-blue-600">⏳ In elaborazione</span> : <span className="text-xs text-yellow-600">⏳ In corso</span>}
                            </div>
                            <button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Classifica ({sortedScores.length} partecipanti)</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {sortedScores.map((s, i) => (
                      <div key={s.id} className={`p-3 rounded border flex justify-between ${i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-gray-50' : i === 2 ? 'bg-orange-50' : 'bg-white'}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-600 w-6">{i + 1}</span>
                          <span>{s.username || 'Utente'}</span>
                        </div>
                        <span className="font-bold text-purple-700">{s.points || 0} pt</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* INDOVINELLI TAB */}
          {activeTab === 'riddles' && (
            <>
              <div className="mb-6 p-4 bg-green-50 rounded-lg">
                <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus size={20} /> Nuovo Indovinello</h2>
                
                <div className="mb-3">
                  <label className="text-sm text-gray-600">Competizione *</label>
                  <select value={newRiddle.competitionId} onChange={e => setNewRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-2 border rounded-lg">
                    <option value="">-- Seleziona competizione --</option>
                    {competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>

                <input type="text" placeholder="Titolo *" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3" />
                
                <div className="mb-3">
                  <label className="text-sm text-gray-600">Domanda *</label>
                  <div className="flex gap-2 mb-2">
                    {[['bold', Bold], ['italic', Italic], ['justifyCenter', AlignCenter], ['justifyLeft', AlignLeft], ['insertUnorderedList', List]].map(([cmd, Icon]) => (
                      <button key={cmd} type="button" onClick={() => { editorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded hover:bg-gray-100"><Icon size={18} /></button>
                    ))}
                  </div>
                  <div ref={editorRef} contentEditable className="w-full min-h-20 px-4 py-2 border rounded-lg bg-white" />
                </div>

                <input type="text" placeholder="Risposta (CASE-SENSITIVE) *" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3" />

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                  <div><label className="text-sm text-gray-600">Ora inizio</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                  <div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
                </div>

                <div className="mb-3">
                  <button type="button" onClick={() => setShowPuntiCustom(!showPuntiCustom)} className="text-sm text-purple-600 hover:text-purple-800">
                    <Trophy size={16} className="inline mr-1" /> {showPuntiCustom ? 'Nascondi' : 'Personalizza'} punteggi
                  </button>
                  {showPuntiCustom && (
                    <div className="mt-2 p-3 bg-purple-50 rounded-lg grid grid-cols-4 gap-2">
                      <div><label className="text-xs">🥇 Primo</label><input type="number" min="0" value={newRiddle.puntoPrimo} onChange={e => setNewRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-1 border rounded text-center" /></div>
                      <div><label className="text-xs">🥈 Secondo</label><input type="number" min="0" value={newRiddle.puntoSecondo} onChange={e => setNewRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-1 border rounded text-center" /></div>
                      <div><label className="text-xs">🥉 Terzo</label><input type="number" min="0" value={newRiddle.puntoTerzo} onChange={e => setNewRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-1 border rounded text-center" /></div>
                      <div><label className="text-xs">Altri</label><input type="number" min="0" value={newRiddle.puntoAltri} onChange={e => setNewRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-1 border rounded text-center" /></div>
                    </div>
                  )}
                </div>

                <button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Crea Indovinello'}
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                <h2 className="font-semibold">Tutti gli indovinelli ({riddles.length})</h2>
                {riddles.map(r => {
                  const comp = competitions.find(c => c.id === r.competitionId);
                  return (
                    <div key={r.id} className="p-3 bg-white rounded border flex justify-between">
                      <div>
                        <span className="font-medium">{r.titolo}</span>
                        <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{comp?.nome || 'N/A'}</span>
                        <button onClick={() => viewAnswers(r)} className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /></button>
                        <p className="text-xs text-gray-500">Risposta: {r.risposta}</p>
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* UTENTI TAB */}
          {activeTab === 'users' && (
            <div className="space-y-2">
              <h2 className="font-semibold">Utenti registrati ({users.length})</h2>
              {users.map(u => (
                <div key={u.id} className="p-3 bg-white rounded border flex justify-between items-center">
                  <div>
                    <p className="font-medium">{u.username}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                  <button onClick={() => setConfirmDelete({ type: 'user', id: u.id, name: u.username })} className="text-red-500 p-1"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
