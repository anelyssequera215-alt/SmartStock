BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS products_reference_case_insensitive_uidx
    ON products (lower(reference));

COMMIT;
