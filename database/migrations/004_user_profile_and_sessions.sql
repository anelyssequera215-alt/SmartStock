BEGIN;

ALTER TABLE users
    ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0
        CHECK (auth_version >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_case_insensitive_uidx
    ON users (lower(email));

COMMIT;
