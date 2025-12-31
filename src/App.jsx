import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy, Star, LogOut, Mail, Lock, User, Check, Loader2, Clock, ArrowLeft, ChevronRight, Flag, UserPlus, Crown, Home, Bell, X, Megaphone, Info, FileText, Award, Calendar, Settings, Edit3, Save, Eye, EyeOff, KeyRound } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, limit, Timestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, verifyBeforeUpdateEmail } from 'firebase/auth';

const formatDateTime = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('it-IT', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
};

const formatDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('it-IT');
};

const compareAnswers = (a, b) => a?.trim() === b?.trim();

// Funzione per ottenere i punti effettivi (riddle override o competition default)
const getEffectivePoints = (riddle, competition) => {
  if (riddle.puntiCustom) return riddle.punti || { primo: 2, altri: 1 };
  if (competition?.puntiDefault) return competition.puntiDefault;
  return { primo: 2, altri: 1 };
};

const getEffectiveBonus = (riddle, competition) => {
  if (riddle.bonusCustom) return riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 };
  if (competition?.bonusDefault) return competition.bonusDefault;
  return { uno: 0, finoCinque: 0, seiDieci: 0 };
};

const getPointsForPosition = (pos, riddle, competition) => {
  const p = getEffectivePoints(riddle, competition);
  return pos === 0 ? (p.primo || 2) : (p.altri || 1);
};

const getBonusPoints = (correctCount, riddle, competition) => {
  const bonus = getEffectiveBonus(riddle, competition);
  if (correctCount === 1) return bonus.uno || 0;
  if (correctCount >= 2 && correctCount <= 5) return bonus.finoCinque || 0;
  if (correctCount >= 6 && correctCount <= 10) return bonus.seiDieci || 0;
  return 0;
};

// Funzione per inviare webhook
const sendUserWebhook = async (event, userData) => {
  const webhookUrl = import.meta.env.VITE_PABBLY_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'no-cors',
      body: JSON.stringify({
        event,
        oderId: userData.oderId || userData.id,
        fullName: userData.fullName,
        username: userData.username,
        email: userData.email,
        timestamp: new Date().toISOString()
      })
    });
  } catch (e) { console.error('Webhook error:', e); }
};

const assignPointsForRiddle = async (riddleId, riddle, competition) => {
  if (riddle.pointsAssigned) return false;
  try {
    const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
    const allAnswers = [];
    answersSnap.forEach(d => allAnswers.push({ id: d.id, ref: d.ref, ...d.data() }));
    
    allAnswers.sort((a, b) => {
      const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0);
      const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0);
      return timeA - timeB;
    });
    
    // Filtra solo la prima risposta per ogni utente
    const seenUsers = new Set();
    const answers = [];
    for (const ans of allAnswers) {
      const oderId = ans.userId || ans.oderId;
      if (!seenUsers.has(oderId)) {
        seenUsers.add(oderId);
        answers.push(ans);
      } else {
        // Imposta punti a 0 per le risposte duplicate
        await updateDoc(ans.ref, { points: 0, isCorrect: false, duplicate: true });
      }
    }
    
    const correctAnswers = answers.filter(ans => compareAnswers(ans.answer, riddle.risposta));
    const correctCount = correctAnswers.length;
    const bonus = getBonusPoints(correctCount, riddle, competition);
    
    let correctPos = 0;
    for (const ans of answers) {
      const isCorrect = compareAnswers(ans.answer, riddle.risposta);
      let points = 0;
      if (isCorrect) {
        points = getPointsForPosition(correctPos, riddle, competition) + bonus;
        correctPos++;
        if (riddle.competitionId) {
          const oderId = ans.userId || ans.oderId;
          const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`);
          const scoreDoc = await getDoc(scoreRef);
          if (scoreDoc.exists()) {
            await updateDoc(scoreRef, { points: (scoreDoc.data().points || 0) + points });
          }
        }
      }
      await updateDoc(ans.ref, { points, isCorrect, bonus: isCorrect ? bonus : 0 });
    }
    await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, processedAt: serverTimestamp(), correctCount });
    return true;
  } catch (e) {
    console.error('Error assigning points:', e);
    return false;
  }
};

const saveNavState = (state) => {
  try {
    sessionStorage.setItem('haikuNavState', JSON.stringify({ ...state, timestamp: Date.now() }));
  } catch (e) {}
};

const loadNavState = () => {
  try {
    const saved = sessionStorage.getItem('haikuNavState');
    if (!saved) return null;
    const state = JSON.parse(saved);
    if (Date.now() - state.timestamp > 3600000) {
      sessionStorage.removeItem('haikuNavState');
      return null;
    }
    return state;
  } catch (e) {
    return null;
  }
};

const BottomNav = ({ activeTab, setActiveTab, hasNotifications }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 z-50">
    <div className="max-w-lg mx-auto flex justify-around">
      {[
        { id: 'home', icon: Home, label: 'Home' },
        { id: 'competitions', icon: Flag, label: 'Gare' },
        { id: 'notifications', icon: Bell, label: 'Avvisi', badge: hasNotifications },
        { id: 'profile', icon: User, label: 'Profilo' }
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

const CompetitionTabs = ({ activeTab, setActiveTab, hasActiveRiddle }) => (
  <div className="flex bg-white rounded-xl p-1 mb-4 shadow-sm">
    {[
      { id: 'quiz', icon: Star, label: 'Quiz' },
      { id: 'classifica', icon: Trophy, label: 'Classifica' },
      { id: 'info', icon: Info, label: 'Info' }
    ].map(tab => (
      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 flex items-center justify-center gap-1 py-2 px-3 rounded-lg text-sm font-medium relative ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-600'}`}>
        <tab.icon size={16} />
        {tab.label}
        {tab.id === 'quiz' && hasActiveRiddle && activeTab !== 'quiz' && <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />}
      </button>
    ))}
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
        <div className="text-gray-700 mb-6" dangerouslySetInnerHTML={{ __html: announcement.messaggio }} />
        <button onClick={() => { onMarkRead(announcement.id); onClose(); }} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold">Ho capito</button>
      </div>
    </div>
  );
};

const FloatingNotification = ({ notification, onDismiss, onNavigate }) => {
  if (!notification) return null;
  const isNew = notification.type === 'new_riddle';
  const isRes = notification.type === 'result';
  
  return (
    <div className="fixed top-4 left-4 right-4 z-[100] max-w-lg mx-auto animate-slide-down">
      <div 
        onClick={() => { onNavigate(notification); onDismiss(notification.id); }}
        className={`p-4 rounded-xl border-2 shadow-lg cursor-pointer transform transition-all hover:scale-[1.02] ${
          isNew ? 'bg-green-50 border-green-400' : isRes ? 'bg-blue-50 border-blue-400' : 'bg-purple-50 border-purple-400'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isNew ? 'bg-green-100' : isRes ? 'bg-blue-100' : 'bg-purple-100'}`}>
            {isNew ? <Star className="text-green-600" size={20} /> : isRes ? <Award className="text-blue-600" size={20} /> : <Bell className="text-purple-600" size={20} />}
          </div>
          <div className="flex-1">
            <p className={`font-semibold ${isNew ? 'text-green-800' : isRes ? 'text-blue-800' : 'text-purple-800'}`}>{notification.title}</p>
            <p className={`text-sm ${isNew ? 'text-green-700' : isRes ? 'text-blue-700' : 'text-purple-700'}`}>{notification.message}</p>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
      </div>
    </div>
  );
};

const BackToast = ({ show }) => {
  if (!show) return null;
  return (
    <div className="fixed bottom-24 left-4 right-4 z-[100] max-w-lg mx-auto">
      <div className="bg-gray-800 text-white p-3 rounded-xl text-center text-sm">Premi di nuovo per uscire</div>
    </div>
  );
};

const ForgotPasswordModal = ({ onClose, onSend, sending }) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  
  const handleSend = async () => {
    if (!email.includes('@')) return;
    const success = await onSend(email);
    if (success) setSent(true);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><KeyRound size={24} className="text-purple-600" /> Recupera password</h3>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-600" size={32} />
            </div>
            <p className="text-gray-700 mb-4">Email inviata! Controlla la tua casella di posta.</p>
            <button onClick={onClose} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold">Chiudi</button>
          </div>
        ) : (
          <>
            <p className="text-gray-600 mb-4">Inserisci la tua email e ti invieremo un link per reimpostare la password.</p>
            <input type="email" placeholder="La tua email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4" />
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button>
              <button onClick={handleSend} disabled={sending || !email.includes('@')} className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">
                {sending ? <Loader2 size={20} className="animate-spin" /> : 'Invia'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ChangeEmailModal = ({ user, onClose, onSuccess }) => {
  const [newEmail, setNewEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  
  const handleSend = async () => {
    if (!newEmail.includes('@')) {
      setError('Email non valida');
      return;
    }
    setSending(true);
    setError('');
    try {
      await verifyBeforeUpdateEmail(user, newEmail);
      setSent(true);
    } catch (e) {
      if (e.code === 'auth/requires-recent-login') {
        setError('Per sicurezza, esci e accedi di nuovo prima di cambiare email');
      } else if (e.code === 'auth/email-already-in-use') {
        setError('Email già in uso');
      } else {
        setError('Errore: ' + e.message);
      }
    } finally {
      setSending(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Mail size={24} className="text-purple-600" /> Cambia email</h3>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-600" size={32} />
            </div>
            <p className="text-gray-700 mb-2">Email di verifica inviata a:</p>
            <p className="font-semibold text-purple-700 mb-4">{newEmail}</p>
            <p className="text-sm text-gray-500 mb-4">Clicca sul link nell'email per confermare il cambio.</p>
            <button onClick={onClose} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold">Chiudi</button>
          </div>
        ) : (
          <>
            <p className="text-gray-600 mb-2">Email attuale: <strong>{user.email}</strong></p>
            <p className="text-gray-600 mb-4">Inserisci la nuova email. Riceverai un link di verifica.</p>
            <input type="email" placeholder="Nuova email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-2" />
            {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button>
              <button onClick={handleSend} disabled={sending || !newEmail.includes('@')} className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">
                {sending ? <Loader2 size={20} className="animate-spin" /> : 'Invia verifica'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ProfileView = ({ userData, user, onUpdateUsername, onUpdateFullName, updating, canChangeUsername, daysUntilChange, onChangeEmail }) => {
  const [editingUsername, setEditingUsername] = useState(false);
  const [editingFullName, setEditingFullName] = useState(false);
  const [newUsername, setNewUsername] = useState(userData?.username || '');
  const [newFullName, setNewFullName] = useState(userData?.fullName || '');
  const [error, setError] = useState('');
  const [showChangeEmail, setShowChangeEmail] = useState(false);

  const handleSaveUsername = async () => {
    if (newUsername.trim().length < 3) {
      setError('Minimo 3 caratteri');
      return;
    }
    const success = await onUpdateUsername(newUsername.trim());
    if (success) {
      setEditingUsername(false);
      setError('');
    }
  };

  const handleSaveFullName = async () => {
    if (newFullName.trim().length < 3) {
      setError('Minimo 3 caratteri');
      return;
    }
    const success = await onUpdateFullName(newFullName.trim());
    if (success) {
      setEditingFullName(false);
      setError('');
    }
  };

  return (
    <div className="space-y-4">
      {showChangeEmail && <ChangeEmailModal user={user} onClose={() => setShowChangeEmail(false)} />}
      
      <div className="bg-white rounded-2xl p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
            <User size={32} className="text-purple-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-800">{userData?.username}</h2>
            <p className="text-sm text-gray-500">{userData?.fullName}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="py-3 border-b">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Nome completo</span>
              {!editingFullName && (
                <button onClick={() => { setEditingFullName(true); setNewFullName(userData?.fullName || ''); }} className="text-purple-600 text-sm font-medium flex items-center gap-1">
                  Modifica <Edit3 size={14} />
                </button>
              )}
            </div>
            {editingFullName ? (
              <div className="flex gap-2 mt-2">
                <input type="text" value={newFullName} onChange={e => setNewFullName(e.target.value)} className="flex-1 px-3 py-2 border-2 border-purple-200 rounded-xl" placeholder="Nome e Cognome" />
                <button onClick={handleSaveFullName} disabled={updating} className="p-2 bg-green-500 text-white rounded-xl">
                  {updating ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                </button>
                <button onClick={() => { setEditingFullName(false); setError(''); }} className="p-2 bg-gray-200 rounded-xl"><X size={20} /></button>
              </div>
            ) : (
              <p className="text-gray-800 font-medium mt-1">{userData?.fullName || '-'}</p>
            )}
          </div>

          <div className="py-3 border-b">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Nickname</span>
              {!editingUsername && canChangeUsername && (
                <button onClick={() => { setEditingUsername(true); setNewUsername(userData?.username || ''); }} className="text-purple-600 text-sm font-medium flex items-center gap-1">
                  Modifica <Edit3 size={14} />
                </button>
              )}
            </div>
            {editingUsername ? (
              <div className="flex gap-2 mt-2">
                <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="flex-1 px-3 py-2 border-2 border-purple-200 rounded-xl" placeholder="Nuovo nickname" />
                <button onClick={handleSaveUsername} disabled={updating} className="p-2 bg-green-500 text-white rounded-xl">
                  {updating ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                </button>
                <button onClick={() => { setEditingUsername(false); setError(''); }} className="p-2 bg-gray-200 rounded-xl"><X size={20} /></button>
              </div>
            ) : (
              <p className="text-gray-800 font-medium mt-1">{userData?.username}</p>
            )}
            {!canChangeUsername && daysUntilChange > 0 && (
              <p className="text-xs text-yellow-600 mt-1">⏳ Potrai cambiare nickname tra {daysUntilChange} giorni</p>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-between items-center py-3 border-b">
            <span className="text-gray-600">Email</span>
            <button onClick={() => setShowChangeEmail(true)} className="text-purple-600 text-sm font-medium flex items-center gap-1">
              Cambia <ChevronRight size={16} />
            </button>
          </div>
          <p className="text-gray-800 font-medium -mt-2 mb-2">{user?.email}</p>

          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Email verificata</span>
            <span className={user?.emailVerified ? 'text-green-600' : 'text-red-500'}>{user?.emailVerified ? '✓ Sì' : '✗ No'}</span>
          </div>
          <div className="flex justify-between py-3 border-b">
            <span className="text-gray-600">Membro dal</span>
            <span className="text-gray-800">{formatDate(userData?.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const CompetitionCard = ({ competition, isJoined, onJoin, onSelect, userScore, userRank, competitionRiddles, isPastCompetition }) => {
  const now = new Date();
  let start, end, isActive, isPast;
  
  if (competitionRiddles && competitionRiddles.length > 0) {
    const dates = competitionRiddles.map(r => ({
      start: r.dataInizio?.toDate ? r.dataInizio.toDate() : new Date(r.dataInizio),
      end: r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine)
    }));
    start = new Date(Math.min(...dates.map(d => d.start.getTime())));
    end = new Date(Math.max(...dates.map(d => d.end.getTime())));
  } else {
    start = competition.dataInizio?.toDate ? competition.dataInizio.toDate() : new Date(competition.dataInizio);
    end = competition.dataFine?.toDate ? competition.dataFine.toDate() : new Date(competition.dataFine);
  }
  
  isActive = now >= start && now <= end;
  isPast = now > end;

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
      <p className="text-xs text-gray-400 mb-3">{formatDate(start)} - {formatDate(end)}</p>
      {isJoined && (
        <div className="bg-purple-50 rounded-xl p-3 mb-3 flex justify-between items-center">
          <span className="flex items-center gap-1"><Crown size={16} className="text-yellow-500" /> {userScore || 0} pt</span>
          <span className="text-sm text-gray-600">#{userRank || '-'}</span>
        </div>
      )}
      <button onClick={() => onSelect(competition)} className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 ${isJoined ? 'bg-purple-600 text-white' : isPast ? 'bg-gray-200 text-gray-700' : 'bg-purple-500 text-white'}`}>
        {isJoined ? <><ChevronRight size={18} /> Entra</> : isPast ? <><Eye size={18} /> Visualizza</> : <><UserPlus size={18} /> Partecipa</>}
      </button>
    </div>
  );
};

const ScheduledRiddleCard = ({ riddle, competition }) => {
  const start = riddle.dataInizio?.toDate ? riddle.dataInizio.toDate() : new Date(riddle.dataInizio);
  const hasCustomPoints = riddle.puntiCustom || riddle.bonusCustom;

  return (
    <div className="rounded-2xl p-4 bg-blue-50 border-2 border-blue-200 border-dashed">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <Calendar className="text-blue-600" size={20} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-gray-800">{riddle.titolo}</h3>
          <p className="text-xs text-blue-600">Disponibile dal {formatDateTime(start)}</p>
        </div>
      </div>
      {hasCustomPoints && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-xs text-yellow-700 font-medium">⭐ Punteggio speciale per questo quiz!</p>
        </div>
      )}
    </div>
  );
};

const RiddleCard = ({ riddle, competition, onSubmit, hasAnswered, userAnswer, onViewAnswers, showViewButton, isViewOnly }) => {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  const now = new Date();
  const start = riddle.dataInizio?.toDate ? riddle.dataInizio.toDate() : new Date(riddle.dataInizio);
  const end = riddle.dataFine?.toDate ? riddle.dataFine.toDate() : new Date(riddle.dataFine);
  const isPublished = now >= start;
  const isExpired = now > end;
  
  // Controlla se ha punteggio custom
  const hasCustomPoints = riddle.puntiCustom || riddle.bonusCustom;
  const punti = getEffectivePoints(riddle, competition);
  const bonus = getEffectiveBonus(riddle, competition);
  const hasBonus = bonus.uno > 0 || bonus.finoCinque > 0 || bonus.seiDieci > 0;

  const handleSubmit = async () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(riddle.id, answer.trim());
      setAnswer('');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isPublished) {
    return <ScheduledRiddleCard riddle={riddle} competition={competition} />;
  }

  return (
    <div className={`rounded-2xl p-5 ${isExpired ? 'bg-gray-50' : 'bg-purple-50'}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-bold text-gray-800">{riddle.titolo}</h3>
        {showViewButton && (
          <button onClick={() => onViewAnswers(riddle)} className="text-sm text-purple-600 font-medium flex items-center gap-1">
            Risultati <ChevronRight size={16} />
          </button>
        )}
      </div>
      
      <div className="text-gray-700 mb-4" dangerouslySetInnerHTML={{ __html: riddle.domanda }} />
      
      {/* Mostra punti solo se sono custom per questo quiz */}
      {hasCustomPoints && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
          <p className="text-xs text-yellow-700 font-medium mb-2">⭐ Punteggio speciale per questo quiz:</p>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">1° {punti.primo}pt</span>
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">Altri {punti.altri}pt</span>
          </div>
          {hasBonus && (
            <p className="text-xs text-yellow-600 mt-2">Bonus: Solo 1 +{bonus.uno} | 2-5 +{bonus.finoCinque} | 6-10 +{bonus.seiDieci}</p>
          )}
        </div>
      )}
      
      {isExpired || isViewOnly ? (
        <div className="bg-white rounded-xl p-4 border">
          <p className="text-sm text-gray-600">Risposta: <strong className="text-purple-700">{riddle.risposta}</strong></p>
          {riddle.correctCount !== undefined && (
            <p className="text-xs text-gray-500 mt-1">Risposte corrette: {riddle.correctCount}</p>
          )}
          {hasAnswered && (
            <p className="text-sm mt-2">Tua: "{userAnswer}" {compareAnswers(userAnswer, riddle.risposta) ? '✅' : '❌'}</p>
          )}
        </div>
      ) : hasAnswered ? (
        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
          <p className="text-green-700 font-medium flex items-center gap-2 mb-2"><Check size={18} /> Risposta inviata</p>
          <div className="bg-white rounded-lg p-3 border border-green-100">
            <p className="text-sm text-gray-600">La tua risposta:</p>
            <p className="text-lg font-semibold text-gray-800 mt-1">"{userAnswer}"</p>
          </div>
          <p className="text-xs text-gray-500 mt-3">Il risultato sarà visibile al termine del quiz</p>
        </div>
      ) : !isViewOnly ? (
        <>
          <p className="text-xs text-gray-500 mb-2">Scade: {formatDateTime(riddle.dataFine)}</p>
          <p className="text-xs text-red-500 mb-3 font-medium">⚠️ Un solo tentativo!</p>
          <div className="flex gap-2">
            <input type="text" placeholder="Risposta..." value={answer} onChange={e => setAnswer(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmit()} className="flex-1 px-4 py-3 border-2 border-purple-200 rounded-xl" />
            <button onClick={handleSubmit} disabled={submitting || !answer.trim()} className="px-6 py-3 bg-green-500 text-white rounded-xl font-semibold disabled:bg-gray-300">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Invia'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};

const CompetitionLeaderboard = ({ scores, currentUserId }) => {
  if (scores.length === 0) return <p className="text-gray-500 text-center py-8">Nessun partecipante</p>;
  const sorted = [...scores].sort((a, b) => (b.points || 0) - (a.points || 0));
  return (
    <div className="space-y-2">
      {sorted.map((s, i) => (
        <div key={s.oderId || s.id} className={`flex items-center justify-between p-4 rounded-xl ${i === 0 ? 'bg-yellow-100 border border-yellow-300' : i === 1 ? 'bg-gray-100' : i === 2 ? 'bg-orange-50' : 'bg-white border'}`}>
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200'}`}>{i + 1}</span>
            <span className={s.oderId === currentUserId ? 'text-purple-700 font-semibold' : ''}>
              {s.username || 'Utente'} {s.oderId === currentUserId && '(Tu)'}
            </span>
          </div>
          <span className="font-bold text-purple-700">{s.points || 0} pt</span>
        </div>
      ))}
    </div>
  );
};

const RiddleAnswersView = ({ riddle, answers, users, currentUserId, onBack }) => {
  const sorted = [...answers].sort((a, b) => {
    const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0);
    const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0);
    return timeA - timeB;
  });
  const userMap = {};
  users.forEach(u => {
    if (u.oderId) userMap[u.oderId] = u.username;
    if (u.id) userMap[u.id] = u.username;
    if (u.userId) userMap[u.userId] = u.username;
  });
  
  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
        <h3 className="text-xl font-bold text-purple-700">{riddle.titolo}</h3>
      </div>
      <div className="mb-4 p-4 bg-purple-50 rounded-xl">
        <p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p>
        {riddle.correctCount !== undefined && <p className="text-xs text-gray-500 mt-1">Risposte corrette: {riddle.correctCount}</p>}
      </div>
      {sorted.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Nessuna risposta</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {sorted.map((ans, i) => {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            const oderId = ans.userId || ans.oderId;
            return (
              <div key={ans.id} className={`p-3 rounded-xl border ${oderId === currentUserId ? 'bg-purple-50 border-purple-200' : 'bg-white'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>{i + 1}</span>
                    <div>
                      <span className="font-medium">{oderId === currentUserId ? 'Tu' : (userMap[oderId] || 'Utente')}</span>
                      <p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold ${ans.points > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {riddle.pointsAssigned ? (ans.points > 0 ? `+${ans.points}` : '0') : '-'}
                    </span>
                    {ans.bonus > 0 && <p className="text-xs text-green-500">+{ans.bonus} bonus</p>}
                  </div>
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

const CompetitionInfoView = ({ competition, competitionRiddles }) => {
  let start, end;
  if (competitionRiddles && competitionRiddles.length > 0) {
    const dates = competitionRiddles.map(r => ({
      start: r.dataInizio?.toDate ? r.dataInizio.toDate() : new Date(r.dataInizio),
      end: r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine)
    }));
    start = new Date(Math.min(...dates.map(d => d.start.getTime())));
    end = new Date(Math.max(...dates.map(d => d.end.getTime())));
  } else {
    start = competition.dataInizio?.toDate ? competition.dataInizio.toDate() : new Date(competition.dataInizio);
    end = competition.dataFine?.toDate ? competition.dataFine.toDate() : new Date(competition.dataFine);
  }

  const puntiDefault = competition.puntiDefault || { primo: 2, altri: 1 };
  const bonusDefault = competition.bonusDefault || { uno: 0, finoCinque: 0, seiDieci: 0 };
  const hasBonus = bonusDefault.uno > 0 || bonusDefault.finoCinque > 0 || bonusDefault.seiDieci > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Info size={18} className="text-purple-600" /> Informazioni</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <p><strong>Periodo:</strong> {formatDate(start)} - {formatDate(end)}</p>
          <p><strong>Partecipanti:</strong> {competition.participantsCount || 0}</p>
          <p><strong>Quiz totali:</strong> {competitionRiddles?.length || 0}</p>
          {competition.descrizione && <p><strong>Descrizione:</strong> {competition.descrizione}</p>}
        </div>
      </div>
      
      {/* Sezione Punteggi */}
      <div className="bg-white rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Trophy size={18} className="text-yellow-500" /> Punteggi</h3>
        <div className="space-y-3">
          <div className="p-3 bg-purple-50 rounded-xl">
            <p className="text-sm font-medium text-purple-700 mb-2">Punti standard:</p>
            <div className="flex gap-3">
              <span className="text-sm bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full">1° classificato: {puntiDefault.primo} pt</span>
              <span className="text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full">Altri: {puntiDefault.altri} pt</span>
            </div>
          </div>
          {hasBonus && (
            <div className="p-3 bg-green-50 rounded-xl">
              <p className="text-sm font-medium text-green-700 mb-2">🎁 Punti bonus:</p>
              <div className="text-sm text-green-600 space-y-1">
                {bonusDefault.uno > 0 && <p>• Se risponde solo 1 persona: <strong>+{bonusDefault.uno}</strong></p>}
                {bonusDefault.finoCinque > 0 && <p>• Se rispondono da 2 a 5 persone: <strong>+{bonusDefault.finoCinque}</strong></p>}
                {bonusDefault.seiDieci > 0 && <p>• Se rispondono da 6 a 10 persone: <strong>+{bonusDefault.seiDieci}</strong></p>}
              </div>
              <p className="text-xs text-gray-500 mt-2">I bonus si aggiungono ai punti standard</p>
            </div>
          )}
          <p className="text-xs text-gray-500 italic">Alcuni quiz potrebbero avere punteggi speciali diversi, indicati direttamente nel quiz.</p>
        </div>
      </div>
      
      {competition.regolamento ? (
        <div className="bg-white rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><FileText size={18} className="text-purple-600" /> Regolamento</h3>
          <div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: competition.regolamento }} />
        </div>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-8 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nessun regolamento disponibile</p>
        </div>
      )}
    </div>
  );
};

const EmailVerificationScreen = ({ user, onResendEmail, resending }) => (
  <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
      <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <Mail size={40} className="text-yellow-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Verifica la tua email</h2>
      <p className="text-gray-600 mb-6">Abbiamo inviato un link di verifica a <strong>{user.email}</strong>. Clicca sul link per attivare il tuo account.</p>
      <button onClick={onResendEmail} disabled={resending} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold mb-4 disabled:bg-gray-400 flex items-center justify-center gap-2">
        {resending ? <Loader2 size={20} className="animate-spin" /> : 'Invia di nuovo'}
      </button>
      <button onClick={() => signOut(auth)} className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold">Esci e riprova</button>
      <p className="text-xs text-gray-400 mt-4">Dopo aver verificato, ricarica questa pagina</p>
    </div>
  </div>
);

const App = () => {
  const savedState = useRef(loadNavState());
  const backPressTime = useRef(0);
  
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialStateRestored, setInitialStateRestored] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState(savedState.current?.activeTab || 'home');
  const [competitions, setCompetitions] = useState([]);
  const [userCompetitions, setUserCompetitions] = useState([]);
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionTab, setCompetitionTab] = useState(savedState.current?.competitionTab || 'quiz');
  const [competitionScores, setCompetitionScores] = useState([]);
  const [riddles, setRiddles] = useState([]);
  const [allRiddles, setAllRiddles] = useState([]);
  const [allUserScores, setAllUserScores] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [readAnnouncements, setReadAnnouncements] = useState([]);
  const [showPopup, setShowPopup] = useState(null);
  const [inAppNotifications, setInAppNotifications] = useState([]);
  const [dismissedNotifications, setDismissedNotifications] = useState([]);
  const [floatingNotification, setFloatingNotification] = useState(null);
  const [showBackToast, setShowBackToast] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [updatingUsername, setUpdatingUsername] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const showMsg = useCallback((msg, dur = 3000) => {
    setMessage(msg);
    if (dur > 0) setTimeout(() => setMessage(''), dur);
  }, []);

  useEffect(() => {
    const handleBackButton = (e) => {
      if (viewingRiddle) { e.preventDefault(); setViewingRiddle(null); return; }
      if (selectedCompetition) { e.preventDefault(); setSelectedCompetition(null); setCompetitionTab('quiz'); return; }
      if (activeTab !== 'home') { e.preventDefault(); setActiveTab('home'); return; }
      const now = Date.now();
      if (now - backPressTime.current < 2000) return;
      e.preventDefault();
      backPressTime.current = now;
      setShowBackToast(true);
      setTimeout(() => setShowBackToast(false), 2000);
    };
    window.addEventListener('popstate', handleBackButton);
    if (window.history.state === null) window.history.pushState({ page: 'app' }, '');
    return () => window.removeEventListener('popstate', handleBackButton);
  }, [viewingRiddle, selectedCompetition, activeTab]);

  useEffect(() => {
    if (user && !loading) {
      window.history.pushState({ activeTab, selectedCompetition: selectedCompetition?.id, viewingRiddle: viewingRiddle?.id }, '');
    }
  }, [activeTab, selectedCompetition, viewingRiddle, user, loading]);

  useEffect(() => {
    if (user && initialStateRestored) {
      saveNavState({ activeTab, selectedCompetitionId: selectedCompetition?.id || null, competitionTab, viewingRiddleId: viewingRiddle?.id || null });
    }
  }, [activeTab, selectedCompetition, competitionTab, viewingRiddle, user, initialStateRestored]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserData({ id: userDoc.id, ...data });
            setReadAnnouncements(data.readAnnouncements || []);
            setDismissedNotifications(data.dismissedNotifications || []);
          }
        } catch (e) { console.error('Error loading user data:', e); }
      } else {
        setUser(null);
        setUserData(null);
        setSelectedCompetition(null);
        setViewingRiddle(null);
        sessionStorage.removeItem('haikuNavState');
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(50)), (snap) => setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    if (user && user.emailVerified && announcements.length > 0 && !showPopup) {
      const shown = JSON.parse(sessionStorage.getItem('shownAnnouncements') || '[]');
      const unread = announcements.find(a => !readAnnouncements.includes(a.id) && !shown.includes(a.id));
      if (unread) {
        setShowPopup(unread);
        sessionStorage.setItem('shownAnnouncements', JSON.stringify([...shown, unread.id]));
      }
    }
  }, [user, announcements, readAnnouncements, showPopup]);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'competitions'), orderBy('dataInizio', 'desc')), (snap) => setCompetitions(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'riddles')), (snap) => setAllRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    if (competitions.length > 0 && user && !initialStateRestored && savedState.current) {
      if (savedState.current.selectedCompetitionId) {
        const comp = competitions.find(c => c.id === savedState.current.selectedCompetitionId);
        if (comp) setSelectedCompetition(comp);
      }
      setInitialStateRestored(true);
    } else if (competitions.length > 0 && user && !initialStateRestored) {
      setInitialStateRestored(true);
    }
  }, [competitions, user, initialStateRestored]);

  useEffect(() => {
    if (!user) { setUserCompetitions([]); setAllUserScores([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('oderId', '==', user.uid)), (snap) => {
      const scores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUserCompetitions(scores.map(s => s.competitionId));
      setAllUserScores(scores);
    });
  }, [user]);

  useEffect(() => {
    if (!selectedCompetition) { setRiddles([]); return; }
    return onSnapshot(query(collection(db, 'riddles'), where('competitionId', '==', selectedCompetition.id)), async (snap) => {
      const now = new Date();
      const list = [];
      for (const docSnap of snap.docs) {
        const data = { id: docSnap.id, ...docSnap.data() };
        const end = data.dataFine?.toDate ? data.dataFine.toDate() : new Date(data.dataFine);
        if (now > end && !data.pointsAssigned) {
          try { await assignPointsForRiddle(docSnap.id, data, selectedCompetition); data.pointsAssigned = true; } catch (e) { console.error('Error assigning points:', e); }
        }
        list.push(data);
      }
      list.sort((a, b) => {
        const dateA = a.dataInizio?.toDate ? a.dataInizio.toDate() : new Date(a.dataInizio);
        const dateB = b.dataInizio?.toDate ? b.dataInizio.toDate() : new Date(b.dataInizio);
        return dateA - dateB;
      });
      setRiddles(list);
    });
  }, [selectedCompetition]);

  useEffect(() => {
    if (!selectedCompetition) { setCompetitionScores([]); return; }
    return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [selectedCompetition]);

  useEffect(() => {
    if (!user) { setUserAnswers({}); return; }
    return onSnapshot(query(collection(db, 'answers'), where('userId', '==', user.uid)), (snap) => {
      const answers = {};
      snap.forEach(d => { const data = d.data(); answers[data.riddleId] = { id: d.id, ...data }; });
      setUserAnswers(answers);
    });
  }, [user]);

  useEffect(() => {
    if (!user || userCompetitions.length === 0) { setInAppNotifications([]); return; }
    const compIds = userCompetitions.slice(0, 10);
    return onSnapshot(query(collection(db, 'riddles'), where('competitionId', 'in', compIds)), (snap) => {
      const now = new Date();
      const notifications = [];
      const shown = JSON.parse(sessionStorage.getItem('shownRiddleNotifications') || '[]');
      const floatingShown = JSON.parse(sessionStorage.getItem('floatingShown') || '[]');
      snap.docs.forEach(docSnap => {
        const riddle = { id: docSnap.id, ...docSnap.data() };
        const start = riddle.dataInizio?.toDate ? riddle.dataInizio.toDate() : new Date(riddle.dataInizio);
        const end = riddle.dataFine?.toDate ? riddle.dataFine.toDate() : new Date(riddle.dataFine);
        const comp = competitions.find(c => c.id === riddle.competitionId);
        if (now >= start && now <= end && !dismissedNotifications.includes(`new_${riddle.id}`) && !shown.includes(`new_${riddle.id}`)) {
          const notif = { id: `new_${riddle.id}`, type: 'new_riddle', title: `Nuovo quiz: ${riddle.titolo}`, message: `${comp?.nome || 'Gara'} - Scade ${formatDateTime(riddle.dataFine)}`, riddleId: riddle.id, competitionId: riddle.competitionId, expiry: end };
          notifications.push(notif);
          if (!floatingShown.includes(notif.id)) { setFloatingNotification(notif); sessionStorage.setItem('floatingShown', JSON.stringify([...floatingShown, notif.id])); }
        }
        if (now > end && riddle.pointsAssigned && !dismissedNotifications.includes(`result_${riddle.id}`) && !shown.includes(`result_${riddle.id}`)) {
          const ans = userAnswers[riddle.id];
          if (ans) {
            const correct = compareAnswers(ans.answer, riddle.risposta);
            const notif = { id: `result_${riddle.id}`, type: 'result', title: `Risultato: ${riddle.titolo}`, message: correct ? `Hai guadagnato ${ans.points || 0} punti!` : `Risposta errata. Soluzione: ${riddle.risposta}`, riddleId: riddle.id, competitionId: riddle.competitionId };
            notifications.push(notif);
            if (!floatingShown.includes(notif.id)) { setFloatingNotification(notif); sessionStorage.setItem('floatingShown', JSON.stringify([...floatingShown, notif.id])); }
          }
        }
      });
      setInAppNotifications(notifications.slice(0, 5));
    });
  }, [user, userCompetitions, competitions, dismissedNotifications, userAnswers]);

  useEffect(() => {
    const check = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'riddles'), where('pointsAssigned', '==', false)));
        const now = new Date();
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const end = data.dataFine?.toDate ? data.dataFine.toDate() : new Date(data.dataFine);
          if (now > end) {
            const comp = competitions.find(c => c.id === data.competitionId);
            await assignPointsForRiddle(docSnap.id, data, comp);
          }
        }
      } catch (e) { console.error('Periodic check error:', e); }
    };
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [competitions]);

  const handleNotificationNavigate = (notification) => {
    const comp = competitions.find(c => c.id === notification.competitionId);
    if (comp) { setSelectedCompetition(comp); setCompetitionTab(notification.type === 'new_riddle' ? 'quiz' : 'classifica'); }
    setFloatingNotification(null);
  };

  const handleResendVerificationEmail = async () => {
    if (!user || resendingEmail) return;
    setResendingEmail(true);
    try { await sendEmailVerification(user); showMsg('✅ Email inviata!'); } catch { showMsg('Errore: riprova tra qualche minuto'); } finally { setResendingEmail(false); }
  };

  const handleForgotPassword = async (email) => {
    setSendingReset(true);
    try { await sendPasswordResetEmail(auth, email); return true; } catch (e) { showMsg('Errore: ' + e.message); return false; } finally { setSendingReset(false); }
  };

  const handleRegister = async () => {
    if (authLoading) return;
    if (fullName.trim().length < 3) { showMsg('Nome completo: min 3 caratteri'); return; }
    if (username.trim().length < 3) { showMsg('Nickname: min 3 caratteri'); return; }
    if (!email.includes('@')) { showMsg('Email non valida'); return; }
    if (password.length < 6) { showMsg('Password: min 6 caratteri'); return; }
    setAuthLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      const userData = { fullName: fullName.trim(), username: username.trim(), email, readAnnouncements: [], dismissedNotifications: [], usernameChangedAt: null, createdAt: serverTimestamp() };
      await setDoc(doc(db, 'users', cred.user.uid), userData);
      const webhookUrl = import.meta.env.VITE_PABBLY_WEBHOOK_URL;
      if (webhookUrl) {
        try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, mode: 'no-cors', body: JSON.stringify({ event: 'new_registration', oderId: cred.user.uid, fullName: fullName.trim(), username: username.trim(), email, timestamp: new Date().toISOString() }) }); } catch (e) { console.error('Webhook error:', e); }
      }
      showMsg('✅ Registrazione completata! Controlla la tua email.');
    } catch (e) { showMsg(e.code === 'auth/email-already-in-use' ? 'Email già registrata' : 'Errore'); } finally { setAuthLoading(false); }
  };

  const handleLogin = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try { await signInWithEmailAndPassword(auth, email, password); } catch { showMsg('Credenziali errate'); } finally { setAuthLoading(false); }
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('haikuNavState');
    await signOut(auth);
    setSelectedCompetition(null);
    setViewingRiddle(null);
    setActiveTab('home');
  };

  const handleUpdateUsername = async (newUsername) => {
    if (!user || !userData || updatingUsername) return false;
    setUpdatingUsername(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { username: newUsername, usernameChangedAt: serverTimestamp() });
      const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', user.uid)));
      for (const scoreDoc of scoresSnap.docs) await updateDoc(scoreDoc.ref, { username: newUsername });
      setUserData(prev => ({ ...prev, username: newUsername, usernameChangedAt: Timestamp.now() }));
      await sendUserWebhook('user_updated', { oderId: user.uid, fullName: userData.fullName, username: newUsername, email: userData.email });
      showMsg('✅ Nickname aggiornato!');
      return true;
    } catch (e) { showMsg('Errore: ' + e.message); return false; } finally { setUpdatingUsername(false); }
  };

  const handleUpdateFullName = async (newFullName) => {
    if (!user || !userData || updatingUsername) return false;
    setUpdatingUsername(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { fullName: newFullName });
      setUserData(prev => ({ ...prev, fullName: newFullName }));
      await sendUserWebhook('user_updated', { oderId: user.uid, fullName: newFullName, username: userData.username, email: userData.email });
      showMsg('✅ Nome aggiornato!');
      return true;
    } catch (e) { showMsg('Errore: ' + e.message); return false; } finally { setUpdatingUsername(false); }
  };

  const canChangeUsername = () => {
    if (!userData?.usernameChangedAt) return true;
    const lastChange = userData.usernameChangedAt.toDate ? userData.usernameChangedAt.toDate() : new Date(userData.usernameChangedAt);
    return (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24) >= 30;
  };

  const daysUntilUsernameChange = () => {
    if (!userData?.usernameChangedAt) return 0;
    const lastChange = userData.usernameChangedAt.toDate ? userData.usernameChangedAt.toDate() : new Date(userData.usernameChangedAt);
    return Math.max(0, Math.ceil(30 - (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24)));
  };

  const handleJoinCompetition = async (compId) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'competitionScores', `${compId}_${user.uid}`), { competitionId: compId, oderId: user.uid, username: userData?.username || 'Utente', points: 0, joinedAt: serverTimestamp() });
      const compRef = doc(db, 'competitions', compId);
      const compDoc = await getDoc(compRef);
      if (compDoc.exists()) await updateDoc(compRef, { participantsCount: (compDoc.data().participantsCount || 0) + 1 });
      showMsg('✅ Iscritto!');
    } catch (e) { console.error('Join error:', e); showMsg('Errore'); }
  };

  const handleSubmitAnswer = async (riddleId, answer) => {
    if (!user || userAnswers[riddleId]) return;
    
    // Verifica lato server se esiste già una risposta
    const existingSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId), where('userId', '==', user.uid)));
    if (!existingSnap.empty) {
      showMsg('⚠️ Hai già risposto a questo quiz');
      return;
    }
    
    const answerData = { userId: user.uid, riddleId, answer, time: serverTimestamp(), points: 0, isCorrect: null };
    setUserAnswers(prev => ({ ...prev, [riddleId]: answerData }));
    showMsg('✅ Inviata!');
    try { await setDoc(doc(collection(db, 'answers')), answerData); } catch (e) { console.error('Submit error:', e); setUserAnswers(prev => { const n = { ...prev }; delete n[riddleId]; return n; }); showMsg('Errore'); }
  };

  const handleViewAnswers = async (riddle) => {
    setViewingRiddle(riddle);
    try { const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id))); setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); } catch (e) { console.error('View answers error:', e); }
  };

  const handleMarkAnnouncementRead = async (annId) => {
    if (!user) return;
    const newRead = [...readAnnouncements, annId];
    setReadAnnouncements(newRead);
    try { await updateDoc(doc(db, 'users', user.uid), { readAnnouncements: newRead }); } catch (e) { console.error('Mark read error:', e); }
  };

  const handleDismissNotification = async (notifId) => {
    if (!user) return;
    const newDismissed = [...dismissedNotifications, notifId];
    setDismissedNotifications(newDismissed);
    sessionStorage.setItem('shownRiddleNotifications', JSON.stringify([...JSON.parse(sessionStorage.getItem('shownRiddleNotifications') || '[]'), notifId]));
    setFloatingNotification(null);
    try { await updateDoc(doc(db, 'users', user.uid), { dismissedNotifications: newDismissed }); } catch (e) { console.error('Dismiss error:', e); }
  };

  const getRiddlesForCompetition = (compId) => allRiddles.filter(r => r.competitionId === compId);

  const isCompetitionActive = (comp) => {
    const compRiddles = getRiddlesForCompetition(comp.id);
    const now = new Date();
    if (compRiddles.length > 0) {
      const dates = compRiddles.map(r => ({ start: r.dataInizio?.toDate ? r.dataInizio.toDate() : new Date(r.dataInizio), end: r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine) }));
      return now >= new Date(Math.min(...dates.map(d => d.start.getTime()))) && now <= new Date(Math.max(...dates.map(d => d.end.getTime())));
    }
    const start = comp.dataInizio?.toDate ? comp.dataInizio.toDate() : new Date(comp.dataInizio);
    const end = comp.dataFine?.toDate ? comp.dataFine.toDate() : new Date(comp.dataFine);
    return now >= start && now <= end;
  };

  const isCompetitionPast = (comp) => {
    const compRiddles = getRiddlesForCompetition(comp.id);
    const now = new Date();
    if (compRiddles.length > 0) {
      const dates = compRiddles.map(r => ({ end: r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine) }));
      return now > new Date(Math.max(...dates.map(d => d.end.getTime())));
    }
    const end = comp.dataFine?.toDate ? comp.dataFine.toDate() : new Date(comp.dataFine);
    return now > end;
  };

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (user && !user.emailVerified) return <EmailVerificationScreen user={user} onResendEmail={handleResendVerificationEmail} resending={resendingEmail} />;

  if (viewingRiddle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-4 pb-24">
        <FloatingNotification notification={floatingNotification} onDismiss={handleDismissNotification} onNavigate={handleNotificationNavigate} />
        <BackToast show={showBackToast} />
        <div className="max-w-lg mx-auto"><RiddleAnswersView riddle={viewingRiddle} answers={riddleAnswers} users={competitionScores} currentUserId={user?.uid} onBack={() => setViewingRiddle(null)} /></div>
      </div>
    );
  }

  if (selectedCompetition) {
    const isJoined = userCompetitions.includes(selectedCompetition.id);
    const isPast = isCompetitionPast(selectedCompetition);
    const isViewOnly = isPast && !isJoined;
    const now = new Date();
    
    const scheduledRiddles = riddles.filter(r => { const s = r.dataInizio?.toDate ? r.dataInizio.toDate() : new Date(r.dataInizio); return now < s; });
    const activeRiddles = riddles.filter(r => { const s = r.dataInizio?.toDate ? r.dataInizio.toDate() : new Date(r.dataInizio); const e = r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine); return now >= s && now <= e; });
    const pastRiddles = riddles.filter(r => { const e = r.dataFine?.toDate ? r.dataFine.toDate() : new Date(r.dataFine); return now > e; });
    
    const userScore = competitionScores.find(s => s.oderId === user?.uid);
    const sortedScores = [...competitionScores].sort((a, b) => (b.points || 0) - (a.points || 0));
    const userRank = user ? sortedScores.findIndex(s => s.oderId === user.uid) + 1 : 0;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 pb-24">
        <FloatingNotification notification={floatingNotification} onDismiss={handleDismissNotification} onNavigate={handleNotificationNavigate} />
        <BackToast show={showBackToast} />
        
        <div className="bg-white rounded-b-3xl shadow-lg p-4 mb-4">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <button onClick={() => { setSelectedCompetition(null); setCompetitionTab('quiz'); }} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-purple-800">{selectedCompetition.nome}</h2>
              {isJoined && user && <p className="text-sm text-purple-600">{userScore?.points || 0} pt • #{userRank || '-'}</p>}
              {isViewOnly && <p className="text-sm text-gray-500">Visualizzazione archivio</p>}
            </div>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4">
          {!isJoined && !isPast ? (
            <div className="text-center py-12 bg-white rounded-2xl">
              <Flag size={48} className="mx-auto text-purple-300 mb-4" />
              <p className="text-gray-600 mb-4">Non sei iscritto</p>
              {user ? (
                <button onClick={() => handleJoinCompetition(selectedCompetition.id)} className="bg-purple-600 text-white px-8 py-3 rounded-xl font-semibold inline-flex items-center gap-2"><UserPlus size={20} /> Partecipa</button>
              ) : (
                <p className="text-gray-500">Accedi per partecipare</p>
              )}
            </div>
          ) : (
            <>
              <CompetitionTabs activeTab={competitionTab} setActiveTab={setCompetitionTab} hasActiveRiddle={activeRiddles.length > 0} />

              {competitionTab === 'quiz' && (
                <>
                  {activeRiddles.length > 0 && !isViewOnly && (
                    <div className="mb-6">
                      <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Star className="text-yellow-500" /> Attivi ({activeRiddles.length})</h3>
                      <div className="space-y-4">
                        {activeRiddles.map(r => <RiddleCard key={r.id} riddle={r} competition={selectedCompetition} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} isViewOnly={false} />)}
                      </div>
                    </div>
                  )}
                  
                  {activeRiddles.length === 0 && scheduledRiddles.length === 0 && pastRiddles.length === 0 && (
                    <div className="bg-white rounded-2xl p-8 text-center mb-6"><Clock size={48} className="mx-auto text-gray-300 mb-4" /><p className="text-gray-600">Nessun quiz disponibile</p></div>
                  )}

                  {scheduledRiddles.length > 0 && !isViewOnly && (
                    <div className="mb-6">
                      <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Calendar className="text-blue-500" /> In arrivo ({scheduledRiddles.length})</h3>
                      <div className="space-y-3">{scheduledRiddles.map(r => <ScheduledRiddleCard key={r.id} riddle={r} competition={selectedCompetition} />)}</div>
                    </div>
                  )}
                  
                  {pastRiddles.length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Clock className="text-gray-400" /> {isViewOnly ? 'Quiz' : 'Conclusi'} ({pastRiddles.length})</h3>
                      <div className="space-y-3">
                        {pastRiddles.map(r => <RiddleCard key={r.id} riddle={r} competition={selectedCompetition} onSubmit={handleSubmitAnswer} hasAnswered={!!userAnswers[r.id]} userAnswer={userAnswers[r.id]?.answer} onViewAnswers={handleViewAnswers} showViewButton={r.pointsAssigned} isViewOnly={isViewOnly} />)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {competitionTab === 'classifica' && (
                <div className="bg-white rounded-2xl p-5">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifica {isPast && 'finale'}</h3>
                  <CompetitionLeaderboard scores={competitionScores} currentUserId={user?.uid} />
                </div>
              )}

              {competitionTab === 'info' && <CompetitionInfoView competition={selectedCompetition} competitionRiddles={riddles} />}
            </>
          )}
        </div>

        {message && <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-purple-600 text-white p-4 rounded-xl text-center shadow-lg">{message}</div>}
      </div>
    );
  }

  const unreadAnnouncements = announcements.filter(a => !readAnnouncements.includes(a.id));
  const activeJoinedComps = competitions.filter(c => userCompetitions.includes(c.id) && isCompetitionActive(c));
  const allJoinedComps = competitions.filter(c => userCompetitions.includes(c.id));
  const pastComps = competitions.filter(c => isCompetitionPast(c) && !userCompetitions.includes(c.id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 pb-24">
      <FloatingNotification notification={floatingNotification} onDismiss={handleDismissNotification} onNavigate={handleNotificationNavigate} />
      <AnnouncementPopup announcement={showPopup} onClose={() => setShowPopup(null)} onMarkRead={handleMarkAnnouncementRead} />
      <BackToast show={showBackToast} />
      {showForgotPassword && <ForgotPasswordModal onClose={() => setShowForgotPassword(false)} onSend={handleForgotPassword} sending={sendingReset} />}

      <div className="bg-white rounded-b-3xl shadow-lg p-6 mb-6">
        <div className="max-w-lg mx-auto">
          {user ? (
            <div className="flex justify-between items-center">
              <div><p className="text-gray-500 text-sm">Ciao 👋</p><h1 className="text-2xl font-bold text-purple-800">{userData?.username}</h1></div>
              <button onClick={handleLogout} className="p-3 bg-gray-100 rounded-xl"><LogOut size={20} className="text-gray-600" /></button>
            </div>
          ) : (
            <div className="text-center"><h1 className="text-3xl font-bold text-purple-800 mb-1">🎯 Haiku Quiz</h1><p className="text-gray-500">Indovinelli quotidiani</p></div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4">
        {!user ? (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">{isLoginMode ? 'Accedi' : 'Registrati'}</h2>
            
            {!isLoginMode && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-2">Nome completo</label>
                  <div className="relative">
                    <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Nome e Cognome" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-2">Nickname</label>
                  <div className="relative">
                    <Star size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Min. 3 caratteri" value={username} onChange={e => setUsername(e.target.value)} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
                  </div>
                </div>
              </>
            )}
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="email" placeholder="email@esempio.com" value={email} onChange={e => setEmail(e.target.value)} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="password" placeholder="Min. 6 caratteri" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && (isLoginMode ? handleLogin() : handleRegister())} className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl" />
              </div>
            </div>
            
            {isLoginMode && (
              <button onClick={() => setShowForgotPassword(true)} className="w-full text-right text-sm text-purple-600 mb-4">Password dimenticata?</button>
            )}
            
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
                  <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-xl flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('notifications')}>
                    <Bell className="text-purple-600" size={20} /><span className="text-purple-700">{unreadAnnouncements.length} nuov{unreadAnnouncements.length === 1 ? 'o avviso' : 'i avvisi'}</span><ChevronRight className="text-purple-400 ml-auto" size={18} />
                  </div>
                )}
                
                {activeJoinedComps.length > 0 ? (
                  <div className="mb-6">
                    <h3 className="font-bold text-gray-800 mb-3">Gare attive</h3>
                    <div className="space-y-4">
                      {activeJoinedComps.map(comp => {
                        const usd = allUserScores.find(s => s.competitionId === comp.id);
                        return <CompetitionCard key={comp.id} competition={comp} isJoined={true} onJoin={handleJoinCompetition} onSelect={setSelectedCompetition} userScore={usd?.points} competitionRiddles={getRiddlesForCompetition(comp.id)} />;
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-8 text-center mb-6">
                    <Flag size={48} className="mx-auto text-purple-200 mb-4" /><p className="text-gray-600 font-medium">Nessuna gara attiva</p>
                    <button onClick={() => setActiveTab('competitions')} className="mt-4 bg-purple-600 text-white px-6 py-3 rounded-xl font-semibold">Scopri le gare</button>
                  </div>
                )}
              </>
            )}

            {activeTab === 'competitions' && (
              <div className="space-y-4">
                {allJoinedComps.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-bold text-gray-800 mb-3">Le tue gare</h3>
                    <div className="space-y-4">
                      {allJoinedComps.map(comp => {
                        const usd = allUserScores.find(s => s.competitionId === comp.id);
                        return <CompetitionCard key={comp.id} competition={comp} isJoined={true} onJoin={handleJoinCompetition} onSelect={setSelectedCompetition} userScore={usd?.points} competitionRiddles={getRiddlesForCompetition(comp.id)} />;
                      })}
                    </div>
                  </div>
                )}
                
                <h3 className="font-bold text-gray-800">Tutte le gare</h3>
                {competitions.filter(c => !userCompetitions.includes(c.id)).length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 text-center"><p className="text-gray-500">Nessuna nuova gara disponibile</p></div>
                ) : (
                  competitions.filter(c => !userCompetitions.includes(c.id)).map(comp => (
                    <CompetitionCard key={comp.id} competition={comp} isJoined={false} onJoin={handleJoinCompetition} onSelect={setSelectedCompetition} userScore={0} competitionRiddles={getRiddlesForCompetition(comp.id)} isPastCompetition={isCompetitionPast(comp)} />
                  ))
                )}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2"><Megaphone className="text-purple-600" /> Avvisi</h3>
                {announcements.length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 text-center"><Bell size={48} className="mx-auto text-gray-200 mb-4" /><p className="text-gray-500">Nessun avviso</p></div>
                ) : (
                  announcements.map(ann => (
                    <div key={ann.id} className={`bg-white rounded-2xl p-4 ${!readAnnouncements.includes(ann.id) ? 'border-2 border-purple-300' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0"><Megaphone className="text-purple-600" size={18} /></div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-gray-800">{ann.titolo}</h4>
                            {!readAnnouncements.includes(ann.id) && <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Nuovo</span>}
                          </div>
                          <div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: ann.messaggio }} />
                          <p className="text-xs text-gray-400 mt-2">{formatDate(ann.createdAt)}</p>
                        </div>
                      </div>
                      {!readAnnouncements.includes(ann.id) && <button onClick={() => handleMarkAnnouncementRead(ann.id)} className="w-full mt-3 text-sm text-purple-600 font-medium">Segna come letto</button>}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'profile' && <ProfileView userData={userData} user={user} onUpdateUsername={handleUpdateUsername} onUpdateFullName={handleUpdateFullName} updating={updatingUsername} canChangeUsername={canChangeUsername()} daysUntilChange={daysUntilUsernameChange()} />}
          </>
        )}

        {message && user && <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-purple-600 text-white p-4 rounded-xl text-center shadow-lg">{message}</div>}
      </div>

      {user && <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} hasNotifications={unreadAnnouncements.length > 0} />}
      
      <style>{`
        @keyframes slide-down { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-down { animation: slide-down 0.3s ease-out; }
      `}</style>
    </div>
  );
};


export default App;
