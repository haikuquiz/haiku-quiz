import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, AlignCenter, AlignLeft, List, Eye, Check, Loader2, ArrowLeft, Clock, Award, Users, Lock } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const ADMIN_EMAILS = ['haikuquizofficial@gmail.com'];

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const compareAnswers = (a, b) => a?.trim() === b?.trim();

const RiddleAnswersView = ({ riddle, answers, users, onBack }) => {
  const sorted = [...answers].sort((a, b) => (a.time?.toDate?.() || 0) - (b.time?.toDate?.() || 0));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

  return (
    <div className="bg-white rounded-lg shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>
      <div className="mb-4 p-3 bg-purple-50 rounded-lg">
        <div className="text-sm mb-2" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
        <p className="text-sm font-semibold text-purple-700">Risposta: <code className="bg-purple-100 px-2 py-1 rounded">{riddle.risposta}</code></p>
      </div>
      <h4 className="font-semibold mb-3"><Clock size={18} className="inline" /> Risposte ({sorted.length})</h4>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            const first = i === 0 && correct && ans.points === 3;
            return (
              <div key={ans.id} className="p-3 rounded-lg border bg-white">
                <div className="flex justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${first ? 'bg-yellow-400' : correct ? 'bg-green-100' : 'bg-gray-100'}`}>{i + 1}</span>
                    <div>
                      <span className="font-semibold">{userMap[ans.userId] || 'Utente'}</span>
                      {first && <span className="ml-2 text-xs bg-yellow-400 px-2 py-0.5 rounded-full"><Award size={12} className="inline" /> PRIMO!</span>}
                      <p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p>
                    </div>
                  </div>
                  <span className={`font-bold ${ans.points > 0 ? 'text-green-600' : 'text-red-500'}`}>{riddle.pointsAssigned ? (ans.points > 0 ? `+${ans.points}` : '0') : '-'}</span>
                </div>
                <p className={`mt-2 pl-11 text-sm ${correct ? 'text-green-700' : 'text-red-600'}`}>"{ans.answer}" {correct ? '✓' : '✗'}</p>
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
  const [riddles, setRiddles] = useState([]);
  const [users, setUsers] = useState([]);
  const [showUsers, setShowUsers] = useState(false);
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00' });
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
    return onSnapshot(query(collection(db, 'riddles'), orderBy('dataInizio', 'desc')), (snap) => {
      setRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(query(collection(db, 'users'), orderBy('points', 'desc')), (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isAdmin]);

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!ADMIN_EMAILS.includes(cred.user.email)) { await signOut(auth); showMsg('Accesso non autorizzato'); }
    } catch { showMsg('Credenziali errate'); }
    finally { setAuthLoading(false); }
  };

  const handleAddRiddle = async () => {
    const domanda = editorRef.current?.innerHTML || '';
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.dataInizio || !newRiddle.dataFine) { showMsg('Compila tutti i campi'); return; }
    const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
    const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
    if (end <= start) { showMsg('Data fine deve essere dopo data inizio'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'riddles')), { titolo: newRiddle.titolo, domanda, risposta: newRiddle.risposta.trim(), dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), pointsAssigned: false, firstSolver: null, createdAt: serverTimestamp() });
      setNewRiddle({ titolo: '', risposta: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00' });
      if (editorRef.current) editorRef.current.innerHTML = '';
      showMsg('✅ Indovinello creato!');
    } catch (e) { showMsg('Errore: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteRiddle = async (id) => {
    setSubmitting(true);
    try {
      const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', id)));
      for (const d of snap.docs) {
        const ans = d.data();
        if (ans.points > 0) {
          const uRef = doc(db, 'users', ans.userId);
          const uDoc = await getDoc(uRef);
          if (uDoc.exists()) await updateDoc(uRef, { points: Math.max(0, (uDoc.data().points || 0) - ans.points) });
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
      const snap = await getDocs(query(collection(db, 'answers'), where('userId', '==', id)));
      for (const d of snap.docs) await deleteDoc(d.ref);
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
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={users} onBack={() => setViewingRiddle(null)} />
      </div>
    </div>
  );

  const now = new Date();

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3>
            <p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p>
            {confirmDelete.type === 'riddle' && <p className="text-sm text-orange-600 mb-4">I punti verranno rimossi.</p>}
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={submitting} className="flex-1 bg-gray-300 py-2 rounded-lg">Annulla</button>
              <button onClick={() => confirmDelete.type === 'riddle' ? handleDeleteRiddle(confirmDelete.id) : handleDeleteUser(confirmDelete.id)} disabled={submitting} className="flex-1 bg-red-600 text-white py-2 rounded-lg flex items-center justify-center">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Settings size={28} /> Admin Panel</h1>
            <button onClick={() => signOut(auth)} className="text-gray-500 hover:text-red-600"><LogOut size={24} /></button>
          </div>
          {message && <div className={`mb-4 p-3 rounded-lg text-center ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{message}</div>}
          
          <div className="mb-6 p-4 bg-green-50 rounded-lg">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus size={20} /> Nuovo Indovinello</h2>
            <input type="text" placeholder="Titolo" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3" />
            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                {[['bold', Bold], ['italic', Italic], ['justifyCenter', AlignCenter], ['justifyLeft', AlignLeft], ['insertUnorderedList', List]].map(([cmd, Icon]) => (
                  <button key={cmd} onClick={() => { editorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded hover:bg-gray-100"><Icon size={18} /></button>
                ))}
              </div>
              <div ref={editorRef} contentEditable className="w-full min-h-24 px-4 py-2 border rounded-lg bg-white" style={{ whiteSpace: 'pre-wrap' }} />
            </div>
            <input type="text" placeholder="Risposta (CASE-SENSITIVE)" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-2 border rounded-lg mb-3" />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
              <div><label className="text-sm text-gray-600">Ora inizio</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
              <div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" /></div>
            </div>
            <button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Crea Indovinello'}
            </button>
          </div>

          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="font-semibold mb-3">Indovinelli ({riddles.length})</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {riddles.map(r => {
                const end = r.dataFine?.toDate?.() || new Date(r.dataFine);
                const past = now > end;
                return (
                  <div key={r.id} className="p-3 bg-white rounded border">
                    <div className="flex justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-purple-700">{r.titolo}</span>
                          <button onClick={() => viewAnswers(r)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded"><Eye size={12} className="inline" /> Risposte</button>
                        </div>
                        <p className="text-xs text-gray-500">Risposta: <code className="bg-gray-100 px-1">{r.risposta}</code></p>
                        {r.pointsAssigned ? <p className="text-xs text-green-600 mt-1"><Check size={14} className="inline" /> Punti assegnati</p> : past ? <p className="text-xs text-blue-600 mt-1">⏳ Scaduto - punti in elaborazione</p> : <p className="text-xs text-yellow-600 mt-1">⏳ In corso</p>}
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} className="text-red-500 p-1"><Trash2 size={18} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold">Utenti ({users.length})</h2>
              <button onClick={() => setShowUsers(!showUsers)} className="text-sm text-blue-600">{showUsers ? 'Nascondi' : 'Mostra'}</button>
            </div>
            {showUsers && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {users.map(u => (
                  <div key={u.id} className="flex justify-between items-center p-3 bg-white rounded border">
                    <div><p className="font-semibold">{u.username}</p><p className="text-xs text-gray-500">{u.email} • {u.points || 0} punti</p></div>
                    <button onClick={() => setConfirmDelete({ type: 'user', id: u.id, name: u.username })} className="text-red-500 p-1"><Trash2 size={18} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
