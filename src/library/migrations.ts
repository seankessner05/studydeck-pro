export interface Migration {
  /** 1, 2, 3, … with no gaps. Never edit a migration that has shipped; add a new one. */
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "meta table",
    sql: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO meta (key, value) VALUES ('created_at', datetime('now'));
    `,
  },
  {
    version: 2,
    name: "study: cards, reviews, AI usage",
    sql: `
      CREATE TABLE cards (
        id           TEXT PRIMARY KEY,
        course       TEXT NOT NULL,
        note_id      TEXT,                          -- "COURSE/file.md" the card came from (null for hand-made cards)
        section      TEXT,                          -- heading inside the note: the card's topic
        front        TEXT NOT NULL,
        back         TEXT NOT NULL,
        quote        TEXT,                          -- verbatim receipt from the note
        origin       TEXT NOT NULL DEFAULT 'manual',-- manual | generated
        note_version TEXT,                          -- the note's granola_updated_at when generated (stale detection)
        fsrs         TEXT NOT NULL,                 -- the scheduler's card state as JSON
        due          INTEGER NOT NULL,              -- ms epoch, copied out of fsrs for fast queries
        state        INTEGER NOT NULL DEFAULT 0,    -- 0 new, 1 learning, 2 review, 3 relearning
        reps         INTEGER NOT NULL DEFAULT 0,
        lapses       INTEGER NOT NULL DEFAULT 0,
        suspended    INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_cards_due  ON cards (course, suspended, state, due);
      CREATE INDEX idx_cards_note ON cards (note_id);

      CREATE TABLE reviews (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id        TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
        course         TEXT NOT NULL,
        grade          INTEGER NOT NULL,            -- 1 again, 2 hard, 3 good, 4 easy
        state_before   INTEGER NOT NULL,
        reviewed_at    INTEGER NOT NULL,            -- ms epoch
        scheduled_days REAL NOT NULL,               -- the interval that was scheduled
        ms_taken       INTEGER
      );
      CREATE INDEX idx_reviews_time   ON reviews (reviewed_at);
      CREATE INDEX idx_reviews_course ON reviews (course, reviewed_at);

      CREATE TABLE ai_usage (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       INTEGER NOT NULL,                  -- ms epoch
        kind     TEXT NOT NULL,                     -- chat | cards | quiz | problems | exam | cheatsheet
        calls    INTEGER NOT NULL DEFAULT 1,
        cost_usd REAL NOT NULL DEFAULT 0            -- what Claude reports at API rates; not a charge on a subscription
      );
      CREATE INDEX idx_usage_time ON ai_usage (at);
    `,
  },
  {
    version: 3,
    name: "study: card generation log",
    sql: `
      -- Which version of each lecture has been turned into cards, even when no new cards resulted.
      CREATE TABLE gen_log (
        note_id      TEXT NOT NULL,
        note_version TEXT NOT NULL,
        at           INTEGER NOT NULL,
        created      INTEGER NOT NULL,
        calls        INTEGER NOT NULL,
        PRIMARY KEY (note_id, note_version)
      );
    `,
  },
];
