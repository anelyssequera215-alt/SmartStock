BEGIN;

CREATE TABLE companies (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
    nit TEXT NOT NULL UNIQUE CHECK (length(trim(nit)) > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER companies_set_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id BIGINT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE RESTRICT,
    plan_code TEXT NOT NULL CHECK (plan_code = 'complete_monthly'),
    amount_cop INTEGER NOT NULL DEFAULT 69900 CHECK (amount_cop = 69900),
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid')),
    access_status TEXT NOT NULL DEFAULT 'active' CHECK (access_status = 'active'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO companies (legal_name, nit)
VALUES ('SmartStock (Legacy)', 'LEGACY-SMARTSTOCK')
RETURNING id;

ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles
    ADD CONSTRAINT roles_name_check
    CHECK (name IN ('admin', 'warehouse', 'cashier', 'customer', 'platform_admin'));
INSERT INTO roles (name) VALUES ('platform_admin') ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE categories ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE suppliers ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE products ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE purchase_invoices ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE purchase_invoice_items ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE sales ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE sale_items ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE waste_records ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE waste_record_items ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE audit_logs ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE stock_movements ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE customer_orders ADD COLUMN company_id BIGINT REFERENCES companies(id);
ALTER TABLE customer_order_items ADD COLUMN company_id BIGINT REFERENCES companies(id);

DROP TRIGGER audit_logs_immutable ON audit_logs;
DROP TRIGGER stock_movements_immutable ON stock_movements;
DROP TRIGGER purchase_invoice_items_protect_moved ON purchase_invoice_items;
DROP TRIGGER sale_items_protect_moved ON sale_items;
DROP TRIGGER waste_record_items_protect_moved ON waste_record_items;
DROP TRIGGER waste_records_protect_moved ON waste_records;
DROP TRIGGER users_set_updated_at ON users;
DROP TRIGGER products_set_updated_at ON products;
DROP TRIGGER customer_orders_set_updated_at ON customer_orders;

DO $$
DECLARE
    legacy_company_id BIGINT;
BEGIN
    SELECT id INTO STRICT legacy_company_id
    FROM companies WHERE nit = 'LEGACY-SMARTSTOCK';

    INSERT INTO subscriptions (company_id, plan_code, payment_status)
    VALUES (legacy_company_id, 'complete_monthly', 'pending');

    UPDATE users SET company_id = legacy_company_id;
    UPDATE categories SET company_id = legacy_company_id;
    UPDATE suppliers SET company_id = legacy_company_id;
    UPDATE products SET company_id = legacy_company_id;
    UPDATE purchase_invoices SET company_id = legacy_company_id;
    UPDATE purchase_invoice_items SET company_id = legacy_company_id;
    UPDATE sales SET company_id = legacy_company_id;
    UPDATE sale_items SET company_id = legacy_company_id;
    UPDATE waste_records SET company_id = legacy_company_id;
    UPDATE waste_record_items SET company_id = legacy_company_id;
    UPDATE audit_logs SET company_id = legacy_company_id;
    UPDATE stock_movements SET company_id = legacy_company_id;
    UPDATE customer_orders SET company_id = legacy_company_id;
    UPDATE customer_order_items SET company_id = legacy_company_id;
END;
$$;

UPDATE users
SET is_active = FALSE, auth_version = auth_version + 1
WHERE id IN (
    SELECT ur.user_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE r.name = 'customer'
);

ALTER TABLE categories ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE purchase_invoices ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE purchase_invoice_items ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sales ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sale_items ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE waste_records ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE waste_record_items ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE customer_orders ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE customer_order_items ALTER COLUMN company_id SET NOT NULL;

WITH duplicates AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY company_id, lower(name)
               ORDER BY id
           ) AS canonical_id
    FROM categories
)
UPDATE products p
SET category_id = duplicates.canonical_id
FROM duplicates
WHERE p.category_id = duplicates.id
  AND duplicates.id <> duplicates.canonical_id;

WITH duplicates AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY company_id, lower(name)
               ORDER BY id
           ) AS canonical_id
    FROM categories
)
DELETE FROM categories c
USING duplicates
WHERE c.id = duplicates.id
  AND duplicates.id <> duplicates.canonical_id;

ALTER TABLE categories DROP CONSTRAINT categories_name_key;
CREATE UNIQUE INDEX categories_company_name_uidx
    ON categories (company_id, lower(name));
ALTER TABLE users ADD CONSTRAINT users_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE companies ADD COLUMN owner_user_id BIGINT;
UPDATE companies c
SET owner_user_id = (
    SELECT u.id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE u.company_id = c.id AND r.name = 'admin'
    ORDER BY u.created_at, u.id
    LIMIT 1
);
ALTER TABLE companies ADD CONSTRAINT companies_owner_company_user_fk
    FOREIGN KEY (id, owner_user_id) REFERENCES users(company_id, id);

CREATE TABLE platform_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action = 'subscription.payment_status_updated'),
    previous_payment_status TEXT NOT NULL CHECK (previous_payment_status IN ('pending', 'paid')),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_logs_company_occurred_idx
    ON platform_audit_logs (company_id, occurred_at DESC);
ALTER TABLE categories ADD CONSTRAINT categories_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE products ADD CONSTRAINT products_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE purchase_invoice_items ADD CONSTRAINT purchase_invoice_items_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE sales ADD CONSTRAINT sales_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE waste_records ADD CONSTRAINT waste_records_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE waste_record_items ADD CONSTRAINT waste_record_items_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE products DROP CONSTRAINT products_reference_key;
DROP INDEX IF EXISTS products_reference_case_insensitive_uidx;
CREATE UNIQUE INDEX products_company_reference_uidx
    ON products (company_id, lower(reference));
ALTER TABLE suppliers DROP CONSTRAINT suppliers_tax_id_key;
CREATE UNIQUE INDEX suppliers_company_tax_id_uidx
    ON suppliers (company_id, tax_id) WHERE tax_id IS NOT NULL;
ALTER TABLE sales DROP CONSTRAINT sales_idempotency_key_key;
CREATE UNIQUE INDEX sales_company_idempotency_key_uidx
    ON sales (company_id, idempotency_key);

ALTER TABLE products ADD CONSTRAINT products_company_category_fk
    FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_company_supplier_fk
    FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers(company_id, id);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_company_creator_fk
    FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id);
ALTER TABLE purchase_invoice_items ADD CONSTRAINT purchase_items_company_invoice_fk
    FOREIGN KEY (company_id, purchase_invoice_id) REFERENCES purchase_invoices(company_id, id);
ALTER TABLE purchase_invoice_items ADD CONSTRAINT purchase_items_company_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id);
ALTER TABLE sales ADD CONSTRAINT sales_company_creator_fk
    FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_company_sale_fk
    FOREIGN KEY (company_id, sale_id) REFERENCES sales(company_id, id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_company_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id);
ALTER TABLE waste_records ADD CONSTRAINT wastes_company_responsible_fk
    FOREIGN KEY (company_id, responsible_user_id) REFERENCES users(company_id, id);
ALTER TABLE waste_records ADD CONSTRAINT wastes_company_creator_fk
    FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id);
ALTER TABLE waste_record_items ADD CONSTRAINT waste_items_company_record_fk
    FOREIGN KEY (company_id, waste_record_id) REFERENCES waste_records(company_id, id);
ALTER TABLE waste_record_items ADD CONSTRAINT waste_items_company_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_company_actor_fk
    FOREIGN KEY (company_id, actor_user_id) REFERENCES users(company_id, id);
ALTER TABLE stock_movements ADD CONSTRAINT movements_company_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id);
ALTER TABLE stock_movements ADD CONSTRAINT movements_company_creator_fk
    FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id);
ALTER TABLE stock_movements ADD CONSTRAINT movements_company_purchase_item_fk
    FOREIGN KEY (company_id, purchase_invoice_item_id) REFERENCES purchase_invoice_items(company_id, id);
ALTER TABLE stock_movements ADD CONSTRAINT movements_company_sale_item_fk
    FOREIGN KEY (company_id, sale_item_id) REFERENCES sale_items(company_id, id);
ALTER TABLE stock_movements ADD CONSTRAINT movements_company_waste_item_fk
    FOREIGN KEY (company_id, waste_record_item_id) REFERENCES waste_record_items(company_id, id);
ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_company_customer_fk
    FOREIGN KEY (company_id, customer_user_id) REFERENCES users(company_id, id);
ALTER TABLE customer_order_items ADD CONSTRAINT customer_items_company_order_fk
    FOREIGN KEY (company_id, customer_order_id) REFERENCES customer_orders(company_id, id);
ALTER TABLE customer_order_items ADD CONSTRAINT customer_items_company_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id);

CREATE INDEX users_company_created_idx ON users (company_id, created_at DESC);
CREATE INDEX products_company_active_idx ON products (company_id, is_active, name);
CREATE INDEX sales_company_sold_at_idx ON sales (company_id, sold_at DESC)
    WHERE status = 'confirmed';
CREATE INDEX audit_logs_company_occurred_idx ON audit_logs (company_id, occurred_at DESC);
CREATE INDEX movements_company_created_idx ON stock_movements (company_id, created_at DESC);

CREATE FUNCTION set_audit_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        SELECT company_id INTO NEW.company_id
        FROM users WHERE id = NEW.actor_user_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER audit_logs_set_company_id
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION set_audit_company_id();

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION write_immutable_audit_log();
CREATE TRIGGER stock_movements_immutable
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_changes();
CREATE TRIGGER purchase_invoice_items_protect_moved
BEFORE UPDATE OR DELETE ON purchase_invoice_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();
CREATE TRIGGER sale_items_protect_moved
BEFORE UPDATE OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();
CREATE TRIGGER waste_record_items_protect_moved
BEFORE UPDATE OR DELETE ON waste_record_items
FOR EACH ROW EXECUTE FUNCTION prevent_moved_item_changes();
CREATE TRIGGER waste_records_protect_moved
BEFORE UPDATE OR DELETE ON waste_records
FOR EACH ROW EXECUTE FUNCTION prevent_moved_waste_record_changes();
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customer_orders_set_updated_at
BEFORE UPDATE ON customer_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
