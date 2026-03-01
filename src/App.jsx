import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

const TABS = ['Players', 'Availability', 'Schedule', 'Scores', 'Standings'];

function getUpcomingDates(count = 8) {
  const dates = [];
  const today = new Date();
  let d = new Date(today);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().split('T')[0]);
    d = new Date(d);
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function generateSchedule(availablePlayers) {
  if (availablePlayers.length < 4) return [];
  const shuffled = [...availablePlayers].sort(() => Math.random() - 0.5);
  const matches = [];
  for (let i = 0; i + 3 < shuffled.length; i += 4) {
    matches.push({
      team1: [shuffled[i], shuffled[i + 1]],
      team2: [shuffled[i + 2], shuffled[i + 3]],
    });
  }
  return matches;
}

export default function App() {
  const [tab, setTab] = useState('Players');
  const [players, setPlayers] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPlayer, setNewPlayer] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [userPickerOpen, setUserPickerOpen] = useState(true);
  const dates = getUpcomingDates(8);

  // ─── DATA LOADING ────────────────────────────────
  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase.from('players').select('*').order('created_at');
    if (data) setPlayers(data.map((p) => p.name));
  }, []);

  const fetchAvailability = useCallback(async () => {
    const { data } = await supabase.from('availability').select('*');
    if (data) setAvailability(data);
  }, []);

  const fetchMatches = useCallback(async () => {
    const { data } = await supabase.from('matches').select('*').order('match_number');
    if (data) setMatches(data);
  }, []);

  useEffect(() => {
    async function init() {
      await Promise.all([fetchPlayers(), fetchAvailability(), fetchMatches()]);
      setLoading(false);
    }
    init();
  }, [fetchPlayers, fetchAvailability, fetchMatches]);

  // ─── REAL-TIME SUBSCRIPTIONS ─────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('league-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => fetchPlayers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => fetchAvailability())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchMatches())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchPlayers, fetchAvailability, fetchMatches]);

  // ─── ACTIONS ─────────────────────────────────────
  const addPlayer = async () => {
    if (!newPlayer.trim()) return;
    await supabase.from('players').insert({ name: newPlayer.trim() });
    setNewPlayer('');
  };

  const removePlayer = async (name) => {
    if (!confirm(`Remove ${name} from the league?`)) return;
    await supabase.from('players').delete().eq('name', name);
  };

  const toggleAvailability = async (playerName, date) => {
    const existing = availability.find(
      (a) => a.player_name === playerName && a.session_date === date
    );
    if (existing) {
      await supabase.from('availability').delete().eq('id', existing.id);
    } else {
      await supabase.from('availability').insert({ player_name: playerName, session_date: date });
    }
  };

  const autoGenerateSchedule = async (date) => {
    const availForDate = availability
      .filter((a) => a.session_date === date)
      .map((a) => a.player_name);
    if (availForDate.length < 4) {
      alert('Need at least 4 available players to generate matches.');
      return;
    }
    // Delete existing matches for this date
    await supabase.from('matches').delete().eq('session_date', date);
    // Generate and insert new matches
    const newMatches = generateSchedule(availForDate);
    const rows = newMatches.map((m, idx) => ({
      session_date: date,
      match_number: idx + 1,
      team1_player1: m.team1[0],
      team1_player2: m.team1[1],
      team2_player1: m.team2[0],
      team2_player2: m.team2[1],
    }));
    await supabase.from('matches').insert(rows);
  };

  const updateScore = async (matchId, field, value) => {
    await supabase.from('matches').update({ [field]: value === '' ? null : parseInt(value) }).eq('id', matchId);
  };

  // ─── DERIVED DATA ────────────────────────────────
  const getAvailForDate = (date) =>
    availability.filter((a) => a.session_date === date).map((a) => a.player_name);

  const getMatchesForDate = (date) =>
    matches.filter((m) => m.session_date === date);

  const standings = (() => {
    const stats = {};
    players.forEach((p) => {
      stats[p] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, played: 0 };
    });
    matches.forEach((m) => {
      if (m.score_team1 !== null && m.score_team2 !== null) {
        const s1 = m.score_team1, s2 = m.score_team2;
        [m.team1_player1, m.team1_player2].forEach((p) => {
          if (!stats[p]) stats[p] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, played: 0 };
          stats[p].pointsFor += s1; stats[p].pointsAgainst += s2; stats[p].played++;
          if (s1 > s2) stats[p].wins++; else if (s2 > s1) stats[p].losses++;
        });
        [m.team2_player1, m.team2_player2].forEach((p) => {
          if (!stats[p]) stats[p] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, played: 0 };
          stats[p].pointsFor += s2; stats[p].pointsAgainst += s1; stats[p].played++;
          if (s2 > s1) stats[p].wins++; else if (s1 > s2) stats[p].losses++;
        });
      }
    });
    return Object.entries(stats)
      .map(([name, s]) => ({ name, ...s, pct: s.played ? s.wins / s.played : 0 }))
      .sort((a, b) => b.pct - a.pct || b.wins - a.wins);
  })();

  // ─── RENDER ──────────────────────────────────────
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading league data...</p>
      </div>
    );
  }

  if (userPickerOpen && players.length > 0) {
    return (
      <div className="app">
        <div className="user-picker-overlay">
          <div className="user-picker-card">
            <div className="logo-big">🏓</div>
            <h2>Who's checking in?</h2>
            <p className="subtitle">Select your name to get started</p>
            <div className="user-grid">
              {players.map((p) => (
                <button key={p} className="user-btn" onClick={() => { setCurrentUser(p); setUserPickerOpen(false); }}>
                  {p}
                </button>
              ))}
            </div>
            <button className="skip-btn" onClick={() => { setCurrentUser(''); setUserPickerOpen(false); }}>
              Continue as guest →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="header-left">
            <span className="logo">🏓</span>
            <div>
              <h1 className="title">PICKLE LEAGUE</h1>
              <p className="header-sub">{players.length} players · Doubles</p>
            </div>
          </div>
          {currentUser && (
            <button className="user-chip" onClick={() => setUserPickerOpen(true)}>
              <span className="user-dot" />
              {currentUser}
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="tab-bar">
        <div className="tab-inner">
          {TABS.map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'tab-active' : ''}`}
              onClick={() => { setTab(t); if (t === 'Availability' && !selectedDate) setSelectedDate(dates[0]); if (t === 'Schedule' && !selectedDate) setSelectedDate(dates[0]); if (t === 'Scores' && !selectedDate) setSelectedDate(dates[0]); }}
            >
              {t}
              {t === 'Standings' && <span className="tab-badge">LIVE</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="content">

        {/* PLAYERS */}
        {tab === 'Players' && (
          <section>
            <div className="section-header">
              <h2>League Roster</h2>
              <span className="count-badge">{players.length}</span>
            </div>
            <div className="add-row">
              <input
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
                placeholder="Add new player..."
                className="input"
              />
              <button onClick={addPlayer} className="add-btn">+ Add</button>
            </div>
            <div className="player-grid">
              {players.map((p, i) => {
                const s = standings.find((x) => x.name === p);
                return (
                  <div key={p} className="player-card">
                    <span className="player-rank">#{i + 1}</span>
                    <span className="player-name">{p}</span>
                    <span className="player-stat">{s?.wins || 0}W - {s?.losses || 0}L</span>
                    <button className="remove-btn" onClick={() => removePlayer(p)}>✕</button>
                  </div>
                );
              })}
            </div>
            {players.length === 0 && (
              <div className="empty">
                <span style={{ fontSize: 48 }}>🏓</span>
                <p>No players yet. Add your league members above!</p>
              </div>
            )}
          </section>
        )}

        {/* AVAILABILITY */}
        {tab === 'Availability' && (
          <section>
            <div className="section-header">
              <h2>Mark Your Availability</h2>
            </div>
            <div className="date-strip">
              {dates.map((d) => (
                <button key={d} className={`date-chip ${selectedDate === d ? 'date-active' : ''}`} onClick={() => setSelectedDate(d)}>
                  <span className="date-day">{formatDate(d).split(',')[0]}</span>
                  <span className="date-num">{new Date(d + 'T12:00:00').getDate()}</span>
                  <span className="date-avail">{getAvailForDate(d).length} in</span>
                </button>
              ))}
            </div>
            {selectedDate && (
              <>
                <div className="avail-grid">
                  {players.map((p) => {
                    const isIn = getAvailForDate(selectedDate).includes(p);
                    return (
                      <button
                        key={p}
                        className={`avail-card ${isIn ? 'avail-active' : ''}`}
                        onClick={() => toggleAvailability(p, selectedDate)}
                      >
                        <span className={isIn ? 'check-on' : 'check-off'}>{isIn ? '✓' : '○'}</span>
                        <span>{p}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="avail-summary">
                  <strong className="accent">{getAvailForDate(selectedDate).length}</strong> available →{' '}
                  <strong className="accent">{Math.floor(getAvailForDate(selectedDate).length / 4)}</strong> possible matches
                  {getAvailForDate(selectedDate).length % 4 >= 1 && (
                    <span className="warn"> · {getAvailForDate(selectedDate).length % 4} sitting out</span>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* SCHEDULE */}
        {tab === 'Schedule' && (
          <section>
            <div className="section-header">
              <h2>Match Schedule</h2>
            </div>
            <div className="date-strip">
              {dates.map((d) => (
                <button key={d} className={`date-chip ${selectedDate === d ? 'date-active' : ''}`} onClick={() => setSelectedDate(d)}>
                  <span className="date-day">{formatDate(d).split(',')[0]}</span>
                  <span className="date-num">{new Date(d + 'T12:00:00').getDate()}</span>
                  <span className="date-avail">{getMatchesForDate(d).length} games</span>
                </button>
              ))}
            </div>
            {selectedDate && (
              <>
                <button className="generate-btn" onClick={() => autoGenerateSchedule(selectedDate)}>
                  ⚡ Auto-Generate Matches from Availability
                </button>
                <div className="match-list">
                  {getMatchesForDate(selectedDate).map((m) => (
                    <div key={m.id} className="match-card">
                      <div className="match-label">MATCH {m.match_number}</div>
                      <div className="match-teams">
                        <div className="team-side">
                          <span className="team-label">TEAM A</span>
                          <span className="team-players">{m.team1_player1} & {m.team1_player2}</span>
                        </div>
                        <div className="vs-circle">VS</div>
                        <div className="team-side team-right">
                          <span className="team-label">TEAM B</span>
                          <span className="team-players">{m.team2_player1} & {m.team2_player2}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {getMatchesForDate(selectedDate).length === 0 && (
                  <div className="empty"><p>No matches yet. Hit the button above to auto-generate!</p></div>
                )}
              </>
            )}
          </section>
        )}

        {/* SCORES */}
        {tab === 'Scores' && (
          <section>
            <div className="section-header">
              <h2>Enter Scores</h2>
            </div>
            <div className="date-strip">
              {dates.map((d) => (
                <button key={d} className={`date-chip ${selectedDate === d ? 'date-active' : ''}`} onClick={() => setSelectedDate(d)}>
                  <span className="date-day">{formatDate(d).split(',')[0]}</span>
                  <span className="date-num">{new Date(d + 'T12:00:00').getDate()}</span>
                </button>
              ))}
            </div>
            {selectedDate && (
              <div className="match-list">
                {getMatchesForDate(selectedDate).map((m) => (
                  <div key={m.id} className="score-card">
                    <div className="match-label">MATCH {m.match_number}</div>
                    <div className="score-row">
                      <div className="score-team">
                        <span className="score-names">{m.team1_player1} & {m.team1_player2}</span>
                        <input
                          type="number" min="0" max="99"
                          value={m.score_team1 ?? ''}
                          onChange={(e) => updateScore(m.id, 'score_team1', e.target.value)}
                          className="score-input"
                          placeholder="—"
                        />
                      </div>
                      <span className="score-dash">:</span>
                      <div className="score-team score-team-right">
                        <span className="score-names">{m.team2_player1} & {m.team2_player2}</span>
                        <input
                          type="number" min="0" max="99"
                          value={m.score_team2 ?? ''}
                          onChange={(e) => updateScore(m.id, 'score_team2', e.target.value)}
                          className="score-input"
                          placeholder="—"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {getMatchesForDate(selectedDate).length === 0 && (
                  <div className="empty"><p>No matches to score. Generate a schedule first!</p></div>
                )}
              </div>
            )}
          </section>
        )}

        {/* STANDINGS */}
        {tab === 'Standings' && (
          <section>
            <div className="section-header">
              <h2>League Standings</h2>
            </div>
            <div className="standings-table">
              <div className="standings-header">
                <span className="cell cell-rank">#</span>
                <span className="cell cell-name">PLAYER</span>
                <span className="cell">W</span>
                <span className="cell">L</span>
                <span className="cell">GP</span>
                <span className="cell">PF</span>
                <span className="cell">PA</span>
                <span className="cell">WIN%</span>
              </div>
              {standings.map((s, i) => (
                <div key={s.name} className={`standings-row ${i === 0 ? 'standings-first' : ''} ${i % 2 === 0 ? 'standings-even' : ''}`}>
                  <span className={`cell cell-rank ${i < 3 ? 'accent' : 'muted'}`}>{i + 1}</span>
                  <span className="cell cell-name cell-bold">{s.name}</span>
                  <span className="cell accent">{s.wins}</span>
                  <span className="cell loss">{s.losses}</span>
                  <span className="cell">{s.played}</span>
                  <span className="cell">{s.pointsFor}</span>
                  <span className="cell">{s.pointsAgainst}</span>
                  <span className="cell gold">{s.played ? (s.pct * 100).toFixed(0) + '%' : '—'}</span>
                </div>
              ))}
              {standings.length === 0 && (
                <div className="empty"><p>No standings data yet. Play some games!</p></div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>🏓 Pickle League · Real-time sync for all league members</p>
      </footer>
    </div>
  );
}
