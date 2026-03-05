DROP TABLE IF EXISTS player_points CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS availability CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;

CREATE TABLE seasons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  day_of_week TEXT NOT NULL,
  week_number INTEGER,
  is_tournament BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, session_date)
);

CREATE TABLE availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL REFERENCES players(name) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  time_slots TEXT[] NOT NULL DEFAULT '{7pm,8pm,9pm}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_name, session_id)
);

CREATE TABLE matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  match_number INTEGER NOT NULL,
  time_slot TEXT,
  team1_player1 TEXT NOT NULL,
  team1_player2 TEXT NOT NULL,
  team2_player1 TEXT NOT NULL,
  team2_player2 TEXT NOT NULL,
  score_team1 NUMERIC(4,1),
  score_team2 NUMERIC(4,1),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE substitutions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  original_player TEXT NOT NULL REFERENCES players(name) ON DELETE CASCADE,
  substitute_player TEXT NOT NULL REFERENCES players(name) ON DELETE CASCADE,
  player_slot TEXT NOT NULL,  -- 'team1_player1', 'team1_player2', etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(match_id, player_slot)
);

CREATE TABLE player_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL REFERENCES players(name) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  points NUMERIC(4,1) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_name, season_id, week_number)
);

ALTER PUBLICATION supabase_realtime ADD TABLE seasons;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE availability;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE substitutions;
ALTER PUBLICATION supabase_realtime ADD TABLE player_points;

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON seasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON availability FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON matches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON substitutions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON player_points FOR ALL USING (true) WITH CHECK (true);
