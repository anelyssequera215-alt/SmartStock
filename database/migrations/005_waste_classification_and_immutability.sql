BEGIN;

ALTER TABLE waste_records
    ADD COLUMN waste_type TEXT NOT NULL DEFAULT 'other'
        CHECK (waste_type IN ('damage', 'expiry', 'other'));

CREATE FUNCTION prevent_moved_waste_record_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM waste_record_items wri
        JOIN stock_movements sm ON sm.waste_record_item_id = wri.id
        WHERE wri.waste_record_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'A waste record with stock movements cannot be changed or deleted';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER waste_records_protect_moved
BEFORE UPDATE OR DELETE ON waste_records
FOR EACH ROW EXECUTE FUNCTION prevent_moved_waste_record_changes();

COMMIT;
