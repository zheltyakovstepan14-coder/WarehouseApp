/**
 * Demo seed for rich showcase data (2024-2026).
 * Usage:
 *   npm run seed        -> fill if inventory is empty
 *   npm run seed:reset  -> reset and refill all demo entities
 */

const { pool } = require('./db');

const shouldReset = process.argv.includes('--reset');

const YEARS = [2024, 2025, 2026];
const RENTAL_STATUSES = ['Черновик', 'Проведен', 'Активна', 'Завершена', 'Просрочена'];
const EVENT_STATUSES = ['Черновик', 'Проведен', 'Активно', 'Завершено', 'Просрочено'];
const PURCHASE_STATUSES = ['Черновик', 'Согласована', 'Поставлена', 'Отменена'];

const clientsData = [
  ['ООО АртПлощадка', 'Юрлицо', 'Москва'],
  ['ООО Ивент-Плюс', 'Юрлицо', 'Санкт-Петербург'],
  ['АО Культура Сервис', 'Юрлицо', 'Казань'],
  ['ИП Елена Викторовна Миронова', 'Физлицо', 'Екатеринбург'],
  ['ИП Сергей Андреевич Громов', 'Физлицо', 'Новосибирск'],
  ['ООО Праздник Hall', 'Юрлицо', 'Самара'],
  ['Мария Олеговна Крылова', 'Физлицо', 'Нижний Новгород'],
  ['ООО Север Экспо', 'Юрлицо', 'Пермь'],
  ['ИП Тимур Айратович Валеев', 'Физлицо', 'Уфа'],
  ['ООО Точка Событий', 'Юрлицо', 'Ростов-на-Дону'],
  ['Наталья Игоревна Белова', 'Физлицо', 'Воронеж'],
  ['ООО Музейные Решения', 'Юрлицо', 'Краснодар'],
  ['ООО Форум Экспо', 'Юрлицо', 'Тюмень'],
  ['ИП Артем Лавров', 'Физлицо', 'Челябинск'],
  ['ООО Галерея 21', 'Юрлицо', 'Омск']
];

const employeesData = [
  ['Алексей Викторович Смирнов', 'Кладовщик'],
  ['Ольга Дмитриевна Волкова', 'Менеджер по аренде'],
  ['Пётр Сергеевич Иванов', 'Логист'],
  ['Екатерина Павловна Морозова', 'Координатор мероприятий'],
  ['Виктор Николаевич Королёв', 'Руководитель склада'],
  ['Анна Михайловна Романова', 'Администратор'],
  ['Игорь Васильевич Титов', 'Техник'],
  ['Марина Юрьевна Соколова', 'Менеджер по клиентам'],
  ['Денис Андреевич Новиков', 'Специалист по документам'],
  ['Светлана Олеговна Егорова', 'Оператор склада'],
  ['Руслан Артемович Фадеев', 'Курьер'],
  ['Людмила Сергеевна Гаврилова', 'Бухгалтер']
];

const furnitureNames = [
  'Круглый стол банкетный', 'Стул деревянный классический', 'Диван угловой серый', 'Тумба белая',
  'Стеллаж металлический', 'Барная стойка', 'Стол переговорный', 'Кресло мягкое',
  'Комод дизайнерский', 'Вешалка напольная', 'Табурет высокий', 'Стойка ресепшен'
];

const exhibitNames = [
  'Картина маслом «Венецианская ночь»', 'Скульптура бронзовая', 'Ваза фарфоровая', 'Зеркало дизайнерское',
  'Люстра хрустальная', 'Панно декоративное', 'Инсталляция световая', 'Бюст мраморный',
  'Гобелен настенный', 'Статуэтка авторская', 'Макет исторического здания', 'Витрина стеклянная'
];

const toolNames = [
  'Дрель электрическая', 'Шлифовальная машина', 'Уровень строительный', 'Набор инструментов 100 шт',
  'Лестница алюминиевая', 'Перфоратор', 'Шуруповерт', 'Паяльная станция',
  'Компрессор компактный', 'Лазерный нивелир', 'Сварочный аппарат', 'Ручной резак'
];

const consumableNames = [
  'Гвозди 50 мм', 'Саморезы универсальные', 'Бумага А4', 'Стяжки пластиковые',
  'Клей монтажный', 'Изолента', 'Кабельные хомуты', 'Маркер перманентный',
  'Лента упаковочная', 'Пленка стрейч', 'Перчатки рабочие', 'Батарейки AA'
];

function makePhone(index, prefix = '900') {
  return `+7-${prefix}-${String(index + 1).padStart(3, '0')}-${String(1000 + index).slice(-4)}`;
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function makeDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function shiftIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedRand(index) {
  let x = (index + 1) * 1103515245 + 12345;
  x ^= (x << 13);
  x ^= (x >>> 17);
  x ^= (x << 5);
  return Math.abs(x);
}

function pick(array, index, offset = 0) {
  return array[(seedRand(index + offset) % array.length)];
}

function buildInventoryRows() {
  const rows = [];
  let idx = 1;

  for (const name of furnitureNames) {
    rows.push({
      id: `FUR${String(idx++).padStart(3, '0')}`,
      name,
      category: 'Мебель',
      type: 'asset',
      quantity: 10 + (rows.length % 4) * 3,
      minstock: 2 + (rows.length % 2),
      location: 'Основной склад',
      description: 'Демо-позиция мебели для витрины аналитики',
      info: 'Используется для аренды и выставочных зон'
    });
  }

  idx = 1;
  for (const name of exhibitNames) {
    rows.push({
      id: `EXH${String(idx++).padStart(3, '0')}`,
      name,
      category: 'Экспонат',
      type: 'asset',
      quantity: 4 + (rows.length % 3),
      minstock: 1,
      location: 'Выставочный фонд',
      description: 'Демо-экспонат',
      info: 'Требует аккуратной упаковки и сопровождения'
    });
  }

  idx = 1;
  for (const name of toolNames) {
    rows.push({
      id: `TOL${String(idx++).padStart(3, '0')}`,
      name,
      category: 'Инструмент',
      type: 'asset',
      quantity: 8 + (rows.length % 5),
      minstock: 2,
      location: 'Инструментальная',
      description: 'Демо-инструмент для сервисных задач',
      info: 'Доступен для техобслуживания экспозиций'
    });
  }

  idx = 1;
  for (const name of consumableNames) {
    const quantity = 30 + (rows.length % 8) * 20;
    rows.push({
      id: `CON${String(idx++).padStart(3, '0')}`,
      name,
      category: 'Расходники',
      type: 'consumable',
      requires_purchase: idx % 2 === 0,
      quantity,
      minstock: quantity > 80 ? 40 : 30,
      location: 'Зона расходников',
      description: 'Демо-расходник',
      info: 'Пополняется по заявкам закупки'
    });
  }

  return rows.map((item, i) => {
    const lifespan = item.type === 'asset' ? 24 + (i % 6) * 12 : null;
    const balanceYear = item.type === 'asset' ? (2021 + (i % 5)) : null;
    const balanceDate = item.type === 'asset' ? makeDate(balanceYear, (i % 12) + 1, ((i * 3) % 27) + 1) : null;

    let status = 'В наличии';
    if (item.type === 'asset' && i % 17 === 0) status = 'На реставрации';
    if (item.type === 'asset' && i % 29 === 0) status = 'К списанию';

    return {
      ...item,
      lifespan,
      balance_date: balanceDate,
      status
    };
  });
}

async function insertIssuanceAct(client, { sourceType, sourceId, createdAt, createdBy, counter }) {
  const year = new Date(createdAt).getUTCFullYear();
  const actNumber = `АВ-${year}-${String(counter).padStart(4, '0')}`;
  const result = await client.query(
    `INSERT INTO issuance_acts (act_number, source_type, source_id, status, created_by, created_at)
     VALUES ($1, $2, $3, 'Проведен', $4, $5)
     RETURNING id, act_number`,
    [actNumber, sourceType, sourceId, createdBy, createdAt]
  );
  return result.rows[0];
}

async function seedData(options = {}) {
  const silent = !!options.silent;
  const reset = shouldReset || !!options.reset;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM inventory');
    const existingCount = countResult.rows[0].count;

    if (existingCount > 0 && !reset) {
      if (!silent) {
        console.log(`ℹ База уже заполнена (${existingCount} записей в inventory), сид пропущен.`);
      }
      await client.query('ROLLBACK');
      return { skipped: true, existingCount };
    }

    if (reset) {
      if (!silent) console.log('🧹 Полная очистка демонстрационных данных...');
      await client.query(`
        TRUNCATE TABLE
          inventory_movements,
          inventory_history,
          asset_lifecycle_history,
          writeoff_act_items,
          writeoff_acts,
          purchase_requests,
          event_items,
          rental_items,
          issuance_acts,
          events,
          rentals,
          inventory,
          clients,
          employees
        RESTART IDENTITY CASCADE
      `);
    }

    if (!silent) console.log('🧾 Создание клиентов...');
    const clientIds = [];
    for (let i = 0; i < clientsData.length; i++) {
      const [name, type, city] = clientsData[i];
      const result = await client.query(
        `INSERT INTO clients (name, phone, email, address, inn, type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          name,
          makePhone(i, '910'),
          `client${i + 1}@example.ru`,
          `${city}, ул. Центральная, д. ${i + 3}`,
          type === 'Юрлицо' ? `7700${String(i + 1).padStart(6, '0')}` : '',
          type
        ]
      );
      clientIds.push(result.rows[0].id);
    }

    if (!silent) console.log('👥 Создание сотрудников...');
    const employeeIds = [];
    for (let i = 0; i < employeesData.length; i++) {
      const [name, position] = employeesData[i];
      const result = await client.query(
        `INSERT INTO employees (name, position, phone, email, hire_date, active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id`,
        [
          name,
          position,
          makePhone(i, '920'),
          `employee${i + 1}@warehouse.ru`,
          makeDate(2021 + (i % 4), (i % 12) + 1, ((i * 2) % 27) + 1)
        ]
      );
      employeeIds.push(result.rows[0].id);
    }

    if (!silent) console.log('📦 Создание складских позиций...');
    const inventoryRows = buildInventoryRows();
    for (const item of inventoryRows) {
      await client.query(
        `INSERT INTO inventory (
          id, name, quantity, quantity_pending_writeoff, rentalstatus, category, type,
          requires_purchase, location, minstock, description, info, lifespan, balance_date, status
        )
         VALUES ($1, $2, $3, $4, 'На складе', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          item.id,
          item.name,
          item.quantity,
          item.status === 'К списанию' ? 1 : 0,
          item.category,
          item.type || 'asset',
          item.requires_purchase === true,
          item.location,
          item.minstock,
          item.description,
          item.info || '',
          item.lifespan,
          item.balance_date,
          item.status
        ]
      );
    }

    const inventoryById = new Map(inventoryRows.map((item) => [item.id, item]));
    const assetIds = inventoryRows.filter((i) => i.type === 'asset').map((i) => i.id);
    const consumableIds = inventoryRows.filter((i) => i.type === 'consumable').map((i) => i.id);

    if (!silent) console.log('📅 Создание аренд и документов выдачи...');
    let issuanceCounter = 1;
    let rentalCount = 0;
    for (const year of YEARS) {
      for (let i = 0; i < 24; i++) {
        const status = pick(RENTAL_STATUSES, i, year);
        const month = (i % 12) + 1;
        const day = ((i * 2) % 26) + 1;
        const startDate = `${makeDate(year, month, day)} 10:00:00`;
        const endDate = `${shiftIsoDays(makeDate(year, month, day), 3 + (i % 5))} 18:00:00`;

        const rentalRes = await client.query(
          `INSERT INTO rentals (client_id, employee_id, start_date, end_date, status)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            clientIds[(i + year) % clientIds.length],
            employeeIds[(i + 2) % employeeIds.length],
            startDate,
            endDate,
            status
          ]
        );

        const rentalId = rentalRes.rows[0].id;
        const itemIds = [
          assetIds[(i + year) % assetIds.length],
          assetIds[(i + 5 + year) % assetIds.length],
          consumableIds[(i + 2) % consumableIds.length]
        ];

        for (let j = 0; j < itemIds.length; j++) {
          const itemId = itemIds[j];
          const item = inventoryById.get(itemId);
          const qty = item?.type === 'consumable' ? 5 + (i % 6) : 1 + (j % 2);
          await client.query(
            `INSERT INTO rental_items (
              rental_id, item_id, category, quantity, rent_price, issue_condition, actual_condition,
              return_status, defective_quantity, writeoff_reason, comment, procurement_mode
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'warehouse')`,
            [
              rentalId,
              itemId,
              item?.category || 'Склад',
              qty,
              1200 + (i * 75) + (j * 90),
              'Хорошее',
              status === 'Завершена' ? (i % 10 === 0 ? 'Повреждено' : 'Хорошее') : 'Хорошее',
              status === 'Завершена' ? 'Возвращено' : 'Не возвращено',
              status === 'Завершена' && i % 10 === 0 ? 1 : 0,
              status === 'Завершена' && i % 10 === 0 ? 'Износ при эксплуатации' : null,
              `Демо-аренда ${year} #${i + 1}`
            ]
          );
        }

        if (status !== 'Черновик') {
          const act = await insertIssuanceAct(client, {
            sourceType: 'rental',
            sourceId: rentalId,
            createdAt: `${makeDate(year, month, day)} 12:00:00`,
            createdBy: 'seed-script',
            counter: issuanceCounter++
          });
          await client.query(
            `UPDATE rentals
             SET issuance_act_id = $1, issuance_act_number = $2
             WHERE id = $3`,
            [act.id, act.act_number, rentalId]
          );
        }

        rentalCount += 1;
      }
    }

    if (!silent) console.log('🎪 Создание мероприятий и документов выдачи...');
    let eventCount = 0;
    for (const year of YEARS) {
      for (let i = 0; i < 20; i++) {
        const status = pick(EVENT_STATUSES, i, year);
        const month = ((i + 3) % 12) + 1;
        const day = ((i * 3) % 25) + 1;
        const startDate = `${makeDate(year, month, day)} 09:00:00`;
        const endDate = `${shiftIsoDays(makeDate(year, month, day), 1 + (i % 4))} 22:00:00`;

        const eventRes = await client.query(
          `INSERT INTO events (name, start_date, end_date, location, status, employee_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            `Выставка/ивент ${year}-${String(i + 1).padStart(2, '0')}`,
            startDate,
            endDate,
            `Площадка ${1 + (i % 12)}, зал ${String.fromCharCode(65 + (i % 4))}`,
            status,
            employeeIds[(i + 4) % employeeIds.length]
          ]
        );

        const eventId = eventRes.rows[0].id;
        const itemIds = [
          assetIds[(i + 7 + year) % assetIds.length],
          assetIds[(i + 13 + year) % assetIds.length]
        ];

        for (let j = 0; j < itemIds.length; j++) {
          const itemId = itemIds[j];
          const item = inventoryById.get(itemId);
          await client.query(
            `INSERT INTO event_items (
              event_id, item_id, category, quantity, transfer_date, return_date, return_status,
              issue_condition, actual_condition, defective_quantity, writeoff_reason, comment, procurement_mode
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Хорошее', $8, $9, $10, $11, 'warehouse')`,
            [
              eventId,
              itemId,
              item?.category || 'Склад',
              1 + (j % 2),
              startDate,
              endDate,
              status === 'Завершено' ? 'Возвращено' : 'Не возвращено',
              status === 'Завершено' && i % 11 === 0 ? 'Повреждено' : 'Хорошее',
              status === 'Завершено' && i % 11 === 0 ? 1 : 0,
              status === 'Завершено' && i % 11 === 0 ? 'Повреждение при транспортировке' : null,
              `Демо-мероприятие ${year} #${i + 1}`
            ]
          );
        }

        if (status !== 'Черновик') {
          const act = await insertIssuanceAct(client, {
            sourceType: 'event',
            sourceId: eventId,
            createdAt: `${makeDate(year, month, day)} 11:30:00`,
            createdBy: 'seed-script',
            counter: issuanceCounter++
          });
          await client.query(
            `UPDATE events
             SET issuance_act_id = $1, issuance_act_number = $2
             WHERE id = $3`,
            [act.id, act.act_number, eventId]
          );
        }

        eventCount += 1;
      }
    }

    if (!silent) console.log('🛒 Создание заявок на закупку...');
    let requestCounter = 1;
    let purchaseCount = 0;
    for (const year of YEARS) {
      for (let i = 0; i < 20; i++) {
        const itemId = consumableIds[(i + year) % consumableIds.length];
        const item = inventoryById.get(itemId);
        const status = pick(PURCHASE_STATUSES, i, year);
        const createdAt = `${makeDate(year, (i % 12) + 1, ((i * 2) % 25) + 1)} 10:15:00`;
        const expectedDate = shiftIsoDays(createdAt.slice(0, 10), 7 + (i % 12));
        await client.query(
          `INSERT INTO purchase_requests (
            request_number, item_id, item_name, item_category, quantity, status, source_type, source_id,
            expected_date, notes, created_by, created_at, updated_at
          )
           VALUES ($1, $2, $3, $4, $5, $6, 'inventory', NULL, $7, $8, 'seed-script', $9, $9)`,
          [
            `ЗП-${year}-${String(requestCounter++).padStart(4, '0')}`,
            itemId,
            item?.name || itemId,
            item?.category || 'Расходники',
            20 + (i % 7) * 10,
            status,
            expectedDate,
            `Автогенерация для демо-аналитики (${year})`,
            createdAt
          ]
        );
        purchaseCount += 1;
      }
    }

    if (!silent) console.log('🧾 Создание актов списания...');
    let writeoffCounter = 1;
    let writeoffCount = 0;
    const writeoffReasonCategories = ['износ', 'поломка', 'утрата', 'брак'];
    for (const year of YEARS) {
      for (let i = 0; i < 8; i++) {
        const status = (year === 2026 && i === 7) ? 'Черновик' : 'Проведен';
        const actDate = `${makeDate(year, ((i + 5) % 12) + 1, ((i * 2) % 26) + 1)} 16:10:00`;
        const postedAt = status === 'Проведен' ? `${makeDate(year, ((i + 5) % 12) + 1, ((i * 2) % 26) + 1)} 17:00:00` : null;
        const actNumber = `АС-${year}-${String(writeoffCounter++).padStart(4, '0')}`;
        const actRes = await client.query(
          `INSERT INTO writeoff_acts (
            public_id, act_number, status, act_date, posted_at, basis_type, basis_id, basis_label,
            basis_name, basis_act_number, reason, signature, responsible_position, created_by, created_at
          )
           VALUES ($1, $2, $3, $4, $5, 'manual', NULL, 'Плановое списание', 'Склад', NULL, $6, $7, $8, 'seed-script', $4)
           RETURNING id`,
          [
            `writeoff-${year}-${i + 1}`,
            actNumber,
            status,
            actDate,
            postedAt,
            pick(writeoffReasonCategories, i, year),
            'Иванов И.И.',
            'Комиссия'
          ]
        );

        const actId = actRes.rows[0].id;
        const picked = [
          assetIds[(i + year) % assetIds.length],
          consumableIds[(i + 3 + year) % consumableIds.length]
        ];
        for (let j = 0; j < picked.length; j++) {
          const itemId = picked[j];
          const item = inventoryById.get(itemId);
          const qty = item?.type === 'consumable' ? 8 + (j * 2) : 1;
          const reasonCategory = pick(writeoffReasonCategories, i + j, year);
          await client.query(
            `INSERT INTO writeoff_act_items (
              act_id, item_id, item_name, item_category, item_type, quantity, reason, reason_category, comment
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              actId,
              itemId,
              item?.name || itemId,
              item?.category || 'Склад',
              item?.type || 'asset',
              qty,
              reasonCategory,
              reasonCategory,
              `Списание в рамках демо (${year})`
            ]
          );
        }

        writeoffCount += 1;
      }
    }

    if (!silent) console.log('📈 Создание истории движений по месяцам...');
    let movementCount = 0;
    for (const year of YEARS) {
      for (let month = 1; month <= 12; month++) {
        for (let i = 0; i < 4; i++) {
          const itemId = inventoryRows[(year + month + i) % inventoryRows.length].id;
          const item = inventoryById.get(itemId);
          const opType = i % 3 === 0 ? 'Списание' : (i % 3 === 1 ? 'Выдача' : 'Возврат');
          const day = ((i * 3) % 27) + 1;
          const opDate = `${makeDate(year, month, day)} ${pad2(9 + (i % 8))}:30:00`;
          await client.query(
            `INSERT INTO inventory_movements (
              inventory_id, item_name, category, operation_type, quantity, responsible_name,
              source_location, destination_location, document_type, document_label, operation_context, notes, created_by, operation_date
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'seed', $11, 'seed-script', $12)`,
            [
              itemId,
              item?.name || itemId,
              item?.category || 'Склад',
              opType,
              1 + (i % 4),
              pick(employeesData, i + month, year)[0],
              'Склад',
              opType === 'Возврат' ? 'Склад' : 'Клиент/Площадка',
              opType === 'Списание' ? 'writeoff_act' : 'issuance_act',
              `${opType} ${year}/${month}`,
              `Демо-движение ${year}-${month}-${i + 1}`,
              opDate
            ]
          );
          movementCount += 1;
        }
      }
    }

    await client.query('COMMIT');

    const summary = {
      clients: clientIds.length,
      employees: employeeIds.length,
      inventory: inventoryRows.length,
      rentals: rentalCount,
      events: eventCount,
      purchaseRequests: purchaseCount,
      writeoffActs: writeoffCount,
      inventoryMovements: movementCount
    };

    if (!silent) {
      console.log('✅ Демонстрационные данные успешно загружены:');
      console.table(summary);
    }

    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка при заполнении БД:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedData()
    .then(() => pool.end())
    .catch(() => pool.end());
}

module.exports = { seedData };

