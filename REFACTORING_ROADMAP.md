# Refactoring Roadmap (Практичный)

## Шаг 1. Дубли роутов и временные файлы

Статус: **сделано**

- Удален дублирующий `GET /api/inventory/purchase-requests` в `routes/inventory.js`.
- Удалены временные/резервные файлы:
  - `tmp_test_event.js`
  - `tmp_test_rental.js`
  - `script.corrupted.backup.js`
  - `tmp_hashes.json`

---

## Шаг 2. Единый источник данных по заявкам (только БД)

Цель: убрать `localStorage` как источник истины для закупочных заявок.
Статус: **в процессе**

Уже сделано:

- Клиентский fallback на `localStorage` для создания заявки удален.
- Обновление статусов заявок в формах аренды/мероприятий переведено на API (`/api/inventory/purchase-requests?requestNumber=...`).
- Серверный endpoint `/api/inventory/purchase-requests` расширен фильтрами `requestNumber` и `itemId`.

### Порядок работ (без поломок)

1. **Backend contract first**
   - Файл: `routes/inventory.js`
   - Добавить/проверить единый API контракт:
     - `GET /purchase-requests?status=...`
     - `POST /purchase-requests`
     - `PUT /purchase-requests/:id`
     - `PUT /purchase-requests/:id/status`
   - Явно вернуть поля: `request_number`, `status`, `items[]` (или `item_*` + группировка на сервере).

2. **Purchase request service на фронте**
   - Новый файл: `frontend/services/purchaseRequests-api.js` (или `purchase-requests-api.js` рядом с `script.js`)
   - Вынести туда:
     - `fetchPurchaseRequestDraftsForItem`
     - create/update/status методы
     - маппинг статусов

3. **Перевести чтение с localStorage на API**
   - Файлы: `script.js`, `warehouse-advanced.js`
   - Заменить:
     - `readLocalPurchaseRequestDocs`
     - `createOrMergeLocalPurchaseRequestForIssue`
     - прямые `localStorage.getItem('warehouse_purchase_request_documents_v1')`
   - На API слой из п.2.

4. **Совместимость на переходный период**
   - 1 релиз оставить read-only fallback:
     - читать localStorage только если API недоступен;
     - писать только в API.
   - После стабилизации fallback удалить.

---

## Шаг 3. Модульный разбор `script.js` / `warehouse-advanced.js`

Цель: уменьшить связанность, ускорить поддержку.
Статус: **начато**

Уже сделано:

- Добавлен `script-utils-core.js`: `escapeHtml`, `tryFixUtf8Mojibake`, `restoreText`, `parseDateValue`, `toDateTimeLocalValue`, `formatDateTime`.
- Подключение в `index.html` **перед** `script.js`; дубликаты удалены из `script.js`.
- В `warehouse-advanced.js` локальный дубль `tryFixUtf8Mojibake`/`restoreText` заменён на вызов `window.restoreText` (после загрузки core).
- Дополнительно вынесены `formatDateOnly` и `formatDateTimeSafe` из `script.js` в `script-utils-core.js`.

### Приоритет выноса (по риску и связанности)

1. **Низкий риск**
   - `utils/date.js`, `utils/text.js`, `utils/status.js` — по желанию переименовать `script-utils-core.js` в папку `js/` и разбить дальше.
   - Следующий кандидат: `formatDateOnly` и мелкие форматтеры из `script.js`.

2. **Средний риск**
   - `modules/purchase-requests.js`
   - `modules/documents-hub.js`
   - Вынести UI + обработчики модалок закупок и документов.

3. **Высокий риск**
   - `modules/rentals-form.js`
   - `modules/events-form.js`
   - Вынести логику submit/validation/posting.

4. **Состояние и события**
   - `state/store.js` (центральное состояние: rentals/events/inventory/current user)
   - `events/bus.js` (единый механизм уведомлений, включая статус закупки).

### Техническое правило на каждый вынос

- 1 модуль = 1 PR.
- После каждого выноса: smoke-check и сравнение поведения форм.

---

## Шаг 4. Smoke e2e (4-5 сценариев)

Цель: быстро ловить регрессии критических потоков.
Статус: **базовый smoke добавлен**

Уже сделано:

- Добавлен `tests/smoke-flows.test.js`.
- Добавлен npm script: `npm run test:smoke`.
- Сценарии smoke покрывают:
  - health check
  - login (при наличии `SMOKE_USERNAME` / `SMOKE_PASSWORD`)
  - inventory
  - rentals + events
  - purchase requests (единый endpoint)

### Рекомендуемый стек

- Playwright
- Отдельный `.env.test`

### Минимальные сценарии

1. Логин -> загрузка дашборда.
2. Создание аренды в черновик -> повторное открытие черновика.
3. Нехватка товара -> создание заявки на закупку.
4. Блокировка кнопки `Провести` до статуса "Получена".
5. Раздел `Документы` -> корректные статусы (`Проведен`, `Черновик`, `Отменен`, `Частично`).

### Структура

- `tests/e2e/smoke.spec.ts`
- `playwright.config.ts`
- npm scripts:
  - `test:e2e:smoke`
  - `test:e2e:smoke:headed`

---

## Шаг 5. Production static без `/node_modules` и CDN

Цель: предсказуемая и автономная сборка фронта.

### Порядок перехода

1. Ввести сборщик (Vite или esbuild).
2. Перенести зависимости (`jspdf`, `html2canvas`, `xlsx`, `chart.js`) в npm imports.
3. Собирать фронт в `public/dist`.
4. В `server.js` раздавать только `public`:
   - `app.use(express.static(path.join(__dirname, 'public')))`
5. Удалить скрипты из `index.html`, которые грузятся с CDN и `/node_modules`.

### Проверка готовности

- Приложение стартует без интернета.
- В source нет ссылок `unpkg`, `jsdelivr`, `/node_modules/...`.

---

## Рекомендуемый порядок релизов

1. Step 1 (чистка + дубль роута) — завершено.
2. Step 2 (API source of truth) — 2 PR.
3. Step 3 (модульный вынос) — 4-6 PR.
4. Step 4 (smoke e2e) — 1 PR.
5. Step 5 (production static) — 1-2 PR.
