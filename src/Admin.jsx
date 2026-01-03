import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Trash2, LogOut, Bold, Italic, List, Eye, Loader2, ArrowLeft, Lock, Trophy, Flag, Users, Megaphone, Home, LayoutGrid, FileText, Edit3, RefreshCw, Gift, Save, Clock, Star, AlertTriangle, ChevronRight, Info, BarChart3, Archive, ArchiveRestore, Dumbbell, Target, Send, EyeOff } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

const ADMIN_EMAILS = ['haikuquizofficial@gmail.com'];

const formatDateTime = (ts) => { if (!ts) return '-'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const formatDate = (ts) => { if (!ts) return '-'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('it-IT'); };
const formatDateForInput = (ts) => { if (!ts) return ''; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toISOString().split('T')[0]; };
const formatTimeForInput = (ts) => { if (!ts) return '09:00'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toTimeString().slice(0, 5); };
const compareAnswers = (a, b) => a?.trim().toLowerCase() === b?.trim().toLowerCase();

const sendUserWebhook = async (event, userData) => { const webhookUrl = import.meta.env.VITE_PABBLY_WEBHOOK_URL; if (!webhookUrl) return; try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, mode: 'no-cors', body: JSON.stringify({ event, oderId: userData.oderId || userData.id, fullName: userData.fullName, username: userData.username, email: userData.email, timestamp: new Date().toISOString() }) }); } catch (e) { console.error('Webhook error:', e); } };

const getEffectivePoints = (riddle, competition) => { if (riddle.puntiCustom) return riddle.punti || { primo: 2, altri: 1 }; if (competition?.puntiDefault) return competition.puntiDefault; return { primo: 2, altri: 1 }; };
const getEffectiveBonus = (riddle, competition) => { if (riddle.bonusCustom) return riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 }; if (competition?.bonusDefault) return competition.bonusDefault; return { uno: 0, finoCinque: 0, seiDieci: 0 }; };
const getBonusPoints = (correctCount, riddle, competition) => { const bonus = getEffectiveBonus(riddle, competition); if (correctCount === 1) return bonus.uno || 0; if (correctCount >= 2 && correctCount <= 5) return bonus.finoCinque || 0; if (correctCount >= 6 && correctCount <= 10) return bonus.seiDieci || 0; return 0; };

const recalculateRiddlePoints = async (riddleId, riddle, competition) => {
  try {
    const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddleId)));
    const allAnswers = []; answersSnap.forEach(d => allAnswers.push({ id: d.id, ref: d.ref, ...d.data() }));
    if (allAnswers.length === 0) { await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, correctCount: 0 }); return { success: true, processed: 0 }; }
    allAnswers.sort((a, b) => { const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0); const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0); return timeA - timeB; });
    const seenUsers = new Set(); const answers = [];
    for (const ans of allAnswers) { const oderId = ans.userId || ans.oderId; if (!seenUsers.has(oderId)) { seenUsers.add(oderId); answers.push(ans); } else { await updateDoc(ans.ref, { points: 0, isCorrect: false, duplicate: true }); } }
    const punti = getEffectivePoints(riddle, competition); const getPoints = (pos) => pos === 0 ? (punti.primo || 2) : (punti.altri || 1);
    const correctAnswers = answers.filter(ans => compareAnswers(ans.answer, riddle.risposta)); const correctCount = correctAnswers.length; const bonus = getBonusPoints(correctCount, riddle, competition);
    if (riddle.competitionId) { for (const oldAns of allAnswers.filter(a => a.points > 0)) { const oderId = oldAns.userId || oldAns.oderId; const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - oldAns.points) }); } }
    let correctPosition = 0;
    for (const ans of answers) { const isCorrect = compareAnswers(ans.answer, riddle.risposta); let points = 0, ansBonus = 0; if (isCorrect) { ansBonus = bonus; points = getPoints(correctPosition) + ansBonus; correctPosition++; } await updateDoc(ans.ref, { points, isCorrect, bonus: ansBonus }); if (points > 0 && riddle.competitionId) { const oderId = ans.userId || ans.oderId; const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: (scoreDoc.data().points || 0) + points }); } }
    await updateDoc(doc(db, 'riddles', riddleId), { pointsAssigned: true, processedAt: serverTimestamp(), correctCount });
    return { success: true, processed: answers.length, correct: correctPosition };
  } catch (e) { return { success: false, error: e.message }; }
};


const resetAndRecalculateAllScores = async (competitionId, compRiddles, competition) => {
  try {
    const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', competitionId)));
    for (const scoreDoc of scoresSnap.docs) await updateDoc(scoreDoc.ref, { points: 0 });
    const userPoints = {};
    const now = new Date();
    let processed = 0;
    for (const riddle of compRiddles) {
      const end = riddle.dataFine?.toDate ? riddle.dataFine.toDate() : new Date(riddle.dataFine);
      if (now <= end) continue;
      const answersSnap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id)));
      const allAnswers = []; answersSnap.forEach(d => allAnswers.push({ id: d.id, ref: d.ref, ...d.data() }));
      if (allAnswers.length === 0) { await updateDoc(doc(db, 'riddles', riddle.id), { pointsAssigned: true, correctCount: 0 }); processed++; continue; }
      allAnswers.sort((a, b) => { const timeA = a.time?.toDate ? a.time.toDate().getTime() : (a.time?.seconds ? a.time.seconds * 1000 : 0); const timeB = b.time?.toDate ? b.time.toDate().getTime() : (b.time?.seconds ? b.time.seconds * 1000 : 0); return timeA - timeB; });
      const seenUsers = new Set(); const answers = [];
      for (const ans of allAnswers) { const oderId = ans.userId || ans.oderId; if (!seenUsers.has(oderId)) { seenUsers.add(oderId); answers.push(ans); } else { await updateDoc(ans.ref, { points: 0, isCorrect: false, duplicate: true }); } }
      const punti = getEffectivePoints(riddle, competition); const getPoints = (pos) => pos === 0 ? (punti.primo || 2) : (punti.altri || 1);
      const correctAnswers = answers.filter(ans => compareAnswers(ans.answer, riddle.risposta)); const correctCount = correctAnswers.length; const bonus = getBonusPoints(correctCount, riddle, competition);
      let correctPosition = 0;
      for (const ans of answers) { const isCorrect = compareAnswers(ans.answer, riddle.risposta); let points = 0, ansBonus = 0; if (isCorrect) { ansBonus = bonus; points = getPoints(correctPosition) + ansBonus; correctPosition++; const oderId = ans.userId || ans.oderId; userPoints[oderId] = (userPoints[oderId] || 0) + points; } await updateDoc(ans.ref, { points, isCorrect, bonus: ansBonus }); }
      await updateDoc(doc(db, 'riddles', riddle.id), { pointsAssigned: true, correctCount });
      processed++;
    }
    for (const oderId in userPoints) { const scoreRef = doc(db, 'competitionScores', `${competitionId}_${oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: userPoints[oderId] }); }
    return { success: true, processed };
  } catch (e) { return { success: false, error: e.message }; }
};

const AdminBottomNav = ({ activeTab, setActiveTab }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-2 py-2 z-50"><div className="max-w-4xl mx-auto flex justify-around">
    {[{ id: 'dashboard', icon: Home, label: 'Home' }, { id: 'competitions', icon: Flag, label: 'Gare' }, { id: 'training', icon: Dumbbell, label: 'Allena' }, { id: 'announcements', icon: Megaphone, label: 'Avvisi' }, { id: 'users', icon: Users, label: 'Utenti' }].map(tab => (
      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center px-2 py-1 rounded-lg ${activeTab === tab.id ? 'text-purple-600' : 'text-gray-500'}`}><tab.icon size={22} /><span className="text-xs mt-1">{tab.label}</span></button>
    ))}
  </div></div>
);

const RichTextEditor = ({ editorRef, placeholder, initialContent }) => {
  useEffect(() => { if (editorRef.current && initialContent !== undefined) editorRef.current.innerHTML = initialContent; }, [initialContent, editorRef]);
  return (<div className="mb-3"><div className="flex gap-2 mb-2">{[['bold', Bold], ['italic', Italic], ['insertUnorderedList', List]].map(([cmd, Icon]) => (<button key={cmd} type="button" onClick={() => { editorRef.current?.focus(); document.execCommand(cmd, false, null); }} className="p-2 border rounded-lg hover:bg-gray-100"><Icon size={16} /></button>))}</div><div ref={editorRef} contentEditable className="w-full min-h-24 px-4 py-3 border-2 border-gray-200 rounded-xl bg-white focus:outline-none focus:border-purple-500" data-placeholder={placeholder} /></div>);
};

const PointsEditor = ({ punti, onChange }) => (<div className="p-3 bg-purple-50 rounded-xl border border-purple-200 mb-3"><p className="text-sm font-medium text-purple-700 mb-2 flex items-center gap-1"><Trophy size={16} /> Punti standard</p><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-purple-600">1° classificato</label><input type="number" min="0" value={punti.primo} onChange={e => onChange({ ...punti, primo: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-center" /></div><div><label className="text-xs text-purple-600">Altri corretti</label><input type="number" min="0" value={punti.altri} onChange={e => onChange({ ...punti, altri: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-center" /></div></div></div>);

const BonusEditor = ({ bonus, onChange }) => (<div className="p-3 bg-green-50 rounded-xl border border-green-200 mb-3"><p className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1"><Gift size={16} /> Punti bonus</p><div className="grid grid-cols-3 gap-2"><div><label className="text-xs text-green-600">Solo 1</label><input type="number" min="0" value={bonus.uno} onChange={e => onChange({ ...bonus, uno: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div><div><label className="text-xs text-green-600">2-5</label><input type="number" min="0" value={bonus.finoCinque} onChange={e => onChange({ ...bonus, finoCinque: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div><div><label className="text-xs text-green-600">6-10</label><input type="number" min="0" value={bonus.seiDieci} onChange={e => onChange({ ...bonus, seiDieci: parseInt(e.target.value) || 0 })} className="w-full px-2 py-2 border rounded text-center text-sm" /></div></div></div>);

const UserEditModal = ({ user, onClose, onSave, saving }) => {
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newFullName, setNewFullName] = useState(user?.fullName || '');
  return (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl p-6 max-w-md w-full"><h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Edit3 size={20} /> Modifica utente</h3><div className="mb-3"><label className="text-sm text-gray-600 mb-1 block">Nome completo</label><input type="text" value={newFullName} onChange={e => setNewFullName(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div className="mb-3"><label className="text-sm text-gray-600 mb-1 block">Nickname</label><input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><p className="text-xs text-gray-500 mb-4">Email: {user?.email}</p><div className="flex gap-3"><button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button><button onClick={() => onSave(user.id, newUsername.trim(), newFullName.trim())} disabled={saving || newUsername.trim().length < 3} className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{saving ? <Loader2 size={18} className="animate-spin" /> : <><Save size={18} /> Salva</>}</button></div></div></div>);
};

const DeleteUserModal = ({ user, onClose, onConfirm, deleting }) => (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl p-6 max-w-md w-full"><div className="flex items-center gap-3 mb-4"><div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center"><AlertTriangle className="text-red-600" size={24} /></div><div><h3 className="text-lg font-bold text-red-700">Eliminazione completa</h3><p className="text-sm text-gray-500">Azione irreversibile!</p></div></div><div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4"><p className="text-sm text-red-700"><strong>Utente:</strong> {user?.username}</p><p className="text-sm text-red-700"><strong>Email:</strong> {user?.email}</p></div><div className="flex gap-3"><button onClick={onClose} className="flex-1 bg-gray-200 py-3 rounded-xl font-semibold">Annulla</button><button onClick={() => onConfirm(user)} disabled={deleting} className="flex-1 bg-red-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{deleting ? <Loader2 size={18} className="animate-spin" /> : <><Trash2 size={18} /> Elimina</>}</button></div></div></div>);

const CompetitionDetailView = ({ competition, riddles, scores, users, onBack, onEdit, onViewAnswers, onEditRiddle, onDeleteRiddle, onAddRiddle, onRecalculate, recalculating, onResetAll, resettingAll, onArchive, onPublish }) => {
  const [activeTab, setActiveTab] = useState('quiz');
  const compRiddles = riddles.filter(r => r.competitionId === competition.id).sort((a, b) => { const dateA = a.dataInizio?.toDate ? a.dataInizio.toDate().getTime() : new Date(a.dataInizio).getTime(); const dateB = b.dataInizio?.toDate ? b.dataInizio.toDate().getTime() : new Date(b.dataInizio).getTime(); return dateA - dateB; });
  const now = new Date();
  const puntiDefault = competition.puntiDefault || { primo: 2, altri: 1 };
  const bonusDefault = competition.bonusDefault || { uno: 0, finoCinque: 0, seiDieci: 0 };
  const hasBonus = bonusDefault.uno > 0 || bonusDefault.finoCinque > 0 || bonusDefault.seiDieci > 0;
  const sortedScores = [...scores].sort((a, b) => (b.points || 0) - (a.points || 0));
  const userMap = {}; users.forEach(u => { userMap[u.id] = u; userMap[u.oderId] = u; });

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-3"><button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><div className="flex-1"><h1 className="text-xl font-bold text-gray-800">{competition.nome} {competition.published === false && <span className="text-xs bg-yellow-500 text-white px-2 py-1 rounded-full ml-2">Bozza</span>} {competition.archived && <span className="text-xs bg-gray-500 text-white px-2 py-1 rounded-full ml-2">Archiviata</span>}</h1><p className="text-sm text-gray-500">{competition.participantsCount || 0} partecipanti • {compRiddles.length} quiz</p></div><button onClick={onEdit} className="p-2 bg-purple-100 text-purple-600 rounded-xl"><Edit3 size={20} /></button></div>
        <div className="flex gap-2">{[{ id: 'quiz', label: 'Quiz', icon: LayoutGrid }, { id: 'classifica', label: 'Classifica', icon: BarChart3 }, { id: 'info', label: 'Info', icon: Info }].map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 py-2 px-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}><tab.icon size={16} /> {tab.label}</button>))}</div>
      </div></div>
      <div className="max-w-4xl mx-auto px-4">
        {activeTab === 'quiz' && (<div className="space-y-3">
          <button onClick={() => onAddRiddle(competition.id)} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2"><Plus size={18} /> Nuovo Quiz</button>
          {compRiddles.length === 0 ? (<div className="bg-white rounded-2xl p-8 text-center"><LayoutGrid size={48} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500">Nessun quiz in questa gara</p></div>) : (
            compRiddles.map(r => { const start = r.dataInizio?.toDate?.() || new Date(r.dataInizio); const end = r.dataFine?.toDate?.() || new Date(r.dataFine); const isActive = now >= start && now <= end; const isPast = now > end; const isFuture = now < start; const hasCustom = r.puntiCustom || r.bonusCustom;
              return (<div key={r.id} className={`bg-white rounded-2xl p-4 ${isActive ? 'border-2 border-green-400' : ''}`}><div className="flex justify-between items-start mb-2"><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><h4 className="font-semibold text-gray-800">{r.titolo}</h4>{isActive && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">LIVE</span>}{isFuture && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">Programmato</span>}{isPast && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Concluso</span>}{hasCustom && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">⭐ Custom</span>}</div><p className="text-xs text-gray-500 mt-1">{formatDateTime(start)} → {formatDateTime(end)}</p></div></div><div className="flex items-center justify-between"><div><p className="text-sm"><span className="text-gray-500">Risposta:</span> <strong className="text-purple-700">{r.risposta}</strong></p>{r.correctCount !== undefined && <p className="text-xs text-gray-500">Corrette: {r.correctCount}</p>}</div><div className="flex gap-2"><button onClick={() => onViewAnswers(r)} className="p-2 bg-blue-50 text-blue-600 rounded-lg" title="Vedi risposte"><Eye size={18} /></button><button onClick={() => onRecalculate(r)} disabled={recalculating} className="p-2 bg-orange-50 text-orange-600 rounded-lg" title="Ricalcola"><RefreshCw size={18} className={recalculating ? 'animate-spin' : ''} /></button><button onClick={() => onEditRiddle(r)} className="p-2 bg-purple-50 text-purple-600 rounded-lg" title="Modifica"><Edit3 size={18} /></button><button onClick={() => onDeleteRiddle(r)} className="p-2 bg-red-50 text-red-600 rounded-lg" title="Elimina"><Trash2 size={18} /></button></div></div></div>);
            })
          )}
        </div>)}
        {activeTab === 'classifica' && (<div className="bg-white rounded-2xl p-4"><h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Trophy className="text-yellow-500" /> Classifica</h3>{sortedScores.length === 0 ? (<p className="text-gray-500 text-center py-8">Nessun partecipante</p>) : (<div className="space-y-2">{sortedScores.map((s, i) => { const userData = userMap[s.oderId] || {}; return (<div key={s.id} className={`flex items-center justify-between p-3 rounded-xl ${i === 0 ? 'bg-yellow-50 border border-yellow-200' : i === 1 ? 'bg-gray-100' : i === 2 ? 'bg-orange-50' : 'bg-white border'}`}><div className="flex items-center gap-3"><span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-400 text-white' : i === 1 ? 'bg-gray-400 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200'}`}>{i + 1}</span><div><p className="font-medium text-gray-800">{s.username || userData.username || 'Utente'}</p>{userData.fullName && <p className="text-xs text-gray-500">{userData.fullName}</p>}</div></div><span className="font-bold text-purple-600 text-lg">{s.points || 0} pt</span></div>); })}</div>)}</div>)}
        {activeTab === 'info' && (<div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Info size={18} className="text-purple-600" /> Informazioni</h3><div className="space-y-2 text-sm text-gray-600"><p><strong>Periodo:</strong> {formatDate(competition.dataInizio)} - {formatDate(competition.dataFine)}</p><p><strong>Partecipanti:</strong> {competition.participantsCount || 0}</p><p><strong>Quiz totali:</strong> {compRiddles.length}</p>{competition.descrizione && <p><strong>Descrizione:</strong> {competition.descrizione}</p>}</div></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Trophy size={18} className="text-yellow-500" /> Punteggi default</h3><div className="space-y-3"><div className="p-3 bg-purple-50 rounded-xl"><p className="text-sm text-purple-700"><strong>1° classificato:</strong> {puntiDefault.primo} pt</p><p className="text-sm text-purple-700"><strong>Altri corretti:</strong> {puntiDefault.altri} pt</p></div>{hasBonus && (<div className="p-3 bg-green-50 rounded-xl"><p className="text-sm font-medium text-green-700 mb-1">Bonus pochi rispondenti:</p><p className="text-sm text-green-600">Solo 1: +{bonusDefault.uno} | 2-5: +{bonusDefault.finoCinque} | 6-10: +{bonusDefault.seiDieci}</p></div>)}</div></div>{competition.regolamento && (<div className="bg-white rounded-2xl p-5"><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><FileText size={18} className="text-purple-600" /> Regolamento</h3><div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: competition.regolamento }} /></div>)}<button onClick={onResetAll} disabled={resettingAll} className="w-full bg-red-500 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 mb-3">{resettingAll ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />} {resettingAll ? 'Ricalcolo in corso...' : '🔄 Reset e Ricalcola TUTTI i punteggi'}</button><button onClick={onEdit} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 mb-3"><Edit3 size={18} /> Modifica impostazioni gara</button><button onClick={() => onPublish(competition.id, competition.published === false)} className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 mb-3 ${competition.published === false ? 'bg-green-600 text-white' : 'bg-yellow-500 text-white'}`}>{competition.published === false ? <><Send size={18} /> Pubblica gara</> : <><EyeOff size={18} /> Nascondi gara</>}</button><button onClick={() => onArchive(competition.id, !competition.archived)} className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 ${competition.archived ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}`}>{competition.archived ? <><ArchiveRestore size={18} /> Ripristina gara</> : <><Archive size={18} /> Archivia gara</>}</button></div>)}
      </div>
    </div>
  );
};

const RiddleAnswersView = ({ riddle, competition, answers, users, onBack, onRecalculate, recalculating, onResetAll, resettingAll }) => {
  const sorted = [...answers].sort((a, b) => { const timeA = a.time?.toDate ? a.time.toDate().getTime() : 0; const timeB = b.time?.toDate ? b.time.toDate().getTime() : 0; return timeA - timeB; });
  const userMap = {}; users.forEach(u => { if (u.oderId) userMap[u.oderId] = u.username; if (u.id) userMap[u.id] = u.username; });
  const punti = getEffectivePoints(riddle, competition); const bonus = getEffectiveBonus(riddle, competition);
  return (<div className="bg-white rounded-2xl shadow-xl p-6"><div className="flex items-center gap-3 mb-4"><button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h3 className="text-xl font-bold text-purple-700 flex-1">{riddle.titolo}</h3><button onClick={() => onRecalculate(riddle)} disabled={recalculating} className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-xl disabled:opacity-50"><RefreshCw size={16} className={recalculating ? 'animate-spin' : ''} />{recalculating ? '...' : 'Ricalcola'}</button></div><div className="mb-4 p-4 bg-gray-50 rounded-xl border"><p className="text-xs text-gray-500 uppercase font-semibold mb-2">Domanda:</p><div className="text-gray-800" dangerouslySetInnerHTML={{ __html: riddle.domanda }} /></div><div className="mb-4 p-4 bg-purple-50 rounded-xl"><p className="text-sm font-semibold text-purple-700">Risposta: {riddle.risposta}</p><p className="text-xs text-gray-500 mt-1">Punti: 1° {punti.primo}pt | Altri {punti.altri}pt</p>{(bonus.uno > 0 || bonus.finoCinque > 0 || bonus.seiDieci > 0) && <p className="text-xs text-green-600 mt-1">Bonus: 1 +{bonus.uno} | 2-5 +{bonus.finoCinque} | 6-10 +{bonus.seiDieci}</p>}{riddle.correctCount !== undefined && <p className="text-xs text-blue-600 mt-1">Corrette: {riddle.correctCount}</p>}</div><h4 className="font-semibold text-gray-700 mb-3">Risposte ({sorted.length})</h4>{sorted.length === 0 ? <p className="text-gray-500 text-center py-8">Nessuna risposta</p> : (<div className="space-y-2 max-h-96 overflow-y-auto">{sorted.map((ans, i) => { const correct = compareAnswers(ans.answer, riddle.risposta); const oderId = ans.userId || ans.oderId; return (<div key={ans.id} className={`p-3 rounded-xl border ${correct ? 'bg-green-50 border-green-200' : 'bg-white'}`}><div className="flex justify-between items-center"><div className="flex items-center gap-3"><span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${correct ? 'bg-green-500 text-white' : 'bg-gray-200'}`}>{i + 1}</span><div><span className="font-medium">{userMap[oderId] || 'Utente'}</span><p className="text-xs text-gray-500">{formatDateTime(ans.time)}</p><p className={`text-sm ${correct ? 'text-green-700' : 'text-red-600'}`}>"{ans.answer}"</p></div></div><span className={`font-bold text-lg ${ans.points > 0 ? 'text-green-600' : 'text-gray-400'}`}>{ans.points > 0 ? `+${ans.points}` : '0'}</span></div></div>); })}</div>)}</div>);
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
  const [editingCompetition, setEditingCompetition] = useState(null);
  const [editingRiddle, setEditingRiddle] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [creatingCompetition, setCreatingCompetition] = useState(false);
  const [creatingRiddle, setCreatingRiddle] = useState(false);
  const [newCompetition, setNewCompetition] = useState({ nome: '', descrizione: '', dataInizio: '', dataFine: '', puntiDefault: { primo: 2, altri: 1 }, bonusDefault: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newRiddle, setNewRiddle] = useState({ titolo: '', risposta: '', competitionId: '', dataInizio: '', oraInizio: '09:00', dataFine: '', oraFine: '18:00', puntiCustom: false, punti: { primo: 2, altri: 1 }, bonusCustom: false, bonusPunti: { uno: 0, finoCinque: 0, seiDieci: 0 } });
  const [newAnnouncement, setNewAnnouncement] = useState({ titolo: '' });
  const [viewingRiddle, setViewingRiddle] = useState(null);
  const [riddleAnswers, setRiddleAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [trainingCollections, setTrainingCollections] = useState([]);
  const [selectedTrainingCollection, setSelectedTrainingCollection] = useState(null);
  const [trainingRiddles, setTrainingRiddles] = useState([]);
  const [creatingTrainingCollection, setCreatingTrainingCollection] = useState(false);
  const [creatingTrainingRiddle, setCreatingTrainingRiddle] = useState(false);
  const [newTrainingCollection, setNewTrainingCollection] = useState({ nome: '', descrizione: '', maxAttemptsPerDay: 5, maxPass: 3 });
  const [newTrainingRiddle, setNewTrainingRiddle] = useState({ risposta: '' });
  const trainingRiddleEditorRef = useRef(null);
  const [resettingAll, setResettingAll] = useState(false);

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
  useEffect(() => { if (!isAdmin) return; return onSnapshot(query(collection(db, 'trainingCollections'), orderBy('createdAt', 'desc')), (snap) => setTrainingCollections(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin]);
  useEffect(() => { if (!selectedTrainingCollection) { setTrainingRiddles([]); return; } return onSnapshot(query(collection(db, 'trainingRiddles'), where('collectionId', '==', selectedTrainingCollection.id), orderBy('ordine', 'asc')), (snap) => setTrainingRiddles(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [selectedTrainingCollection]);
  useEffect(() => { if (!isAdmin || !selectedCompetition) { setCompetitionScores([]); return; } return onSnapshot(query(collection(db, 'competitionScores'), where('competitionId', '==', selectedCompetition.id)), (snap) => setCompetitionScores(snap.docs.map(d => ({ id: d.id, ...d.data() })))); }, [isAdmin, selectedCompetition]);

  const handleLogin = async () => { if (authLoading) return; setAuthLoading(true); try { const cred = await signInWithEmailAndPassword(auth, email, password); if (!ADMIN_EMAILS.includes(cred.user.email)) { await signOut(auth); showMsg('Non autorizzato'); } } catch { showMsg('Credenziali errate'); } finally { setAuthLoading(false); } };

  const handleRecalculatePoints = async (riddle) => { setRecalculating(true); const comp = competitions.find(c => c.id === riddle.competitionId); const result = await recalculateRiddlePoints(riddle.id, riddle, comp); if (result.success) { showMsg(`✅ ${result.correct || 0} corrette su ${result.processed || 0}`); if (viewingRiddle) { const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', riddle.id))); setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); const riddleDoc = await getDoc(doc(db, 'riddles', riddle.id)); if (riddleDoc.exists()) setViewingRiddle({ id: riddleDoc.id, ...riddleDoc.data() }); } } else showMsg(`❌ ${result.error}`); setRecalculating(false); };
  const handleResetAll = async () => { if (!selectedCompetition) return; if (!confirm('Sei sicuro? Questo resetterà e ricalcolerà TUTTI i punteggi della gara!')) return; setResettingAll(true); const compRiddles = riddles.filter(r => r.competitionId === selectedCompetition.id); const result = await resetAndRecalculateAllScores(selectedCompetition.id, compRiddles, selectedCompetition); if (result.success) showMsg(`✅ Reset completato! ${result.processed} quiz ricalcolati`); else showMsg(`❌ ${result.error}`); setResettingAll(false); };

  const handleAddCompetition = async () => { if (!newCompetition.nome || !newCompetition.dataInizio || !newCompetition.dataFine) { showMsg('Compila tutti i campi'); return; } setSubmitting(true); try { const regolamento = regolamentoEditorRef.current?.innerHTML || ''; await setDoc(doc(collection(db, 'competitions')), { nome: newCompetition.nome, descrizione: newCompetition.descrizione || '', regolamento, dataInizio: Timestamp.fromDate(new Date(newCompetition.dataInizio)), dataFine: Timestamp.fromDate(new Date(newCompetition.dataFine)), puntiDefault: newCompetition.puntiDefault, bonusDefault: newCompetition.bonusDefault, published: false, participantsCount: 0, createdAt: serverTimestamp() }); setNewCompetition({ nome: '', descrizione: '', dataInizio: '', dataFine: '', puntiDefault: { primo: 2, altri: 1 }, bonusDefault: { uno: 0, finoCinque: 0, seiDieci: 0 } }); if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = ''; setCreatingCompetition(false); showMsg('✅ Gara creata!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const handleUpdateCompetition = async () => { if (!editingCompetition) return; setSubmitting(true); try { const regolamento = regolamentoEditorRef.current?.innerHTML || ''; await updateDoc(doc(db, 'competitions', editingCompetition.id), { nome: editingCompetition.nome, descrizione: editingCompetition.descrizione || '', regolamento, puntiDefault: editingCompetition.puntiDefault, bonusDefault: editingCompetition.bonusDefault }); if (selectedCompetition?.id === editingCompetition.id) { setSelectedCompetition({ ...selectedCompetition, ...editingCompetition, regolamento }); } setEditingCompetition(null); showMsg('✅ Gara aggiornata!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const handleArchiveCompetition = async (compId, archive) => {
    try {
      await updateDoc(doc(db, 'competitions', compId), { archived: archive });
      showMsg(archive ? '✅ Gara archiviata' : '✅ Gara ripristinata');
    } catch (e) { showMsg('Errore: ' + e.message); }
  };

  const handlePublishCompetition = async (compId, publish) => {
    try {
      await updateDoc(doc(db, 'competitions', compId), { published: publish });
      showMsg(publish ? '✅ Gara pubblicata' : '✅ Gara nascosta');
    } catch (e) { showMsg('Errore: ' + e.message); }
  };

  const handleAddTrainingCollection = async () => {
    if (!newTrainingCollection.nome) { showMsg('Inserisci un nome'); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'trainingCollections')), {
        nome: newTrainingCollection.nome,
        descrizione: newTrainingCollection.descrizione || '',
        maxAttemptsPerDay: parseInt(newTrainingCollection.maxAttemptsPerDay) || 5,
        maxPass: parseInt(newTrainingCollection.maxPass) || 3,
        riddlesCount: 0,
        published: false,
        createdAt: serverTimestamp()
      });
      setNewTrainingCollection({ nome: '', descrizione: '', maxAttemptsPerDay: 5, maxPass: 3 });
      setCreatingTrainingCollection(false);
      showMsg('✅ Collezione creata!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleAddTrainingRiddle = async () => {
    const domanda = trainingRiddleEditorRef.current?.innerHTML || '';
    if (!domanda.trim() || !newTrainingRiddle.risposta || !selectedTrainingCollection) { showMsg('Compila tutti i campi'); return; }
    setSubmitting(true);
    try {
      const ordine = trainingRiddles.length + 1;
      await setDoc(doc(collection(db, 'trainingRiddles')), {
        collectionId: selectedTrainingCollection.id,
        domanda,
        risposta: newTrainingRiddle.risposta.trim(),
        ordine,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'trainingCollections', selectedTrainingCollection.id), { riddlesCount: ordine });
      setNewTrainingRiddle({ risposta: '' });
      if (trainingRiddleEditorRef.current) trainingRiddleEditorRef.current.innerHTML = '';
      setCreatingTrainingRiddle(false);
      showMsg('✅ Indovinello aggiunto!');
    } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); }
  };

  const handleDeleteTrainingRiddle = async (riddleId) => {
    if (!selectedTrainingCollection) return;
    try {
      await deleteDoc(doc(db, 'trainingRiddles', riddleId));
      const newCount = Math.max(0, (selectedTrainingCollection.riddlesCount || 1) - 1);
      await updateDoc(doc(db, 'trainingCollections', selectedTrainingCollection.id), { riddlesCount: newCount });
      showMsg('✅ Eliminato');
    } catch (e) { showMsg('Errore: ' + e.message); }
  };

  const handleDeleteTrainingCollection = async (collectionId) => {
    try {
      const riddlesSnap = await getDocs(query(collection(db, 'trainingRiddles'), where('collectionId', '==', collectionId)));
      for (const r of riddlesSnap.docs) await deleteDoc(r.ref);
      await deleteDoc(doc(db, 'trainingCollections', collectionId));
      setSelectedTrainingCollection(null);
      showMsg('✅ Collezione eliminata');
    } catch (e) { showMsg('Errore: ' + e.message); }

  const handlePublishTrainingCollection = async (collectionId, publish) => {
    try {
      await updateDoc(doc(db, 'trainingCollections', collectionId), { published: publish });
      if (selectedTrainingCollection?.id === collectionId) {
        setSelectedTrainingCollection(prev => ({ ...prev, published: publish }));
      }
      showMsg(publish ? '✅ Collezione pubblicata' : '✅ Collezione nascosta');
    } catch (e) { showMsg('Errore: ' + e.message); }
  };
  };

  const handleAddRiddle = async () => { const domanda = riddleEditorRef.current?.innerHTML || ''; if (!newRiddle.titolo || !domanda || !newRiddle.risposta || !newRiddle.competitionId || !newRiddle.dataInizio || !newRiddle.dataFine) { showMsg('Compila tutti i campi'); return; } setSubmitting(true); try { const start = new Date(`${newRiddle.dataInizio}T${newRiddle.oraInizio}:00`); const end = new Date(`${newRiddle.dataFine}T${newRiddle.oraFine}:00`); await setDoc(doc(collection(db, 'riddles')), { titolo: newRiddle.titolo, domanda, risposta: newRiddle.risposta.trim(), competitionId: newRiddle.competitionId, dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), puntiCustom: newRiddle.puntiCustom, punti: newRiddle.puntiCustom ? newRiddle.punti : null, bonusCustom: newRiddle.bonusCustom, bonusPunti: newRiddle.bonusCustom ? newRiddle.bonusPunti : null, pointsAssigned: false, createdAt: serverTimestamp() }); setNewRiddle({ ...newRiddle, titolo: '', risposta: '', dataInizio: '', dataFine: '' }); if (riddleEditorRef.current) riddleEditorRef.current.innerHTML = ''; setCreatingRiddle(false); showMsg('✅ Quiz creato!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const handleUpdateRiddle = async () => { if (!editingRiddle) return; const domanda = editRiddleEditorRef.current?.innerHTML || ''; setSubmitting(true); try { const start = new Date(`${editingRiddle.dataInizio}T${editingRiddle.oraInizio}:00`); const end = new Date(`${editingRiddle.dataFine}T${editingRiddle.oraFine}:00`); await updateDoc(doc(db, 'riddles', editingRiddle.id), { titolo: editingRiddle.titolo, domanda, risposta: editingRiddle.risposta.trim(), competitionId: editingRiddle.competitionId, dataInizio: Timestamp.fromDate(start), dataFine: Timestamp.fromDate(end), puntiCustom: editingRiddle.puntiCustom, punti: editingRiddle.puntiCustom ? editingRiddle.punti : null, bonusCustom: editingRiddle.bonusCustom, bonusPunti: editingRiddle.bonusCustom ? editingRiddle.bonusPunti : null }); setEditingRiddle(null); showMsg('✅ Quiz aggiornato!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const startEditRiddle = (riddle) => { setEditingRiddle({ ...riddle, dataInizio: formatDateForInput(riddle.dataInizio), oraInizio: formatTimeForInput(riddle.dataInizio), dataFine: formatDateForInput(riddle.dataFine), oraFine: formatTimeForInput(riddle.dataFine), puntiCustom: riddle.puntiCustom || false, punti: riddle.punti || { primo: 2, altri: 1 }, bonusCustom: riddle.bonusCustom || false, bonusPunti: riddle.bonusPunti || { uno: 0, finoCinque: 0, seiDieci: 0 } }); };

  const handleAddAnnouncement = async () => { 
    const messaggio = announcementEditorRef.current?.innerHTML || ''; 
    if (!newAnnouncement.titolo || !messaggio.trim()) { showMsg('Compila tutti i campi'); return; } 
    setSubmitting(true); 
    try { 
      await setDoc(doc(collection(db, 'announcements')), { titolo: newAnnouncement.titolo, messaggio, createdAt: serverTimestamp() }); 
      // Invia webhook per annuncio
      const announcementWebhookUrl = import.meta.env.VITE_PABBLY_ANNOUNCEMENT_WEBHOOK_URL;
      if (announcementWebhookUrl) {
        try { 
          await fetch(announcementWebhookUrl, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            mode: 'no-cors', 
            body: JSON.stringify({ 
              event: 'new_announcement', 
              titolo: newAnnouncement.titolo, 
              messaggio: messaggio.replace(/<[^>]*>/g, ''), 
              timestamp: new Date().toISOString() 
            }) 
          }); 
        } catch (e) { console.error('Announcement webhook error:', e); }
      }
      setNewAnnouncement({ titolo: '' }); 
      if (announcementEditorRef.current) announcementEditorRef.current.innerHTML = ''; 
      showMsg('✅ Avviso inviato!'); 
    } catch (e) { showMsg('Errore: ' + e.message); } 
    finally { setSubmitting(false); } 
  };

  const handleUpdateUser = async (userId, newUsername, newFullName) => { if (!userId || newUsername.length < 3) { showMsg('Nickname min 3 caratteri'); return; } setSubmitting(true); try { const userDoc = await getDoc(doc(db, 'users', userId)); const oldData = userDoc.data(); await updateDoc(doc(db, 'users', userId), { username: newUsername, fullName: newFullName }); const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', userId))); for (const scoreDoc of scoresSnap.docs) await updateDoc(scoreDoc.ref, { username: newUsername }); await sendUserWebhook('user_updated_by_admin', { oderId: userId, fullName: newFullName, username: newUsername, email: oldData?.email }); setEditingUser(null); showMsg('✅ Utente aggiornato!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const handleDeleteUserComplete = async (userToDelete) => { if (!userToDelete) return; setSubmitting(true); try { const answersSnap = await getDocs(query(collection(db, 'answers'), where('userId', '==', userToDelete.id))); for (const d of answersSnap.docs) await deleteDoc(d.ref); const scoresSnap = await getDocs(query(collection(db, 'competitionScores'), where('oderId', '==', userToDelete.id))); for (const d of scoresSnap.docs) { const scoreData = d.data(); if (scoreData.competitionId) { const compRef = doc(db, 'competitions', scoreData.competitionId); const compDoc = await getDoc(compRef); if (compDoc.exists() && (compDoc.data().participantsCount || 0) > 0) await updateDoc(compRef, { participantsCount: compDoc.data().participantsCount - 1 }); } await deleteDoc(d.ref); } await deleteDoc(doc(db, 'users', userToDelete.id)); setDeletingUser(null); showMsg('✅ Utente eliminato!'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); } };

  const handleDelete = async () => { if (!confirmDelete) return; setSubmitting(true); try { if (confirmDelete.type === 'competition') { const riddlesSnap = await getDocs(query(collection(db, 'riddles'), where('competitionId', '==', confirmDelete.id))); for (const r of riddlesSnap.docs) { const ans = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); for (const a of ans.docs) await deleteDoc(a.ref); await deleteDoc(r.ref); } const scores = await getDocs(query(collection(db, 'competitionScores'), where('competitionId', '==', confirmDelete.id))); for (const s of scores.docs) await deleteDoc(s.ref); await deleteDoc(doc(db, 'competitions', confirmDelete.id)); if (selectedCompetition?.id === confirmDelete.id) setSelectedCompetition(null); } else if (confirmDelete.type === 'riddle') { const riddle = riddles.find(r => r.id === confirmDelete.id); const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', confirmDelete.id))); for (const d of snap.docs) { const ans = d.data(); if (ans.points > 0 && riddle?.competitionId) { const scoreRef = doc(db, 'competitionScores', `${riddle.competitionId}_${ans.userId || ans.oderId}`); const scoreDoc = await getDoc(scoreRef); if (scoreDoc.exists()) await updateDoc(scoreRef, { points: Math.max(0, (scoreDoc.data().points || 0) - ans.points) }); } await deleteDoc(d.ref); } await deleteDoc(doc(db, 'riddles', confirmDelete.id)); } else if (confirmDelete.type === 'announcement') await deleteDoc(doc(db, 'announcements', confirmDelete.id)); showMsg('✅ Eliminato'); } catch (e) { showMsg('Errore: ' + e.message); } finally { setSubmitting(false); setConfirmDelete(null); } };

  const viewAnswers = async (r) => { setViewingRiddle(r); const snap = await getDocs(query(collection(db, 'answers'), where('riddleId', '==', r.id))); setRiddleAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); };
  const startEditCompetition = (comp) => { setEditingCompetition({ ...comp, puntiDefault: comp.puntiDefault || { primo: 2, altri: 1 }, bonusDefault: comp.bonusDefault || { uno: 0, finoCinque: 0, seiDieci: 0 } }); setTimeout(() => { if (regolamentoEditorRef.current) regolamentoEditorRef.current.innerHTML = comp.regolamento || ''; }, 100); };
  const startAddRiddleForCompetition = (competitionId) => { setNewRiddle({ ...newRiddle, competitionId }); setCreatingRiddle(true); };

  const isCompetitionActive = (comp) => { const compRiddles = riddles.filter(r => r.competitionId === comp.id); const now = new Date(); if (compRiddles.length > 0) { const dates = compRiddles.map(r => ({ start: r.dataInizio?.toDate?.() || new Date(r.dataInizio), end: r.dataFine?.toDate?.() || new Date(r.dataFine) })); return now >= new Date(Math.min(...dates.map(d => d.start.getTime()))) && now <= new Date(Math.max(...dates.map(d => d.end.getTime()))); } const start = comp.dataInizio?.toDate?.() || new Date(comp.dataInizio); const end = comp.dataFine?.toDate?.() || new Date(comp.dataFine); return now >= start && now <= end; };
  const isCompetitionPast = (comp) => { const compRiddles = riddles.filter(r => r.competitionId === comp.id); const now = new Date(); if (compRiddles.length > 0) { const dates = compRiddles.map(r => ({ end: r.dataFine?.toDate?.() || new Date(r.dataFine) })); return now > new Date(Math.max(...dates.map(d => d.end.getTime()))); } const end = comp.dataFine?.toDate?.() || new Date(comp.dataFine); return now > end; };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-purple-600" size={40} /></div>;

  if (!isAdmin) return (<div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full"><div className="text-center mb-6"><div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Lock size={32} className="text-purple-600" /></div><h1 className="text-2xl font-bold">Admin Panel</h1></div><input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4" /><button onClick={handleLogin} disabled={authLoading} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{authLoading ? <Loader2 size={20} className="animate-spin" /> : 'Accedi'}</button>{message && <p className="mt-4 text-center text-red-600">{message}</p>}</div></div>);

  if (selectedCompetition && !editingCompetition && !editingRiddle && !viewingRiddle && !creatingRiddle) { return (<CompetitionDetailView competition={selectedCompetition} riddles={riddles} scores={competitionScores} users={users} onBack={() => setSelectedCompetition(null)} onEdit={() => startEditCompetition(selectedCompetition)} onViewAnswers={viewAnswers} onEditRiddle={startEditRiddle} onDeleteRiddle={(r) => setConfirmDelete({ type: 'riddle', id: r.id, name: r.titolo })} onAddRiddle={startAddRiddleForCompetition} onRecalculate={handleRecalculatePoints} recalculating={recalculating} onResetAll={handleResetAll} resettingAll={resettingAll} onArchive={handleArchiveCompetition} onPublish={handlePublishCompetition} />); }

  if (viewingRiddle) { const comp = competitions.find(c => c.id === viewingRiddle.competitionId); return (<div className="min-h-screen bg-gray-100 p-4 pb-24"><div className="max-w-4xl mx-auto"><RiddleAnswersView riddle={viewingRiddle} competition={comp} answers={riddleAnswers} users={[...users, ...competitionScores]} onBack={() => setViewingRiddle(null)} onRecalculate={handleRecalculatePoints} recalculating={recalculating} onResetAll={handleResetAll} resettingAll={resettingAll} onArchive={handleArchiveCompetition} onPublish={handlePublishCompetition} /></div></div>); }

  if (editingRiddle) return (<div className="min-h-screen bg-gray-100 p-4 pb-24"><div className="max-w-4xl mx-auto bg-white rounded-2xl p-6"><div className="flex items-center gap-3 mb-6"><button onClick={() => setEditingRiddle(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Modifica Quiz</h2></div><select value={editingRiddle.competitionId} onChange={e => setEditingRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select><input type="text" placeholder="Titolo *" value={editingRiddle.titolo} onChange={e => setEditingRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><RichTextEditor editorRef={editRiddleEditorRef} placeholder="Domanda..." initialContent={editingRiddle.domanda} /><input type="text" placeholder="Risposta *" value={editingRiddle.risposta} onChange={e => setEditingRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="grid grid-cols-2 gap-3 mb-3"><input type="date" value={editingRiddle.dataInizio} onChange={e => setEditingRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /><input type="time" value={editingRiddle.oraInizio} onChange={e => setEditingRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div className="grid grid-cols-2 gap-3 mb-4"><input type="date" value={editingRiddle.dataFine} onChange={e => setEditingRiddle(p => ({ ...p, dataFine: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /><input type="time" value={editingRiddle.oraFine} onChange={e => setEditingRiddle(p => ({ ...p, oraFine: e.target.value }))} className="px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4"><h4 className="font-semibold text-yellow-800 mb-3">⭐ Punteggio personalizzato</h4><label className="flex items-center gap-2 mb-3 cursor-pointer"><input type="checkbox" checked={editingRiddle.puntiCustom} onChange={e => setEditingRiddle(p => ({ ...p, puntiCustom: e.target.checked }))} className="w-5 h-5" /><span className="text-sm">Punti custom</span></label>{editingRiddle.puntiCustom && <PointsEditor punti={editingRiddle.punti} onChange={p => setEditingRiddle(pr => ({ ...pr, punti: p }))} />}<label className="flex items-center gap-2 mb-3 cursor-pointer"><input type="checkbox" checked={editingRiddle.bonusCustom} onChange={e => setEditingRiddle(p => ({ ...p, bonusCustom: e.target.checked }))} className="w-5 h-5" /><span className="text-sm">Bonus custom</span></label>{editingRiddle.bonusCustom && <BonusEditor bonus={editingRiddle.bonusPunti} onChange={b => setEditingRiddle(pr => ({ ...pr, bonusPunti: b }))} />}</div><button onClick={handleUpdateRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva'}</button></div></div>);

  if (editingCompetition) return (<div className="min-h-screen bg-gray-100 p-4 pb-24"><div className="max-w-4xl mx-auto bg-white rounded-2xl p-6"><div className="flex items-center gap-3 mb-6"><button onClick={() => setEditingCompetition(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Modifica Gara</h2></div><input type="text" placeholder="Nome *" value={editingCompetition.nome} onChange={e => setEditingCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><textarea placeholder="Descrizione" value={editingCompetition.descrizione || ''} onChange={e => setEditingCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" /><RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." initialContent={editingCompetition.regolamento} /><h4 className="font-semibold text-gray-800 mb-3">Punteggio default</h4><PointsEditor punti={editingCompetition.puntiDefault} onChange={p => setEditingCompetition(pr => ({ ...pr, puntiDefault: p }))} /><BonusEditor bonus={editingCompetition.bonusDefault} onChange={b => setEditingCompetition(pr => ({ ...pr, bonusDefault: b }))} /><button onClick={handleUpdateCompetition} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Salva'}</button></div></div>);

  if (creatingCompetition) return (<div className="min-h-screen bg-gray-100 p-4 pb-24"><div className="max-w-4xl mx-auto bg-white rounded-2xl p-6"><div className="flex items-center gap-3 mb-6"><button onClick={() => setCreatingCompetition(false)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Nuova Gara</h2></div><input placeholder="Nome *" value={newCompetition.nome} onChange={e => setNewCompetition(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><textarea placeholder="Descrizione" value={newCompetition.descrizione} onChange={e => setNewCompetition(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" /><RichTextEditor editorRef={regolamentoEditorRef} placeholder="Regolamento..." /><div className="grid grid-cols-2 gap-3 mb-4"><div><label className="text-sm text-gray-600">Data inizio</label><input type="date" value={newCompetition.dataInizio} onChange={e => setNewCompetition(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newCompetition.dataFine} onChange={e => setNewCompetition(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><h4 className="font-semibold text-gray-800 mb-3">Punteggio default</h4><PointsEditor punti={newCompetition.puntiDefault} onChange={p => setNewCompetition(pr => ({ ...pr, puntiDefault: p }))} /><BonusEditor bonus={newCompetition.bonusDefault} onChange={b => setNewCompetition(pr => ({ ...pr, bonusDefault: b }))} /><button onClick={handleAddCompetition} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea Gara'}</button></div></div>);

  if (creatingRiddle) return (<div className="min-h-screen bg-gray-100 p-4 pb-24"><div className="max-w-4xl mx-auto bg-white rounded-2xl p-6"><div className="flex items-center gap-3 mb-6"><button onClick={() => setCreatingRiddle(false)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Nuovo Quiz</h2></div><select value={newRiddle.competitionId} onChange={e => setNewRiddle(p => ({ ...p, competitionId: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3"><option value="">-- Seleziona gara --</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select><input placeholder="Titolo *" value={newRiddle.titolo} onChange={e => setNewRiddle(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><RichTextEditor editorRef={riddleEditorRef} placeholder="Domanda..." /><input placeholder="Risposta *" value={newRiddle.risposta} onChange={e => setNewRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><div className="grid grid-cols-2 gap-3 mb-3"><div><label className="text-xs text-gray-600">Data inizio</label><input type="date" value={newRiddle.dataInizio} onChange={e => setNewRiddle(p => ({ ...p, dataInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-xs text-gray-600">Ora</label><input type="time" value={newRiddle.oraInizio} onChange={e => setNewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="grid grid-cols-2 gap-3 mb-4"><div><label className="text-xs text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div><div><label className="text-xs text-gray-600">Ora</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div></div><div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4"><h4 className="font-semibold text-yellow-800 mb-3">⭐ Punteggio personalizzato</h4><p className="text-xs text-gray-600 mb-3">Se non selezionato, usa i punti della gara</p><label className="flex items-center gap-2 mb-3 cursor-pointer"><input type="checkbox" checked={newRiddle.puntiCustom} onChange={e => setNewRiddle(p => ({ ...p, puntiCustom: e.target.checked }))} className="w-5 h-5" /><span className="text-sm">Punti custom</span></label>{newRiddle.puntiCustom && <PointsEditor punti={newRiddle.punti} onChange={p => setNewRiddle(pr => ({ ...pr, punti: p }))} />}<label className="flex items-center gap-2 mb-3 cursor-pointer"><input type="checkbox" checked={newRiddle.bonusCustom} onChange={e => setNewRiddle(p => ({ ...p, bonusCustom: e.target.checked }))} className="w-5 h-5" /><span className="text-sm">Bonus custom</span></label>{newRiddle.bonusCustom && <BonusEditor bonus={newRiddle.bonusPunti} onChange={b => setNewRiddle(pr => ({ ...pr, bonusPunti: b }))} />}</div><button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea Quiz'}</button></div></div>);

  const activeComps = competitions.filter(c => isCompetitionActive(c) && !c.archived);
  const pastComps = competitions.filter(c => isCompetitionPast(c) && !c.archived);
  const futureComps = competitions.filter(c => !isCompetitionActive(c) && !isCompetitionPast(c) && !c.archived);
  const archivedComps = competitions.filter(c => c.archived);

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      {confirmDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl p-6 max-w-md w-full"><h3 className="text-lg font-bold mb-4">Conferma eliminazione</h3><p className="mb-4">Eliminare <strong>{confirmDelete.name}</strong>?</p><div className="flex gap-3"><button onClick={() => setConfirmDelete(null)} className="flex-1 bg-gray-200 py-3 rounded-xl">Annulla</button><button onClick={handleDelete} disabled={submitting} className="flex-1 bg-red-500 text-white py-3 rounded-xl flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Elimina'}</button></div></div></div>}
      {editingUser && <UserEditModal user={editingUser} onClose={() => setEditingUser(null)} onSave={handleUpdateUser} saving={submitting} />}
      {deletingUser && <DeleteUserModal user={deletingUser} onClose={() => setDeletingUser(null)} onConfirm={handleDeleteUserComplete} deleting={submitting} />}
      <div className="bg-white p-4 shadow-sm mb-4"><div className="max-w-4xl mx-auto flex justify-between items-center"><h1 className="text-xl font-bold flex items-center gap-2"><Settings size={24} /> Admin</h1><button onClick={() => signOut(auth)} className="p-2 text-gray-500 hover:text-red-600"><LogOut size={22} /></button></div></div>
      {message && <div className={`mx-4 mb-4 p-4 rounded-xl text-center ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message}</div>}
      <div className="max-w-4xl mx-auto px-4">
        {activeTab === 'dashboard' && (<div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><button onClick={() => setActiveTab('competitions')} className="bg-white rounded-2xl p-4 text-center hover:shadow-md transition-shadow"><Flag className="mx-auto text-purple-500 mb-2" size={28} /><p className="text-2xl font-bold">{competitions.length}</p><p className="text-sm text-gray-500">Gare</p></button><button onClick={() => setActiveTab('riddles')} className="bg-white rounded-2xl p-4 text-center hover:shadow-md transition-shadow"><LayoutGrid className="mx-auto text-blue-500 mb-2" size={28} /><p className="text-2xl font-bold">{riddles.length}</p><p className="text-sm text-gray-500">Quiz</p></button><button onClick={() => setActiveTab('users')} className="bg-white rounded-2xl p-4 text-center hover:shadow-md transition-shadow"><Users className="mx-auto text-green-500 mb-2" size={28} /><p className="text-2xl font-bold">{users.length}</p><p className="text-sm text-gray-500">Utenti</p></button><button onClick={() => setActiveTab('announcements')} className="bg-white rounded-2xl p-4 text-center hover:shadow-md transition-shadow"><Megaphone className="mx-auto text-orange-500 mb-2" size={28} /><p className="text-2xl font-bold">{announcements.length}</p><p className="text-sm text-gray-500">Avvisi</p></button></div>{activeComps.length > 0 && (<div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3 flex items-center gap-2"><Star className="text-yellow-500" /> Gare in corso</h3>{activeComps.map(c => (<div key={c.id} onClick={() => setSelectedCompetition(c)} className="p-4 bg-green-50 rounded-xl border border-green-200 cursor-pointer mb-2 hover:bg-green-100"><div className="flex justify-between items-center"><div><h4 className="font-semibold text-green-800">{c.nome} {c.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-sm text-green-600">{c.participantsCount || 0} partecipanti • {riddles.filter(r => r.competitionId === c.id).length} quiz</p></div><ChevronRight className="text-green-400" size={20} /></div></div>))}</div>)}</div>)}
        {activeTab === 'competitions' && (<div className="space-y-4"><button onClick={() => setCreatingCompetition(true)} className="w-full bg-purple-600 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"><Plus size={20} /> Nuova Gara</button>{activeComps.length > 0 && (<div><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Star className="text-green-500" /> In corso ({activeComps.length})</h3>{activeComps.map(c => (<div key={c.id} className="bg-white rounded-2xl p-4 mb-2 border-2 border-green-200 cursor-pointer hover:bg-green-50" onClick={() => setSelectedCompetition(c)}><div className="flex justify-between items-center"><div><h4 className="font-semibold text-gray-800">{c.nome} {c.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-xs text-gray-500">{c.participantsCount || 0} iscritti • {riddles.filter(r => r.competitionId === c.id).length} quiz</p></div><ChevronRight className="text-gray-400" size={20} /></div></div>))}</div>)}{futureComps.length > 0 && (<div><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Clock className="text-blue-500" /> Programmate ({futureComps.length})</h3>{futureComps.map(c => (<div key={c.id} className="bg-white rounded-2xl p-4 mb-2 border border-blue-200 border-dashed cursor-pointer hover:bg-blue-50" onClick={() => setSelectedCompetition(c)}><div className="flex justify-between items-center"><div><h4 className="font-semibold text-gray-800">{c.nome} {c.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-xs text-gray-500">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)}</p></div><ChevronRight className="text-gray-400" size={20} /></div></div>))}</div>)}{pastComps.length > 0 && (<div><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Clock className="text-gray-500" /> Passate ({pastComps.length})</h3>{pastComps.map(c => (<div key={c.id} className="bg-white rounded-2xl p-4 mb-2 opacity-75 cursor-pointer hover:opacity-100" onClick={() => setSelectedCompetition(c)}><div className="flex justify-between items-center"><div><h4 className="font-semibold text-gray-600">{c.nome} {c.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-xs text-gray-400">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)}</p></div><ChevronRight className="text-gray-400" size={20} /></div></div>))}</div>)}{archivedComps.length > 0 && (<div><h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Archive className="text-gray-400" /> Archiviate ({archivedComps.length})</h3>{archivedComps.map(c => (<div key={c.id} className="bg-white rounded-2xl p-4 mb-2 opacity-50 cursor-pointer hover:opacity-75 border-2 border-dashed border-gray-300" onClick={() => setSelectedCompetition(c)}><div className="flex justify-between items-center"><div><h4 className="font-semibold text-gray-500">{c.nome} {c.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-xs text-gray-400">{formatDate(c.dataInizio)} - {formatDate(c.dataFine)} • Archiviata</p></div><ChevronRight className="text-gray-400" size={20} /></div></div>))}</div>)}</div>)}
        {activeTab === 'riddles' && (<div className="space-y-4"><button onClick={() => setCreatingRiddle(true)} className="w-full bg-purple-600 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"><Plus size={20} /> Nuovo Quiz</button><h3 className="font-bold text-gray-800">Quiz per gara</h3>{competitions.map(comp => { const compRiddles = riddles.filter(r => r.competitionId === comp.id); return (<div key={comp.id} className="bg-white rounded-2xl p-4 cursor-pointer hover:bg-gray-50" onClick={() => setSelectedCompetition(comp)}><div className="flex justify-between items-center"><div className="flex items-center gap-3"><Flag className="text-purple-500" size={20} /><div><h4 className="font-semibold text-gray-800">{comp.nome}</h4><p className="text-xs text-gray-500">{compRiddles.length} quiz</p></div></div><ChevronRight className="text-gray-400" size={20} /></div></div>); })}</div>)}
                {activeTab === 'training' && !selectedTrainingCollection && !creatingTrainingCollection && (
          <div className="space-y-4">
            <button onClick={() => setCreatingTrainingCollection(true)} className="w-full bg-purple-600 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"><Plus size={20} /> Nuova Collezione</button>
            <h3 className="font-bold text-gray-800">Collezioni Allenamento</h3>
            {trainingCollections.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center"><Target size={48} className="mx-auto text-gray-300 mb-3" /><p className="text-gray-500">Nessuna collezione</p></div>
            ) : (
              trainingCollections.map(col => (
                <div key={col.id} className="bg-white rounded-2xl p-4 cursor-pointer hover:bg-gray-50" onClick={() => setSelectedTrainingCollection(col)}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Target className="text-purple-600" size={20} /></div>
                      <div><h4 className="font-semibold text-gray-800">{col.nome} {col.published === false && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded ml-1">Bozza</span>}</h4><p className="text-xs text-gray-500">{col.riddlesCount || 0} indovinelli • {col.maxAttemptsPerDay} tentativi/giorno • {col.maxPass} passo</p></div>
                    </div>
                    <ChevronRight className="text-gray-400" size={20} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === 'training' && creatingTrainingCollection && (
          <div className="bg-white rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6"><button onClick={() => setCreatingTrainingCollection(false)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Nuova Collezione</h2></div>
            <input placeholder="Nome *" value={newTrainingCollection.nome} onChange={e => setNewTrainingCollection(p => ({ ...p, nome: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
            <textarea placeholder="Descrizione" value={newTrainingCollection.descrizione} onChange={e => setNewTrainingCollection(p => ({ ...p, descrizione: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 h-20" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className="text-sm text-gray-600">Tentativi/giorno</label><input type="number" min="1" value={newTrainingCollection.maxAttemptsPerDay} onChange={e => setNewTrainingCollection(p => ({ ...p, maxAttemptsPerDay: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              <div><label className="text-sm text-gray-600">Passo totali</label><input type="number" min="0" value={newTrainingCollection.maxPass} onChange={e => setNewTrainingCollection(p => ({ ...p, maxPass: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
            </div>
            <button onClick={handleAddTrainingCollection} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea Collezione'}</button>
          </div>
        )}
        {activeTab === 'training' && selectedTrainingCollection && !creatingTrainingRiddle && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => setSelectedTrainingCollection(null)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button>
                <div className="flex-1"><h2 className="text-xl font-bold">{selectedTrainingCollection.nome} {selectedTrainingCollection.published === false && <span className="text-xs bg-yellow-500 text-white px-2 py-1 rounded-full ml-2">Bozza</span>}</h2><p className="text-sm text-gray-500">{trainingRiddles.length} indovinelli</p></div>
                <button onClick={() => handleDeleteTrainingCollection(selectedTrainingCollection.id)} className="p-2 bg-red-50 text-red-600 rounded-xl"><Trash2 size={20} /></button>
              </div>
              <div className="text-sm text-gray-600 mb-2"><strong>Tentativi/giorno:</strong> {selectedTrainingCollection.maxAttemptsPerDay} | <strong>Passo:</strong> {selectedTrainingCollection.maxPass}</div>
              <button onClick={() => handlePublishTrainingCollection(selectedTrainingCollection.id, selectedTrainingCollection.published === false)} className={`w-full py-2 rounded-xl font-semibold flex items-center justify-center gap-2 ${selectedTrainingCollection.published === false ? 'bg-green-600 text-white' : 'bg-yellow-500 text-white'}`}>{selectedTrainingCollection.published === false ? <><Send size={16} /> Pubblica collezione</> : <><EyeOff size={16} /> Nascondi collezione</>}</button>
            </div>
            <button onClick={() => setCreatingTrainingRiddle(true)} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2"><Plus size={18} /> Nuovo Indovinello</button>
            {trainingRiddles.map((r, i) => (
              <div key={r.id} className="bg-white rounded-2xl p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-xs text-purple-600 font-semibold mb-1">#{i + 1}</p>
                    <div className="text-sm text-gray-700 mb-2" dangerouslySetInnerHTML={{ __html: r.domanda }} />
                    <p className="text-sm"><strong className="text-green-700">Risposta:</strong> {r.risposta}</p>
                  </div>
                  <button onClick={() => handleDeleteTrainingRiddle(r.id)} className="p-2 text-red-500"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'training' && creatingTrainingRiddle && (
          <div className="bg-white rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6"><button onClick={() => setCreatingTrainingRiddle(false)} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={24} /></button><h2 className="text-xl font-bold">Nuovo Indovinello</h2></div>
            <p className="text-sm text-gray-500 mb-3">Collezione: {selectedTrainingCollection?.nome}</p>
            <RichTextEditor editorRef={trainingRiddleEditorRef} placeholder="Domanda/Indovinello..." />
            <input placeholder="Risposta *" value={newTrainingRiddle.risposta} onChange={e => setNewTrainingRiddle(p => ({ ...p, risposta: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" />
            <button onClick={handleAddTrainingRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center">{submitting ? <Loader2 size={18} className="animate-spin" /> : 'Aggiungi Indovinello'}</button>
          </div>
        )}

        {activeTab === 'announcements' && (<div className="space-y-4"><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-4"><Plus size={18} className="inline" /> Nuovo Avviso</h3><input placeholder="Titolo *" value={newAnnouncement.titolo} onChange={e => setNewAnnouncement(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3" /><RichTextEditor editorRef={announcementEditorRef} placeholder="Messaggio..." /><button onClick={handleAddAnnouncement} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold disabled:bg-gray-400 flex items-center justify-center gap-2">{submitting ? <Loader2 size={18} className="animate-spin" /> : <><Megaphone size={18} /> Invia</>}</button></div><div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Avvisi ({announcements.length})</h3>{announcements.map(a => (<div key={a.id} className="p-4 bg-gray-50 rounded-xl border mb-2 flex justify-between"><div className="flex-1"><h4 className="font-semibold">{a.titolo}</h4><div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: a.messaggio }} /><p className="text-xs text-gray-400 mt-2">{formatDateTime(a.createdAt)}</p></div><button onClick={() => setConfirmDelete({ type: 'announcement', id: a.id, name: a.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button></div>))}</div></div>)}
        {activeTab === 'users' && (<div className="bg-white rounded-2xl p-5"><h3 className="font-bold mb-3">Utenti verificati ({users.filter(u => u.emailVerified !== false).length})</h3><div className="space-y-2 max-h-[60vh] overflow-y-auto">{users.filter(u => u.emailVerified !== false).map(u => (<div key={u.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center"><div className="flex-1"><p className="font-medium">{u.username} {u.emailVerified && <span className="text-xs text-green-600">✓</span>}</p>{u.fullName && <p className="text-sm text-gray-600">{u.fullName}</p>}<p className="text-sm text-gray-500">{u.email}</p><p className="text-xs text-gray-400">Registrato: {formatDate(u.createdAt)}</p></div><div className="flex gap-2"><button onClick={() => setEditingUser(u)} className="text-purple-600 p-2"><Edit3 size={18} /></button><button onClick={() => setDeletingUser(u)} className="text-red-500 p-2"><Trash2 size={18} /></button></div></div>))}</div>{users.filter(u => u.emailVerified === false).length > 0 && <div className="mt-4 p-3 bg-yellow-50 rounded-xl"><p className="text-sm text-yellow-700">⏳ {users.filter(u => u.emailVerified === false).length} utenti in attesa di verifica email</p></div>}</div>)}
      </div>
      <AdminBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default Admin;
