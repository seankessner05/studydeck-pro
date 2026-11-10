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
  {
    version: 4,
    name: "study: quiz questions, runs and answers",
    sql: `
      CREATE TABLE questions (
        id           TEXT PRIMARY KEY,
        course       TEXT NOT NULL,
        note_id      TEXT,                          -- "COURSE/file.md" the question came from
        section      TEXT,                          -- heading inside the note: the question's topic
        kind         TEXT NOT NULL,                 -- single | multi | tf
        stem         TEXT NOT NULL,
        options      TEXT NOT NULL,                 -- JSON array of option texts, in the order they are shown
        answer       TEXT NOT NULL,                 -- JSON array of the correct option indexes
        explanation  TEXT NOT NULL,
        quote        TEXT,                          -- verbatim receipt from the note
        note_version TEXT,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_questions_course ON questions (course);
      CREATE INDEX idx_questions_note   ON questions (note_id);

      CREATE TABLE quiz_runs (
        id          TEXT PRIMARY KEY,
        course      TEXT NOT NULL,                  -- a class, or "all"
        started_at  INTEGER NOT NULL,
        finished_at INTEGER,
        total       INTEGER NOT NULL
      );

      CREATE TABLE quiz_answers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT NOT NULL REFERENCES quiz_runs (id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
        course      TEXT NOT NULL,
        section     TEXT,
        picked      TEXT NOT NULL,                  -- JSON array of the option indexes chosen
        correct     INTEGER NOT NULL,
        attempt     INTEGER NOT NULL,               -- 1 = first try in this run; 2+ = asked again after a miss
        answered_at INTEGER NOT NULL,
        ms_taken    INTEGER
      );
      CREATE INDEX idx_qa_question ON quiz_answers (question_id, answered_at);
      CREATE INDEX idx_qa_time     ON quiz_answers (answered_at);
      CREATE INDEX idx_qa_run      ON quiz_answers (run_id);

      -- Which version of each lecture has been turned into questions, even when none were kept.
      CREATE TABLE question_gen_log (
        note_id      TEXT NOT NULL,
        note_version TEXT NOT NULL,
        at           INTEGER NOT NULL,
        created      INTEGER NOT NULL,
        calls        INTEGER NOT NULL,
        PRIMARY KEY (note_id, note_version)
      );
    `,
  },
  {
    version: 5,
    name: "study: practice problems and attempts",
    sql: `
      CREATE TABLE problems (
        id           TEXT PRIMARY KEY,
        course       TEXT NOT NULL,
        note_id      TEXT,
        section      TEXT,
        stem         TEXT NOT NULL,
        givens       TEXT NOT NULL,                 -- JSON [{name, value, label}]
        steps        TEXT NOT NULL,                 -- JSON [{name, label, expr, explain, value}] with values computed by the app
        unit         TEXT NOT NULL DEFAULT '',
        difficulty   INTEGER NOT NULL,              -- 1 easy, 2 medium, 3 hard (by number of steps)
        answer       REAL NOT NULL,                 -- the last step's computed value
        quote        TEXT,
        note_version TEXT,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_problems_course ON problems (course);
      CREATE INDEX idx_problems_note   ON problems (note_id);

      CREATE TABLE problem_attempts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id  TEXT NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
        run_id      TEXT NOT NULL,
        course      TEXT NOT NULL,
        section     TEXT,
        submitted   REAL,                           -- null when the student gave up
        correct     INTEGER NOT NULL,
        hinted      INTEGER NOT NULL DEFAULT 0,     -- 1 if the hint was opened first: a success with help counts for less
        attempt     INTEGER NOT NULL,               -- 1 = first try in this run
        answered_at INTEGER NOT NULL,
        ms_taken    INTEGER
      );
      CREATE INDEX idx_pa_problem ON problem_attempts (problem_id, answered_at);
      CREATE INDEX idx_pa_time    ON problem_attempts (answered_at);
      CREATE INDEX idx_pa_run     ON problem_attempts (run_id);

      CREATE TABLE problem_gen_log (
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
