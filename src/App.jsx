import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

const TABS = ['Home', 'Schedule', 'Availability', 'Standings'];
const ADMINS = ['Connor Schaars', 'Nathan Amburn'];
const TIME_SLOTS = ['7pm', '8pm', '9pm'];

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateLong(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function getRelativeLabel(iso) {
  const target = new Date(iso + 'T12:00:00');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const diffMs = target - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 13) return `in ${diffDays} days`;
  if (diffDays >= 14) return `in ${Math.round(diffDays / 7)} weeks`;
  if (diffDays < -1 && diffDays >= -13) return `${Math.abs(diffDays)} days ago`;
  if (diffDays < -13) return `${Math.round(Math.abs(diffDays) / 7)} weeks ago`;
  return '';
}

function generateBalancedMatches(playerNames, pointsMap) {
  if (playerNames.length < 4) return { matches: [], sittingOut: playerNames };

  const playersWithPoints = playerNames.map(name => ({
    name,
    points: pointsMap[name] || 0,
  }));

  // Sort by points descending
  playersWithPoints.sort((a, b) => b.points - a.points);

  // Trim to multiple of 4
  const playCount = Math.floor(playersWithPoints.length / 4) * 4;
  const active = playersWithPoints.slice(0, playCount);
  const sittingOut = playersWithPoints.slice(playCount).map(p => p.name);

  // Snake-draft pairing: pair #1 with #N, #2 with #N-1, etc.
  const teams = [];
  for (let i = 0; i < active.length / 2; i++) {
    teams.push({
      players: [active[i].name, active[active.length - 1 - i].name],
      totalPoints: active[i].points + active[active.length - 1 - i].points,
    });
  }

  // Sort teams by total points, pair adjacent teams for balanced matches
  teams.sort((a, b) => b.totalPoints - a.totalPoints);

  const matches = [];
  for (let i = 0; i < teams.length; i += 2) {
    matches.push({
      team1: teams[i].players,
      team2: teams[i + 1].players,
    });
  }

  return { matches, sittingOut };
}

export default function App() {
  const [tab, setTab] = useState('Home');
  const [seasons, setSeasons] = useState([]);
  const [activeSeason, setActiveSeason] = useState(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [players, setPlayers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [matches, setMatches] = useState([]);
  const [playerPoints, setPlayerPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPlayer, setNewPlayer] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [userPickerOpen, setUserPickerOpen] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [whosPlayingOpen, setWhosPlayingOpen] = useState(false);
  const [expandedDateId, setExpandedDateId] = useState(null);
  const [substitutions, setSubstitutions] = useState([]);
  const [subPickerState, setSubPickerState] = useState(null); // { matchId, playerSlot, currentPlayer }
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedDay, setSelectedDay] = useState('Sunday');
  const [weekAssignment, setWeekAssignment] = useState(null);
  const [assignmentMode, setAssignmentMode] = useState(false);

  // ─── DATA LOADING ────────────────────────────────
  const fetchSeasons = useCallback(async () => {
    const { data } = await supabase.from('seasons').select('*').order('start_date', { ascending: false });
    if (data) {
      setSeasons(data);
      const active = data.find(s => s.is_active) || data[0];
      if (active && !selectedSeasonId) {
        setActiveSeason(active);
        setSelectedSeasonId(active.id);
      }
    }
  }, [selectedSeasonId]);

  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase.from('players').select('*').order('name');
    if (data) setPlayers(data.map(p => p.name));
  }, []);

  const fetchSessions = useCallback(async () => {
    if (!selectedSeasonId) return;
    const { data } = await supabase.from('sessions').select('*')
      .eq('season_id', selectedSeasonId)
      .order('session_date');
    if (data) setSessions(data);
  }, [selectedSeasonId]);

  const fetchAvailability = useCallback(async () => {
    const { data } = await supabase.from('availability').select('*');
    if (data) setAvailability(data);
  }, []);

  const fetchMatches = useCallback(async () => {
    const { data } = await supabase.from('matches').select('*').order('match_number');
    if (data) setMatches(data);
  }, []);

  const fetchSubstitutions = useCallback(async () => {
    const { data } = await supabase.from('substitutions').select('*');
    if (data) setSubstitutions(data);
  }, []);

  const fetchPlayerPoints = useCallback(async () => {
    const { data } = await supabase.from('player_points').select('*');
    if (data) setPlayerPoints(data);
  }, []);

  useEffect(() => {
    async function init() {
      await Promise.all([fetchSeasons(), fetchPlayers(), fetchAvailability(), fetchMatches(), fetchSubstitutions(), fetchPlayerPoints()]);
      setLoading(false);
    }
    init();
  }, [fetchSeasons, fetchPlayers, fetchAvailability, fetchMatches, fetchSubstitutions, fetchPlayerPoints]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ─── REAL-TIME SUBSCRIPTIONS ─────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('league-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seasons' }, () => fetchSeasons())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => fetchPlayers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => fetchSessions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => fetchAvailability())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchMatches())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'substitutions' }, () => fetchSubstitutions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_points' }, () => fetchPlayerPoints())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSeasons, fetchPlayers, fetchSessions, fetchAvailability, fetchMatches, fetchSubstitutions, fetchPlayerPoints]);

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

  const toggleAvailability = async (playerName, sessionId) => {
    const existing = availability.find(
      a => a.player_name === playerName && a.session_id === sessionId
    );
    if (existing) {
      // Optimistic local update — remove immediately
      setAvailability(prev => prev.filter(a => a.id !== existing.id));
      await supabase.from('availability').delete().eq('id', existing.id);
    } else {
      // Optimistic local update — add immediately with all time slots
      const tempId = `temp-${Date.now()}`;
      setAvailability(prev => [...prev, { id: tempId, player_name: playerName, session_id: sessionId, time_slots: [...TIME_SLOTS] }]);
      await supabase.from('availability').insert({ player_name: playerName, session_id: sessionId, time_slots: TIME_SLOTS });
    }
  };

  const toggleTimeSlot = async (playerName, sessionId, slot) => {
    const existing = availability.find(
      a => a.player_name === playerName && a.session_id === sessionId
    );
    if (!existing) return;

    const currentSlots = existing.time_slots || TIME_SLOTS;
    let newSlots;

    if (currentSlots.includes(slot)) {
      newSlots = currentSlots.filter(s => s !== slot);
    } else {
      newSlots = [...currentSlots, slot].sort((a, b) => TIME_SLOTS.indexOf(a) - TIME_SLOTS.indexOf(b));
    }

    if (newSlots.length === 0) {
      // No hours selected = remove availability entirely
      setAvailability(prev => prev.filter(a => a.id !== existing.id));
      await supabase.from('availability').delete().eq('id', existing.id);
    } else {
      // Optimistic update
      setAvailability(prev => prev.map(a =>
        a.id === existing.id ? { ...a, time_slots: newSlots } : a
      ));
      await supabase.from('availability').update({ time_slots: newSlots }).eq('id', existing.id);
    }
  };

  // ─── WEEK-BASED SCHEDULING ─────────────────────
  const getPlayerPointsMap = () => {
    const map = {};
    const seasonPts = playerPoints.filter(pp => pp.season_id === selectedSeasonId);
    seasonPts.forEach(pp => {
      map[pp.player_name] = (map[pp.player_name] || 0) + parseFloat(pp.points);
    });
    return map;
  };

  const assignPlayersToSessions = (weekNumber) => {
    const weekSessions = sessions.filter(s => s.week_number === weekNumber);
    const sundaySession = weekSessions.find(s => s.day_of_week === 'Sunday');
    const tuesdaySession = weekSessions.find(s => s.day_of_week === 'Tuesday');

    if (!sundaySession || !tuesdaySession) {
      // Single-session week
      const only = sundaySession || tuesdaySession;
      const avail = getAvailForSession(only.id);
      return {
        sunday: sundaySession ? { locked: avail, flex: [], sessionId: only.id } : { locked: [], flex: [], sessionId: null },
        tuesday: tuesdaySession ? { locked: avail, flex: [], sessionId: only.id } : { locked: [], flex: [], sessionId: null },
      };
    }

    const sundayAvail = getAvailForSession(sundaySession.id);
    const tuesdayAvail = getAvailForSession(tuesdaySession.id);

    const sundayOnly = sundayAvail.filter(p => !tuesdayAvail.includes(p));
    const tuesdayOnly = tuesdayAvail.filter(p => !sundayAvail.includes(p));
    const flex = sundayAvail.filter(p => tuesdayAvail.includes(p));

    // Sort flex by points for balanced distribution
    const ptsMap = getPlayerPointsMap();
    const flexSorted = [...flex].sort((a, b) => (ptsMap[b] || 0) - (ptsMap[a] || 0));

    // Greedy assignment: add each flex player to the smaller session
    const sundayFlex = [];
    const tuesdayFlex = [];
    for (const player of flexSorted) {
      const sunTotal = sundayOnly.length + sundayFlex.length;
      const tueTotal = tuesdayOnly.length + tuesdayFlex.length;
      if (sunTotal <= tueTotal) {
        sundayFlex.push(player);
      } else {
        tuesdayFlex.push(player);
      }
    }

    // Post-process: try to optimize for multiples of 4
    const trySwaps = (sunLocked, sunFlex, tueLocked, tueFlex) => {
      const sunTotal = sunLocked + sunFlex.length;
      const tueTotal = tueLocked + tueFlex.length;
      let bestRemainder = (sunTotal % 4) + (tueTotal % 4);
      let bestSunFlex = [...sunFlex];
      let bestTueFlex = [...tueFlex];

      // Try moving 1-3 flex players each direction
      for (let move = 1; move <= 3; move++) {
        if (sunFlex.length >= move) {
          const tryS = sunFlex.slice(move);
          const tryT = [...tueFlex, ...sunFlex.slice(0, move)];
          const r = ((sunLocked + tryS.length) % 4) + ((tueLocked + tryT.length) % 4);
          if (r < bestRemainder || (r === bestRemainder && Math.abs((sunLocked + tryS.length) - (tueLocked + tryT.length)) < Math.abs((sunLocked + bestSunFlex.length) - (tueLocked + bestTueFlex.length)))) {
            bestRemainder = r;
            bestSunFlex = tryS;
            bestTueFlex = tryT;
          }
        }
        if (tueFlex.length >= move) {
          const tryT = tueFlex.slice(move);
          const tryS = [...sunFlex, ...tueFlex.slice(0, move)];
          const r = ((sunLocked + tryS.length) % 4) + ((tueLocked + tryT.length) % 4);
          if (r < bestRemainder || (r === bestRemainder && Math.abs((sunLocked + tryS.length) - (tueLocked + tryT.length)) < Math.abs((sunLocked + bestSunFlex.length) - (tueLocked + bestTueFlex.length)))) {
            bestRemainder = r;
            bestSunFlex = tryS;
            bestTueFlex = tryT;
          }
        }
      }
      return { sunFlex: bestSunFlex, tueFlex: bestTueFlex };
    };

    const optimized = trySwaps(sundayOnly.length, sundayFlex, tuesdayOnly.length, tuesdayFlex);

    return {
      sunday: { locked: sundayOnly, flex: optimized.sunFlex, sessionId: sundaySession.id },
      tuesday: { locked: tuesdayOnly, flex: optimized.tueFlex, sessionId: tuesdaySession.id },
    };
  };

  const moveFlexPlayer = (playerName, fromDay) => {
    setWeekAssignment(prev => {
      const toDay = fromDay === 'sunday' ? 'tuesday' : 'sunday';
      return {
        ...prev,
        [fromDay]: { ...prev[fromDay], flex: prev[fromDay].flex.filter(p => p !== playerName) },
        [toDay]: { ...prev[toDay], flex: [...prev[toDay].flex, playerName] },
      };
    });
  };

  const confirmAndGenerateMatches = async () => {
    const ptsMap = getPlayerPointsMap();

    for (const day of ['sunday', 'tuesday']) {
      const data = weekAssignment[day];
      if (!data.sessionId) continue;
      const allPlayers = [...data.locked, ...data.flex];
      if (allPlayers.length < 4) continue;

      // Check if scored matches exist
      const existingMatches = getMatchesForSession(data.sessionId);
      const hasScores = existingMatches.some(m => m.score_team1 != null || m.score_team2 != null);
      if (hasScores && !confirm(`${day === 'sunday' ? 'Sunday' : 'Tuesday'} has scored matches. Regenerating will erase scores. Continue?`)) {
        continue;
      }

      await supabase.from('matches').delete().eq('session_id', data.sessionId);

      // Build per-slot player pools
      const slotPlayers = {};
      TIME_SLOTS.forEach(slot => {
        slotPlayers[slot] = allPlayers.filter(p => {
          const avail = availability.find(a => a.player_name === p && a.session_id === data.sessionId);
          return avail && (avail.time_slots || TIME_SLOTS).includes(slot);
        });
      });

      // Process most constrained slots first (fewest available players)
      const sortedSlots = [...TIME_SLOTS].sort(
        (a, b) => slotPlayers[a].length - slotPlayers[b].length
      );

      const matched = new Set();
      const allRows = [];
      let matchNum = 0;

      for (const slot of sortedSlots) {
        const eligible = slotPlayers[slot].filter(p => !matched.has(p));
        if (eligible.length < 4) continue;

        const { matches: slotMatches } = generateBalancedMatches(eligible, ptsMap);
        slotMatches.forEach(m => {
          matchNum++;
          [...m.team1, ...m.team2].forEach(p => matched.add(p));
          allRows.push({
            session_id: data.sessionId,
            match_number: matchNum,
            time_slot: slot,
            team1_player1: m.team1[0],
            team1_player2: m.team1[1],
            team2_player1: m.team2[0],
            team2_player2: m.team2[1],
          });
        });
      }

      if (allRows.length > 0) {
        await supabase.from('matches').insert(allRows);
      }
    }

    setAssignmentMode(false);
    setWeekAssignment(null);
  };

  const updateScore = async (matchId, field, value) => {
    const parsed = value === '' ? null : parseFloat(value);
    // Optimistic local update so the input doesn't appear locked
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, [field]: parsed } : m));
    await supabase.from('matches').update({ [field]: parsed }).eq('id', matchId);
    // Auto-recalculate when both scores are set
    const match = matches.find(m => m.id === matchId);
    if (match) {
      const otherField = field === 'score_team1' ? 'score_team2' : 'score_team1';
      const otherScore = match[otherField];
      if (parsed != null && otherScore != null) {
        const session = sessions.find(s => s.id === match.session_id);
        if (session) recalculateWeekPoints(selectedSeasonId, session.week_number);
      }
    }
  };

  const recalculateWeekPoints = async (seasonId, weekNumber) => {
    // Get all sessions for this week
    const weekSessions = sessions.filter(s => s.week_number === weekNumber);
    const weekSessionIds = weekSessions.map(s => s.id);
    // Get all matches for those sessions
    const weekMatches = matches.filter(m => weekSessionIds.includes(m.session_id));
    // Get all substitutions for those matches
    const weekMatchIds = weekMatches.map(m => m.id);
    const weekSubs = substitutions.filter(s => weekMatchIds.includes(s.match_id));

    // Build a map of match_id+slot -> original_player for sub detection
    const subMap = {};
    weekSubs.forEach(s => {
      subMap[`${s.match_id}:${s.player_slot}`] = s.original_player;
    });

    // Track points: { playerName: { regular: number, sub: number } }
    const pointsMap = {};
    const ensurePlayer = (name) => {
      if (!pointsMap[name]) pointsMap[name] = { regular: 0, sub: 0 };
    };

    const SLOTS = ['team1_player1', 'team1_player2', 'team2_player1', 'team2_player2'];

    weekMatches.forEach(m => {
      // Skip unscored matches
      if (m.score_team1 == null || m.score_team2 == null) return;

      const s1 = parseFloat(m.score_team1);
      const s2 = parseFloat(m.score_team2);

      // Determine points for each team
      let team1Match = 0, team2Match = 0;
      if (s1 > s2) { team1Match = 3; team2Match = 0; }
      else if (s2 > s1) { team2Match = 3; team1Match = 0; }
      else { team1Match = 1.5; team2Match = 1.5; }

      const team1Game = s1 * 0.5;
      const team2Game = s2 * 0.5;

      // Award points to each player in the match
      SLOTS.forEach(slot => {
        const playerName = m[slot];
        const subKey = `${m.id}:${slot}`;
        const isSub = !!subMap[subKey]; // this slot has a substitution record
        const isTeam1 = slot.startsWith('team1');

        ensurePlayer(playerName);
        if (isSub) {
          // Subs only get game points (0.5 per game won), no win bonus
          pointsMap[playerName].sub += isTeam1 ? team1Game : team2Game;
        } else {
          pointsMap[playerName].regular += isTeam1 ? (team1Match + team1Game) : (team2Match + team2Game);
        }
      });
    });

    // Build final points with sub cap (1 pt/week max for sub points)
    const rows = Object.entries(pointsMap)
      .filter(([, v]) => v.regular > 0 || v.sub > 0)
      .map(([name, v]) => ({
        player_name: name,
        season_id: seasonId,
        week_number: weekNumber,
        points: v.regular + Math.min(v.sub, 1),
      }));

    // Optimistic local update — replace this week's points immediately
    setPlayerPoints(prev => [
      ...prev.filter(pp => !(pp.season_id === seasonId && pp.week_number === weekNumber)),
      ...rows.map((r, i) => ({ ...r, id: `temp-${weekNumber}-${i}` })),
    ]);

    // Persist to Supabase
    await supabase.from('player_points').delete()
      .eq('season_id', seasonId)
      .eq('week_number', weekNumber);

    if (rows.length > 0) {
      await supabase.from('player_points').insert(rows);
    }
  };

  const performSubstitution = async (matchId, playerSlot, originalPlayer, substitutePlayer) => {
    // Upsert into substitutions — use the FIRST original player if re-subbing
    const existingSub = substitutions.find(s => s.match_id === matchId && s.player_slot === playerSlot);
    const trueOriginal = existingSub ? existingSub.original_player : originalPlayer;

    // Optimistic local updates
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, [playerSlot]: substitutePlayer } : m));
    setSubstitutions(prev => {
      const filtered = prev.filter(s => !(s.match_id === matchId && s.player_slot === playerSlot));
      return [...filtered, { match_id: matchId, player_slot: playerSlot, original_player: trueOriginal, substitute_player: substitutePlayer, id: existingSub?.id || `temp-${Date.now()}` }];
    });
    setSubPickerState(null);

    await supabase.from('substitutions').upsert({
      match_id: matchId,
      player_slot: playerSlot,
      original_player: trueOriginal,
      substitute_player: substitutePlayer,
    }, { onConflict: 'match_id,player_slot' });

    // Update the match row with the new player
    await supabase.from('matches').update({ [playerSlot]: substitutePlayer }).eq('id', matchId);

    // If match has scores, recalculate
    const match = matches.find(m => m.id === matchId);
    if (match && match.score_team1 != null && match.score_team2 != null) {
      const session = sessions.find(s => s.id === match.session_id);
      if (session && session.week_number) {
        setTimeout(() => recalculateWeekPoints(selectedSeasonId, session.week_number), 500);
      }
    }
  };

  const performReplace = async (matchId, playerSlot, newPlayer) => {
    // Replace = permanent swap, no sub record, full points for new player
    // If there was an existing sub record on this slot, remove it
    const existingSub = substitutions.find(s => s.match_id === matchId && s.player_slot === playerSlot);

    // Optimistic local updates
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, [playerSlot]: newPlayer } : m));
    if (existingSub) {
      setSubstitutions(prev => prev.filter(s => !(s.match_id === matchId && s.player_slot === playerSlot)));
    }
    setSubPickerState(null);

    // Update the match row
    await supabase.from('matches').update({ [playerSlot]: newPlayer }).eq('id', matchId);

    // Remove any existing sub record for this slot
    if (existingSub) {
      await supabase.from('substitutions').delete().eq('id', existingSub.id);
    }

    // If match has scores, recalculate
    const match = matches.find(m => m.id === matchId);
    if (match && match.score_team1 != null && match.score_team2 != null) {
      const session = sessions.find(s => s.id === match.session_id);
      if (session && session.week_number) {
        setTimeout(() => recalculateWeekPoints(selectedSeasonId, session.week_number), 500);
      }
    }
  };

  const undoSubstitution = async (matchId, playerSlot) => {
    const sub = substitutions.find(s => s.match_id === matchId && s.player_slot === playerSlot);
    if (!sub) return;

    // Optimistic local updates
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, [playerSlot]: sub.original_player } : m));
    setSubstitutions(prev => prev.filter(s => !(s.match_id === matchId && s.player_slot === playerSlot)));
    setSubPickerState(null);

    // Restore original player on the match row
    await supabase.from('matches').update({ [playerSlot]: sub.original_player }).eq('id', matchId);

    // Delete substitution record
    await supabase.from('substitutions').delete().eq('id', sub.id);

    // Recalculate if scored
    const match = matches.find(m => m.id === matchId);
    if (match && match.score_team1 != null && match.score_team2 != null) {
      const session = sessions.find(s => s.id === match.session_id);
      if (session && session.week_number) {
        setTimeout(() => recalculateWeekPoints(selectedSeasonId, session.week_number), 500);
      }
    }
  };

  // ─── DERIVED DATA ────────────────────────────────
  const isAdmin = ADMINS.includes(currentUser);

  const getAvailForSession = (sessionId) =>
    availability.filter(a => a.session_id === sessionId).map(a => a.player_name);

  const getAvailForSessionSlot = (sessionId, slot) =>
    availability
      .filter(a => a.session_id === sessionId && (a.time_slots || TIME_SLOTS).includes(slot))
      .map(a => a.player_name);

  const getMatchesForSession = (sessionId) =>
    matches.filter(m => m.session_id === sessionId);

  const getSubForSlot = (matchId, playerSlot) =>
    substitutions.find(s => s.match_id === matchId && s.player_slot === playerSlot);

  const renderPlayerName = (match, slot, align) => {
    const name = match[slot];
    const sub = getSubForSlot(match.id, slot);
    return (
      <span
        className={`player-tap ${sub ? 'player-subbed' : ''}`}
        style={align === 'right' ? { justifyContent: 'flex-end' } : {}}
        onClick={(e) => { e.stopPropagation(); setSubPickerState({ matchId: match.id, playerSlot: slot, currentPlayer: name }); }}
      >
        {sub ? (
          <>
            {name}
            <span className="sub-for-label">(sub for {sub.original_player})</span>
          </>
        ) : (
          name
        )}
      </span>
    );
  };

  const renderTeamPlayers = (match, slot1, slot2, align) => (
    <div className="team-players-list" style={align === 'right' ? { alignItems: 'flex-end' } : {}}>
      {renderPlayerName(match, slot1, align)}
      {renderPlayerName(match, slot2, align)}
    </div>
  );

  const weekNumbers = [...new Set(sessions.map(s => s.week_number))].sort((a, b) => a - b);

  // Determine upcoming week
  const today = new Date().toISOString().split('T')[0];

  const getUpcomingWeek = () => {
    // Find the first week with a session date >= today
    for (const w of weekNumbers) {
      const weekSessions = sessions.filter(s => s.week_number === w);
      const latestDate = weekSessions.reduce((max, s) => s.session_date > max ? s.session_date : max, '');
      if (latestDate >= today) return w;
    }
    // All weeks past — return last week
    return weekNumbers[weekNumbers.length - 1] || null;
  };

  const isWeekPast = (weekNum) => {
    const weekSessions = sessions.filter(s => s.week_number === weekNum);
    if (weekSessions.length === 0) return false;
    const latestDate = weekSessions.reduce((max, s) => s.session_date > max ? s.session_date : max, '');
    return latestDate < today;
  };

  const getCloserDay = (weekNum) => {
    const weekSess = sessions.filter(s => s.week_number === weekNum);
    const sun = weekSess.find(s => s.day_of_week === 'Sunday');
    const tue = weekSess.find(s => s.day_of_week === 'Tuesday');
    if (!sun) return 'Tuesday';
    if (!tue) return 'Sunday';
    // If Tuesday is today or closer to today than Sunday, pick Tuesday
    const sunDiff = Math.abs(new Date(sun.session_date + 'T12:00:00') - new Date());
    const tueDiff = Math.abs(new Date(tue.session_date + 'T12:00:00') - new Date());
    return tueDiff < sunDiff ? 'Tuesday' : 'Sunday';
  };

  // Auto-select upcoming week when sessions load and no week selected
  useEffect(() => {
    if (sessions.length > 0 && weekNumbers.length > 0 && selectedWeek === null) {
      const upcoming = getUpcomingWeek();
      setSelectedWeek(upcoming);
      if (upcoming) setSelectedDay(getCloserDay(upcoming));
    }
  }, [sessions.length, weekNumbers.length]);

  // Next upcoming session
  const nextSession = sessions.find(s => s.session_date >= today);

  // User's checked-in session count
  const myCheckedSessions = sessions.filter(s =>
    availability.some(a => a.session_id === s.id && a.player_name === currentUser)
  );

  // Standings
  const standings = (() => {
    const seasonPoints = playerPoints.filter(pp => pp.season_id === selectedSeasonId);
    const stats = {};
    players.forEach(p => {
      stats[p] = { totalPoints: 0, weeks: {} };
    });
    seasonPoints.forEach(pp => {
      if (!stats[pp.player_name]) {
        stats[pp.player_name] = { totalPoints: 0, weeks: {} };
      }
      stats[pp.player_name].weeks[pp.week_number] = parseFloat(pp.points);
      stats[pp.player_name].totalPoints += parseFloat(pp.points);
    });
    return Object.entries(stats)
      .map(([name, s]) => ({ name, ...s }))
      .filter(s => s.totalPoints > 0 || playerPoints.some(pp => pp.player_name === s.name && pp.season_id === selectedSeasonId))
      .sort((a, b) => b.totalPoints - a.totalPoints);
  })();

  const currentSeason = seasons.find(s => s.id === selectedSeasonId);

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
              {players.map(p => (
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
          <div className="header-right">
            <select
              className="season-select"
              value={selectedSeasonId}
              onChange={e => {
                setSelectedSeasonId(e.target.value);
                setSelectedWeek(null);
              }}
            >
              {seasons.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_active ? ' ●' : ''}
                </option>
              ))}
            </select>
            {currentUser && (
              <button className="user-chip" onClick={() => setUserPickerOpen(true)}>
                <span className="user-dot" />
                {currentUser}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tab-bar">
        <div className="tab-inner">
          {TABS.map(t => (
            <button
              key={t}
              className={`tab ${tab === t ? 'tab-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === 'Standings' && <span className="tab-badge">LIVE</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="content">

        {/* HOME */}
        {tab === 'Home' && (
          <section className="home-section">
            {(() => {
              // Find current user's next upcoming match
              const PLAYER_SLOTS = ['team1_player1', 'team1_player2', 'team2_player1', 'team2_player2'];
              const userMatches = currentUser
                ? matches.filter(m => PLAYER_SLOTS.some(s => m[s] === currentUser))
                : [];
              const upcomingMatch = userMatches.find(m => {
                const session = sessions.find(s => s.id === m.session_id);
                return session && session.session_date >= today;
              });
              const upcomingSession = upcomingMatch ? sessions.find(s => s.id === upcomingMatch.session_id) : null;

              // Find unscored past matches the user played in
              const unscoredMatches = userMatches.filter(m => {
                const session = sessions.find(s => s.id === m.session_id);
                if (!session || session.session_date >= today) return false;
                return m.score_team1 == null || m.score_team2 == null ||
                  (parseFloat(m.score_team1) === 0 && parseFloat(m.score_team2) === 0);
              });
              const unscoredSessions = [...new Set(unscoredMatches.map(m => {
                const session = sessions.find(s => s.id === m.session_id);
                return session;
              }).filter(Boolean))];

              const goToMatch = (session) => {
                setTab('Schedule');
                setSelectedWeek(session.week_number);
                setSelectedDay(session.day_of_week);
              };

              return (
                <>
                  <div className="welcome-banner">
                    <h2 className="welcome-title">
                      {currentUser ? `Hey ${currentUser.split(' ')[0]}!` : 'Welcome to Pickle League!'}
                    </h2>

                    {upcomingMatch && upcomingSession ? (
                      <>
                        <p className="next-session-inline">
                          Your next game is <strong>{formatDateLong(upcomingSession.session_date)}</strong> at <strong>{upcomingMatch.time_slot}</strong>
                        </p>
                        <p className="next-match-detail">
                          {(() => {
                            const isTeam1 = upcomingMatch.team1_player1 === currentUser || upcomingMatch.team1_player2 === currentUser;
                            const partner = isTeam1
                              ? (upcomingMatch.team1_player1 === currentUser ? upcomingMatch.team1_player2 : upcomingMatch.team1_player1)
                              : (upcomingMatch.team2_player1 === currentUser ? upcomingMatch.team2_player2 : upcomingMatch.team2_player1);
                            const opp1 = isTeam1 ? upcomingMatch.team2_player1 : upcomingMatch.team1_player1;
                            const opp2 = isTeam1 ? upcomingMatch.team2_player2 : upcomingMatch.team1_player2;
                            return <>You & <strong>{partner}</strong> vs <strong>{opp1}</strong> & <strong>{opp2}</strong></>;
                          })()}
                        </p>
                        <button className="home-action-btn" onClick={() => goToMatch(upcomingSession)}>
                          View your match
                        </button>
                      </>
                    ) : nextSession ? (
                      <>
                        <p className="next-session-inline">
                          Next session is <strong>{formatDateLong(nextSession.session_date)}</strong> at 7:00 PM
                        </p>
                        {currentUser && !getAvailForSession(nextSession.id).includes(currentUser) && (
                          <button className="status-check-in" onClick={() => toggleAvailability(currentUser, nextSession.id)}>
                            Check in for this session
                          </button>
                        )}
                        {currentUser && getAvailForSession(nextSession.id).includes(currentUser) && (
                          <span className="status-in">You're checked in — schedule coming soon</span>
                        )}
                      </>
                    ) : (
                      <p className="next-session-inline">Season complete! Check standings for final results.</p>
                    )}
                  </div>

                  {unscoredSessions.length > 0 && (
                    <div className="home-card unscored-reminder">
                      <div className="home-card-header">
                        <span className="home-card-icon">📝</span>
                        <span className="home-card-label">Scores Needed</span>
                      </div>
                      <p className="unscored-text">
                        You have {unscoredMatches.length === 1 ? 'a game' : `${unscoredMatches.length} games`} that still {unscoredMatches.length === 1 ? 'needs' : 'need'} scores entered.
                        Tap below to fill them in so your points count!
                      </p>
                      {unscoredSessions.map(session => (
                        <button key={session.id} className="home-action-btn unscored-action" onClick={() => goToMatch(session)}>
                          Enter scores for {formatDate(session.session_date)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {/* How It Works */}
            <div className="home-card">
              <div className="home-card-header">
                <span className="home-card-icon">🧭</span>
                <span className="home-card-label">How It Works</span>
              </div>
              <div className="howto-steps">
                <div className="howto-step">
                  <span className="howto-num">1</span>
                  <div>
                    <strong>Check in</strong>
                    <p>Go to <strong>Availability</strong> and tap the dates you can play. Do this each week so we know who's showing up.</p>
                  </div>
                </div>
                <div className="howto-step">
                  <span className="howto-num">2</span>
                  <div>
                    <strong>See your matches</strong>
                    <p>Once enough people check in, the schedule gets posted under <strong>Schedule</strong>. Matches are split into time slots (7 / 8 / 9 pm).</p>
                  </div>
                </div>
                <div className="howto-step">
                  <span className="howto-num">3</span>
                  <div>
                    <strong>Subs</strong>
                    <p>Can't make it? Someone can sub in. Admins tap a player name on the schedule to swap them out. The original player is tracked and can be restored.</p>
                  </div>
                </div>
                <div className="howto-step">
                  <span className="howto-num">4</span>
                  <div>
                    <strong>Scoring</strong>
                    <p>After you play, enter scores right on the <strong>Schedule</strong> tab. Points are calculated automatically — <strong>3 pts</strong> for a win, <strong>1.5</strong> for a tie, <strong>0.5</strong> per game won. Sub points are capped at <strong>1 pt/week</strong>.</p>
                  </div>
                </div>
                <div className="howto-step">
                  <span className="howto-num">5</span>
                  <div>
                    <strong>Standings</strong>
                    <p>Check <strong>Standings</strong> to see where you rank. Points update in real time as scores are entered.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="quick-links">
              <button className="quick-link-btn" onClick={() => setTab('Availability')}>
                📝 My Availability
              </button>
              <button className="quick-link-btn" onClick={() => setTab('Schedule')}>
                📊 View Schedule
              </button>
            </div>

            {/* Collapsible Player Roster */}
            <div className="home-card collapsible-card">
              <button className="collapsible-header" onClick={() => setRosterOpen(!rosterOpen)}>
                <div className="home-card-header">
                  <span className="home-card-icon">👥</span>
                  <span className="home-card-label">Player Roster</span>
                  <span className="count-badge">{players.length}</span>
                </div>
                <span className={`chevron ${rosterOpen ? 'chevron-open' : ''}`}>▸</span>
              </button>
              {rosterOpen && (
                <div className="collapsible-body">
                  <div className="add-row">
                    <input
                      value={newPlayer}
                      onChange={e => setNewPlayer(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPlayer()}
                      placeholder="Add new player..."
                      className="input"
                    />
                    <button onClick={addPlayer} className="add-btn">+ Add</button>
                  </div>
                  <div className="player-grid">
                    {players.map((p, i) => {
                      const s = standings.find(x => x.name === p);
                      return (
                        <div key={p} className="player-card">
                          <span className="player-rank">#{i + 1}</span>
                          <span className="player-name">{p}</span>
                          <span className="player-stat">{s?.totalPoints || 0} pts</span>
                          <button className="remove-btn" onClick={() => removePlayer(p)}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* AVAILABILITY */}
        {tab === 'Availability' && (
          <section>
            {/* My Availability */}
            <div className="section-header">
              <h2>My Availability</h2>
            </div>
            {currentUser ? (
              <>
                <p className="avail-summary-line">
                  You're in for <strong className="accent">{myCheckedSessions.length}</strong> of <strong>{sessions.length}</strong> sessions
                </p>
                <div className="avail-matrix">
                  {sessions.map(s => {
                    const availRow = availability.find(a => a.session_id === s.id && a.player_name === currentUser);
                    const isIn = !!availRow;
                    const activeSlots = availRow?.time_slots || TIME_SLOTS;
                    return (
                      <div key={s.id} className="avail-chip-wrapper">
                        <button
                          className={`avail-chip ${isIn ? 'avail-chip-in' : 'avail-chip-out'}`}
                          onClick={() => toggleAvailability(currentUser, s.id)}
                        >
                          <span className={`avail-dot ${isIn ? 'avail-dot-green' : 'avail-dot-red'}`} />
                          <span className="avail-chip-day">{s.day_of_week.slice(0, 3)}</span>
                          <span className="avail-chip-date">{formatDate(s.session_date).replace(/^\w+, /, '')}</span>
                          {s.is_tournament && <span className="date-tourney-badge">T</span>}
                        </button>
                        {isIn && (
                          <div className="time-slot-pills">
                            {TIME_SLOTS.map(slot => (
                              <button
                                key={slot}
                                className={`time-pill ${activeSlots.includes(slot) ? 'time-pill-active' : 'time-pill-off'}`}
                                onClick={() => toggleTimeSlot(currentUser, s.id, slot)}
                              >
                                {slot.replace('pm', '')}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="empty">
                <p>Sign in to manage your availability.</p>
              </div>
            )}

            {/* Who's Playing */}
            <div className="whos-playing-section">
              <button className="collapsible-header" onClick={() => setWhosPlayingOpen(!whosPlayingOpen)}>
                <div className="home-card-header">
                  <span className="home-card-icon">👥</span>
                  <span className="home-card-label">Who's Playing?</span>
                </div>
                <span className={`chevron ${whosPlayingOpen ? 'chevron-open' : ''}`}>▸</span>
              </button>
              {whosPlayingOpen && (
                <div className="collapsible-body">
                  <div className="whos-playing-list">
                    {sessions.map(s => {
                      const availPlayers = getAvailForSession(s.id);
                      const isExpanded = expandedDateId === s.id;
                      return (
                        <div key={s.id} className="whos-playing-item">
                          <button
                            className="whos-playing-date-row"
                            onClick={() => setExpandedDateId(isExpanded ? null : s.id)}
                          >
                            <span className="whos-date-label">{formatDate(s.session_date)}</span>
                            <span className="whos-count-badge">{availPlayers.length} in</span>
                            <span className={`chevron-small ${isExpanded ? 'chevron-open' : ''}`}>▸</span>
                          </button>
                          {isExpanded && (
                            <div className="whos-player-list">
                              {availPlayers.length > 0 ? (
                                <>
                                  {availPlayers.map(p => (
                                    <span key={p} className="whos-player-chip">{p}</span>
                                  ))}
                                  <div className="whos-slot-summary">
                                    {TIME_SLOTS.map(slot => {
                                      const count = getAvailForSessionSlot(s.id, slot).length;
                                      return <span key={slot} className="whos-slot-count">{slot}: {count}</span>;
                                    })}
                                  </div>
                                </>
                              ) : (
                                <span className="muted">No one yet</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* SCHEDULE (with inline scores) */}
        {tab === 'Schedule' && (
          <section>
            <div className="section-header">
              <h2>Schedule & Scores</h2>
            </div>
            <div className="week-strip">
              {weekNumbers.map(w => {
                const weekSess = sessions.filter(s => s.week_number === w);
                const isTournament = weekSess.some(s => s.is_tournament);
                const matchCount = weekSess.reduce((sum, s) => sum + getMatchesForSession(s.id).length, 0);
                const past = isWeekPast(w);
                const allScored = matchCount > 0 && weekSess.every(s =>
                  getMatchesForSession(s.id).every(m => m.score_team1 != null && m.score_team2 != null)
                );
                // Relative time: use the nearest session date
                const nearestDate = weekSess
                  .map(s => s.session_date)
                  .sort((a, b) => Math.abs(new Date(a + 'T12:00:00') - new Date()) - Math.abs(new Date(b + 'T12:00:00') - new Date()))[0];
                const relLabel = nearestDate ? getRelativeLabel(nearestDate) : '';
                const isThisWeek = relLabel === 'Today' || relLabel === 'Tomorrow' || relLabel === 'Yesterday' ||
                  (weekSess.some(s => s.session_date <= today) && weekSess.some(s => s.session_date >= today));
                return (
                  <button
                    key={w}
                    className={`week-chip ${selectedWeek === w ? 'week-active' : ''} ${isTournament ? 'week-tournament' : ''} ${past && allScored ? 'week-completed' : ''} ${isThisWeek ? 'week-current' : ''}`}
                    onClick={() => { setSelectedWeek(w); setSelectedDay(getCloserDay(w)); setAssignmentMode(false); setWeekAssignment(null); }}
                  >
                    <span className="week-num">{isTournament ? 'T' : `W${w}`}</span>
                    <span className="week-games">
                      {past && allScored ? 'Done' : matchCount > 0 ? `${matchCount} games` : '\u00A0'}
                    </span>
                    <span className="week-when">{isThisWeek ? 'This week' : relLabel}</span>
                  </button>
                );
              })}
            </div>

            {selectedWeek && !assignmentMode && (
              <>
                {isAdmin && (
                  <div className="admin-actions-row">
                    <button className="generate-week-btn" onClick={() => {
                      const assignment = assignPlayersToSessions(selectedWeek);
                      setWeekAssignment(assignment);
                      setAssignmentMode(true);
                    }}>
                      Generate Week {selectedWeek} Schedule
                    </button>
                    <button className="recalc-btn" onClick={() => recalculateWeekPoints(selectedSeasonId, selectedWeek)}>
                      Recalculate Points
                    </button>
                  </div>
                )}
                {(() => {
                  const weekSess = sessions.filter(s => s.week_number === selectedWeek);
                  const hasSunday = weekSess.some(s => s.day_of_week === 'Sunday');
                  const hasTuesday = weekSess.some(s => s.day_of_week === 'Tuesday');
                  const showToggle = hasSunday && hasTuesday;
                  return (
                    <div className="day-toggle-enhanced">
                      {hasSunday && (() => {
                        const sunSession = weekSess.find(s => s.day_of_week === 'Sunday');
                        const sunDate = sunSession ? formatDateLong(sunSession.session_date) : '';
                        const sunRel = sunSession ? getRelativeLabel(sunSession.session_date) : '';
                        return (
                          <button className={`day-toggle-card ${selectedDay === 'Sunday' ? 'day-toggle-card-active' : ''}`} onClick={() => setSelectedDay('Sunday')}>
                            <span className="day-toggle-label">☀️ Sunday Games</span>
                            <span className="day-toggle-date">{sunDate}</span>
                            {sunRel && <span className={`day-toggle-rel ${sunRel === 'Today' ? 'rel-today' : ''}`}>{sunRel}</span>}
                          </button>
                        );
                      })()}
                      {hasTuesday && (() => {
                        const tueSession = weekSess.find(s => s.day_of_week === 'Tuesday');
                        const tueDate = tueSession ? formatDateLong(tueSession.session_date) : '';
                        const tueRel = tueSession ? getRelativeLabel(tueSession.session_date) : '';
                        return (
                          <button className={`day-toggle-card ${selectedDay === 'Tuesday' ? 'day-toggle-card-active' : ''}`} onClick={() => setSelectedDay('Tuesday')}>
                            <span className="day-toggle-label">🌙 Tuesday Games</span>
                            <span className="day-toggle-date">{tueDate}</span>
                            {tueRel && <span className={`day-toggle-rel ${tueRel === 'Today' ? 'rel-today' : ''}`}>{tueRel}</span>}
                          </button>
                        );
                      })()}
                    </div>
                  ) : hasSunday || hasTuesday ? (
                    <div className="day-toggle-enhanced">
                      {(() => {
                        const sess = weekSess[0];
                        const dateStr = sess ? formatDateLong(sess.session_date) : '';
                        const relStr = sess ? getRelativeLabel(sess.session_date) : '';
                        return (
                          <div className="day-toggle-card day-toggle-card-active day-toggle-card-solo">
                            <span className="day-toggle-label">{sess?.day_of_week === 'Sunday' ? '☀️' : '🌙'} {sess?.day_of_week} Games</span>
                            <span className="day-toggle-date">{dateStr}</span>
                            {relStr && <span className={`day-toggle-rel ${relStr === 'Today' ? 'rel-today' : ''}`}>{relStr}</span>}
                          </div>
                        );
                      })()}
                    </div>
                  ) : null;
                })()}

                <div className="week-sessions">
                  {sessions.filter(s => s.week_number === selectedWeek && s.day_of_week === selectedDay).map(session => {
                    const sessionMatches = getMatchesForSession(session.id);
                    const relLabel = getRelativeLabel(session.session_date);
                    return (
                      <div key={session.id} className="week-session-card">
                        <div className="week-session-header">
                          <span className="week-session-count">{getAvailForSession(session.id).length} players available</span>
                        </div>
                        {['7pm', '8pm', '9pm'].map(slot => {
                          const slotMatches = sessionMatches.filter(m => m.time_slot === slot);
                          if (slotMatches.length === 0) return null;
                          return (
                            <div key={slot} className="time-slot-group">
                              <div className="time-slot-header">{slot}</div>
                              <div className="match-list">
                                {slotMatches.map(m => {
                                  const hasScores = m.score_team1 != null && m.score_team2 != null;
                                  const t1Won = hasScores && parseFloat(m.score_team1) > parseFloat(m.score_team2);
                                  const t2Won = hasScores && parseFloat(m.score_team2) > parseFloat(m.score_team1);
                                  return (
                                    <div key={m.id} className={`match-card ${hasScores ? 'match-scored' : ''}`}>
                                      <div className="match-label">MATCH {m.match_number}</div>
                                      <div className="match-teams-scores">
                                        <div className={`team-score-row ${t1Won ? 'team-won' : ''}`}>
                                          <div className="team-players-inline">
                                            {renderPlayerName(m, 'team1_player1', 'left')}
                                            <span className="team-amp">&</span>
                                            {renderPlayerName(m, 'team1_player2', 'left')}
                                          </div>
                                          <div className="score-input-group">
                                            <input
                                              type="number" inputMode="numeric" min="0" max="99" step="1"
                                              value={m.score_team1 ?? ''}
                                              onChange={e => updateScore(m.id, 'score_team1', e.target.value)}
                                              className="score-input-inline"
                                              placeholder="—"
                                            />
                                            <span className="score-label">games</span>
                                          </div>
                                        </div>
                                        <div className={`team-score-row ${t2Won ? 'team-won' : ''}`}>
                                          <div className="team-players-inline">
                                            {renderPlayerName(m, 'team2_player1', 'left')}
                                            <span className="team-amp">&</span>
                                            {renderPlayerName(m, 'team2_player2', 'left')}
                                          </div>
                                          <div className="score-input-group">
                                            <input
                                              type="number" inputMode="numeric" min="0" max="99" step="1"
                                              value={m.score_team2 ?? ''}
                                              onChange={e => updateScore(m.id, 'score_team2', e.target.value)}
                                              className="score-input-inline"
                                              placeholder="—"
                                            />
                                            <span className="score-label">games</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {sessionMatches.length === 0 && (
                          <div className="empty-mini">
                            <p className="muted">No matches yet</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Assignment Preview */}
            {assignmentMode && weekAssignment && (() => {
              const ptsMap = getPlayerPointsMap();
              return (
                <div className="assignment-preview">
                  <h3>Player Assignment — Week {selectedWeek}</h3>
                  <p className="subtitle">Locked players can only play one day. Flex players can be moved between sessions.</p>
                  <div className="assignment-columns">
                    {['sunday', 'tuesday'].map(day => {
                      const data = weekAssignment[day];
                      if (!data.sessionId) return null;
                      const total = data.locked.length + data.flex.length;
                      const remainder = total % 4;
                      const matchCount = Math.floor(total / 4);
                      return (
                        <div key={day} className="assignment-column">
                          <div className="assignment-column-header">
                            <span>{day === 'sunday' ? 'Sunday' : 'Tuesday'}</span>
                            <span className={`player-count ${remainder !== 0 ? 'count-warn' : ''}`}>
                              {total} players · {matchCount} {matchCount === 1 ? 'match' : 'matches'}{remainder > 0 ? ` · ${remainder} sitting out` : ''}
                            </span>
                          </div>
                          {data.locked.map(p => (
                            <div key={p} className="assignment-player locked">
                              <span>{p}</span>
                              <span className="player-pts">{ptsMap[p]?.toFixed(1) || '0.0'} pts</span>
                            </div>
                          ))}
                          {data.flex.length > 0 && data.locked.length > 0 && <hr className="assignment-divider" />}
                          {data.flex.map(p => (
                            <div key={p} className="assignment-player flex">
                              <span>{p} <span className="player-pts">{ptsMap[p]?.toFixed(1) || '0.0'} pts</span></span>
                              <button onClick={() => moveFlexPlayer(p, day)}>
                                {day === 'sunday' ? '→ Tue' : '← Sun'}
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <div className="assignment-actions">
                    <button className="cancel-btn" onClick={() => { setAssignmentMode(false); setWeekAssignment(null); }}>
                      Cancel
                    </button>
                    <button className="confirm-generate-btn" onClick={confirmAndGenerateMatches}>
                      Confirm & Generate Matches
                    </button>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* STANDINGS */}
        {tab === 'Standings' && (
          <section>
            <div className="section-header">
              <h2>League Standings</h2>
              <span className="season-label">{currentSeason?.name}</span>
            </div>
            <div className="standings-table">
              <div className="standings-header">
                <span className="cell cell-rank">#</span>
                <span className="cell cell-name">PLAYER</span>
                {weekNumbers.map(w => (
                  <span key={w} className="cell cell-week">W{w}</span>
                ))}
                <span className="cell cell-total">TOTAL</span>
              </div>
              {standings.map((s, i) => (
                <div key={s.name} className={`standings-row ${i === 0 ? 'standings-first' : ''} ${i % 2 === 0 ? 'standings-even' : ''}`}>
                  <span className={`cell cell-rank ${i < 3 ? 'accent' : 'muted'}`}>{i + 1}</span>
                  <span className="cell cell-name cell-bold">{s.name}</span>
                  {weekNumbers.map(w => (
                    <span key={w} className={`cell cell-week ${(s.weeks[w] || 0) >= 5 ? 'accent' : (s.weeks[w] || 0) > 0 ? '' : 'muted'}`}>
                      {s.weeks[w] || 0}
                    </span>
                  ))}
                  <span className="cell cell-total gold">{s.totalPoints}</span>
                </div>
              ))}
              {standings.length === 0 && (
                <div className="empty"><p>No standings data yet. Play some games!</p></div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* SUB / REPLACE PICKER MODAL */}
      {subPickerState && (() => {
        const { matchId, playerSlot, currentPlayer } = subPickerState;
        const match = matches.find(m => m.id === matchId);
        if (!match) return null;
        const existingSub = getSubForSlot(matchId, playerSlot);
        // Players already in this match
        const matchPlayers = ['team1_player1', 'team1_player2', 'team2_player1', 'team2_player2'].map(s => match[s]);
        // Available players: all players not already in this match
        const availablePlayers = players.filter(p => !matchPlayers.includes(p));
        return (
          <div className="sub-picker-overlay" onClick={() => setSubPickerState(null)}>
            <div className="sub-picker-card" onClick={e => e.stopPropagation()}>
              <h3>Change Player</h3>
              <p className="subtitle">Updating {currentPlayer} in Match {match.match_number}</p>
              {existingSub && (
                <>
                  <button className="undo-sub-btn" onClick={() => undoSubstitution(matchId, playerSlot)}>
                    Restore original: {existingSub.original_player}
                  </button>
                  <hr className="sub-divider" />
                </>
              )}
              <div className="picker-hint">
                <span className="hint-sub">Sub</span> = fills in temporarily, points capped at 1/week
              </div>
              <div className="picker-hint" style={{ marginBottom: 16 }}>
                <span className="hint-replace">Replace</span> = permanent change, earns full points
              </div>
              {availablePlayers.map(p => (
                <div key={p} className="picker-player-row">
                  <span className="picker-player-name">{p}</span>
                  <div className="picker-actions">
                    <button className="picker-sub-btn" onClick={() => performSubstitution(matchId, playerSlot, currentPlayer, p)}>Sub</button>
                    <button className="picker-replace-btn" onClick={() => performReplace(matchId, playerSlot, p)}>Replace</button>
                  </div>
                </div>
              ))}
              <button className="sub-cancel-btn" onClick={() => setSubPickerState(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      <footer className="footer">
        <p>🏓 Pickle League · Real-time sync for all league members</p>
      </footer>
    </div>
  );
}
