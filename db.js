// Обязательно импортируем Pool из библиотеки pg
const { Pool } = require('pg');
const { config } = require('./config/app-config');

// Теперь можно использовать Pool
const pool = new Pool({
  connectionString: config.db.connectionString,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  options: `-c statement_timeout=${config.db.statementTimeoutMs}`
});

const createTables = async () => {
  // Создаём таблицы, если они не существуют, без удаления существующих данных

  // Обновленная таблица клиентов
  const clientsQuery = `
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(255) NOT NULL,
      address TEXT,
      inn VARCHAR(20),
      type VARCHAR(20) NOT NULL CHECK (type IN ('Физлицо', 'Юрлицо'))
    );
  `;

  // Таблица сотрудников
  const employeesQuery = `
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      position VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(255) NOT NULL,
      hire_date DATE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `;

  // Таблица инвентаря
  const inventoryQuery = `
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT,
      quantity INTEGER,
      quantity_pending_writeoff INTEGER DEFAULT 0,
      type TEXT DEFAULT 'asset' CHECK (type IN ('asset', 'consumable')),
      requires_purchase BOOLEAN DEFAULT FALSE,
      lifespan INTEGER,
      balance_date DATE,
      image TEXT,
      rentalstatus TEXT,
      status TEXT DEFAULT 'В наличии',
      status_reason TEXT,
      planned_return_date TIMESTAMP,
      writeoff_reason TEXT,
      writeoff_date TIMESTAMP,
      writeoff_act_number TEXT,
      is_writeoff_marker BOOLEAN DEFAULT FALSE,
      source_item_id TEXT,
      category TEXT DEFAULT 'Склад',
      location TEXT,
      minstock INTEGER DEFAULT 0,
      description TEXT,
      info TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const inventoryHistoryQuery = `
    CREATE TABLE IF NOT EXISTS inventory_history (
      id SERIAL PRIMARY KEY,
      inventory_id TEXT NOT NULL,
      changed_by TEXT,
      change_type TEXT,
      old_value TEXT,
      new_value TEXT,
      field_name TEXT,
      change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const inventoryMovementsQuery = `
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id SERIAL PRIMARY KEY,
      inventory_id TEXT NOT NULL,
      item_name TEXT,
      category TEXT,
      operation_type TEXT,
      quantity INTEGER DEFAULT 0,
      responsible_name TEXT,
      source_location TEXT,
      destination_location TEXT,
      document_type TEXT,
      document_id INTEGER,
      document_label TEXT,
      document_url TEXT,
      operation_context TEXT,
      notes TEXT,
      created_by TEXT,
      operation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const purchaseRequestsQuery = `
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id SERIAL PRIMARY KEY,
      request_number TEXT NOT NULL,
      item_id TEXT REFERENCES inventory(id),
      item_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Черновик',
      source_type TEXT,
      source_id INTEGER,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const writeoffActsQuery = `
    CREATE TABLE IF NOT EXISTS writeoff_acts (
      id SERIAL PRIMARY KEY,
      public_id TEXT,
      act_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Черновик',
      act_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      posted_at TIMESTAMP,
      basis_type TEXT,
      basis_id INTEGER,
      basis_label TEXT,
      basis_name TEXT,
      basis_act_number TEXT,
      reason TEXT,
      signature TEXT,
      responsible_position TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const writeoffActItemsQuery = `
    CREATE TABLE IF NOT EXISTS writeoff_act_items (
      id SERIAL PRIMARY KEY,
      act_id INTEGER REFERENCES writeoff_acts(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES inventory(id),
      item_name TEXT,
      item_category TEXT,
      item_type TEXT,
      basis_type TEXT,
      basis_id TEXT,
      basis_label TEXT,
      basis_name TEXT,
      basis_act_number TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      reason_category TEXT,
      comment TEXT
    );
  `;

  const assetLifecycleHistoryQuery = `
    CREATE TABLE IF NOT EXISTS asset_lifecycle_history (
      id SERIAL PRIMARY KEY,
      item_id TEXT REFERENCES inventory(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL DEFAULT 'extend',
      before_lifespan INTEGER,
      after_lifespan INTEGER,
      before_end_date DATE,
      after_end_date DATE,
      reason TEXT,
      changed_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Обновленная таблица аренды
  const rentalsQuery = `
    CREATE TABLE IF NOT EXISTS rentals (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id),
      employee_id INTEGER REFERENCES employees(id),
      start_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Новая'
    );
  `;

  // Таблица позиций аренды
  const rentalItemsQuery = `
    CREATE TABLE IF NOT EXISTS rental_items (
      id SERIAL PRIMARY KEY,
      rental_id INTEGER REFERENCES rentals(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES inventory(id),
      category VARCHAR(100),
      quantity INTEGER NOT NULL,
      defective_quantity INTEGER NOT NULL DEFAULT 0,
      rent_price DECIMAL(10,2),
      external_source BOOLEAN NOT NULL DEFAULT FALSE,
      procurement_mode TEXT NOT NULL DEFAULT 'warehouse'
    );
  `;

  // Таблица мероприятий
  const eventsQuery = `
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      start_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NOT NULL,
      location VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'Планируется',
      employee_id INTEGER REFERENCES employees(id)
    );
  `;

  // Таблица позиций мероприятий
  const eventItemsQuery = `
    CREATE TABLE IF NOT EXISTS event_items (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES inventory(id),
      category VARCHAR(100),
      quantity INTEGER NOT NULL,
      defective_quantity INTEGER NOT NULL DEFAULT 0,
      transfer_date TIMESTAMP,
      return_date TIMESTAMP,
      return_status VARCHAR(50) DEFAULT 'Не возвращено',
      external_source BOOLEAN NOT NULL DEFAULT FALSE,
      procurement_mode TEXT NOT NULL DEFAULT 'warehouse'
    );
  `;

  const usersQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Кладовщик',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      custom_permissions JSONB,
      last_login TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(clientsQuery);
  await pool.query(employeesQuery);
  await pool.query(inventoryQuery);
  await pool.query(inventoryHistoryQuery);
  await pool.query(inventoryMovementsQuery);
  await pool.query(rentalsQuery);
  await pool.query(rentalItemsQuery);
  await pool.query(eventsQuery);
  await pool.query(eventItemsQuery);
  await pool.query(usersQuery);
  await pool.query(purchaseRequestsQuery);
  await pool.query(writeoffActsQuery);
  await pool.query(writeoffActItemsQuery);
  await pool.query(assetLifecycleHistoryQuery);

  // Таблица актов выдачи (документы проведения)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issuance_acts (
      id SERIAL PRIMARY KEY,
      act_number TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL CHECK (source_type IN ('rental', 'event')),
      source_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Проведен',
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      cancelled_at TIMESTAMP,
      cancelled_by TEXT
    );
  `);

  await pool.query(`
    ALTER TABLE rentals
      ADD COLUMN IF NOT EXISTS issuance_act_id INTEGER REFERENCES issuance_acts(id),
      ADD COLUMN IF NOT EXISTS issuance_act_number TEXT;
  `);

  await pool.query(`
    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS issuance_act_id INTEGER REFERENCES issuance_acts(id),
      ADD COLUMN IF NOT EXISTS issuance_act_number TEXT;
  `);

  await pool.query(`
    ALTER TABLE purchase_requests
      ADD COLUMN IF NOT EXISTS expected_date DATE,
      ADD COLUMN IF NOT EXISTS item_category TEXT;
  `);

  await pool.query(`
    ALTER TABLE purchase_requests
      ALTER COLUMN status SET DEFAULT 'Черновик';
  `);

  await pool.query(`
    UPDATE purchase_requests
    SET status = CASE
      WHEN LOWER(COALESCE(status, '')) IN ('новая', 'draft') THEN 'Черновик'
      WHEN LOWER(COALESCE(status, '')) IN ('в работе', 'agreed') THEN 'Согласована'
      WHEN LOWER(COALESCE(status, '')) IN ('закрыта', 'delivered') THEN 'Поставлена'
      ELSE status
    END
    WHERE status IS NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE writeoff_acts
      ADD COLUMN IF NOT EXISTS public_id TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Черновик',
      ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS basis_name TEXT,
      ADD COLUMN IF NOT EXISTS basis_act_number TEXT,
      ADD COLUMN IF NOT EXISTS responsible_position TEXT;
  `);

  await pool.query(`
    ALTER TABLE writeoff_act_items
      ADD COLUMN IF NOT EXISTS item_category TEXT,
      ADD COLUMN IF NOT EXISTS item_type TEXT,
      ADD COLUMN IF NOT EXISTS basis_type TEXT,
      ADD COLUMN IF NOT EXISTS basis_id TEXT,
      ADD COLUMN IF NOT EXISTS basis_label TEXT,
      ADD COLUMN IF NOT EXISTS basis_name TEXT,
      ADD COLUMN IF NOT EXISTS basis_act_number TEXT,
      ADD COLUMN IF NOT EXISTS reason_category TEXT,
      ADD COLUMN IF NOT EXISTS comment TEXT;
  `);

  // Нормализация: в системе должен быть только один черновик акта списания.
  await pool.query(`
    DO $$
    DECLARE
      keep_id INTEGER;
    BEGIN
      SELECT id INTO keep_id
      FROM writeoff_acts
      WHERE status = 'Черновик'
      ORDER BY created_at ASC, id ASC
      LIMIT 1;

      IF keep_id IS NOT NULL THEN
        UPDATE writeoff_act_items
        SET act_id = keep_id
        WHERE act_id IN (
          SELECT id
          FROM writeoff_acts
          WHERE status = 'Черновик'
            AND id <> keep_id
        );

        DELETE FROM writeoff_acts
        WHERE status = 'Черновик'
          AND id <> keep_id;
      END IF;
    END $$;
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_writeoff_acts_single_draft ON writeoff_acts ((status)) WHERE status = 'Черновик'`);

  await pool.query(`
    ALTER TABLE asset_lifecycle_history
      ADD COLUMN IF NOT EXISTS change_type TEXT NOT NULL DEFAULT 'extend',
      ADD COLUMN IF NOT EXISTS before_lifespan INTEGER,
      ADD COLUMN IF NOT EXISTS after_lifespan INTEGER,
      ADD COLUMN IF NOT EXISTS before_end_date DATE,
      ADD COLUMN IF NOT EXISTS after_end_date DATE,
      ADD COLUMN IF NOT EXISTS reason TEXT,
      ADD COLUMN IF NOT EXISTS changed_by TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Кладовщик',
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS custom_permissions JSONB,
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await pool.query(`
    ALTER TABLE inventory
      ADD COLUMN IF NOT EXISTS info TEXT,
      ADD COLUMN IF NOT EXISTS image TEXT,
      ADD COLUMN IF NOT EXISTS quantity_pending_writeoff INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'asset',
      ADD COLUMN IF NOT EXISTS requires_purchase BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS lifespan INTEGER,
      ADD COLUMN IF NOT EXISTS balance_date DATE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'В наличии',
      ADD COLUMN IF NOT EXISTS status_reason TEXT,
      ADD COLUMN IF NOT EXISTS planned_return_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS writeoff_reason TEXT,
        ADD COLUMN IF NOT EXISTS writeoff_date TIMESTAMP,
        ADD COLUMN IF NOT EXISTS writeoff_act_number TEXT,
        ADD COLUMN IF NOT EXISTS is_writeoff_marker BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS source_item_id TEXT REFERENCES inventory(id);
  `);

  await pool.query(`
    UPDATE inventory
    SET type = CASE
      WHEN LOWER(COALESCE(category, '')) LIKE '%расход%' THEN 'consumable'
      ELSE 'asset'
    END
    WHERE type IS NULL OR TRIM(type) = '';
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'inventory_type_check'
      ) THEN
        ALTER TABLE inventory
          ADD CONSTRAINT inventory_type_check CHECK (type IN ('asset', 'consumable'));
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE inventory
    SET status = COALESCE(NULLIF(TRIM(status), ''), 'В наличии')
    WHERE status IS NULL OR TRIM(status) = '';
  `);

  // Legacy migration: fold marker rows into source item pending_writeoff and remove marker duplicates.
  await pool.query(`
    WITH marker_sum AS (
      SELECT source_item_id, SUM(GREATEST(COALESCE(quantity, 0), 0))::int AS marker_qty
      FROM inventory
      WHERE COALESCE(is_writeoff_marker, FALSE) = TRUE
        AND source_item_id IS NOT NULL
      GROUP BY source_item_id
    )
    UPDATE inventory i
    SET quantity_pending_writeoff = GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0) + COALESCE(ms.marker_qty, 0),
        updated_at = CURRENT_TIMESTAMP
    FROM marker_sum ms
    WHERE i.id = ms.source_item_id
      AND COALESCE(i.is_writeoff_marker, FALSE) = FALSE;
  `);

  await pool.query(`
    UPDATE writeoff_act_items wai
    SET item_id = marker.source_item_id,
        item_name = COALESCE(source.name, wai.item_name)
    FROM inventory marker
    LEFT JOIN inventory source ON source.id = marker.source_item_id
    WHERE wai.item_id = marker.id
      AND COALESCE(marker.is_writeoff_marker, FALSE) = TRUE
      AND marker.source_item_id IS NOT NULL;
  `);

  await pool.query(`
    DELETE FROM inventory
    WHERE COALESCE(is_writeoff_marker, FALSE) = TRUE;
  `);

  await pool.query(`
    ALTER TABLE rental_items
      ADD COLUMN IF NOT EXISTS issue_condition VARCHAR(50) DEFAULT 'Хорошее',
      ADD COLUMN IF NOT EXISTS actual_condition VARCHAR(50) DEFAULT 'Хорошее',
      ADD COLUMN IF NOT EXISTS return_status VARCHAR(50) DEFAULT 'Возвращено',
      ADD COLUMN IF NOT EXISTS defective_quantity INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS writeoff_reason TEXT,
      ADD COLUMN IF NOT EXISTS comment TEXT,
      ADD COLUMN IF NOT EXISTS damage_photo TEXT,
      ADD COLUMN IF NOT EXISTS external_source BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS procurement_mode TEXT NOT NULL DEFAULT 'warehouse';
  `);

  await pool.query(`
    ALTER TABLE event_items
      ADD COLUMN IF NOT EXISTS issue_condition VARCHAR(50) DEFAULT 'Хорошее',
      ADD COLUMN IF NOT EXISTS actual_condition VARCHAR(50) DEFAULT 'Хорошее',
      ADD COLUMN IF NOT EXISTS defective_quantity INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS writeoff_reason TEXT,
      ADD COLUMN IF NOT EXISTS comment TEXT,
      ADD COLUMN IF NOT EXISTS damage_photo TEXT,
      ADD COLUMN IF NOT EXISTS external_source BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS procurement_mode TEXT NOT NULL DEFAULT 'warehouse';
  `);

  // Вьюхи зависят от колонок дат в rentals/events и должны быть пересозданы после ALTER TYPE.
  await pool.query('DROP VIEW IF EXISTS requests');
  await pool.query('DROP VIEW IF EXISTS items');

  await pool.query(`
    ALTER TABLE rentals
      ALTER COLUMN start_date TYPE TIMESTAMP USING start_date::timestamp,
      ALTER COLUMN end_date TYPE TIMESTAMP USING end_date::timestamp;
  `);

  await pool.query(`
    ALTER TABLE events
      ALTER COLUMN start_date TYPE TIMESTAMP USING start_date::timestamp,
      ALTER COLUMN end_date TYPE TIMESTAMP USING end_date::timestamp;
  `);

  await pool.query(`
    ALTER TABLE event_items
      ALTER COLUMN transfer_date TYPE TIMESTAMP USING transfer_date::timestamp,
      ALTER COLUMN return_date TYPE TIMESTAMP USING return_date::timestamp;
  `);

  // Добавление внешних ключей, если они не существуют
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_items_rental_id_fkey') THEN
        ALTER TABLE rental_items ADD CONSTRAINT rental_items_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_items_item_id_fkey') THEN
        ALTER TABLE rental_items ADD CONSTRAINT rental_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'event_items_event_id_fkey') THEN
        ALTER TABLE event_items ADD CONSTRAINT event_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'event_items_item_id_fkey') THEN
        ALTER TABLE event_items ADD CONSTRAINT event_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory(id);
      END IF;
    END $$
  `);

  // Индексы для ускорения частых JOIN/ORDER BY/фильтрации в API
  await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_category_name ON inventory (category, name)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_name ON employees (name)');

  await pool.query('CREATE INDEX IF NOT EXISTS idx_rentals_client_id ON rentals (client_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rentals_employee_id ON rentals (employee_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rentals_status ON rentals (status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rentals_start_date ON rentals (start_date)');

  await pool.query('CREATE INDEX IF NOT EXISTS idx_events_employee_id ON events (employee_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_events_status ON events (status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_events_start_date ON events (start_date)');

  await pool.query('CREATE INDEX IF NOT EXISTS idx_rental_items_rental_id ON rental_items (rental_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rental_items_item_id ON rental_items (item_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_event_items_event_id ON event_items (event_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_event_items_item_id ON event_items (item_id)');

  await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_id ON inventory_movements (inventory_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_movements_operation_date ON inventory_movements (operation_date DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_source_item_id ON inventory (source_item_id)');

  // Представление items: агрегированные остатки и вычисляемая доступность
  await pool.query(`
    CREATE OR REPLACE VIEW items AS
    SELECT
      i.id,
      i.name,
      i.category,
      COALESCE(i.quantity, 0) AS total_qty,
      COALESCE(r_usage.in_rental, 0) AS in_rental,
      COALESCE(e_usage.in_event, 0) AS in_event,
      GREATEST(
        COALESCE(i.quantity, 0)
        - COALESCE(r_usage.in_rental, 0)
        - COALESCE(e_usage.in_event, 0),
        0
      ) AS available_qty,
      CASE
        WHEN COALESCE(NULLIF(TRIM(i.status), ''), 'В наличии') IN ('На реставрации', 'Списано', 'К списанию') THEN i.status
        WHEN GREATEST(
          COALESCE(i.quantity, 0)
          - COALESCE(r_usage.in_rental, 0)
          - COALESCE(e_usage.in_event, 0),
          0
        ) > 0 THEN 'В наличии'
        WHEN GREATEST(
          COALESCE(i.quantity, 0)
          - COALESCE(r_usage.in_rental, 0)
          - COALESCE(e_usage.in_event, 0),
          0
        ) = 0 AND (COALESCE(r_usage.in_rental, 0) > 0 OR COALESCE(e_usage.in_event, 0) > 0)
          THEN 'Нет в наличии (в использовании)'
        ELSE 'Нет в наличии'
      END AS availability_status
    FROM inventory i
    LEFT JOIN (
      SELECT ri.item_id, SUM(ri.quantity) AS in_rental
      FROM rental_items ri
      INNER JOIN rentals r ON r.id = ri.rental_id
      WHERE COALESCE(ri.external_source, FALSE) = FALSE
        AND COALESCE(NULLIF(TRIM(r.status), ''), 'Черновик') IN ('Активна', 'Активно', 'Просрочена', 'Проведен')
      GROUP BY ri.item_id
    ) AS r_usage ON r_usage.item_id = i.id
    LEFT JOIN (
      SELECT ei.item_id, SUM(ei.quantity) AS in_event
      FROM event_items ei
      INNER JOIN events e ON e.id = ei.event_id
      WHERE COALESCE(ei.external_source, FALSE) = FALSE
        AND COALESCE(NULLIF(TRIM(e.status), ''), 'Черновик') IN ('Активно', 'Активна', 'Просрочена', 'Проведен')
      GROUP BY ei.item_id
    ) AS e_usage ON e_usage.item_id = i.id;
  `);

  // Представление requests: унифицированный поток резервирования (аренда + мероприятие)
  await pool.query(`
    CREATE OR REPLACE VIEW requests AS
    SELECT
      CONCAT('rental-', ri.id) AS id,
      ri.item_id,
      'rental'::TEXT AS usage_type,
      ri.quantity AS qty,
      r.status,
      r.id AS source_id,
      r.start_date AS started_at,
      r.end_date AS ended_at,
      ri.external_source,
      ri.procurement_mode,
      ri.comment,
      NULL::timestamp AS updated_at
    FROM rental_items ri
    INNER JOIN rentals r ON r.id = ri.rental_id

    UNION ALL

    SELECT
      CONCAT('event-', ei.id) AS id,
      ei.item_id,
      'event'::TEXT AS usage_type,
      ei.quantity AS qty,
      e.status,
      e.id AS source_id,
      e.start_date AS started_at,
      e.end_date AS ended_at,
      ei.external_source,
      ei.procurement_mode,
      ei.comment,
      NULL::timestamp AS updated_at
    FROM event_items ei
    INNER JOIN events e ON e.id = ei.event_id;
  `);
};

// createTables().catch(err => console.error('Error creating tables:', err));

module.exports = { pool, createTables };
