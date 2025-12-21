NewRiddle(p => ({ ...p, oraInizio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="text-sm text-gray-600">Data fine</label><input type="date" value={newRiddle.dataFine} onChange={e => setNewRiddle(p => ({ ...p, dataFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
                <div><label className="text-sm text-gray-600">Ora fine</label><input type="time" value={newRiddle.oraFine} onChange={e => setNewRiddle(p => ({ ...p, oraFine: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" /></div>
              </div>
              <div className="mb-4">
                <button type="button" onClick={() => setShowPuntiCustom(!showPuntiCustom)} className="text-sm text-purple-600 font-medium">
                  <Trophy size={14} className="inline mr-1" /> {showPuntiCustom ? 'Nascondi' : 'Personalizza'} punteggi
                </button>
                {showPuntiCustom && (
                  <div className="mt-2 p-4 bg-purple-50 rounded-xl grid grid-cols-4 gap-2">
                    <div><label className="text-xs">🥇 Primo</label><input type="number" min="0" value={newRiddle.puntoPrimo} onChange={e => setNewRiddle(p => ({ ...p, puntoPrimo: e.target.value }))} className="w-full px-2 py-2 border rounded-lg text-center" /></div>
                    <div><label className="text-xs">🥈 Secondo</label><input type="number" min="0" value={newRiddle.puntoSecondo} onChange={e => setNewRiddle(p => ({ ...p, puntoSecondo: e.target.value }))} className="w-full px-2 py-2 border rounded-lg text-center" /></div>
                    <div><label className="text-xs">🥉 Terzo</label><input type="number" min="0" value={newRiddle.puntoTerzo} onChange={e => setNewRiddle(p => ({ ...p, puntoTerzo: e.target.value }))} className="w-full px-2 py-2 border rounded-lg text-center" /></div>
                    <div><label className="text-xs">Altri</label><input type="number" min="0" value={newRiddle.puntoAltri} onChange={e => setNewRiddle(p => ({ ...p, puntoAltri: e.target.value }))} className="w-full px-2 py-2 border rounded-lg text-center" /></div>
                  </div>
                )}
              </div>
              <button onClick={handleAddRiddle} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Crea Indovinello'}
              </button>
            </div>

            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-3">Tutti gli indovinelli ({riddles.length})</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {riddles.map(r => {
                  const comp = competitions.find(c => c.id === r.competitionId);
                  return (
                    <div key={r.id} className="p-3 bg-gray-50 rounded-xl border flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{r.titolo}</span>
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{comp?.nome || 'N/A'}</span>
                          <button onClick={() => viewAnswers(r)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg"><Eye size={12} className="inline" /></button>
                        </div>
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

        {/* ANNOUNCEMENTS TAB */}
        {activeTab === 'announcements' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus size={18} /> Nuova Comunicazione</h3>
              <input type="text" placeholder="Titolo *" value={newAnnouncement.titolo} onChange={e => setNewAnnouncement(p => ({ ...p, titolo: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-3 focus:outline-none focus:border-purple-500" />
              <textarea placeholder="Messaggio *" value={newAnnouncement.messaggio} onChange={e => setNewAnnouncement(p => ({ ...p, messaggio: e.target.value }))} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4 h-32 focus:outline-none focus:border-purple-500" />
              <button onClick={handleAddAnnouncement} disabled={submitting} className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <><Megaphone size={18} /> Invia Comunicazione</>}
              </button>
            </div>

            <div className="bg-white rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-3">Comunicazioni inviate ({announcements.length})</h3>
              <div className="space-y-3">
                {announcements.map(a => (
                  <div key={a.id} className="p-4 bg-gray-50 rounded-xl border">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-800">{a.titolo}</h4>
                        <p className="text-sm text-gray-600 mt-1">{a.messaggio}</p>
                        <p className="text-xs text-gray-400 mt-2">{formatDateTime(a.createdAt)}</p>
                      </div>
                      <button onClick={() => setConfirmDelete({ type: 'announcement', id: a.id, name: a.titolo })} className="text-red-500 p-1"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl p-5">
            <h3 className="font-bold text-gray-800 mb-3">Utenti registrati ({users.length})</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {users.map(u => (
                <div key={u.id} className="p-4 bg-gray-50 rounded-xl border flex justify-between items-center">
                  <div>
                    <p className="font-medium">{u.username}</p>
                    <p className="text-sm text-gray-500">{u.email}</p>
                    <p className="text-xs text-gray-400">Registrato: {formatDate(u.createdAt)}</p>
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
