BEGIN;

ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles
    ADD CONSTRAINT roles_name_check
    CHECK (name IN ('admin', 'warehouse', 'cashier', 'customer'));

INSERT INTO roles (name) VALUES ('customer');

CREATE TABLE customer_orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_order_id BIGINT NOT NULL
        REFERENCES customer_orders(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
    UNIQUE (customer_order_id, product_id)
);

ALTER TABLE sales
    ADD COLUMN customer_order_id BIGINT UNIQUE
        REFERENCES customer_orders(id) ON DELETE RESTRICT;

CREATE INDEX customer_orders_customer_created_idx
    ON customer_orders (customer_user_id, created_at DESC);
CREATE INDEX customer_orders_status_created_idx
    ON customer_orders (status, created_at ASC);
CREATE INDEX customer_order_items_order_idx
    ON customer_order_items (customer_order_id, id);

CREATE TRIGGER customer_orders_set_updated_at
BEFORE UPDATE ON customer_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
