-- Add mood columns to track_features (idempotent)
DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_happy REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_sad REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_aggressive REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_relaxed REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_party REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN voice_instrumental REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN mood_acoustic REAL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
