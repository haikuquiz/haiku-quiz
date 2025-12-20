import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Star, Calendar, Users, LogOut, Mail, Lock, User, Eye, EyeOff, Check, X, Loader2, Clock, Award, ArrowLeft, ChevronRight } from 'lucide-react';
import { db, auth } from './firebase';
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'firebase/auth';

// ============ UTILITY FUNCTIONS ============
const getCurrentDateTime = () => new Date();

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const compareAnswers = (userAnswer, correctAnswer) => {
  if (!userAnswer || !correctAnswer) return false;
  return userAnswer.trim() === correctAnswer.trim();
};

// ============ POINTS ASSIGNMENT FUNCTION ============
const assignPointsForRiddle = async (riddleId, riddle) => {
  if (riddle.pointsAssigned) return false;

  const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
  const answers = [];
  answersSnap.forEach(doc => answers.push({ id: doc.id, ref: doc.ref, ...doc.data() }));
  
  // Sort by time
  answers.sort((a, b) => {
    const timeA = a.time?.toDate ? a.time.toDate() : new Date(a.time || 0);
    const timeB = b.time?.toDate ? b.time.toDate() : new Date(b.time || 0);
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
      
      // Update user points
      const userRef = doc(db, 'users', answer.userId);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        await updateDoc(userRef, { points: (userDoc.data().points || 0) + points });
      }
    }
    
    // Update answer with points and isCorrect
    await updateDoc(answer.ref, { points, isCorrect });
  }
  
  // Mark riddle as processed
  await updateDoc(doc(db, 'riddles', riddleId), { 
    pointsAssigned: true, 
    firstSolver,
    processedAt: serverTimestamp()
  });
  
  return true;
};

// ============ COMPONENTS ============

const Leaderboard = React.memo(({ players, currentUserId }) => {
  if (players.length === 0) {
    return <p className="text-gray-500 text-center py-4">Nessun giocatore ancora. Sii il primo!</p>;
  }

  return (
    <div className="space-y-3">
      {players.map((player, index) => (
        <div
          key={player.id}
          className={`flex items-center justify-between p-4 rounded-lg transition-all ${
            index === 0 ? 'bg-yellow-100 border-2 border-yellow-400' :
            index === 1 ? 'bg-gray-100 border-2 border-gray-400' :
            index === 2 ? 'bg-orange-100 border-2 border-orange-400' :
            'bg-purple-50'
          }`}
        >
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-gray-700 w-8">{index + 1}</span>
            <span className={`font-semibold ${player.id === currentUserId ? 'text-purple-700' : 'text-gray-800'}`}>
              {player.username} {player.id === currentUserId && '(Tu)'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-purple-700">{player.points || 0}</span>
            <Users size={20} className="text-purple-600" />
          </div>
        </div>
      ))}
    </div>
  );
});

const RiddleCard = React.memo(({ riddle, onSubmit, hasAnswered, userAnswer, onViewAnswers, showViewButton }) => {
  const [answer, setAnswer] = useState('');
  const [localSubmitting, setLocalSubmitting] = useState(false);
  
  const now = getCurrentDateTime();
  const startDateTime = riddle.dataInizio?.toDate ? riddle.dataInizio.toDate() : new Date(riddle.dataInizio);
  const isPublished = now >= startDateTime;

  const handleSubmit = async () => {
    if (!answer.trim() || localSubmitting) return;
    
    const trimmedAnswer = answer.trim();
    setLocalSubmitting(true);
    setAnswer('');
    
    try {
      await onSubmit(riddle.id, trimmedAnswer);
    } catch (e) {
      console.error('Submit failed:', e);
      setAnswer(trimmedAnswer);
    } finally {
      setLocalSubmitting(false);
    }
  };

  const endDate = riddle.dataFine?.toDate ? riddle.dataFine.toDate() : new Date(riddle.dataFine);
  const endDateStr = endDate.toLocaleDateString('it-IT');
  const endTimeStr = endDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-purple-50 rounded-lg p-6">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-xl font-semibold text-gray-800">{riddle.titolo}</h3>
        {showViewButton && (
          <button
            onClick={() => onViewAnswers(riddle)}
            className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
          >
            Classifica <ChevronRight size={16} />
          </button>
        )}
      </div>
      
      {!isPublished ? (
        <div className="text-gray-600 italic mb-4">
          <p>Indovinello disponibile dal {startDateTime.toLocaleDateString('it-IT')}</p>
        </div>
      ) : (
        <>
          <div className="text-lg text-gray-700 mb-4" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
          <p className="text-sm text-gray-500 mb-2">Primo a rispondere correttamente: 3 punti | Altri: 1 punto</p>
          <p className="text-sm text-red-600 mb-4 font-semibold">
            ⚠️ Un solo tentativo! La risposta è CASE-SENSITIVE
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Scadenza: {endDateStr} alle {endTimeStr}
          </p>

          {!hasAnswered ? (
            <>
              <input
                type="text"
                placeholder="Scrivi la tua risposta (attenzione alle maiuscole!)..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
                className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg mb-3 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleSubmit}
                disabled={localSubmitting || !answer.trim()}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {localSubmitting ? <><Loader2 size={20} className="animate-spin" /> Invio...</> : 'Invia Risposta'}
              </button>
            </>
          ) : (
            <div className="bg-blue-100 border-2 border-blue-400 rounded-lg p-4">
              <p className="text-blue-800 font-semibold flex items-center gap-2">
                <Check size={20} /> Risposta inviata!
              </p>
              <p className="text-blue-700 text-sm mt-1">La tua risposta: "{userAnswer}"</p>
            </div>
          )}
        </>
      )}
    </div>
  );
});

const RiddleAnswersView = React.memo(({ riddle, answers, users, currentUserId, onBack }) => {
  const sortedAnswers = [...answers].sort((a, b) => {
    const timeA = a.time?.toDate ? a.time.toDate() : new Date(a.time || 0);
    const timeB = b.time?.toDate ? b.time.toDate() : new Date(b.time || 0);
    return timeA - timeB;
  });
  
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.username; });

  return (
    <div className="bg-white rounded-lg shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
          <ArrowLeft size={24} className="text-gray-600" />
        </button>
        <div>
          <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
        </div>
      </div>

      <div className="mb-4 p-3 bg-purple-50 rounded-lg">
        <div className="text-sm text-gray-700 mb-2" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
        <p className="text-sm font-semibold text-purple-700">
          Risposta corretta: <code className="bg-purple-100 px-2 py-1 rounded">{riddle.risposta}</code>
        </p>
      </div>

      <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <Clock size={18} /> Risposte ({sortedAnswers.length})
      </h4>

      {sortedAnswers.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Nessuna risposta</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sortedAnswers.map((answer, index) => {
            const isCurrentUser = answer.userId === currentUserId;
            const isCorrect = compareAnswers(answer.answer, riddle.risposta);
            const isFirst = index === 0 && isCorrect && answer.points === 3;
            
            return (
              <div 
                key={answer.id || index}
                className={`p-3 rounded-lg border-2 ${
                  isCurrentUser ? 'bg-yellow-50 border-yellow-400' : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isFirst ? 'bg-yellow-400 text-yellow-900' :
                      isCorrect ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${isCurrentUser ? 'text-yellow-700' : 'text-gray-800'}`}>
                          {isCurrentUser ? 'Tu' : (userMap[answer.userId] || `Utente ${index + 1}`)}
                        </span>
                        {isCurrentUser && <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">TU</span>}
                        {isFirst && <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full flex items-center gap-1"><Award size={12} /> PRIMO!</span>}
                      </div>
                      <p className="text-xs text-gray-500">{formatDateTime(answer.time)}</p>
                    </div>
                  </div>
                  <div className={answer.points > 0 ? 'text-green-600' : 'text-red-500'}>
                    {riddle.pointsAssigned ? (
                      <span className="font-bold">{answer.points > 0 ? `+${answer.points}` : '0'}</span>
                    ) : (
                      <span className="text-gray-400 text-sm">In attesa</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 pl-11">
                  <p className={`text-sm ${isCorrect ? 'text-green-700' : 'text-red-600'}`}>
                    Risposta: <span className={`font-medium px-1 rounded ${isCorrect ? 'bg-green-100' : 'bg-red-100'}`}>"{answer.answer}"</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

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
  
  const [activeRiddles, setActiveRiddles] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [allRiddlesView, setAllRiddlesView] = useState([]);
  
  const [showMyAnswers, setShowMyAnswers] = useState(false);
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);

  const showMessage = useCallback((msg, duration = 3000) => {
    setMessage(msg);
    if (duration > 0) setTimeout(() => setMessage(''), duration);
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUserData({ id: userDoc.id, ...userDoc.data() });
        }
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load riddles and check for expired ones
  useEffect(() => {
    const q = query(collection(db, 'riddles'), orderBy('dataInizio', 'desc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const now = new Date();
      const riddles = [];
      const active = [];
      
      for (const docSnap of snapshot.docs) {
        const data = { id: docSnap.id, ...docSnap.data() };
        const start = data.dataInizio?.toDate ? data.dataInizio.toDate() : new Date(data.dataInizio);
        const end = data.dataFine?.toDate ? data.dataFine.toDate() : new Date(data.dataFine);
        
        let status = 'future';
        if (now >= start && now <= end) {
          status = 'active';
          active.push(data);
        } else if (now > end) {
          status = 'past';
          
          // Auto-assign points for expired riddles
          if (!data.pointsAssigned) {
            try {
              await assignPointsForRiddle(docSnap.id, data);
              data.pointsAssigned = true;
            } catch (e) {
              console.error('Error assigning points:', e);
            }
          }
        }
        
        riddles.push({ ...data, status });
      }
      
      setActiveRiddles(active);
      setAllRiddlesView(riddles);
    });
    return () => unsubscribe();
  }, []);

  // Load leaderboard
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('points', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = [];
      snapshot.forEach((doc) => {
        users.push({ id: doc.id, ...doc.data() });
      });
      setLeaderboard(users);
    });
    return () => unsubscribe();
  }, []);

  // Load user's answers
  useEffect(() => {
    if (!user) {
      setUserAnswers({});
      return;
    }
    
    const q = query(collection(db, 'answers'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const answers = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        answers[data.riddleId] = { id: doc.id, ...data };
      });
      setUserAnswers(answers);
    });
    return () => unsubscribe();
  }, [user]);

  // Periodic check for expired riddles (every 30 seconds)
  useEffect(() => {
    const checkExpiredRiddles = async () => {
      const now = new Date();
      const q = query(collection(db, 'riddles'), where('pointsAssigned', '==', false));
      const snapshot = await getDocs(q);
      
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const end = data.dataFine?.toDate ? data.dataFine.toDate() : new Date(data.dataFine);
        
        if (now > end) {
          try {
            await assignPointsForRiddle(docSnap.id, data);
          } catch (e) {
            console.error('Error in periodic check:', e);
          }
        }
      }
    };

    const interval = setInterval(checkExpiredRiddles, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRegister = async () => {
    if (authLoading) return;
    
    if (username.trim().length < 3) {
      showMessage('Nickname: minimo 3 caratteri');
      return;
    }
    if (!email.includes('@')) {
      showMessage('Email non valida');
      return;
    }
    if (password.length < 6) {
      showMessage('Password: minimo 6 caratteri');
      return;
    }

    setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        username: username.trim(),
        email: email,
        points: 0,
        createdAt: serverTimestamp()
      });
      showMessage('Registrazione completata!');
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        showMessage('Email già registrata');
      } else {
        showMessage('Errore: ' + error.message);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    if (authLoading) return;
    
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      showMessage('Email o password errati');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowMyAnswers(false);
    setViewingRiddle(null);
  };

  const handleSubmitAnswer = async (riddleId, answer) => {
    if (!user || userAnswers[riddleId]) return;

    const answerData = {
      userId: user.uid,
      riddleId: riddleId,
      answer: answer,
      time: serverTimestamp(),
      points: 0,
      isCorrect: null
    };

    // Optimistic update
    setUserAnswers(prev => ({ ...prev, [riddleId]: { ...answerData, oderId: user.uid } }));
    showMessage('✅ Risposta inviata!');

    try {
      await setDoc(doc(collection(db, 'answers')), answerData);
    } catch (error) {
      console.error('Error:', error);
      setUserAnswers(prev => {
        const newAnswers = { ...prev };
        delete newAnswers[riddleId];
        return newAnswers;
      });
      showMessage('Errore nel salvataggio');
    }
  };

  const handleViewAnswers = async (riddle) => {
    setViewingRiddle(riddle);
    const q = query(collection(db, 'answers'), where('riddleId', '==', riddle.id));
    const snapshot = await getDocs(q);
    const answers = [];
    snapshot.forEach((doc) => {
      answers.push({ id: doc.id, ...doc.data() });
    });
    setRiddleAnswers(answers);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (viewingRiddle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4">
        <div className="max-w-4xl mx-auto">
          <RiddleAnswersView
            riddle={viewingRiddle}
            answers={riddleAnswers}
            users={leaderboard}
            currentUserId={user?.uid}
            onBack={() => setViewingRiddle(null)}
          />
        </div>
      </div>
    );
  }

  const myStats = userData ? {
    points: userData.points || 0,
    position: leaderboard.findIndex(u => u.id === user?.uid) + 1
  } : { points: 0, position: 0 };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 pt-8">
          <h1 className="text-4xl font-bold text-purple-900 mb-2 flex items-center justify-center gap-2">
            <Star className="text-yellow-500" size={40} />
            Haiku Quiz
            <Star className="text-yellow-500" size={40} />
          </h1>
          <p className="text-gray-700 flex items-center justify-center gap-2">
            <Calendar size={20} />
            {new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Auth or Dashboard */}
        {!user ? (
          <div className="bg-white rounded-lg shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {isLoginMode ? 'Accedi' : 'Registrati per giocare'}
            </h2>
            
            {!isLoginMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <User size={16} className="inline mr-1" /> Nickname
                </label>
                <input
                  type="text"
                  placeholder="Min. 3 caratteri"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500"
                />
              </div>
            )}
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Mail size={16} className="inline mr-1" /> Email
              </label>
              <input
                type="email"
                placeholder="tua@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500"
              />
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Lock size={16} className="inline mr-1" /> Password
              </label>
              <input
                type="password"
                placeholder="Min. 6 caratteri"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (isLoginMode ? handleLogin() : handleRegister())}
                className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:border-purple-500"
              />
            </div>
            
            <button
              onClick={isLoginMode ? handleLogin : handleRegister}
              disabled={authLoading}
              className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition mb-3 disabled:bg-gray-400 flex items-center justify-center gap-2"
            >
              {authLoading ? <Loader2 size={20} className="animate-spin" /> : (isLoginMode ? 'Accedi' : 'Registrati')}
            </button>
            
            <button
              onClick={() => { setIsLoginMode(!isLoginMode); setMessage(''); }}
              className="w-full text-purple-600 hover:text-purple-800 text-sm"
            >
              {isLoginMode ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
            </button>
            
            {message && (
              <div className={`mt-4 p-3 rounded-lg text-center ${message.includes('Errore') || message.includes('errat') || message.includes('non valida') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                {message}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-xl p-8">
              <div className="mb-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-lg text-gray-700">Ciao, </span>
                    <span className="text-xl font-bold text-purple-700">{userData?.username}</span>
                  </div>
                  <div className="text-sm bg-purple-50 px-3 py-1 rounded-lg">
                    <span className="font-bold text-purple-700">{myStats.points}</span> punti • 
                    <span className="font-bold text-purple-700"> #{myStats.position || '-'}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowMyAnswers(!showMyAnswers)}
                    className={`p-2 rounded-lg ${showMyAnswers ? 'bg-purple-100 text-purple-700' : 'text-gray-500'}`}
                  >
                    {showMyAnswers ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                  <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-600">
                    <LogOut size={20} />
                  </button>
                </div>
              </div>

              {showMyAnswers && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-gray-800 mb-3">Storico indovinelli</h4>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {allRiddlesView.map((riddle) => {
                      const answer = userAnswers[riddle.id];
                      return (
                        <div key={riddle.id} className="p-4 bg-white rounded border">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-purple-700">{riddle.titolo}</p>
                              {riddle.status === 'past' && (
                                <button
                                  onClick={() => handleViewAnswers(riddle)}
                                  className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded"
                                >
                                  <Users size={12} className="inline" /> Classifica
                                </button>
                              )}
                            </div>
                            <span className={`text-xs px-2 py-1 rounded ${
                              riddle.status === 'future' ? 'bg-gray-200' :
                              riddle.status === 'active' ? 'bg-blue-200' : 'bg-green-200'
                            }`}>
                              {riddle.status === 'future' ? 'Futuro' : riddle.status === 'active' ? 'In corso' : 'Concluso'}
                            </span>
                          </div>
                          
                          {riddle.status !== 'future' && (
                            <>
                              <div className="text-sm text-gray-700 mb-2" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
                              {answer && (
                                <p className="text-sm bg-blue-50 p-2 rounded">Tua risposta: "{answer.answer}"</p>
                              )}
                              {riddle.status === 'past' && (
                                <div className="mt-2 p-2 bg-purple-50 rounded">
                                  <p className="text-sm">Risposta: "{riddle.risposta}"</p>
                                  {answer && (
                                    <p className={`text-sm font-semibold ${answer.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {answer.points > 0 ? `+${answer.points} punti` : 'Errata'}
                                    </p>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeRiddles.length === 0 ? (
                <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-6 text-center">
                  <p className="text-yellow-800 font-semibold">Nessun indovinello attivo</p>
                  <p className="text-yellow-700 text-sm mt-2">Torna più tardi!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeRiddles.map((riddle) => (
                    <RiddleCard
                      key={riddle.id}
                      riddle={riddle}
                      onSubmit={handleSubmitAnswer}
                      hasAnswered={!!userAnswers[riddle.id]}
                      userAnswer={userAnswers[riddle.id]?.answer}
                      onViewAnswers={handleViewAnswers}
                      showViewButton={riddle.pointsAssigned}
                    />
                  ))}
                </div>
              )}

              {message && (
                <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg text-center">
                  {message}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div className="bg-white rounded-lg shadow-xl p-8 mt-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <Trophy className="text-yellow-500" size={32} />
            Classifica
          </h2>
          <Leaderboard players={leaderboard} currentUserId={user?.uid} />
        </div>
      </div>
    </div>
  );
};

export default App;
