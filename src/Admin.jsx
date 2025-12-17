import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, AlignCenter, AlignLeft, List, Eye, Check, Loader2, ArrowLeft, Clock, Award, Users, Lock } from 'lucide-react';
import { db, auth } from './firebase';
import { 
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const ADMIN_EMAILS = ['haikuquizofficial@gmail.com'];

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

const compareAnswers = (userAnswer, correctAnswer) => {
  if (!userAnswer || !correctAnswer) return false;
  return userAnswer.trim() === correctAnswer.trim();
};

const RiddleAnswersView = ({ riddle, answers, users, onBack }) => {
  const sortedAnswers = [...answers].sort((a, b) => {
    const timeA = a.time?.toDate ? a.time.toDate() : new Date(a.time);
    const timeB = b.time?.toDate ? b.time.toDate() : new Date(b.time);
    return timeA - timeB;
  });
  
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.username; });

  return (
    <div className="bg-white rounded-lg shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={24} className="text-gray-600" />
        </button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>

      <div className="mb-4 p-3 bg-purple-50 rounded-lg">
        <div className="text-sm text-gray-700 mb-2" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
        <p className="text-sm font-semibold text-purple-700">
          Risposta: <code className="bg-purple-100 px-2 py-1 rounded">{riddle.risposta}</code>
        </p>
      </div>

      <h4 className="font-semibold mb-3 flex items-center gap-2">
        <Clock size={18} /> Risposte ({sortedAnswers.length})
      </h4>

      {sortedAnswers.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Nessuna risposta</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sortedAnswers.map((answer, index) => {
            const isCorrect = compareAnswers(answer.answer, riddle.risposta);
            const isFirst = index === 0 && isCorrect && answer.points === 3;
            
            return (
              <div key={answer.id || index} className="p-3 rounded-lg border bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isFirst ? 'bg-yellow-400' : isCorrect ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{userMap[answer.userId] || 'Utente'}</span>
                        {isFirst && <span className="text-xs bg-yellow-400 px-2 py-0.5 rounded-full flex items-center gap-1"><Award size={12} /> PRIMO!</span>}
                      </div>
                      <p className="text-xs text-gray-500">{formatDateTime(answer.time)}</p>
                    </div>
                  </div>
                  <span className={`font-bold ${answer.points > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {riddle.pointsAssigned ? (answer.points > 0 ? `+${answer.points}` : '0') : '-'}
                  </span>
                </div>
                <p className={`mt-2 pl-11 text-sm ${isCorrect ? 'text-green-700' : 'text-red-600'}`}>
                  "{answer.answer}" {isCorrect ? '✓' : '✗'}
                </p>
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
  
  const [newRiddle, setNewRiddle] = useState({
    titolo: '', risposta: '',
    dataInizio: '', oraInizio: '09:00',
    dataFine: '', oraFine: '18:00'
  });
  
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  
  const editorRef = useRef(null);

  const showMsg = (msg, duration = 3000) => {
    setMessage(msg);
    if (duration > 0) setTimeout(() => setMessage(''), duration);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && ADMIN_EMAILS.includes(firebaseUser.email)) {
        setUser(firebaseUser);
        setIsAdmin(true);
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    
    const q = query(collection(db, 'riddles'), orderBy('dataInizio', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = [];
      snapshot.forEach((doc) => data.push({ id: doc.id, ...doc.data() }));
      setRiddles(data);
    });
    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    
    const q = query(collection(db, 'users'), orderBy('points', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = [];
      snapshot.forEach((doc) => data.push({ id: doc.id, ...doc.data() }));
      setUsers(data);
    });
    return () => unsubscribe();
  }, [isAdmin]);

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!ADMIN_EMAILS.includes(cred.user.email)) {
        await signOut(auth);
        showMsg('Accesso non autorizzato');
      }
    } catch (error) {
      showMsg('Credenziali errate');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const applyFormatting = (cmd) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand(cmd, false, null);
    }
  };

  const handleAddRiddle = async () => {
    const domanda = editorRef.current?.innerHTML || '';
    
    if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.dataInizio || !newRiddle.dataFine) {
      showMsg('Compila tutti i campi');
      return;
    }

    const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`);
    const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`);
    
    if (end <= start) {
      showMsg('Data fine deve essere dopo data inizio');
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'riddles')), {
        titolo: newRiddle.titolo,
        domanda: domanda,
        risposta: newRiddle.risposta.trim(),
        dataInizio: Timestamp.fromDate(start),
        dataFine: Timestamp.fromDate(end),
        pointsAssigned: false,
        firstSolver: null,
        createdAt: serverTimestamp()
      });
      
      setNewRiddle({ titolo: '', risposta: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00' });
      if (editorRef.current) editorRef.current.innerHTML = '';
      showMsg('✅ Indovinello creato!');
    } catch (error) {
      showMsg('Errore: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRiddle = async (riddleId) => {
    setSubmitting(true);
    try {
      // Get answers and subtract points
      const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
      
      for (const answerDoc of answersSnap.docs) {
        const answer = answerDoc.data();
        if (answer.points > 0) {
          const userRef = doc(db, 'users', answer.userId);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const currentPoints = userDoc.data().points || 0;
            await updateDoc(userRef, { points: Math.max(0, currentPoints - answer.points) });
          }
        }
        await deleteDoc(answerDoc.ref);
      }
      
      await deleteDoc(doc(db, 'riddles', riddleId));
      showMsg('✅ Eliminato');
      setConfirmDelete(null);
    } catch (error) {
      showMsg('Errore: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    setSubmitting(true);
    try {
      const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', userId)));
      for (const doc of answersSnap.docs) {
        await deleteDoc(doc.ref);
      }
      await deleteDoc(doc(db, 'users', userId));
      showMsg('✅ Utente eliminato');
      setConfirmDelete(null);
    } catch (error) {
      showMsg('Errore: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPoints = async (riddleId) => {
    setSubmitting(true);
    try {
      const riddleDoc = await getDoc(doc(db, 'riddles', riddleId));
      if (!riddleDoc.exists()) return;
      
      const riddle = riddleDoc.data();
      if (riddle.pointsAssigned) {
        showMsg('Punti già assegnati');
        return;
      }

      const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
      const answers = [];
      answersSnap.forEach(doc => answers.push({ id: doc.id, ref: doc.ref, ...doc.data() }));
      
      answers.sort((a, b) => {
        const timeA = a.time?.toDate ? a.time.toDate() : new Date(a.time);
        const timeB = b.time?.toDate ? b.time.toDate() : new Date(b.time);
        return timeA - timeB;
      });

      let firstSolver = null;
      
      for (const answer of answers) {
        const isCorrect = compareAnswers(answer.answer, riddle.risposta);
        let points = 0;
        
        if (isCorrect) {
          if (!firstSolver) {
            points = 3;
            firstSolver = answer.userId;
          } else {
            points = 1;
          }
          
          const userRef = doc(db, 'users', answer.userId);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            await updateDoc(userRef, { points: (userDoc.data().points || 0) + points });
          }
        }
        
        await updateDoc(answer.ref, { points, isCorrect });
      }
      
      await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, firstSolver });
      showMsg('✅ Punti assegnati!');
    } catch (error) {
      showMsg('Errore: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewAnswers = async (riddle) => {
    setViewingRiddle(riddle);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
    const answers = [];
    snap.forEach(doc => answers.push({ id: doc.id, ...doc.data() }));
    setRiddleAnswers(answers);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <Lock size={24} /> Admin Haiku Quiz
          </h1>
          
          <input
            type="email"
            placeholder="Email admin"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg mb-3"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 border rounded-lg mb-4"
          />
          
          <button
            onClick={handleLogin}
            disabled={authLoading}
            className="w-full bg-gray-800 text-white py-3 rounded-lg font-semibold hover:bg-gray-900 disabled:bg-gray-400 flex items-center justify-center gap-2"
          >
            {authLoading ? <Loader2 size={20} className="animate-spin" /> : 'Accedi'}
          </button>
          
          {message && <p className="mt-4 text-center text-red-600">{message}</p>}
        </div>
      </div>
    );
  }

  if (viewingRiddle) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-4xl mx-auto">
          <RiddleAnswersView
            riddle={viewingRiddle}
            answers={riddleAnswers}
            users={users}
            onBack={() => setViewingRiddle(null)}
          />
        </div>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3>
            <p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p>
            {confirmDelete.type === 'riddle' && (
              <p className="text-sm text-orange-600 mb-4">I punti verranno rimossi dagli utenti.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={submitting} className="flex-1 bg-gray-300 py-2 rounded-lg">Annulla</button>
              <button 
                onClick={() => confirmDelete.type === 'riddle' ? handleDeleteRiddle(confirmDelete.id) : handleDeleteUser(confirmDelete.id)}
                disabled={submitting}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Settings size={28} /> Admin Panel
            </h1>
            <button onClick={handleLogout} className="text-gray-500 hover:text-red-600">
              <LogOut size={24} />
            </button>
          </div>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-center ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {message}
            </div>
          )}

          {/* New Riddle Form */}
          <div className="mb-6 p-4 bg-green-50 rounded-lg">
            <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Plus size={20} /> Nuovo Indovinello
            </h2>
            
            <input
              type="text"
              placeholder="Titolo"
              value={newRiddle.titolo}
              onChange={(e) => setNewRiddle(p => ({ ...p, titolo: e.target.value }))}
              className="w-full px-4 py-2 border rounded-lg mb-3"
            />

            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                <button onClick={() => applyFormatting('bold')} className="p-2 border rounded hover:bg-gray-100"><Bold size={18} /></button>
                <button onClick={() => applyFormatting('italic')} className="p-2 border rounded hover:bg-gray-100"><Italic size={18} /></button>
                <button onClick={() => applyFormatting('justifyCenter')} className="p-2 border rounded hover:bg-gray-100"><AlignCenter size={18} /></button>
                <button onClick={() => applyFormatting('justifyLeft')} className="p-2 border rounded hover:bg-gray-100"><AlignLeft size={18} /></button>
                <button onClick={() => applyFormatting('insertUnorderedList')} className="p-2 border rounded hover:bg-gray-100"><List size={18} /></button>
              </div>
              <div
                ref={editorRef}
                contentEditable
                className="w-full min-h-24 px-4 py-2 border rounded-lg bg-white"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>

            <input
              type="text"
              placeholder="Risposta (CASE-SENSITIVE)"
              value={newRiddle.risposta}
              onChange={(e) => setNewRiddle(p => ({ ...p, risposta: e.target.value }))}
              className="w-full px-4 py-2 border rounded-lg mb-3"
            />

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-gray-600">Data inizio</label>
                <input type="date" value={newRiddle.dataInizio} onChange={(e) => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Ora inizio</label>
                <input type="time" value={newRiddle.oraInizio} onChange={(e) => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-gray-600">Data fine</label>
                <input type="date" value={newRiddle.dataFine} onChange={(e) => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Ora fine</label>
                <input type="time" value={newRiddle.oraFine} onChange={(e) => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-2 border rounded-lg" />
              </div>
            </div>

            <button 
              onClick={handleAddRiddle}
              disabled={submitting}
              className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Crea Indovinello'}
            </button>
          </div>

          {/* Riddles List */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="font-semibold text-gray-800 mb-3">Indovinelli ({riddles.length})</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {riddles.map((riddle) => {
                const end = riddle.dataFine?.toDate ? riddle.dataFine.toDate() : new Date(riddle.dataFine);
                const isPast = now > end;
                
                return (
                  <div key={riddle.id} className="p-3 bg-white rounded border">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-purple-700">{riddle.titolo}</span>
                          <button onClick={() => handleViewAnswers(riddle)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded">
                            <Eye size={12} className="inline" /> Risposte
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">Risposta: <code className="bg-gray-100 px-1">{riddle.risposta}</code></p>
                        
                        {riddle.pointsAssigned ? (
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={14} /> Punti assegnati</p>
                        ) : isPast ? (
                          <button onClick={() => handleAssignPoints(riddle.id)} disabled={submitting} className="text-xs bg-blue-500 text-white px-2 py-1 rounded mt-2">
                            Assegna punti
                          </button>
                        ) : (
                          <p className="text-xs text-yellow-600 mt-1">⏳ In corso</p>
                        )}
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'riddle', id: riddle.id, name: riddle.titolo })} className="text-red-500 p-1">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Users List */}
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-gray-800">Utenti ({users.length})</h2>
              <button onClick={() => setShowUsers(!showUsers)} className="text-sm text-blue-600">
                {showUsers ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
            
            {showUsers && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {users.map((user) => (
                  <div key={user.id} className="flex justify-between items-center p-3 bg-white rounded border">
                    <div>
                      <p className="font-semibold">{user.username}</p>
                      <p className="text-xs text-gray-500">{user.email} • {user.points || 0} punti</p>
                    </div>
                    <button onClick={() => setConfirmDelete({ type: 'user', id: user.id, name: user.username })} className="text-red-500 p-1">
                      <Trash2 size={18} />
                    </button>
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
