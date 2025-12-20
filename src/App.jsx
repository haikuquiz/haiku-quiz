import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Star, Calendar, Users, LogOut, Mail, Lock, User, Eye, EyeOff, Check, Loader2, Clock, Award, ArrowLeft, ChevronRight, Flag, UserPlus, Crown } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const compareAnswers = (a, b) => a?.trim() === b?.trim();

const getPointsForPosition = (position, riddle) => {
  const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };
  if (position === 0) return punti.primo;
  if (position === 1) return punti.secondo;
  if (position === 2) return punti.terzo;
  return punti.altri;
};

const assignPointsForRiddle = async (riddleId, riddle) => {
  if (riddle.pointsAssigned) return false;

  const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
  const answers = [];
  answersSnap.forEach(doc => answers.push({ id: doc.id, ref: doc.ref, ...doc.data() }));
  
  answers.sort((a, b) => (a.time?.toDate?.() || 0) - (b.time?.toDate?.() || 0));

  let firstSolver = null;
  let correctPosition = 0;
  
  for (const answer of answers) {
    const isCorrect = compareAnswers(answer.answer, riddle.risposta);
    let points = 0;
    
    if (isCorrect) {
      points = getPointsForPosition(correctPosition, riddle);
      if (correctPosition === 0) firstSolver = answer.userId;
      correctPosition++;
      
      // Aggiorna punti nella competizione
      if (riddle.competitionId) {
        const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${answer.userId}`);
        const scoreDoc = await getDoc(scoreRef);
        if (scoreDoc.exists()) {
          await updateDoc(scoreRef, { points: (scoreDoc.data().points || 0) + points });
        } else {
          await setDoc(scoreRef, { competitionId: riddle.competitionId, oderId: answer.userId, points, odername: '' });
        }
      }
    }
    
    await updateDoc(answer.ref, { points, isCorrect });
  }
  
  await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, firstSolver, processedAt: serverTimestamp() });
  return true;
};

// ============ COMPONENTS ============

const CompetitionCard = ({ competition, isJoined, onJoin, onSelect, userScore, userRank }) => {
  const now = new Date();
  const start = competition.dataInizio?.toDate?.() || new Date(competition.dataInizio);
  const end = competition.dataFine?.toDate?.() || new Date(competition.dataFine);
  const isActive = now >= start && now <= end;
  const isPast = now > end;
  const isFuture = now < start;

  return (
    <div className={`bg-white rounded-lg p-4 border-2 ${isJoined ? 'border-purple-400' : 'border-gray-200'} transition-all hover:shadow-md`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <Flag className={isActive ? 'text-green-500' : isPast ? 'text-gray-400' : 'text-blue-500'} size={20} />
          <h3 className="font-bold text-gray-800">{competition.nome}</h3>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-green-100 text-green-700' : isPast ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'}`}>
          {isActive ? 'In corso' : isPast ? 'Conclusa' : 'Prossimamente'}
        </span>
      </div>
      
      {competition.descrizione && <p className="text-sm text-gray-600 mb-3">{competition.descrizione}</p>}
      
      <div className="text-xs text-gray-500 mb-3">
        <p>📅 {formatDate(competition.dataInizio)} - {formatDate(competition.dataFine)}</p>
        <p>👥 {competition.participantsCount || 0} partecipanti</p>
      </div>

      {isJoined && (
        <div className="bg-purple-50 rounded p-2 mb-3">
          <p className="text-sm text-purple-700">
            <Crown size={14} className="inline mr-1" />
            I tuoi punti: <strong>{userScore || 0}</strong> • Posizione: <strong>#{userRank || '-'}</strong>
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {!isJoined && !isPast ? (
          <button onClick={() => onJoin(competition.id)} className="flex-1 bg-purple-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 flex items-center justify-center gap-1">
            <UserPlus size={16} /> Partecipa
          </button>
        ) : isJoined ? (
          <button onClick={() => onSelect(competition)} className="flex-1 bg-purple-100 text-purple-700 py-2 rounded-lg text-sm font-semibold hover:bg-purple-200 flex items-center justify-center gap-1">
            <ChevronRight size={16} /> Entra
          </button>
        ) : (
          <button onClick={() => onSelect(competition)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 flex items-center justify-center gap-1">
            <Eye size={16} /> Visualizza
          </button>
        )}
      </div>
    </div>
  );
};

const CompetitionLeaderboard = ({ scores, currentUserId }) => {
  if (scores.length === 0) return <p className="text-gray-500 text-center py-4">Nessun partecipante ancora.</p>;
  
  const sorted = [...scores].sort((a, b) => (b.points || 0) - (a.points || 0));
  
  return (
    <div className="space-y-2">
      {sorted.map((score, index) => (
        <div key={score.oderId} className={`flex items-center justify-between p-3 rounded-lg ${index === 0 ? 'bg-yellow-100 border border-yellow-400' : index === 1 ? 'bg-gray-100' : index === 2 ? 'bg-orange-50' : 'bg-white border'}`}>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-gray-600 w-6">{index + 1}</span>
            <span className={`font-medium ${score.oderId === currentUserId ? 'text-purple-700' : 'text-gray-800'}`}>
              {score.username || 'Utente'} {score.oderId === currentUserId && '(Tu)'}
            </span>
          </div>
          <span className="font-bold text-purple-700">{score.points || 0} pt</span>
        </div>
      ))}
    </div>
  );
};

const RiddleCard = ({ riddle, onSubmit, hasAnswered, userAnswer, onViewAnswers, showViewButton }) => {
  const [answer, setAnswer] = useState('');
  const [localSubmitting, setLocalSubmitting] = useState(false);
  
  const now = new Date();
  const startDateTime = riddle.dataInizio?.toDate?.() || new Date(riddle.dataInizio);
  const endDate = riddle.dataFine?.toDate?.() || new Date(riddle.dataFine);
  const isPublished = now >= startDateTime;
  const isExpired = now > endDate;
  const punti = riddle.punti || { primo: 3, secondo: 1, terzo: 1, altri: 1 };

  const handleSubmit = async () => {
    if (!answer.trim() || localSubmitting) return;
    setLocalSubmitting(true);
    try { await onSubmit(riddle.id, answer.trim()); setAnswer(''); }
    catch (e) { console.error(e); }
    finally { setLocalSubmitting(false); }
  };

  return (
    <div className={`rounded-lg p-5 ${isExpired ? 'bg-gray-50' : 'bg-purple-50'}`}>
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-lg font-semibold text-gray-800">{riddle.titolo}</h3>
        {showViewButton && <button onClick={() => onViewAnswers(riddle)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">Classifica <ChevronRight size={16} /></button>}
      </div>
      
      {!isPublished ? (
        <p className="text-gray-500 italic">Disponibile dal {formatDate(riddle.dataInizio)}</p>
      ) : (
        <>
          <div className="text-gray-700 mb-3" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
          <div className="text-xs text-gray-500 mb-2">🥇 {punti.primo} pt | 🥈 {punti.secondo} pt | 🥉 {punti.terzo} pt | Altri: {punti.altri} pt</div>
          {!isExpired && <p className="text-xs text-gray-500 mb-2">Scadenza: {formatDate(riddle.dataFine)} {endDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>}
          
          {isExpired ? (
            <div className="bg-gray-100 rounded p-3">
              <p className="text-sm text-gray-600">Risposta: <strong>{riddle.risposta}</strong></p>
              {hasAnswered && <p className="text-sm mt-1">Tua risposta: "{userAnswer}" {compareAnswers(userAnswer, riddle.risposta) ? '✅' : '❌'}</p>}
            </div>
          ) : !hasAnswered ? (
            <>
              <p className="text-xs text-red-600 mb-2 font-semibold">⚠️ Un solo tentativo! CASE-SENSITIVE</p>
              <input type="text" placeholder="La tua risposta..." value={answer} onChange={e => setAnswer(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmit()} className="w-full px-4 py-2 border-2 border-purple-300 rounded-lg mb-2 focus:outline-none focus:border-purple-500" />
              <button onClick={handleSubmit} disabled={localSubmitting || !answer.trim()} className="w-full bg-green-600 text-white py-2 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                {localSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Invia'}
              </button>
            </>
          ) : (
            <div className="bg-blue-100 border border-blue-300 rounded p-3">
              <p className="text-blue-800 font-medium flex items-center gap-2"><Check size={18} /> Risposta inviata: "{userAnswer}"</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const RiddleAnswersView = ({ riddle, answers, users, currentUserId, onBack }) => {
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
      </div>
      <h4 className="font-semibold mb-3"><Clock size={18} className="inline mr-1" /> Risposte ({sorted.length})</h4>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            return (
              <div key={ans.id} className={`p-3 rounded-lg border ${ans.userId === currentUserId ? 'bg-yellow-50 border-yellow-300' : 'bg-white'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>{i + 1}</span>
                    <div>
                      <span className="font-medium">{ans.userId === currentUserId ? 'Tu' : (userMap[ans.userId] || 'Utente')}</span>
                      <p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p>
                    </div>
                  </div>
                  <span className={`font-bold ${ans.points > 0 ? 'text-green-600' : 'text-red-500'}`}>{riddle.pointsAssigned ? (ans.points > 0 ? `+${ans.points}` : '0') : '-'}</span>
                </div>
                <p className={`mt-1 pl-9 text-sm ${correct ? 'text-green-700' : 'text-red-600'}`}>"{ans.answer}"</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============ MAIN APP ============
const App = () => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [competitions, setCompetitions] = useState([]);
  const [userCompetitions, setUserCompetitions] = useState([]);
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionScores, setCompetitionScores] = useState([]);
  
  const [riddles, setRiddles] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);

  const showMessage = useCallback((msg, dur = 3000) => {
    setMessage(msg);
    if (dur > 0) setTimeout(() => setMessage(''), dur);
  }, []);

  // Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) setUserData({ id: userDoc.id, ...userDoc.data() });
      } else {
        setUser(null);
        setUserData(null);
        setSelectedCompetition(null);
      }
      setLoading(false);
    });
  }, []);

  // Load competitions
  useEffect(() => {
    return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => {
      setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // Load user's joined competitions
  useEffect(() => {
    if (!user) { setUserCompetitions([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('oderId', '==', user.uid)), (snap) => {
      setUserCompetitions(snap.docs.map(d => d.data().competitionId));
    });
  }, [user]);

  // Load riddles for selected competition
  useEffect(() => {
    if (!selectedCompetition) { setRiddles([]); return; }
    return onSnapshot(query(collection(db, 'riddles'), where('competitionId', '==', selectedCompetition.id), orderBy('dataInizio', 'desc')), async (snap) => {
      const now = new Date();
      const riddlesList = [];
      for (const docSnap of snap.docs) {
        const data = { id: docSnap.id, ...docSnap.data() };
        const end = data.dataFine?.toDate?.() || new Date(data.dataFine);
        if (now > end && !data.pointsAssigned) {
          try { await assignPointsForRiddle(docSnap.id, data); data.pointsAssigned = true; } catch (e) { console.error(e); }
        }
        riddlesList.push(data);
      }
      setRiddles(riddlesList);
    });
  }, [selectedCompetition]);

  // Load competition scores
  useEffect(() => {
    if (!selectedCompetition) { setCompetitionScores([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => {
      setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [selectedCompetition]);

  // Load user answers
  useEffect(() => {
    if (!user) { setUserAnswers({}); return; }
    return onSnapshot(query(collection(db, 'answers'), where('userId', '==', user.uid)), (snap) => {
      const answers = {};
      snap.forEach(doc => { const d = doc.data(); answers[d.riddleId] = { id: doc.id, ...d }; });
      setUserAnswers(answers);
    });
  }, [user]);

  // Periodic check for expired riddles
  useEffect(() => {
    const check = async () => {
      const snap = await getDocs(query(collection(db, 'riddles'), where('pointsAssigned', '==', false)));
      const now = new Date();
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const end = data.dataFine?.toDate?.() || new Date(data.dataFine);
        if (now > end) try { await assignPointsForRiddle(docSnap.id, data); } catch (e) { console.error(e); }
      }
    };
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRegister = async () => {
    if (authLoading) return;
    if (username.trim().length < 3) { showMessage('Nickname: minimo 3 caratteri'); return; }
    if (!email.includes('@')) { showMessage('Email non valida'); return; }
    if (password.length < 6) { showMessage('Password: minimo 6 caratteri'); return; }
    setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), { username: username.trim(), email, createdAt: serverTimestamp() });
      showMessage('Registrazione completata!');
    } catch (error) {
      showMessage(error.code === 'auth/email-already-in-use' ? 'Email già registrata' : 'Errore: ' + error.message);
    } finally { setAuthLoading(false); }
  };

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch { showMessage('Email o password errati'); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = async () => { 
    await signOut(auth); 
    setSelectedCompetition(null);
    setViewingRiddle(null);
  };

  const handleJoinCompetition = async (competitionId) => {
    if (!user) return;
    try {
      const scoreRef = doc(db, 'competitionScores', `${competitionId}_${user.uid}`);
      await setDoc(scoreRef, { 
        competitionId, 
        oderId: user.uid, 
        username: userData?.username || 'Utente',
        points: 0, 
        joinedAt: serverTimestamp() 
      });
      
      // Incrementa contatore partecipanti
      const compRef = doc(db, 'competitions', competitionId);
      const compDoc = await getDoc(compRef);
      if (compDoc.exists()) {
        await updateDoc(compRef, { participantsCount: (compDoc.data().participantsCount || 0) + 1 });
      }
      
      showMessage('✅ Iscrizione completata!');
    } catch (e) {
      showMessage('Errore: ' + e.message);
    }
  };

  const handleSubmitAnswer = async (riddleId, answer) => {
    if (!user || userAnswers[riddleId]) return;
    const answerData = { userId: user.uid, riddleId, answer, time: serverTimestamp(), points: 0, isCorrect: null };
    setUserAnswers(prev => ({ ...prev, [riddleId]: answerData }));
    showMessage('✅ Risposta inviata!');
    try { await setDoc(doc(collection(db, 'answers')), answerData); }
    catch (error) {
      setUserAnswers(prev => { const n = { ...prev }; delete n[riddleId]; return n; });
      showMessage('Errore nel salvataggio');
    }
  };

  const handleViewAnswers = async (riddle) => {
    setViewingRiddle(riddle);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
    setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center"><Loader2 className="animate-spin" size={32} /></div>;

  // Vista risposte indovinello
  if (viewingRiddle) return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4">
      <div className="max-w-4xl mx-auto">
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={competitionScores} currentUserId={user?.uid} onBack={() => setViewingRiddle(null)} />
      </div>
    </div>
  );

  // Vista competizione selezionata
  if (selectedCompetition && user) {
    const isJoined = userCompetitions.includes(selectedCompetition.id);
    const now = new Date();
    const activeRiddles = riddles.filter(r => {
      const start = r.dataInizio?.toDate?.() || new Date(r.dataInizio);
      const end = r.dataFine?.toDate?.() || new Date(r.dataFine);
      return now >= start && now <= end;
    });
    const pastRiddles = riddles.filter(r => {
      const end = r.dataFine?.toDate?.() || new Date(r.dataFine);
      return now > end;
    });
    const userScore = competitionScores.find(s => s.oderId === user.uid);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    const userRank = sortedScores.findIndex(s => s.oderId === user.uid) + 1;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={24} /></button>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-purple-800 flex items-center gap-2"><Flag className="text-purple-600" /> {selectedCompetition.nome}</h2>
                {selectedCompetition.descrizione && <p className="text-gray-600">{selectedCompetition.descrizione}</p>}
              </div>
              <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={20} /></button>
            </div>

            {isJoined && (
              <div className="bg-purple-50 rounded-lg p-4 mb-4">
                <p className="text-purple-700">
                  <Crown size={18} className="inline mr-1" />
                  I tuoi punti: <strong>{userScore?.points || 0}</strong> • Posizione: <strong>#{userRank || '-'}</strong>
                </p>
              </div>
            )}

            {!isJoined ? (
              <div className="text-center py-8">
                <p className="text-gray-600 mb-4">Non sei ancora iscritto a questa competizione</p>
                <button onClick={() => handleJoinCompetition(selectedCompetition.id)} className="bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 flex items-center gap-2 mx-auto">
                  <UserPlus size={20} /> Partecipa ora
                </button>
              </div>
            ) : (
              <>
                {activeRiddles.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Star className="text-yellow-500" /> Indovinelli attivi ({activeRiddles.length})</h3>
                    <div className="space-y-4">
                      {activeRiddles.map(r => (
                        <RiddleCard key={r.id} riddle={r} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} />
                      ))}
                    </div>
                  </div>
                )}

                {activeRiddles.length === 0 && (
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-6 text-center mb-6">
                    <p className="text-yellow-800 font-semibold">Nessun indovinello attivo al momento</p>
                    <p className="text-yellow-700 text-sm">Torna più tardi!</p>
                  </div>
                )}

                {pastRiddles.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Clock className="text-gray-500" /> Indovinelli conclusi ({pastRiddles.length})</h3>
                    <div className="space-y-3">
                      {pastRiddles.map(r => (
                        <RiddleCard key={r.id} riddle={r} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {message && <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-lg text-center">{message}</div>}
          </div>

          <div className="bg-white rounded-lg shadow-xl p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifica competizione</h3>
            <CompetitionLeaderboard scores={competitionScores} currentUserId={user?.uid} />
          </div>
        </div>
      </div>
    );
  }

  // Vista principale: lista competizioni
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8 pt-8">
          <h1 className="text-4xl font-bold text-purple-900 mb-2 flex items-center justify-center gap-2"><Star className="text-yellow-500" size={40} /> Haiku Quiz <Star className="text-yellow-500" size={40} /></h1>
          <p className="text-gray-700 flex items-center justify-center gap-2"><Calendar size={20} /> {new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        {!user ? (
          <div className="bg-white rounded-lg shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">{isLoginMode ? 'Accedi' : 'Registrati per giocare'}</h2>
            {!isLoginMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2"><User size={16} className="inline mr-1" /> Nickname</label>
                <input type="text" placeholder="Min. 3 caratteri" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500" />
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2"><Mail size={16} className="inline mr-1" /> Email</label>
              <input type="email" placeholder="tua@email.com" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2"><Lock size={16} className="inline mr-1" /> Password</label>
              <input type="password" placeholder="Min. 6 caratteri" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && (isLoginMode ? handleLogin() : handleRegister())} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500" />
            </div>
            <button onClick={isLoginMode ? handleLogin : handleRegister} disabled={authLoading} className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 mb-3 disabled:bg-gray-400 flex items-center justify-center gap-2">
              {authLoading ? <Loader2 size={20} className="animate-spin" /> : (isLoginMode ? 'Accedi' : 'Registrati')}
            </button>
            <button onClick={() => { setIsLoginMode(!isLoginMode); setMessage(''); }} className="w-full text-purple-600 hover:text-purple-800 text-sm">
              {isLoginMode ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
            </button>
            {message && <div className={`mt-4 p-3 rounded-lg text-center ${message.includes('Errore') || message.includes('errat') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{message}</div>}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <span className="text-gray-700">Ciao, </span>
                <span className="text-xl font-bold text-purple-700">{userData?.username}</span>
              </div>
              <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={20} /></button>
            </div>

            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Flag className="text-purple-600" /> Competizioni</h3>
            
            {competitions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>Nessuna competizione disponibile al momento.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {competitions.map(comp => {
                  const isJoined = userCompetitions.includes(comp.id);
                  const userScoreData = competitionScores.find(s => s.competitionId === comp.id && s.oderId === user.uid);
                  return (
                    <CompetitionCard
                      key={comp.id}
                      competition={comp}
                      isJoined={isJoined}
                      onJoin={handleJoinCompetition}
                      onSelect={setSelectedCompetition}
                      userScore={userScoreData?.points}
                      userRank={null}
                    />
                  );
                })}
              </div>
            )}

            {message && <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-lg text-center">{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
