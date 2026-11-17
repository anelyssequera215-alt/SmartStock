BEGIN;

CREATE TABLE roles (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
        CHECK (name IN ('admin', 'warehouse', 'cashier'))
);

INSERT INTO roles (name) VALUES
    ('admin'),
    ('warehouse'),
    ('cashier');

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    tax_id TEXT UNIQUE,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE CHECK (length(trim(reference)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category_id BIGINT REFERENCES categories(id) ON DELETE RESTRICT,
    price NUMERIC(14, 2) NOT NULL CHECK (price >= 0),
    minimum_stock NUMERIC(14, 3) NOT NULL DEFAULT 0
        CHECK (minimum_stock >= 0),
    stock_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0
        CHECK (stock_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_invoices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL CHECK (length(trim(invoice_number)) > 0),
    issued_at TIMESTAMPTZ NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, invoice_number)
);

CREATE TABLE purchase_invoice_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_invoice_id BIGINT NOT NULL
        REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(14, 2) NOT NULL CHECK (unit_cost >= 0),
    UNIQUE (purchase_invoice_id, product_id)
);

CREATE TABLE sales (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    sold_at TIMESTAMPTZ,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'draft' AND sold_at IS NULL)
        OR (status IN ('confirmed', 'cancelled') AND sold_at IS NOT NULL)
    )
);

CREATE TABLE sale_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
    UNIQUE (sale_id, product_id)
);

CREATE TABLE waste_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    responsible_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE waste_record_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    waste_record_id BIGINT NOT NULL REFERENCES waste_records(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    UNIQUE (waste_record_id, product_id)
);

CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE stock_movements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN ('purchase', 'sale', 'waste', 'adjustment')),
    quantity_delta NUMERIC(14, 3) NOT NULL CHECK (quantity_delta <> 0),
    purchase_invoice_item_id BIGINT UNIQUE
        REFERENCES purchase_invoice_items(id) ON DELETE RESTRICT,
    sale_item_id BIGINT UNIQUE
        REFERENCES sale_items(id) ON DELETE RESTRICT,
    waste_record_item_id BIGINT UNIQUE
        REFERENCES waste_record_items(id) ON DELETE RESTRICT,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (movement_type = 'purchase'
            AND quantity_delta > 0
            AND purchase_invoice_item_id IS NOT NULL
            AND sale_item_id IS NULL
            AND waste_record_item_id IS NULL)
        OR (movement_type = 'sale'
            AND quantity_delta < 0
            AND purchase_invoice_item_id IS NULL
            AND sale_item_id IS NOT NULL
            AND waste_record_item_id IS NULL)
        OR (movement_type = 'waste'
            AND quantity_delta < 0
            AND purchase_invoice_item_id IS NULL
            AND sale_item_id IS NULL
            AND waste_record_item_id IS NOT NULL)
        OR (movement_type = 'adjustment'
            AND purchase_invoice_item_id IS NULL
            AND sale_item_id IS NULL
            AND waste_record_item_id IS NULL)
    )
);

CREATE INDEX products_name_search_idx ON products (lower(name));
CREATE INDEX products_stock_alert_idx ON products (stock_quantity, minimum_stock)
    WHERE is_active;
CREATE INDEX purchase_invoices_issued_at_idx ON purchase_invoices (issued_at);
CREATE INDEX sales_sold_at_idx ON sales (sold_at) WHERE status = 'confirmed';
CREATE INDEX stock_movements_product_created_idx
    ON stock_movements (product_id, created_at DESC);
CREATE INDEX audit_logs_occurred_at_idx ON audit_logs (occurred_at DESC);

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION protect_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.stock_quantity <> 0 THEN
        RAISE EXCEPTION 'Initial stock must be recorded as a stock movement';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
       AND current_setting('app.applying_stock_movement', TRUE) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Stock can only be changed by recording a stock movement';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER products_protect_stock
BEFORE INSERT OR UPDATE OF stock_quantity ON products
FOR EACH ROW EXECUTE FUNCTION protect_product_stock();

CREATE FUNCTION write_immutable_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit log records cannot be changed or deleted';
END;
$$;

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION write_immutable_audit_log();

CREATE FUNCTION prevent_moved_item_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (TG_TABLE_NAME = 'purchase_invoice_items'
        AND EXISTS (
            SELECT 1 FROM stock_movements
            WHERE purchase_invoice_item_id = OLD.id
        ))
       OR (TG_TABLE_NAME = 'sale_items'
        AND EXISTS (
            SELECT 1 FROM stock_movements WHERE sale_item_id = OLD.id
        ))
       OR (TG_TABLE_NAME = 'waste_record_items'
        AND EXISTS (
            SELECT 1 FROM stock_movements
            WHERE waste_record_item_id = OLD.id
        )) THEN
        RAISE EXCEPTION 'An item with a stock movement cannot be changed or deleted';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_invoice_items_protect_moved
BEFORE UPDATE OR DELETE ON purchase_invoice_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();

CREATE TRIGGER sale_items_protect_moved
BEFORE UPDATE OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();

CREATE TRIGGER waste_record_items_protect_moved
BEFORE UPDATE OR DELETE ON waste_record_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();

CREATE FUNCTION write_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    item_product_id BIGINT;
    item_quantity NUMERIC(14, 3);
    previous_guard TEXT;
    affected_rows INTEGER;
BEGIN
    IF NEW.movement_type = 'purchase' THEN
        SELECT product_id, quantity INTO item_product_id, item_quantity
        FROM purchase_invoice_items WHERE id = NEW.purchase_invoice_item_id
        FOR UPDATE;
        IF item_product_id IS DISTINCT FROM NEW.product_id
           OR item_quantity IS DISTINCT FROM NEW.quantity_delta THEN
            RAISE EXCEPTION 'Purchase movement does not match its invoice item';
        END IF;
    ELSIF NEW.movement_type = 'sale' THEN
        SELECT product_id, quantity INTO item_product_id, item_quantity
        FROM sale_items WHERE id = NEW.sale_item_id
        FOR UPDATE;
        IF item_product_id IS DISTINCT FROM NEW.product_id
           OR -item_quantity IS DISTINCT FROM NEW.quantity_delta THEN
            RAISE EXCEPTION 'Sale movement does not match its sale item';
        END IF;
    ELSIF NEW.movement_type = 'waste' THEN
        SELECT product_id, quantity INTO item_product_id, item_quantity
        FROM waste_record_items WHERE id = NEW.waste_record_item_id
        FOR UPDATE;
        IF item_product_id IS DISTINCT FROM NEW.product_id
           OR -item_quantity IS DISTINCT FROM NEW.quantity_delta THEN
            RAISE EXCEPTION 'Waste movement does not match its waste item';
        END IF;
    END IF;

    previous_guard := current_setting('app.applying_stock_movement', TRUE);
    PERFORM set_config('app.applying_stock_movement', 'true', TRUE);
    UPDATE products
    SET stock_quantity = stock_quantity + NEW.quantity_delta
    WHERE id = NEW.product_id
      AND stock_quantity + NEW.quantity_delta >= 0;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    PERFORM set_config(
        'app.applying_stock_movement',
        COALESCE(previous_guard, ''),
        TRUE
    );

    IF affected_rows = 0 THEN
        RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id;
    END IF;

    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES (
        NEW.created_by,
        CASE NEW.movement_type
            WHEN 'adjustment' THEN 'stock.adjusted'
            ELSE 'stock.' || NEW.movement_type
        END,
        'stock_movement',
        NEW.id,
        jsonb_build_object(
            'product_id', NEW.product_id,
            'quantity_delta', NEW.quantity_delta,
            'movement_type', NEW.movement_type
        )
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_apply
AFTER INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION write_stock_movement();

CREATE FUNCTION prevent_stock_movement_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Stock movements cannot be changed or deleted';
END;
$$;

CREATE TRIGGER stock_movements_immutable
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_changes();

CREATE FUNCTION audit_product_price_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    actor_id BIGINT;
BEGIN
    IF NEW.price IS DISTINCT FROM OLD.price THEN
        actor_id := NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT;
        IF actor_id IS NULL THEN
            RAISE EXCEPTION 'Set app.user_id before changing a product price';
        END IF;

        INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
        VALUES (
            actor_id,
            'product.price_changed',
            'product',
            NEW.id,
            jsonb_build_object('old_price', OLD.price, 'new_price', NEW.price)
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER products_audit_price_changes
AFTER UPDATE OF price ON products
FOR EACH ROW EXECUTE FUNCTION audit_product_price_changes();

COMMENT ON COLUMN products.stock_quantity IS
    'Maintained only by stock_movements; all initial stock must be entered as an adjustment.';
COMMENT ON TABLE audit_logs IS
    'Append-only audit history. Set transaction-local app.user_id for audited price changes.';

COMMIT;
