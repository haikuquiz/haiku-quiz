import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Star, Calendar, Users, LogOut, Mail, Lock, User, Check, Loader2, Clock, ArrowLeft, ChevronRight, Flag, UserPlus, Crown, Home, Bell, X, Megaphone } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, limit } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

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
  let correctPosition = 0;
  for (const answer of answers) {
    const isCorrect = compareAnswers(answer.answer, riddle.risposta);
    let points = 0;
    if (isCorrect) {
      points = getPointsForPosition(correctPosition, riddle);
      correctPosition++;
      if (riddle.competitionId) {
        const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${answer.userId}`);
        const scoreDoc = await getDoc(scoreRef);
        if (scoreDoc.exists()) {
          await updateDoc(scoreRef, { points: (scoreDoc.data().points || 0) + points });
        }
      }
    }
    await updateDoc(answer.ref, { points, isCorrect });
  }
  await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, processedAt: serverTimestamp() });
  return true;
};

const BottomNav = ({ activeTab, setActiveTab, hasNotifications }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 z-50">
    <div className="max-w-lg mx-auto flex justify-around">
      {[
        { id: 'home', icon: Home, label: 'Home' },
        { id: 'competitions', icon: Flag, label: 'Gare' },
        { id: 'leaderboard', icon: Trophy, label: 'Classifica' },
        { id: 'notifications', icon: Bell, label: 'Avvisi', badge: hasNotifications },
      ].map(tab => (
        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center px-3 py-1 rounded-lg relative ${activeTab === tab.id ? 'text-purple-600' : 'text-gray-500'}`}>
          <tab.icon size={24} />
          <span className="text-xs mt-1">{tab.label}</span>
          {tab.badge && <span className="absolute top-0 right-1 w-2 h-2 bg-red-500 rounded-full" />}
        </button>
      ))}
    </div>
  </div>
);

const AnnouncementPopup = ({ announcement, onClose, onMarkRead }) => {
  if (!announcement) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400"><X size={24} /></button>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
            <Megaphone className="text-purple-600" size={24} />
          </div>
          <div>
            <h3 className="font-bold text-lg">{announcement.titolo}</h3>
            <p className="text-sm text-gray-500">{formatDate(announcement.createdAt)}</p>
          </div>
        </div>
        <div className="text-gray-700 mb-6 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: announcement.messaggio }} />
        <button onClick={() => { onMarkRead(announcement.id); onClose(); }} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold">Ho capito</button>
      </div>
    </div>
  );
};

const CompetitionCard = ({ competition, isJoined, onJoin, onSelect, userScore, userRank }) => {
  const now = new Date();
  const start = competition.dataInizio?.toDate?.() || new Date(competition.dataInizio);
  const end = competition.dataFine?.toDate?.() || new Date(competition.dataFine);
  const isActive = now >= start && now <= end;
  const isPast = now > end;

  return (
    <div className={`bg-white rounded-2xl p-5 border-2 ${isJoined ? 'border-purple-400' : 'border-gray-100'}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? 'bg-green-100' : isPast ? 'bg-gray-100' : 'bg-blue-100'}`}>
            <Flag className={isActive ? 'text-green-600' : isPast ? 'text-gray-500' : 'text-blue-600'} size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800">{competition.nome}</h3>
            <p className="text-xs text-gray-500">{competition.participantsCount || 0} partecipanti</p>
          </div>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full font-medium ${isActive ? 'bg-green-100 text-green-700' : isPast ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'}`}>
          {isActive ? 'Live' : isPast ? 'Finita' : 'Presto'}
        </span>
      </div>
      {competition.descrizione && <p className="text-sm text-gray-600 mb-3">{competition.descrizione}</p>}
      <p className="text-xs text-gray-400 mb-3">{formatDate(competition.dataInizio)} - {formatDate(competition.dataFine)}</p>
      {isJoined && (
        <div className="bg-purple-50 rounded-xl p-3 mb-3 flex justify-between items-center">
          <span className="flex items-center gap-1"><Crown size={16} className="text-yellow-500" /> {userScore || 0} pt</span>
          <span className="text-sm text-gray-600">#{userRank || '-'}</span>
        </div>
      )}
      <button onClick={() => isJoined || isPast ? onSelect(competition) : onJoin(competition.id)} className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 ${isJoined ? 'bg-purple-600 text-white' : isPast ? 'bg-gray-100 text-gray-600' : 'bg-purple-500 text-white'}`}>
        {isJoined ? <><ChevronRight size={18} /> Entra</> : isPast ? 'Visualizza' : <><UserPlus size={18} /> Partecipa</>}
      </button>
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
    finally { setLocalSubmitting(false); }
  };

  return (
    <div className={`rounded-2xl p-5 ${isExpired ? 'bg-gray-50' : 'bg-purple-50'}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-bold text-gray-800">{riddle.titolo}</h3>
        {showViewButton && <button onClick={() => onViewAnswers(riddle)} className="text-sm text-purple-600 font-medium flex items-center gap-1">Risultati <ChevronRight size={16} /></button>}
      </div>
      {!isPublished ? (
        <p className="text-gray-500">Disponibile dal {formatDate(riddle.dataInizio)}</p>
      ) : (
        <>
          <div className="text-gray-700 mb-4" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">1° {punti.primo}pt</span>
            <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">2° {punti.secondo}pt</span>
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">3° {punti.terzo}pt</span>
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">Altri {punti.altri}pt</span>
          </div>
          {isExpired ? (
            <div className="bg-white rounded-xl p-4 border">
              <p className="text-sm text-gray-600">Risposta: <strong className="text-purple-700">{riddle.risposta}</strong></p>
              {hasAnswered && <p className="text-sm mt-2">Tua: "{userAnswer}" {compareAnswers(userAnswer, riddle.risposta) ? '✅' : '❌'}</p>}
            </div>
          ) : !hasAnswered ? (
            <>
              <p className="text-xs text-gray-500 mb-2">Scade: {formatDateTime(riddle.dataFine)}</p>
              <p className="text-xs text-red-500 mb-3 font-medium">⚠️ Un solo tentativo!</p>
              <div className="flex gap-2">
                <input type="text" placeholder="Risposta..." value={answer} onChange={e => setAnswer(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmit()} className="flex-1 px-4 py-3 border-2 border-purple-200 rounded-xl" />
                <button onClick={handleSubmit} disabled={localSubmitting || !answer.trim()} className="px-6 py-3 bg-green-500 text-white rounded-xl font-semibold disabled:bg-gray-300 flex items-center gap-2">
                  {localSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Invia'}
                </button>
              </div>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-700 font-medium flex items-center gap-2"><Check size={18} /> Inviata: "{userAnswer}"</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const CompetitionLeaderboard = ({ scores, currentUserId }) => {
  if (scores.length === 0) return <p className="text-gray-500 text-center py-8">Nessun partecipante</p>;
  const sorted = [...scores].sort((a, b) => (b.points || 0) - (a.points || 0));
  return (
    <div className="space-y-2">
      {sorted.map((score, index) => (
        <div key={score.oderId} className={`flex items-center justify-between p-4 rounded-xl ${index === 0 ? 'bg-yellow-100 border border-yellow-300' : index === 1 ? 'bg-gray-100' : index === 2 ? 'bg-orange-50' : 'bg-white border'}`}>
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${index === 0 ? 'bg-yellow-400' : index === 1 ? 'bg-gray-400 text-white' : index === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200'}`}>{index + 1}</span>
            <span className={score.oderId === currentUserId ? 'text-purple-700 font-semibold' : ''}>{score.username || 'Utente'} {score.oderId === currentUserId && '(Tu)'}</span>
          </div>
          <span className="font-bold text-purple-700">{score.points || 0} pt</span>
        </div>
      ))}
    </div>
  );
};

const RiddleAnswersView = ({ riddle, answers, users, currentUserId, onBack }) => {
  const sorted = [...answers].sort((a, b) => (a.time?.toDate?.() || 0) - (b.time?.toDate?.() || 0));
  const userMap = Object.fromEntries(users.map(u => [u.oderId || u.id, u.username]));
  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>
      <div className="mb-4 p-4 bg-purple-50 rounded-xl">
        <p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p>
      </div>
      {sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            return (
              <div key={ans.id} className={`p-3 rounded-xl border ${ans.userId === currentUserId ? 'bg-purple-50 border-purple-200' : 'bg-white'}`}>
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
  const [activeTab, setActiveTab] = useState('home');
  const [competitions, setCompetitions] = useState([]);
  const [userCompetitions, setUserCompetitions] = useState([]);
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionScores, setCompetitionScores] = useState([]);
  const [riddles, setRiddles] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [readAnnouncements, setReadAnnouncements] = useState([]);
  const [showPopup, setShowPopup] = useState(null);

  const showMsg = useCallback((msg, dur = 3000) => { setMessage(msg); if (dur > 0) setTimeout(() => setMessage(''), dur); }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({ id: userDoc.id, ...data });
          setReadAnnouncements(data.readAnnouncements || []);
        }
      } else {
        setUser(null); setUserData(null); setSelectedCompetition(null);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(50)), (snap) => {
      const anns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAnnouncements(anns);
    });
  }, []);

  // Show popup only once per session for unread announcements
  useEffect(() => {
    if (user && announcements.length > 0 && !showPopup) {
      const shownThisSession = JSON.parse(sessionStorage.getItem('shownAnnouncements') || '[]');
      const unread = announcements.find(a => !readAnnouncements.includes(a.id) && !shownThisSession.includes(a.id));
      if (unread) {
        setShowPopup(unread);
        sessionStorage.setItem('shownAnnouncements', JSON.stringify([...shownThisSession, unread.id]));
      }
    }
  }, [user, announcements, readAnnouncements]);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => {
      setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    if (!user) { setUserCompetitions([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('oderId', '==', user.uid)), (snap) => {
      setUserCompetitions(snap.docs.map(d => d.data().competitionId));
    });
  }, [user]);

  useEffect(() => {
    if (!selectedCompetition) { setRiddles([]); return; }
    return onSnapshot(query(collection(db, 'riddles'), where('competitionId', '==', selectedCompetition.id), orderBy('dataInizio', 'desc')), async (snap) => {
      const now = new Date();
      const list = [];
      for (const docSnap of snap.docs) {
        const data = { id: docSnap.id, ...docSnap.data() };
        const end = data.dataFine?.toDate?.() || new Date(data.dataFine);
        if (now > end && !data.pointsAssigned) {
          try { await assignPointsForRiddle(docSnap.id, data); data.pointsAssigned = true; } catch (e) { console.error(e); }
        }
        list.push(data);
      }
      setRiddles(list);
    });
  }, [selectedCompetition]);

  useEffect(() => {
    if (!selectedCompetition) { setCompetitionScores([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => {
      setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [selectedCompetition]);

  useEffect(() => {
    if (!user) { setUserAnswers({}); return; }
    return onSnapshot(query(collection(db, 'answers'), where('userId', '==', user.uid)), (snap) => {
      const answers = {};
      snap.forEach(doc => { const d = doc.data(); answers[d.riddleId] = { id: doc.id, ...d }; });
      setUserAnswers(answers);
    });
  }, [user]);

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
    if (username.trim().length < 3) { showMsg('Nickname: min 3 caratteri'); return; }
    if (!email.includes('@')) { showMsg('Email non valida'); return; }
    if (password.length < 6) { showMsg('Password: min 6 caratteri'); return; }
    setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), { username: username.trim(), email, readAnnouncements: [], createdAt: serverTimestamp() });
      showMsg('✅ Registrazione completata!');
    } catch (error) {
      showMsg(error.code === 'auth/email-already-in-use' ? 'Email già registrata' : 'Errore');
    } finally { setAuthLoading(false); }
  };

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch { showMsg('Credenziali errate'); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = async () => { await signOut(auth); setSelectedCompetition(null); setViewingRiddle(null); setActiveTab('home'); };

  const handleJoinCompetition = async (competitionId) => {
    if (!user) return;
    try {
      const scoreRef = doc(db, 'competitionScores', `${competitionId}_${user.uid}`);
      await setDoc(scoreRef, { competitionId, oderId: user.uid, username: userData?.username || 'Utente', points: 0, joinedAt: serverTimestamp() });
      const compRef = doc(db, 'competitions', competitionId);
      const compDoc = await getDoc(compRef);
      if (compDoc.exists()) await updateDoc(compRef, { participantsCount: (compDoc.data().participantsCount || 0) + 1 });
      showMsg('✅ Iscritto!');
    } catch (e) { showMsg('Errore'); }
  };

  const handleSubmitAnswer = async (riddleId, answer) => {
    if (!user || userAnswers[riddleId]) return;
    const answerData = { userId: user.uid, riddleId, answer, time: serverTimestamp(), points: 0, isCorrect: null };
    setUserAnswers(prev => ({ ...prev, [riddleId]: answerData }));
    showMsg('✅ Inviata!');
    try { await setDoc(doc(collection(db, 'answers')), answerData); }
    catch { setUserAnswers(prev => { const n = { ...prev }; delete n[riddleId]; return n; }); showMsg('Errore'); }
  };

  const handleViewAnswers = async (riddle) => {
    setViewingRiddle(riddle);
    const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
    setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const handleMarkAnnouncementRead = async (annId) => {
    if (!user) return;
    const newRead = [...readAnnouncements, annId];
    setReadAnnouncements(newRead);
    await updateDoc(doc(db, 'users', user.uid), { readAnnouncements: newRead });
  };

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (viewingRiddle) return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4 pb-24">
      <div className="max-w-lg mx-auto">
        <RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={competitionScores} currentUserId={user?.uid} onBack={() => setViewingRiddle(null)} />
      </div>
    </div>
  );

  if (selectedCompetition && user) {
    const isJoined = userCompetitions.includes(selectedCompetition.id);
    const now = new Date();
    const activeRiddles = riddles.filter(r => { const s = r.dataInizio?.toDate?.() || new Date(r.dataInizio); const e = r.dataFine?.toDate?.() || new Date(r.dataFine); return now >= s && now <= e; });
    const pastRiddles = riddles.filter(r => { const e = r.dataFine?.toDate?.() || new Date(r.dataFine); return now > e; });
    const userScore = competitionScores.find(s => s.oderId === user.uid);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    const userRank = sortedScores.findIndex(s => s.oderId === user.uid) + 1;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 pb-24">
        <div className="bg-white rounded-b-3xl shadow-lg p-4 mb-4">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <button onClick={() => setSelectedCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-purple-800">{selectedCompetition.nome}</h2>
              {isJoined && <p className="text-sm text-purple-600">{userScore?.points || 0} pt • #{userRank || '-'}</p>}
            </div>
          </div>
        </div>
        <div className="max-w-lg mx-auto px-4">
          {!isJoined ? (
            <div className="text-center py-12 bg-white rounded-2xl">
              <Flag size={48} className="mx-auto text-purple-300 mb-4" />
              <p className="text-gray-600 mb-4">Non sei iscritto</p>
              <button onClick={() => handleJoinCompetition(selectedCompetition.id)} className="bg-purple-600 text-white px-8 py-3 rounded-xl font-semibold inline-flex items-center gap-2"><UserPlus size={20} /> Partecipa</button>
            </div>
          ) : (
            <>
              {activeRiddles.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Star className="text-yellow-500" /> Attivi ({activeRiddles.length})</h3>
                  <div className="space-y-4">{activeRiddles.map(r => <RiddleCard key={r.id} riddle={r} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} />)}</div>
                </div>
              )}
              {activeRiddles.length === 0 && (
                <div className="bg-white rounded-2xl p-8 text-center mb-6">
                  <Clock size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-600">Nessun quiz attivo</p>
                </div>
              )}
              {pastRiddles.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Clock className="text-gray-400" /> Conclusi ({pastRiddles.length})</h3>
                  <div className="space-y-3">{pastRiddles.map(r => <RiddleCard key={r.id} riddle={r} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} />)}</div>
                </div>
              )}
            </>
          )}
          <div className="bg-white rounded-2xl p-5 mb-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifica</h3>
            <CompetitionLeaderboard scores={competitionScores} currentUserId={user?.uid} />
          </div>
        </div>
        {message && <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-purple-600 text-white p-4 rounded-xl text-center shadow-lg">{message}</div>}
      </div>
    );
  }

  const unreadAnnouncements = announcements.filter(a => !readAnnouncements.includes(a.id));
  const joinedComps = competitions.filter(c => userCompetitions.includes(c.id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 pb-24">
      <AnnouncementPopup announcement={showPopup} onClose={() => setShowPopup(null)} onMarkRead={handleMarkAnnouncementRead} />
      <div className="bg-white rounded-b-3xl shadow-lg p-6 mb-6">
        <div className="max-w-lg mx-auto">
          {user ? (
            <div className="flex justify-between items-center">
              <div>
                <p className="text-gray-500 text-sm">Ciao 👋</p>
                <h1 className="text-2xl font-bold text-purple-800">{userData?.username}</h1>
              </div>
              <button onClick={handleLogout} className="p-3 bg-gray-100 rounded-xl"><LogOut size={20} className="text-gray-600" /></button>
            </div>
          ) : (
            <div className="text-center">
              <h1 className="text-3xl font-bold text-purple-800 mb-1">🎯 Haiku Quiz</h1>
              <p className="text-gray-500">Indovinelli quotidiani</p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4">
        {!user ? (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">{isLoginMode ? 'Accedi' : 'Registrati'}</h2>
            {!isLoginMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-2">Nickname</label>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Min. 3 caratteri" value={username} onChange={e => setUsername(e.target.value)} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
                </div>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="email" placeholder="email@esempio.com" value={email} onChange={e => setEmail(e.target.value)} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 mb-2">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="password" placeholder="Min. 6 caratteri" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && (isLoginMode ? handleLogin() : handleRegister())} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
              </div>
            </div>
            <button onClick={isLoginMode ? handleLogin : handleRegister} disabled={authLoading} className="w-full bg-purple-600 text-white py-4 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2 mb-4">
              {authLoading ? <Loader2 size={20} className="animate-spin" /> : (isLoginMode ? 'Accedi' : 'Registrati')}
            </button>
            <button onClick={() => { setIsLoginMode(!isLoginMode); setMessage(''); }} className="w-full text-purple-600 text-sm">
              {isLoginMode ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
            </button>
            {message && <div className={`mt-4 p-3 rounded-xl text-center text-sm ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>}
          </div>
        ) : (
          <>
            {activeTab === 'home' && (
              <>
                {unreadAnnouncements.length > 0 && (
                  <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-xl flex items-center gap-3">
                    <Bell className="text-purple-600" size={20} />
                    <span className="text-purple-700">{unreadAnnouncements.length} nuov{unreadAnnouncements.length === 1 ? 'o avviso' : 'i avvisi'}</span>
                  </div>
                )}
                {joinedComps.length > 0 ? (
                  <div className="mb-6">
                    <h3 className="font-bold text-gray-800 mb-3">Le tue gare</h3>
                    <div className="space-y-4">
                      {joinedComps.map(comp => {
                        const scores = competitionScores.filter(s => s.competitionId === comp.id);
                        const userScoreData = scores.find(s => s.oderId === user.uid);
                        const sorted = [...scores].sort((a, b) => (b.points || 0) - (a.points || 0));
                        const rank = sorted.findIndex(s => s.oderId === user.uid) + 1;
                        return <CompetitionCard key={comp.id} competition={comp} isJoined={true} onJoin={handleJoinCompetition} onSelect={setSelectedCompetition} userScore={userScoreData?.points} userRank={rank} />;
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-8 text-center mb-6">
                    <Flag size={48} className="mx-auto text-purple-200 mb-4" />
                    <p className="text-gray-600 font-medium">Non sei iscritto a nessuna gara</p>
                    <button onClick={() => setActiveTab('competitions')} className="mt-4 bg-purple-600 text-white px-6 py-3 rounded-xl font-semibold">Scopri le gare</button>
                  </div>
                )}
              </>
            )}

            {activeTab === 'competitions' && (
              <div className="space-y-4">
                <h3 className="font-bold text-gray-800">Tutte le gare</h3>
                {competitions.length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 text-center"><p className="text-gray-500">Nessuna gara</p></div>
                ) : (
                  competitions.map(comp => <CompetitionCard key={comp.id} competition={comp} isJoined={userCompetitions.includes(comp.id)} onJoin={handleJoinCompetition} onSelect={setSelectedCompetition} />)
                )}
              </div>
            )}

            {activeTab === 'leaderboard' && (
              <div className="bg-white rounded-2xl p-5">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifiche</h3>
                {joinedComps.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">Iscriviti a una gara!</p>
                ) : (
                  joinedComps.map(comp => (
                    <div key={comp.id} className="mb-6">
                      <h4 className="font-medium text-purple-700 mb-2">{comp.nome}</h4>
                      <CompetitionLeaderboard scores={competitionScores.filter(s => s.competitionId === comp.id)} currentUserId={user?.uid} />
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2"><Megaphone className="text-purple-600" /> Avvisi</h3>
                {announcements.length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 text-center">
                    <Bell size={48} className="mx-auto text-gray-200 mb-4" />
                    <p className="text-gray-500">Nessun avviso</p>
                  </div>
                ) : (
                  announcements.map(ann => (
                    <div key={ann.id} className={`bg-white rounded-2xl p-4 ${!readAnnouncements.includes(ann.id) ? 'border-2 border-purple-300' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <Megaphone className="text-purple-600" size={18} />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-gray-800">{ann.titolo}</h4>
                            {!readAnnouncements.includes(ann.id) && <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Nuovo</span>}
                          </div>
                          <div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: ann.messaggio }} />
                          <p className="text-xs text-gray-400 mt-2">{formatDate(ann.createdAt)}</p>
                        </div>
                      </div>
                      {!readAnnouncements.includes(ann.id) && (
                        <button onClick={() => handleMarkAnnouncementRead(ann.id)} className="w-full mt-3 text-sm text-purple-600 font-medium">Segna come letto</button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
        {message && user && <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-purple-600 text-white p-4 rounded-xl text-center shadow-lg">{message}</div>}
      </div>
      {user && <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} hasNotifications={unreadAnnouncements.length > 0} />}
    </div>
  );
};

export default App;
