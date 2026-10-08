CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cards (
  id BIGSERIAL PRIMARY KEY,

  dpla_id TEXT UNIQUE NOT NULL,
  nypl_uuid TEXT UNIQUE NOT NULL,

  title TEXT NOT NULL,

  front_image_id TEXT NOT NULL,
  back_image_id TEXT,

  source_url TEXT NOT NULL,
  rights TEXT,

  display_eligible BOOLEAN NOT NULL,

  embedding VECTOR(768) NOT NULL
);