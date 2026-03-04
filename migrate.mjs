import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function insert(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ✓ ${table}: ${data.length} rows`);
  return data;
}

function parseAvailabilityCSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  // Row 5 (index 4) has the dates: ,,3/1,3/3,3/8,3/10,...
  const dateRow = lines[4].split(',');
  // Columns 2-21 are the 20 session dates (month/day format)
  const sessionDates = [];
  for (let col = 2; col <= 21; col++) {
    const raw = (dateRow[col] || '').trim();
    if (raw) {
      // Convert "3/1" to "2026-03-01"
      const [month, day] = raw.split('/');
      sessionDates.push(`2026-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
  }

  // Rows 6-48 (index 5-47) are player data
  const availability = {};
  for (let i = 5; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[1] || '').trim();
    if (!name || name === '') continue;
    // Skip empty/summary rows
    if (name === 'FALSE' || name === 'TRUE') continue;

    availability[name] = [];
    for (let col = 2; col <= 21; col++) {
      const val = (cols[col] || '').trim().toUpperCase();
      if (val === 'TRUE' && sessionDates[col - 2]) {
        availability[name].push(sessionDates[col - 2]);
      }
    }
  }
  return availability;
}

function parseScheduleCSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  const NAME_ALIASES = {
    'Jared D': 'Jared Draper',
    'Nathan': 'Nathan Amburn',
    'Connor S': 'Connor Schaars',
  };

  function resolveAlias(name) {
    return NAME_ALIASES[name] || name;
  }

  // Parse a player cell like "Name", "(Name)", "Name(Alias)", "(Name)(XXX)"
  // Returns { actual: string, isSub: boolean, originalPlayer: string|null }
  function parsePlayerCell(cell) {
    cell = (cell || '').trim();
    if (!cell) return null;

    // Remove (XXX) noise
    cell = cell.replace(/\(XXX\)/g, '').trim();
    if (!cell) return null;

    // Pattern: (Name) — entire name in parens, player is a sub
    if (cell.startsWith('(') && cell.endsWith(')') && cell.indexOf(')(') === -1) {
      const name = resolveAlias(cell.slice(1, -1).trim());
      return { actual: name, isSub: true, originalPlayer: name };
    }

    // Pattern: ActualName(OriginalName) — sub replacing someone
    const hybridMatch = cell.match(/^(.+?)\((.+?)\)$/);
    if (hybridMatch) {
      const actual = resolveAlias(hybridMatch[1].trim());
      const original = resolveAlias(hybridMatch[2].trim());
      return { actual, isSub: true, originalPlayer: original };
    }

    // Regular player name
    return { actual: resolveAlias(cell), isSub: false, originalPlayer: null };
  }

  function parseTimeSlot(val) {
    const t = (val || '').trim();
    if (t === '7:00 PM') return '7pm';
    if (t === '8:00 PM') return '8pm';
    if (t === '9:00 PM') return '9pm';
    return t;
  }

  function parseDateFromHeader(header) {
    // "SUNDAY: 3/1" → "2026-03-01"
    const match = (header || '').match(/(\d+)\/(\d+)/);
    if (!match) return null;
    const [, month, day] = match;
    // Determine year: months 3-5 are 2026
    return `2026-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const weeks = [];
  let currentWeek = null;
  let sunTimeSlot = null;
  let tueTimeSlot = null;

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const col0 = (cols[0] || '').trim();

    // Week header row: "WEEK N", "PLAY IN GAMES", or "TOURNAMENT"
    if (col0.startsWith('WEEK') || col0 === 'PLAY IN GAMES' || col0 === 'TOURNAMENT') {
      let weekNum;
      if (col0.startsWith('WEEK')) weekNum = parseInt(col0.replace('WEEK ', ''));
      else if (col0 === 'PLAY IN GAMES') weekNum = 9;
      else weekNum = 10;

      // Day headers are on the previous line
      const prevCols = lines[i - 1].split(',');
      const sunDate = parseDateFromHeader((prevCols[1] || '').trim());
      const tueDate = parseDateFromHeader((prevCols[7] || '').trim());

      currentWeek = { weekNum, sunDate, tueDate, sunMatches: [], tueMatches: [] };
      weeks.push(currentWeek);

      // This row also has the first time slot
      sunTimeSlot = parseTimeSlot(cols[1]);
      tueTimeSlot = parseTimeSlot(cols[7]);
      continue;
    }

    // Time slot row
    if ((cols[1] || '').trim().match(/^\d+:\d+ [AP]M$/)) {
      sunTimeSlot = parseTimeSlot(cols[1]);
      tueTimeSlot = parseTimeSlot(cols[7]);
      continue;
    }

    // Match data row (has "VS" in col 3 or col 9)
    if ((cols[3] || '').trim() === 'VS' && currentWeek) {
      const p2Line = (lines[i + 2] || '').split(',');

      // Sunday match (cols 1-5, p2 in cols 1,4)
      const sunPlayers = [
        parsePlayerCell(cols[1]),
        parsePlayerCell(p2Line[1]),
        parsePlayerCell(cols[4]),
        parsePlayerCell(p2Line[4]),
      ];
      if (sunPlayers.some(p => p !== null)) {
        const s1 = parseInt((cols[2] || '0').trim()) || 0;
        const s2 = parseInt((cols[5] || '0').trim()) || 0;
        currentWeek.sunMatches.push({
          timeSlot: sunTimeSlot,
          team1: [sunPlayers[0], sunPlayers[1]],
          team2: [sunPlayers[2], sunPlayers[3]],
          score1: (s1 === 0 && s2 === 0) ? null : s1,
          score2: (s1 === 0 && s2 === 0) ? null : s2,
        });
      }

      // Tuesday match (cols 7-11, p2 in cols 7,10)
      const tuePlayers = [
        parsePlayerCell(cols[7]),
        parsePlayerCell(p2Line[7]),
        parsePlayerCell(cols[10]),
        parsePlayerCell(p2Line[10]),
      ];
      if (tuePlayers.some(p => p !== null)) {
        const s1 = parseInt((cols[8] || '0').trim()) || 0;
        const s2 = parseInt((cols[11] || '0').trim()) || 0;
        currentWeek.tueMatches.push({
          timeSlot: tueTimeSlot,
          team1: [tuePlayers[0], tuePlayers[1]],
          team2: [tuePlayers[2], tuePlayers[3]],
          score1: (s1 === 0 && s2 === 0) ? null : s1,
          score2: (s1 === 0 && s2 === 0) ? null : s2,
        });
      }
    }
  }

  return weeks;
}

function parseScoresCSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  // Row 1 is header, rows 2+ are player data
  // Columns: Ranking, Players, Week of 3/1, Week of 3/8, ..., Total Points
  const points = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[1] || '').trim();
    if (!name || name === '') continue;
    if (name.startsWith('Scoring Rules') || name.startsWith('Each') || name.startsWith('Winning') || name.startsWith('Tied') || name.startsWith('If someone') || name.startsWith('Subs') || name.startsWith('You must') || name.startsWith('New games')) continue;

    // Week columns start at index 2
    const weekPoints = {};
    for (let w = 0; w < 8; w++) {
      const val = (cols[w + 2] || '').trim();
      if (val && !isNaN(parseFloat(val))) {
        weekPoints[w + 1] = parseFloat(val);
      }
    }
    if (Object.keys(weekPoints).length > 0) {
      points[name] = weekPoints;
    }
  }
  return points;
}

async function migrate() {
  console.log('\n=== PICKLE LEAGUE MIGRATION ===\n');

  // 1. SEASONS
  console.log('1. Inserting seasons...');
  const seasons = await insert('seasons', [
    { name: 'Spring 2025', start_date: '2025-03-02', end_date: '2025-05-06', is_active: false },
    { name: 'Spring 2026', start_date: '2026-03-01', end_date: '2026-05-05', is_active: true },
  ]);
  const s25 = seasons.find(s => s.name === 'Spring 2025');
  const s26 = seasons.find(s => s.name === 'Spring 2026');

  // 2. PLAYERS
  console.log('2. Inserting players...');
  // Parse availability CSV to get the canonical player list
  const availCSV = parseAvailabilityCSV('/Users/connor/Downloads/Pickleball Availability - Spring 2026.csv');
  const csvPlayerNames = Object.keys(availCSV);

  // Additional players from S25 history and S26 scores not in availability CSV
  const extraPlayers = ['Casey Gaffney', 'Connor Nichols', 'Marty Lisenby', 'Collin Couch', 'Lew Kennedy', 'Max Gilbert'];
  const allPlayerNames = [...new Set([...csvPlayerNames, ...extraPlayers])];

  await insert('players', allPlayerNames.map(name => ({ name })));

  // 3. SESSIONS (Spring 2026 - 20 sessions)
  console.log('3. Inserting sessions...');
  const sessionData = [
    { date: '2026-03-01', day: 'Sunday',  week: 1,  tournament: false },
    { date: '2026-03-03', day: 'Tuesday', week: 1,  tournament: false },
    { date: '2026-03-08', day: 'Sunday',  week: 2,  tournament: false },
    { date: '2026-03-10', day: 'Tuesday', week: 2,  tournament: false },
    { date: '2026-03-15', day: 'Sunday',  week: 3,  tournament: false },
    { date: '2026-03-17', day: 'Tuesday', week: 3,  tournament: false },
    { date: '2026-03-22', day: 'Sunday',  week: 4,  tournament: false },
    { date: '2026-03-24', day: 'Tuesday', week: 4,  tournament: false },
    { date: '2026-03-29', day: 'Sunday',  week: 5,  tournament: false },
    { date: '2026-03-31', day: 'Tuesday', week: 5,  tournament: false },
    { date: '2026-04-05', day: 'Sunday',  week: 6,  tournament: false },
    { date: '2026-04-07', day: 'Tuesday', week: 6,  tournament: false },
    { date: '2026-04-12', day: 'Sunday',  week: 7,  tournament: false },
    { date: '2026-04-14', day: 'Tuesday', week: 7,  tournament: false },
    { date: '2026-04-19', day: 'Sunday',  week: 8,  tournament: false },
    { date: '2026-04-21', day: 'Tuesday', week: 8,  tournament: false },
    { date: '2026-04-26', day: 'Sunday',  week: 9,  tournament: false },
    { date: '2026-04-28', day: 'Tuesday', week: 9,  tournament: false },
    { date: '2026-05-03', day: 'Sunday',  week: 10, tournament: true },
    { date: '2026-05-05', day: 'Tuesday', week: 10, tournament: true },
  ];
  const sessions = await insert('sessions', sessionData.map(s => ({
    season_id: s26.id,
    session_date: s.date,
    day_of_week: s.day,
    week_number: s.week,
    is_tournament: s.tournament,
  })));

  const sessionByDate = {};
  sessions.forEach(s => { sessionByDate[s.session_date] = s.id; });

  // 4. AVAILABILITY (from CSV)
  console.log('4. Inserting availability from CSV...');
  const availRows = [];
  for (const [player, dates] of Object.entries(availCSV)) {
    for (const date of dates) {
      const sessionId = sessionByDate[date];
      if (sessionId) {
        availRows.push({ player_name: player, session_id: sessionId });
      } else {
        console.warn(`  ⚠ No session found for ${player} on ${date}`);
      }
    }
  }
  for (let i = 0; i < availRows.length; i += 50) {
    const batch = availRows.slice(i, i + 50);
    await insert('availability', batch);
  }
  console.log(`  Total availability rows: ${availRows.length}`);

  // 5. MATCHES from schedule CSV (all weeks with data)
  console.log('5. Inserting matches from schedule CSV...');
  const scheduleData = parseScheduleCSV('/Users/connor/Downloads/Pickleball Availability - S26 Schedule.csv');

  const SLOTS = ['team1_player1', 'team1_player2', 'team2_player1', 'team2_player2'];
  const allInsertedMatches = [];
  const allSubRows = [];

  for (const week of scheduleData) {
    const daySets = [
      { date: week.sunDate, matches: week.sunMatches },
      { date: week.tueDate, matches: week.tueMatches },
    ];
    for (const { date, matches } of daySets) {
      if (!date || matches.length === 0) continue;
      const sessionId = sessionByDate[date];
      if (!sessionId) { console.warn(`  ⚠ No session for date ${date}`); continue; }

      const matchRows = matches.map((m, idx) => {
        const players = [...m.team1, ...m.team2]; // [t1p1, t1p2, t2p1, t2p2]
        const row = {
          session_id: sessionId,
          match_number: idx + 1,
          time_slot: m.timeSlot,
          score_team1: m.score1,
          score_team2: m.score2,
        };
        SLOTS.forEach((slot, si) => {
          row[slot] = players[si] ? players[si].actual : null;
        });
        return row;
      });

      const inserted = await insert('matches', matchRows);
      allInsertedMatches.push(...inserted);

      // Build substitution records
      matches.forEach((m, idx) => {
        const players = [...m.team1, ...m.team2];
        const matchId = inserted[idx].id;
        players.forEach((p, si) => {
          if (p && p.isSub) {
            allSubRows.push({
              match_id: matchId,
              player_slot: SLOTS[si],
              original_player: p.originalPlayer,
              substitute_player: p.actual,
            });
          }
        });
      });
    }
  }

  // 6. SUBSTITUTIONS from schedule CSV
  console.log('6. Inserting substitutions from schedule CSV...');
  if (allSubRows.length > 0) {
    await insert('substitutions', allSubRows);
  }

  // 7. SPRING 2026 WEEK 1 PLAYER POINTS (from scores CSV)
  console.log('7. Inserting Spring 2026 Week 1 player points...');
  const scoresData = parseScoresCSV('/Users/connor/Downloads/Pickleball Availability - S26 Scores.csv');
  const s26PointRows = [];
  for (const [player, weeks] of Object.entries(scoresData)) {
    for (const [weekNum, pts] of Object.entries(weeks)) {
      s26PointRows.push({
        player_name: player,
        season_id: s26.id,
        week_number: parseInt(weekNum),
        points: pts,
      });
    }
  }
  if (s26PointRows.length > 0) {
    await insert('player_points', s26PointRows);
  }

  // 8. SPRING 2025 HISTORICAL POINTS
  console.log('8. Inserting Spring 2025 player points...');
  const s25Points = {
    'Connor Schaars': [2.5,5.5,6,6,1,5,6,5.5],
    'Rob Lodge': [6,5.5,2,1.5,7,6,2,5.5],
    'Sandeep Ammula': [1,6,4,5,4.5,0,7,6.5],
    'Quinton Baugh': [0,5.5,5.5,5.5,5,5,0,6],
    'Randy Calvert': [4,0,0,5.5,5.5,2.5,4.5,5],
    'Nathan Amburn': [0,7,1.5,6,5.5,0,0,5.5],
    'Clint Curtis': [0,5.5,5,5.5,1,3,0,5],
    'Kenneth Morris': [0,0.5,1.5,1,4.5,5,6,6],
    'Truman Spencer': [0,6,0,5.5,0,1,5.5,5],
    'David Ames': [2.5,5.5,0,6,5.5,0,3,0.5],
    'Earl Haeg': [0,4,4.5,4.5,2,0,6.5,1],
    'Jon Heydrick': [6,6,5.5,0.5,4.5,0,0,0],
    'Trey Lopez': [6,5,4.5,0,1,4.5,0,0.5],
    'Gabe Boyd': [0.5,0,5.5,6,0,1,6.5,1.5],
    'Caleb Sensel': [0.5,5.5,1.5,5,1,3.5,0,3],
    'Jarratt Calvert': [2.5,0,1.5,5.5,4.5,1,1,1],
    'James Anderson': [0,0,0,0,5.5,4,7,0],
    'Stancy Abraham': [0,1,1,5,1.5,6,0,1.5],
    'Ben Hangartner': [0.5,5,0.5,0,5.5,4.5,0,0],
    'Marty Lisenby': [0,0,1,5.5,4.5,3,1,0],
    'Garrett Simpson': [0,5,5.5,0,0.5,2,1,0.5],
    'Lew Kennedy': [0.5,5.5,0,5.5,0,3,0,0],
    'Ryan Amburn': [0,0,5,0,5.5,0,3,0.5],
    'Bryan Urroz': [0,0,6,0.5,0,1,0,6],
    'Stephen Sensel': [4.5,1,0,0.5,1,4,1,1.5],
    'Pat Hunn': [1,5,0,1,5.5,0.5,0,0.5],
    'Casey Gaffney': [2.5,6,5,0,0,0,0,0],
    'Josh Drury': [0,0,0,0.5,5.5,3,4.5,0],
    'Collin Couch': [0,0,0,5.5,0,3,5,0],
    'Jorden Dial': [0,0.5,1,0,5.5,0,0,5.5],
    'Mike Lamb': [0,5,0,0,5.5,0,0,1.5],
    'Bobby Most': [0,1,0,1,0,0,5.5,4],
    'Jared Draper': [2.5,0,1.5,1,0,0,5.5,0],
    'Chase Wiatrek': [0.5,0,5.5,1,0,0,0,2.5],
    'Jim Bridges': [0,0,0,1,1,0,5.5,1],
    "Evin O'Sullivan": [0,0,0,0,1,1,0,5.5],
    'Max Gilbert': [4,0,0,0,0,0,0,0],
    'Aaron Prentice': [0.5,0,0,1,1,0,0,0],
    'Scott Cameron': [0.5,0,0,0,0,0,0,1],
    'Jason Bobbitt': [0,0,0,0.5,0,0,0,0],
    'David Seay': [0,0,0,0,0,0,0,0.5],
    'Collin Hunn': [0,0,0,0,0,0,0,0],
    'Travis Labhart': [0,0,0,0,0,0,0,0],
    'Matthew Peterson': [0,0,0,0,0,0,0,0],
    'Michael Robbins': [0,0,0,0,0,0,0,0],
  };

  const pointRows = [];
  for (const [player, weeks] of Object.entries(s25Points)) {
    weeks.forEach((pts, i) => {
      pointRows.push({
        player_name: player,
        season_id: s25.id,
        week_number: i + 1,
        points: pts,
      });
    });
  }
  for (let i = 0; i < pointRows.length; i += 50) {
    const batch = pointRows.slice(i, i + 50);
    await insert('player_points', batch);
  }
  console.log(`  Total S25 point rows: ${pointRows.length}`);

  console.log('\n=== MIGRATION COMPLETE ===\n');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
