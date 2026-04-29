// ============================================================================
// Документы для аренды и мероприятий
// ============================================================================

let currentRentalForDocuments = null;
let currentEventForDocuments = null;
let preparedPdfPreviewWindow = null;

function registerPreparedPdfPreviewWindow(win) {
    if (win && !win.closed) {
        preparedPdfPreviewWindow = win;
    }
}

function consumePreparedPdfPreviewWindow() {
    const win = preparedPdfPreviewWindow;
    preparedPdfPreviewWindow = null;
    return win && !win.closed ? win : null;
}

window.registerPreparedPdfPreviewWindow = registerPreparedPdfPreviewWindow;
window.consumePreparedPdfPreviewWindow = consumePreparedPdfPreviewWindow;

function escapeDocumentHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDocumentDate(value) {
    if (!value) return 'Не указана';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getInventoryReferenceList() {
    try {
        return Array.isArray(inventory) ? inventory : [];
    } catch {
        return [];
    }
}

function normalizeDocumentCategory(value) {
    const raw = String(value ?? '').trim();
    const normalized = raw.toLowerCase().replace(/ё/g, 'е');

    if (!raw) return 'Не указана';
    if (/меб/.test(normalized)) return 'Мебель';
    if (/экс|эксп|эсп|эпск|exh|витрин|панно|люстр|скульптур/.test(normalized)) return 'Экспонат';
    if (/инстру|дрел|шлиф|перфор|шуруп|паял|компресс|нивел|свароч|резак/.test(normalized)) return 'Инструмент';

    return raw;
}

function normalizeReturnStatus(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е');

    if (!normalized) return 'Возвращено';
    if (/не\s*возвращ|утрач|missing|lost/.test(normalized)) return 'Не возвращено';
    if (/повреж/.test(normalized)) return 'Возвращено с замечаниями';
    return 'Возвращено';
}

function normalizeConditionLabel(value, returnStatus = '') {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е');
    const normalizedReturnStatus = String(returnStatus ?? '').trim().toLowerCase().replace(/ё/g, 'е');

    if (/утрач|не\s*возвращ|missing|lost/.test(`${normalized} ${normalizedReturnStatus}`)) return 'Утрачено';
    if (/ремонт|repair/.test(normalized)) return 'Требует ремонта';
    if (/повреж|дефект|broken/.test(normalized)) return 'Повреждено';
    return 'Хорошее';
}

function parsePackedDocumentComments(rawComment = '') {
    const raw = String(rawComment || '').trim();
    if (!raw) {
        return {
            issueComment: '',
            acceptanceComment: '',
            writeoffComment: ''
        };
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                issueComment: String(parsed.issueComment || parsed.issue || '').trim(),
                acceptanceComment: String(parsed.acceptanceComment || parsed.acceptance || '').trim(),
                writeoffComment: String(parsed.writeoffComment || parsed.writeoff || '').trim()
            };
        }
    } catch {
        // legacy plain-text comment
    }

    return {
        issueComment: raw,
        acceptanceComment: raw,
        writeoffComment: ''
    };
}

function resolveDocumentCommentByMode(item = {}, mode = 'generic') {
    const packed = parsePackedDocumentComments(item.comment || item.notes || item.remark || '');
    const issueComment = String(item.issue_comment || item.issueComment || packed.issueComment || '').trim();
    const acceptanceComment = String(item.acceptance_comment || item.acceptanceComment || packed.acceptanceComment || issueComment || '').trim();

    if (mode === 'issuance') {
        return issueComment;
    }
    if (mode === 'acceptance') {
        return acceptanceComment;
    }
    return String(item.comment || item.notes || item.remark || acceptanceComment || issueComment || '').trim();
}

function getPreparedDocumentItems(entity, options = {}) {
    const commentMode = String(options.commentMode || 'generic').trim().toLowerCase();
    const sourceItems = Array.isArray(entity?.items) ? entity.items : [];
    const inventoryList = getInventoryReferenceList();

    const preparedItems = sourceItems
        .filter(item => {
            if (!item || typeof item !== 'object') return false;
            const itemId = item.item_id ?? item.itemId ?? item.id;
            const rawName = String(item.item_name || item.itemName || item.name || '').trim();
            return Boolean(itemId) || (rawName && rawName.toLowerCase() !== 'не найден');
        })
        .map((item, index) => {
            const itemId = item.item_id ?? item.itemId ?? item.id ?? '';
            const reference = inventoryList.find(entry => String(entry.id) === String(itemId));
            const name = String(reference?.name || item.item_name || item.itemName || item.name || '').trim() || `Объект ${index + 1}`;
            const category = normalizeDocumentCategory(reference?.category || item.category || item.item_category || item.type);
            const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1) || 1);
            const returnStatus = normalizeReturnStatus(item.return_status || item.returnStatus);
            const issueCondition = normalizeConditionLabel(item.issue_condition || item.issueCondition || item.issue_state || item.issueState);
            const actualCondition = normalizeConditionLabel(item.actual_condition || item.actualCondition || item.condition || item.return_condition || item.returnCondition, item.return_status || item.returnStatus);
            const rawDefective = Number(item.defective_quantity || item.defectiveQuantity || 0);
            const defectiveQuantity = Number.isFinite(rawDefective) ? Math.max(0, Math.min(quantity, rawDefective)) : 0;
            const comment = resolveDocumentCommentByMode(item, commentMode);

            return {
                itemId,
                name,
                category,
                quantity,
                issueCondition,
                actualCondition,
                defectiveQuantity,
                returnStatus,
                comment
            };
        });

    if (preparedItems.length > 0) {
        return preparedItems;
    }

    const fallbackName = String(entity?.itemName || entity?.name || '').trim();
    if (!fallbackName) return [];

    return [{
        itemId: entity?.itemId || entity?.id || '',
        name: fallbackName,
        category: normalizeDocumentCategory(entity?.category),
        quantity: Math.max(1, Number(entity?.quantity ?? 1) || 1),
        issueCondition: 'Хорошее',
        actualCondition: 'Хорошее',
        returnStatus: 'Возвращено',
        comment: resolveDocumentCommentByMode(entity, commentMode)
    }];
}

function buildEntityInfoHtml(entity, items, type) {
    const itemText = items
        .map(item => `${escapeDocumentHtml(item.name)} — ${item.quantity} шт. (${escapeDocumentHtml(item.category)})`)
        .join('<br>');

    if (type === 'event') {
        return `
            <strong>Название:</strong> ${escapeDocumentHtml(entity.name || entity.event_name || 'Не указано')}<br>
            <strong>Даты:</strong> ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.event_date))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.event_date))}<br>
            <strong>Место:</strong> ${escapeDocumentHtml(entity.location || 'Не указано')}<br>
            <strong>Ответственный:</strong> ${escapeDocumentHtml(entity.employee_name || 'Не указан')}<br>
            <strong>Объекты:</strong><br>${itemText}
        `;
    }

    return `
        <strong>Арендатор:</strong> ${escapeDocumentHtml(entity.client_name || entity.renter || 'Не указан')}<br>
        <strong>Период аренды:</strong> ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.returnDate))}<br>
        <strong>Ответственный:</strong> ${escapeDocumentHtml(entity.employee_name || entity.responsible || 'Не указан')}<br>
        <strong>Объекты:</strong><br>${itemText}
    `;
}

/**
 * Открыть модальное окно для генерации документов аренды
 */
function generateDocumentsModal() {
    if (typeof requirePermission === 'function' && !requirePermission('rental', 'documents', 'Недостаточно прав для формирования документов аренды')) return;
    const checkboxes = document.querySelectorAll('.rental-checkbox:checked');

    if (checkboxes.length === 0) {
        showNotification('⚠ Выберите аренду для формирования документов', 'warning');
        return;
    }

    if (checkboxes.length > 1) {
        showNotification('⚠ Выберите только одну аренду', 'warning');
        return;
    }

    const selectedIndex = Number(checkboxes[0].getAttribute('data-index'));
    const rental = rentals[selectedIndex];

    if (!rental) {
        showNotification('⚠ Не удалось найти данные аренды', 'error');
        return;
    }

    const items = getPreparedDocumentItems(rental);
    if (items.length === 0) {
        showNotification('⚠ Список объектов аренды пуст. Добавьте позиции перед формированием акта.', 'warning');
        return;
    }

    currentRentalForDocuments = rental;
    document.getElementById('documentsRentalInfo').innerHTML = buildEntityInfoHtml(rental, items, 'rental');
    document.getElementById('documentsModal').style.display = 'block';

    const transferCheckbox = document.getElementById('docTransfer');
    const acceptanceCheckbox = document.getElementById('docAcceptance');

    if (transferCheckbox) transferCheckbox.checked = true;
    if (acceptanceCheckbox) acceptanceCheckbox.checked = true;
}

/**
 * Открыть модальное окно для генерации документов мероприятия
 */
function generateEventDocumentsModal() {
    if (typeof requirePermission === 'function' && !requirePermission('events', 'documents', 'Недостаточно прав для формирования документов мероприятия')) return;
    const checkboxes = document.querySelectorAll('.event-checkbox:checked');

    if (checkboxes.length === 0) {
        showNotification('⚠ Выберите мероприятие для формирования документов', 'warning');
        return;
    }

    if (checkboxes.length > 1) {
        showNotification('⚠ Выберите только одно мероприятие', 'warning');
        return;
    }

    const selectedIndex = Number(checkboxes[0].getAttribute('data-index'));
    const event = events[selectedIndex];

    if (!event) {
        showNotification('⚠ Не удалось найти данные мероприятия', 'error');
        return;
    }

    const items = getPreparedDocumentItems(event);
    if (items.length === 0) {
        showNotification('⚠ Список объектов мероприятия пуст. Добавьте позиции перед формированием акта.', 'warning');
        return;
    }

    currentEventForDocuments = event;
    document.getElementById('eventDocumentsEventInfo').innerHTML = buildEntityInfoHtml(event, items, 'event');
    document.getElementById('eventDocumentsModal').style.display = 'block';

    const issuanceCheckbox = document.getElementById('eventDocIssuance');
    const acceptanceCheckbox = document.getElementById('eventDocAcceptance');

    if (issuanceCheckbox) issuanceCheckbox.checked = true;
    if (acceptanceCheckbox) acceptanceCheckbox.checked = true;
}

function generateEventIssuanceAct() {
    const checkboxes = document.querySelectorAll('.event-checkbox:checked');

    if (checkboxes.length === 0) {
        showNotification('⚠ Выберите мероприятие для формирования акта выдачи', 'warning');
        return;
    }

    if (checkboxes.length > 1) {
        showNotification('⚠ Выберите только одно мероприятие', 'warning');
        return;
    }

    const selectedIndex = Number(checkboxes[0].getAttribute('data-index'));
    const event = events[selectedIndex];

    if (!event) {
        showNotification('⚠ Не удалось найти данные мероприятия', 'error');
        return;
    }

    generateIssuanceActForEvent(event);
}

function generateEventAcceptanceAct() {
    const checkboxes = document.querySelectorAll('.event-checkbox:checked');

    if (checkboxes.length === 0) {
        showNotification('⚠ Выберите мероприятие для формирования акта приёмки', 'warning');
        return;
    }

    if (checkboxes.length > 1) {
        showNotification('⚠ Выберите только одно мероприятие', 'warning');
        return;
    }

    const selectedIndex = Number(checkboxes[0].getAttribute('data-index'));
    const event = events[selectedIndex];

    if (!event) {
        showNotification('⚠ Не удалось найти данные мероприятия', 'error');
        return;
    }

    generateAcceptanceActForEvent(event);
}

/**
 * Совместимость со старой кнопкой скачивания
 */
async function downloadSelectedDocuments() {
    await generateSelectedDocuments();
}

function closeDocumentsModal() {
    const modal = document.getElementById('documentsModal');
    if (modal) modal.style.display = 'none';
    currentRentalForDocuments = null;
}

function closeEventDocumentsModal() {
    const modal = document.getElementById('eventDocumentsModal');
    if (modal) modal.style.display = 'none';
    currentEventForDocuments = null;
}

async function generateSelectedDocuments() {
    if (!currentRentalForDocuments) {
        showNotification('⚠ Нет выбранной аренды', 'error');
        return;
    }

    const transferChecked = !!document.getElementById('docTransfer')?.checked;
    const acceptanceChecked = !!document.getElementById('docAcceptance')?.checked;

    if (!transferChecked && !acceptanceChecked) {
        showNotification('⚠ Выберите хотя бы один документ', 'warning');
        return;
    }

    try {
        showNotification('⏳ Формирование документов...', 'success');

        if (transferChecked) {
            await generateTransferAct(currentRentalForDocuments, true);
        }
        if (acceptanceChecked) {
            await generateAcceptanceAct(currentRentalForDocuments, true);
        }

        closeDocumentsModal();
        showNotification('✓ Документы сформированы', 'success');
    } catch (error) {
        console.error('Ошибка при формировании документов аренды:', error);
        showNotification(error.message || 'Ошибка при формировании документов', 'error');
    }
}

async function generateSelectedEventDocuments() {
    if (!currentEventForDocuments) {
        showNotification('⚠ Нет выбранного мероприятия', 'error');
        return;
    }

    const issuanceChecked = !!document.getElementById('eventDocIssuance')?.checked;
    const acceptanceChecked = !!document.getElementById('eventDocAcceptance')?.checked;

    if (!issuanceChecked && !acceptanceChecked) {
        showNotification('⚠ Выберите хотя бы один документ', 'warning');
        return;
    }

    try {
        showNotification('⏳ Формирование документов мероприятия...', 'success');

        if (issuanceChecked) {
            await generateIssuanceActForEvent(currentEventForDocuments, true);
        }
        if (acceptanceChecked) {
            await generateAcceptanceActForEvent(currentEventForDocuments, true);
        }

        closeEventDocumentsModal();
        showNotification('✓ Документы мероприятия сформированы', 'success');
    } catch (error) {
        console.error('Ошибка при формировании документов мероприятия:', error);
        showNotification(error.message || 'Ошибка при формировании документов мероприятия', 'error');
    }
}

/**
 * Генерация PDF-документов для аренды и мероприятий
 */
const DOCUMENT_TEMPLATE_STYLES = `
    @page { size: A4; margin: 5mm; }
    body {
        font-family: Arial, sans-serif;
        color: #222;
        background: #fff;
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
    }
    .document {
        padding: 0;
    }
    .header {
        text-align: center;
        margin-bottom: 12px;
    }
    .title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.3px;
    }
    .subtitle {
        margin-top: 6px;
        font-size: 11px;
        color: #666;
    }
    .doc-info {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin: 10px 0 12px;
        font-size: 11px;
    }
    .section {
        margin-bottom: 10px;
        page-break-inside: avoid;
    }
    .section-title {
        font-weight: 700;
        margin-bottom: 8px;
        font-size: 12px;
    }
    .info-box, .note-box {
        border: 1px solid #d9d9d9;
        border-radius: 6px;
        padding: 10px 12px;
        background: #fafafa;
    }
    .info-line {
        margin-bottom: 4px;
    }
    table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        margin-top: 4px;
        font-size: 9.6px;
    }
    th, td {
        border: 1px solid #bcbcbc;
        padding: 6px 7px;
        vertical-align: top;
        word-break: break-word;
        overflow-wrap: anywhere;
    }
    th {
        background: #efefef;
        text-align: left;
    }
    .text-center {
        text-align: center;
    }
    .summary-section {
        margin-top: 12px;
    }
    .summary-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
    }
    .summary-card {
        border: 1px solid #d9d9d9;
        border-radius: 6px;
        padding: 8px 10px;
        background: #fafafa;
    }
    .summary-label {
        font-size: 10px;
        color: #666;
    }
    .summary-value {
        font-size: 15px;
        font-weight: 700;
        margin-top: 4px;
    }
    .signature-row {
        display: flex;
        gap: 18px;
        margin-top: 20px;
    }
    .signature-block {
        flex: 1;
    }
    .signature-line {
        border-bottom: 1px solid #000;
        height: 24px;
        margin-top: 16px;
    }
    .signature-label {
        font-size: 9px;
        text-align: center;
        margin-top: 4px;
        color: #666;
    }
    .stamp-row {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        margin-top: 12px;
    }
    .stamp-box {
        flex: 1;
        border: 1px dashed #9aa3b2;
        border-radius: 6px;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: #4b5563;
        background: #f8fafc;
    }
    table.table-compact {
        font-size: 9.2px;
    }
    table.table-compact th,
    table.table-compact td {
        padding: 5px 4px;
    }
    .footer {
        margin-top: 24px;
        font-size: 9px;
        text-align: center;
        color: #777;
    }
`;

const DOCUMENT_TYPE_PREFIX = {
    issuance: 'АКВ',
    transfer: 'АКП',
    acceptance: 'ПР',
    writeoff: 'АС'
};

function generateYearlyDocumentNumber(docType) {
    const normalizedType = String(docType || 'issuance').trim().toLowerCase();
    const prefix = DOCUMENT_TYPE_PREFIX[normalizedType] || 'АК';
    const year = new Date().getFullYear();
    const storageKey = `warehouse_doc_counter_${normalizedType}_${year}`;
    const next = Number(localStorage.getItem(storageKey) || '0') + 1;
    localStorage.setItem(storageKey, String(next));
    return `${prefix}-${String(next).padStart(6, '0')}`;
}

function generateDocumentNumber(prefix) {
    const normalized = String(prefix || '').toUpperCase();
    if (normalized.includes('ПРИЕМ')) return generateYearlyDocumentNumber('acceptance');
    if (normalized.includes('ВЫДАЧ')) return generateYearlyDocumentNumber('issuance');
    if (normalized.includes('АКТ')) return generateYearlyDocumentNumber('transfer');
    return generateYearlyDocumentNumber('issuance');
}

function registerGeneratedDocument(record) {
    if (typeof window.registerDocumentRecord !== 'function') return;
    window.registerDocumentRecord(record);
}

function calculateDocumentSummary(items) {
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    const damaged = items.reduce((sum, item) => {
        if (!['Повреждено', 'Утрачено', 'Требует ремонта'].includes(item.actualCondition)) return sum;
        const defective = Number(item.defectiveQuantity || 0);
        return sum + (defective > 0 ? defective : item.quantity);
    }, 0);
    const notReturned = items.reduce((sum, item) => sum + ((item.returnStatus === 'Не возвращено' || item.actualCondition === 'Утрачено') ? (Number(item.defectiveQuantity || 0) || item.quantity) : 0), 0);
    const accepted = Math.max(total - notReturned, 0);

    return { total, accepted, damaged, notReturned };
}

function renderIssueSummaryHtml(items) {
    const total = items.reduce((sum, item) => sum + item.quantity, 0);

    return `
        <div class="section summary-section">
            <div class="section-title">Сводка по документу</div>
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="summary-label">Позиций в документе</div>
                    <div class="summary-value">${items.length}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Всего объектов</div>
                    <div class="summary-value">${total}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Категорий задействовано</div>
                    <div class="summary-value">${new Set(items.map(item => item.category)).size}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Базовое состояние</div>
                    <div class="summary-value">Исправно</div>
                </div>
            </div>
        </div>
    `;
}

function renderSummaryHtml(items) {
    const summary = calculateDocumentSummary(items);

    return `
        <div class="section summary-section">
            <div class="section-title">Итоги по акту приёмки</div>
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="summary-label">Всего объектов</div>
                    <div class="summary-value">${summary.total}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Принято</div>
                    <div class="summary-value">${summary.accepted}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Повреждено</div>
                    <div class="summary-value">${summary.damaged}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Не возвращено</div>
                    <div class="summary-value">${summary.notReturned}</div>
                </div>
            </div>
        </div>
    `;
}

function renderInfoLines(lines) {
    return lines
        .filter(Boolean)
        .map(line => `<div class="info-line">• ${line}</div>`)
        .join('');
}

function renderIssueItemsTable(items, stateHeader = 'Состояние на момент выдачи') {
    return `
        <table>
            <thead>
                <tr>
                    <th>Наименование</th>
                    <th>Категория</th>
                    <th class="text-center">Количество</th>
                    <th>${escapeDocumentHtml(stateHeader)}</th>
                    <th>Комментарий</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => `
                    <tr>
                        <td>${escapeDocumentHtml(item.name)}</td>
                        <td>${escapeDocumentHtml(item.category)}</td>
                        <td class="text-center">${item.quantity}</td>
                        <td>${escapeDocumentHtml(item.issueCondition || 'Хорошее')}</td>
                        <td>${escapeDocumentHtml(item.comment || '—')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderAcceptanceItemsTable(items) {
    return `
        <table class="table-compact">
            <thead>
                <tr>
                    <th>Наименование</th>
                    <th>Категория</th>
                    <th class="text-center">Количество</th>
                    <th>Состояние ДО выдачи</th>
                    <th>Состояние ПОСЛЕ возврата</th>
                    <th class="text-center">Дефект</th>
                    <th>Статус возврата</th>
                    <th>Комментарий</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => `
                    <tr>
                        <td>${escapeDocumentHtml(item.name)}</td>
                        <td>${escapeDocumentHtml(item.category)}</td>
                        <td class="text-center">${item.quantity}</td>
                        <td>${escapeDocumentHtml(item.issueCondition || 'Хорошее')}</td>
                        <td>${escapeDocumentHtml(item.actualCondition || 'Хорошее')}<br><span style="color:#666;font-size:9px;">(Хорошее / Повреждено / Утрачено)</span></td>
                        <td class="text-center">${Number(item.defectiveQuantity || 0)}</td>
                        <td>${escapeDocumentHtml(item.returnStatus || 'Возвращено')}</td>
                        <td>${escapeDocumentHtml(item.comment || '—')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function normalizePurchaseActItems(items = []) {
    return (Array.isArray(items) ? items : []).map(item => {
        const required = Math.max(0, Number(item.requiredQuantity ?? item.required_quantity ?? item.quantity ?? 0));
        const received = Math.max(0, Number(item.receivedQuantity ?? item.received_quantity ?? 0));
        const unitPrice = Math.max(0, Number(item.unitPrice ?? item.unit_price ?? item.price ?? 0));
        const amount = received * unitPrice;
        return {
            name: String(item.itemName || item.name || item.item_id || item.itemId || 'Объект').trim() || 'Объект',
            category: String(item.category || item.itemCategory || '—').trim() || '—',
            required,
            received,
            unitPrice,
            amount,
            note: String(item.comment || item.note || item.status || '—').trim() || '—'
        };
    });
}

function renderPurchaseActItemsTable(items) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Наименование</th>
                    <th>Категория</th>
                    <th class="text-center">Требуется</th>
                    <th class="text-center">Поставлено</th>
                    <th class="text-center">Цена, ₽</th>
                    <th class="text-center">Сумма, ₽</th>
                    <th>Примечание</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => `
                    <tr>
                        <td>${escapeDocumentHtml(item.name)}</td>
                        <td>${escapeDocumentHtml(item.category)}</td>
                        <td class="text-center">${item.required}</td>
                        <td class="text-center">${item.received}</td>
                        <td class="text-center">${item.unitPrice.toLocaleString('ru-RU')}</td>
                        <td class="text-center">${item.amount.toLocaleString('ru-RU')}</td>
                        <td>${escapeDocumentHtml(item.note)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderDocumentHtml({
    title,
    subtitle = '',
    docNumber,
    currentDate,
    infoTitle,
    infoLines,
    itemsTitle,
    itemsTableHtml,
    summaryHtml = '',
    noteHtml = '',
    signatureLabels = ['От компании', 'Получатель'],
    footerText = ''
}) {
    return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <style>${DOCUMENT_TEMPLATE_STYLES}</style>
        </head>
        <body>
            <div class="document">
                <div class="header">
                    <div class="title">${escapeDocumentHtml(title)}</div>
                    ${subtitle ? `<div class="subtitle">${escapeDocumentHtml(subtitle)}</div>` : ''}
                </div>

                <div class="doc-info">
                    <div><strong>Номер документа:</strong> ${escapeDocumentHtml(docNumber)}</div>
                    <div><strong>Дата составления:</strong> ${escapeDocumentHtml(currentDate)}</div>
                </div>

                <div class="section">
                    <div class="section-title">${escapeDocumentHtml(infoTitle)}</div>
                    <div class="info-box">
                        ${renderInfoLines(infoLines)}
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">${escapeDocumentHtml(itemsTitle)}</div>
                    ${itemsTableHtml}
                </div>

                ${summaryHtml}

                ${noteHtml ? `
                    <div class="section">
                        <div class="section-title">Примечание</div>
                        <div class="note-box">${noteHtml}</div>
                    </div>
                ` : ''}

                <div class="section">
                    <div class="section-title">Подписи сторон</div>
                    <div class="signature-row">
                        <div class="signature-block">
                            <div>${escapeDocumentHtml(signatureLabels[0] || 'Передал')}</div>
                            <div class="signature-line"></div>
                            <div class="signature-label">(подпись, Ф.И.О., дата)</div>
                        </div>
                        <div class="signature-block">
                            <div>${escapeDocumentHtml(signatureLabels[1] || 'Принял')}</div>
                            <div class="signature-line"></div>
                            <div class="signature-label">(подпись, Ф.И.О., дата)</div>
                        </div>
                    </div>
                    <div class="stamp-row">
                        <div class="stamp-box">М.П.</div>
                        <div class="stamp-box">М.П.</div>
                    </div>
                </div>

                <div class="footer">${escapeDocumentHtml(footerText || `Документ сформирован ${currentDate}`)}</div>
            </div>
        </body>
        </html>
    `;
}

async function exportDocumentPdf(htmlContent, fileName, autoPrint = false) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    iframe.style.border = '0';
    iframe.style.opacity = '0.01';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-1';
    iframe.style.background = '#ffffff';
    document.body.appendChild(iframe);

    try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
            throw new Error('Не удалось создать документ для экспорта PDF');
        }

        iframeDoc.open();
        iframeDoc.write(htmlContent);
        iframeDoc.close();

        await new Promise(resolve => {
            const done = () => setTimeout(resolve, 300);
            iframe.onload = done;
            done();
        });

        if (iframeDoc.fonts?.ready) {
            try {
                await iframeDoc.fonts.ready;
            } catch {
                // ignore font loading issues and continue with system font fallback
            }
        }

        await new Promise(resolve => {
            const raf = iframe.contentWindow?.requestAnimationFrame?.bind(iframe.contentWindow)
                || window.requestAnimationFrame.bind(window);
            raf(() => raf(resolve));
        });

        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
            throw new Error('Не удалось подготовить окно печати');
        }

        iframeWindow.focus();

        iframeWindow.print();
        showNotification(autoPrint
            ? `Документ отправлен на печать: ${fileName}`
            : 'Открыт предпросмотр печати в текущей вкладке', 'success');
    } finally {
        setTimeout(() => iframe.remove(), 1500);
    }
}

async function generateTransferAct(rental, autoPrint = false, documentNumber = null) {
    if (!rental) {
        throw new Error('Данные аренды отсутствуют');
    }

    const items = getPreparedDocumentItems(rental, { commentMode: 'issuance' });
    const generatedNumber = documentNumber || generateYearlyDocumentNumber('transfer');
    if (items.length === 0) {
        showNotification('⚠ Невозможно сформировать акт: список объектов аренды пуст', 'warning');
        if (!documentNumber) {
            registerGeneratedDocument({
                docType: 'transfer',
                number: generatedNumber,
                date: new Date().toISOString(),
                basisType: 'rental',
                basisLabel: `Аренда №${rental.id || '—'}`,
                counterparty: rental.client_name || rental.renter || 'Не указан',
                amount: 0,
                items: [],
                entity: rental
            });
        }
        return;
    }

    const currentDate = formatDocumentDate(new Date());
    const infoLines = [
        `Аренда № ${escapeDocumentHtml(rental.id || '—')}`,
        `Арендатор: ${escapeDocumentHtml(rental.client_name || rental.renter || 'Не указан')}`,
        `Период аренды: ${escapeDocumentHtml(formatDocumentDate(rental.start_date || rental.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(rental.end_date || rental.returnDate))}`,
        `Ответственный: ${escapeDocumentHtml(rental.employee_name || rental.responsible || 'Не указан')}`
    ];

    const htmlContent = renderDocumentHtml({
        title: 'АКТ ПЕРЕДАЧИ ИНВЕНТАРЯ',
        subtitle: 'для аренды',
        docNumber: generatedNumber,
        currentDate,
        infoTitle: 'Информация по аренде',
        infoLines,
        itemsTitle: 'Перечень передаваемого инвентаря',
        itemsTableHtml: renderIssueItemsTable(items, 'Состояние при передаче'),
        summaryHtml: renderIssueSummaryHtml(items),
        noteHtml: 'Наименование объектов и категории автоматически подтягиваются из справочника склада. Если иное не указано в таблице, состояние считается хорошим.',
        signatureLabels: ['Передал со склада', 'Принял арендатор'],
        footerText: `Документ сформирован по аренде № ${rental.id || '—'}`
    });

    await exportDocumentPdf(htmlContent, `Акт передачи инвентаря - ${generatedNumber}.pdf`, autoPrint);

    if (!documentNumber) {
        registerGeneratedDocument({
            docType: 'transfer',
            number: generatedNumber,
            date: new Date().toISOString(),
            basisType: 'rental',
            basisLabel: `Аренда №${rental.id || '—'}`,
            counterparty: rental.client_name || rental.renter || 'Не указан',
            amount: Number((rental.items || []).reduce((sum, item) => sum + Number(item.rent_price || item.rentPrice || 0), 0)),
            items,
            entity: rental
        });
    }
}

async function generateIssuanceAct(rental, autoPrint = false, documentNumber = null) {
    if (!rental) {
        throw new Error('Данные аренды отсутствуют');
    }

    const items = getPreparedDocumentItems(rental, { commentMode: 'issuance' });
    const generatedNumber = documentNumber || generateYearlyDocumentNumber('issuance');
    if (items.length === 0) {
        showNotification('⚠ Невозможно сформировать акт: список объектов аренды пуст', 'warning');
        if (!documentNumber) {
            registerGeneratedDocument({
                docType: 'issuance',
                number: generatedNumber,
                date: new Date().toISOString(),
                basisType: 'rental',
                basisLabel: `Аренда №${rental.id || '—'}`,
                counterparty: rental.client_name || rental.renter || 'Не указан',
                amount: 0,
                items: [],
                entity: rental
            });
        }
        return;
    }

    const currentDate = formatDocumentDate(new Date());
    const infoLines = [
        `Получатель: ${escapeDocumentHtml(rental.client_name || rental.renter || 'Не указан')}`,
        `Период использования: ${escapeDocumentHtml(formatDocumentDate(rental.start_date || rental.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(rental.end_date || rental.returnDate))}`,
        `Ответственный сотрудник: ${escapeDocumentHtml(rental.employee_name || rental.responsible || 'Не указан')}`
    ];

    const htmlContent = renderDocumentHtml({
        title: 'АКТ ВЫДАЧИ ИНВЕНТАРЯ',
        subtitle: 'по договору аренды',
        docNumber: generatedNumber,
        currentDate,
        infoTitle: 'Сведения о выдаче',
        infoLines,
        itemsTitle: 'Выданные объекты',
        itemsTableHtml: renderIssueItemsTable(items, 'Состояние на момент выдачи'),
        summaryHtml: renderIssueSummaryHtml(items),
        noteHtml: '<strong>Важно:</strong> Получатель несёт ответственность за сохранность инвентаря и обязан сообщать о повреждениях или утрате.',
        signatureLabels: ['Материально ответственное лицо', 'Получивший инвентарь'],
        footerText: `Документ сформирован по аренде № ${rental.id || '—'}`
    });

    await exportDocumentPdf(htmlContent, `Акт выдачи инвентаря - ${generatedNumber}.pdf`, autoPrint);

    if (!documentNumber) {
        registerGeneratedDocument({
            docType: 'issuance',
            number: generatedNumber,
            date: new Date().toISOString(),
            basisType: 'rental',
            basisLabel: `Аренда №${rental.id || '—'}`,
            counterparty: rental.client_name || rental.renter || 'Не указан',
            amount: Number((rental.items || []).reduce((sum, item) => sum + Number(item.rent_price || item.rentPrice || 0), 0)),
            items,
            entity: rental
        });
    }
}

async function generateAcceptanceAct(rental, autoPrint = false, documentNumber = null) {
    if (!rental) {
        throw new Error('Данные аренды отсутствуют');
    }

    const items = getPreparedDocumentItems(rental, { commentMode: 'acceptance' });
    const generatedNumber = documentNumber || String(rental.acceptance_act_number || rental.acceptanceActNumber || '').trim() || generateYearlyDocumentNumber('acceptance');
    if (items.length === 0) {
        showNotification('⚠ Невозможно сформировать акт: список объектов аренды пуст', 'warning');
        if (!documentNumber) {
            registerGeneratedDocument({
                docType: 'acceptance',
                number: generatedNumber,
                date: new Date().toISOString(),
                basisType: 'rental',
                basisLabel: `Аренда №${rental.id || '—'}`,
                counterparty: rental.client_name || rental.renter || 'Не указан',
                items: [],
                entity: rental
            });
        }
        return;
    }

    const currentDate = formatDocumentDate(new Date());
    const infoLines = [
        `Арендатор: ${escapeDocumentHtml(rental.client_name || rental.renter || 'Не указан')}`,
        `Период аренды: ${escapeDocumentHtml(formatDocumentDate(rental.start_date || rental.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(rental.end_date || rental.returnDate))}`,
        `Ответственный сотрудник: ${escapeDocumentHtml(rental.employee_name || rental.responsible || 'Не указан')}`
    ];

    const htmlContent = renderDocumentHtml({
        title: 'АКТ ПРИЁМКИ ИНВЕНТАРЯ',
        subtitle: 'возврат по аренде',
        docNumber: generatedNumber,
        currentDate,
        infoTitle: 'Информация по возврату',
        infoLines,
        itemsTitle: 'Возвращённые объекты',
        itemsTableHtml: renderAcceptanceItemsTable(items),
        summaryHtml: renderSummaryHtml(items),
        noteHtml: 'В акте отображаются поля <strong>«Фактическое состояние»</strong> и <strong>«Комментарий»</strong>. Итоги автоматически считают: сколько объектов принято, сколько повреждено и сколько не возвращено.',
        signatureLabels: ['Принимающий со стороны компании', 'Сдающий инвентарь'],
        footerText: `Документ сформирован по аренде № ${rental.id || '—'}`
    });

    await exportDocumentPdf(htmlContent, `Акт приемки инвентаря - ${generatedNumber}.pdf`, autoPrint);

    const isPartial = items.some(item => String(item.returnStatus || '').toLowerCase().includes('не возвращ') || String(item.actualCondition || '').toLowerCase().includes('утрач'));
    if (!documentNumber) {
        registerGeneratedDocument({
            docType: 'acceptance',
            number: generatedNumber,
            date: new Date().toISOString(),
            basisType: 'rental',
            basisLabel: `Аренда №${rental.id || '—'}`,
            counterparty: rental.client_name || rental.renter || 'Не указан',
            items,
            entity: rental,
            status: isPartial ? 'Частично' : undefined
        });
    }
}

async function generateIssuanceActForEvent(event, autoPrint = false, documentNumber = null) {
    if (!event) {
        throw new Error('Данные мероприятия отсутствуют');
    }

    const items = getPreparedDocumentItems(event, { commentMode: 'issuance' });
    const generatedNumber = documentNumber || generateYearlyDocumentNumber('issuance');
    if (items.length === 0) {
        showNotification('⚠ Невозможно сформировать акт: список объектов мероприятия пуст', 'warning');
        if (!documentNumber) {
            registerGeneratedDocument({
                docType: 'issuance',
                number: generatedNumber,
                date: new Date().toISOString(),
                basisType: 'event',
                basisLabel: `Мероприятие №${event.id || '—'}`,
                counterparty: event.location || event.name || 'Не указан',
                amount: 0,
                items: [],
                entity: event
            });
        }
        return;
    }

    const currentDate = formatDocumentDate(new Date());
    const infoLines = [
        `Мероприятие: ${escapeDocumentHtml(event.name || event.event_name || 'Не указано')}`,
        `Даты проведения: ${escapeDocumentHtml(formatDocumentDate(event.start_date || event.event_date))} — ${escapeDocumentHtml(formatDocumentDate(event.end_date || event.event_date))}`,
        `Место: ${escapeDocumentHtml(event.location || 'Не указано')}`,
        `Ответственный: ${escapeDocumentHtml(event.employee_name || 'Не указан')}`
    ];

    const htmlContent = renderDocumentHtml({
        title: 'АКТ ВЫДАЧИ ИНВЕНТАРЯ НА МЕРОПРИЯТИЕ',
        docNumber: generatedNumber,
        currentDate,
        infoTitle: 'Информация о мероприятии',
        infoLines,
        itemsTitle: 'Инвентарь для мероприятия',
        itemsTableHtml: renderIssueItemsTable(items, 'Состояние на момент выдачи'),
        summaryHtml: renderIssueSummaryHtml(items),
        noteHtml: 'Акт формируется по выбранному мероприятию и включает все закреплённые за ним объекты.',
        signatureLabels: ['Материально ответственное лицо', 'Ответственный за мероприятие'],
        footerText: `Документ сформирован по мероприятию № ${event.id || '—'}`
    });

    await exportDocumentPdf(htmlContent, `Акт выдачи на мероприятие - ${generatedNumber}.pdf`, autoPrint);

    if (!documentNumber) {
        registerGeneratedDocument({
            docType: 'issuance',
            number: generatedNumber,
            date: new Date().toISOString(),
            basisType: 'event',
            basisLabel: `Мероприятие №${event.id || '—'}`,
            counterparty: event.location || event.name || 'Не указан',
            amount: 0,
            items,
            entity: event
        });
    }
}

async function generateAcceptanceActForEvent(event, autoPrint = false, documentNumber = null) {
    if (!event) {
        throw new Error('Данные мероприятия отсутствуют');
    }

    const items = getPreparedDocumentItems(event, { commentMode: 'acceptance' });
    const generatedNumber = documentNumber || String(event.acceptance_act_number || event.acceptanceActNumber || '').trim() || generateYearlyDocumentNumber('acceptance');
    if (items.length === 0) {
        showNotification('⚠ Невозможно сформировать акт: список объектов мероприятия пуст', 'warning');
        if (!documentNumber) {
            registerGeneratedDocument({
                docType: 'acceptance',
                number: generatedNumber,
                date: new Date().toISOString(),
                basisType: 'event',
                basisLabel: `Мероприятие №${event.id || '—'}`,
                counterparty: event.location || event.name || 'Не указан',
                items: [],
                entity: event
            });
        }
        return;
    }

    const currentDate = formatDocumentDate(new Date());
    const infoLines = [
        `Мероприятие: ${escapeDocumentHtml(event.name || event.event_name || 'Не указано')}`,
        `Период проведения: ${escapeDocumentHtml(formatDocumentDate(event.start_date || event.event_date))} — ${escapeDocumentHtml(formatDocumentDate(event.end_date || event.event_date))}`,
        `Место: ${escapeDocumentHtml(event.location || 'Не указано')}`,
        `Ответственный: ${escapeDocumentHtml(event.employee_name || 'Не указан')}`
    ];

    const htmlContent = renderDocumentHtml({
        title: 'АКТ ПРИЁМКИ ИНВЕНТАРЯ С МЕРОПРИЯТИЯ',
        docNumber: generatedNumber,
        currentDate,
        infoTitle: 'Информация о возврате с мероприятия',
        infoLines,
        itemsTitle: 'Возвращённые объекты',
        itemsTableHtml: renderAcceptanceItemsTable(items),
        summaryHtml: renderSummaryHtml(items),
        noteHtml: 'Для каждого объекта показываются: правильное название из справочника, категория, фактическое состояние и комментарий по замечаниям.',
        signatureLabels: ['Принимающий со стороны склада', 'Ответственный за мероприятие'],
        footerText: `Документ сформирован по мероприятию № ${event.id || '—'}`
    });

    await exportDocumentPdf(htmlContent, `Акт приемки с мероприятия - ${generatedNumber}.pdf`, autoPrint);

    const isPartial = items.some(item => String(item.returnStatus || '').toLowerCase().includes('не возвращ') || String(item.actualCondition || '').toLowerCase().includes('утрач'));
    if (!documentNumber) {
        registerGeneratedDocument({
            docType: 'acceptance',
            number: generatedNumber,
            date: new Date().toISOString(),
            basisType: 'event',
            basisLabel: `Мероприятие №${event.id || '—'}`,
            counterparty: event.location || event.name || 'Не указан',
            items,
            entity: event,
            status: isPartial ? 'Частично' : undefined
        });
    }
}

function resolveDocumentEntity(doc, basisType) {
    if (doc?.entity && typeof doc.entity === 'object' && Array.isArray(doc.entity.items) && doc.entity.items.length) {
        return doc.entity;
    }
    const basisId = Number(doc?.basisId || doc?.entity?.id || 0);
    if (basisType === 'rental' && basisId > 0 && typeof rentals !== 'undefined' && Array.isArray(rentals)) {
        return rentals.find(entry => Number(entry?.id || 0) === basisId) || {};
    }
    if (basisType === 'event' && basisId > 0 && typeof events !== 'undefined' && Array.isArray(events)) {
        return events.find(entry => Number(entry?.id || 0) === basisId) || {};
    }
    return doc?.entity || {};
}

window.buildDocumentPdfPreviewByType = function buildDocumentPdfPreviewByType(doc) {
    if (!doc) return null;
    const docType = String(doc.docType || '').toLowerCase();
    const basisType = String(doc.basisType || '').toLowerCase();
    const entity = resolveDocumentEntity(doc, basisType);
    const existingNumber = String(doc.number || '').trim() || '—';
    const currentDate = formatDocumentDate(doc?.date || new Date());

    if (docType === 'transfer') {
        const items = getPreparedDocumentItems(entity, { commentMode: 'issuance' });
        return {
            fileName: `Акт передачи инвентаря - ${existingNumber}.pdf`,
            html: renderDocumentHtml({
                title: 'АКТ ПЕРЕДАЧИ ИНВЕНТАРЯ',
                subtitle: 'для аренды',
                docNumber: existingNumber,
                currentDate,
                infoTitle: 'Информация по аренде',
                infoLines: [
                    `Аренда № ${escapeDocumentHtml(entity.id || '—')}`,
                    `Арендатор: ${escapeDocumentHtml(entity.client_name || entity.renter || 'Не указан')}`,
                    `Период аренды: ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.returnDate))}`
                ],
                itemsTitle: 'Перечень передаваемого инвентаря',
                itemsTableHtml: renderIssueItemsTable(items, 'Состояние при передаче'),
                summaryHtml: renderIssueSummaryHtml(items),
                noteHtml: 'Наименование и категории подтягиваются из справочника склада.',
                signatureLabels: ['Передал со склада', 'Принял арендатор'],
                footerText: `Документ сформирован ${currentDate}`
            })
        };
    }

    if (docType === 'issuance') {
        const items = getPreparedDocumentItems(entity, { commentMode: 'issuance' });
        const isEvent = basisType === 'event';
        return {
            fileName: `Акт выдачи - ${existingNumber}.pdf`,
            html: renderDocumentHtml({
                title: isEvent ? 'АКТ ВЫДАЧИ ИНВЕНТАРЯ НА МЕРОПРИЯТИЕ' : 'АКТ ВЫДАЧИ ИНВЕНТАРЯ',
                subtitle: isEvent ? 'по мероприятию' : 'по договору аренды',
                docNumber: existingNumber,
                currentDate,
                infoTitle: isEvent ? 'Информация о мероприятии' : 'Сведения о выдаче',
                infoLines: isEvent
                    ? [
                        `Мероприятие: ${escapeDocumentHtml(entity.name || entity.event_name || 'Не указано')}`,
                        `Даты проведения: ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.event_date))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.event_date))}`
                    ]
                    : [
                        `Получатель: ${escapeDocumentHtml(entity.client_name || entity.renter || 'Не указан')}`,
                        `Период использования: ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.returnDate))}`
                    ],
                itemsTitle: 'Выданные объекты',
                itemsTableHtml: renderIssueItemsTable(items, 'Состояние на момент выдачи'),
                summaryHtml: renderIssueSummaryHtml(items),
                noteHtml: 'Получатель несет ответственность за сохранность инвентаря.',
                signatureLabels: ['Материально ответственное лицо', isEvent ? 'Ответственный за мероприятие' : 'Получивший инвентарь'],
                footerText: `Документ сформирован ${currentDate}`
            })
        };
    }

    if (docType === 'acceptance') {
        const items = getPreparedDocumentItems(entity, { commentMode: 'acceptance' });
        const isEvent = basisType === 'event';
        return {
            fileName: `Акт приемки - ${existingNumber}.pdf`,
            html: renderDocumentHtml({
                title: isEvent ? 'АКТ ПРИЁМКИ ИНВЕНТАРЯ С МЕРОПРИЯТИЯ' : 'АКТ ПРИЁМКИ ИНВЕНТАРЯ',
                subtitle: isEvent ? 'возврат с мероприятия' : 'возврат по аренде',
                docNumber: existingNumber,
                currentDate,
                infoTitle: 'Информация по возврату',
                infoLines: isEvent
                    ? [
                        `Мероприятие: ${escapeDocumentHtml(entity.name || entity.event_name || 'Не указано')}`,
                        `Период проведения: ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.event_date))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.event_date))}`
                    ]
                    : [
                        `Арендатор: ${escapeDocumentHtml(entity.client_name || entity.renter || 'Не указан')}`,
                        `Период аренды: ${escapeDocumentHtml(formatDocumentDate(entity.start_date || entity.rentDate))} — ${escapeDocumentHtml(formatDocumentDate(entity.end_date || entity.returnDate))}`
                    ],
                itemsTitle: 'Возвращённые объекты',
                itemsTableHtml: renderAcceptanceItemsTable(items),
                summaryHtml: renderSummaryHtml(items),
                noteHtml: 'Итоги автоматически считают принятое, поврежденное и невозвращенное.',
                signatureLabels: ['Принимающий со стороны компании', isEvent ? 'Ответственный за мероприятие' : 'Сдающий инвентарь'],
                footerText: `Документ сформирован ${currentDate}`
            })
        };
    }

    if (docType === 'purchase_act') {
        const items = normalizePurchaseActItems(doc?.items || doc?.entity?.items || []);
        return {
            fileName: `Акт закупки - ${existingNumber}.pdf`,
            html: renderDocumentHtml({
                title: 'АКТ ЗАКУПКИ',
                subtitle: 'поступление товарно-материальных ценностей',
                docNumber: existingNumber,
                currentDate,
                infoTitle: 'Информация по документу',
                infoLines: [
                    `Основание: ${escapeDocumentHtml(doc?.basisLabel || doc?.basis || '—')}`,
                    `Контрагент: ${escapeDocumentHtml(doc?.counterparty || doc?.supplier || 'Не указан')}`,
                    `Статус: ${escapeDocumentHtml(doc?.status || 'Черновик')}`
                ],
                itemsTitle: 'Состав поставки',
                itemsTableHtml: renderPurchaseActItemsTable(items),
                summaryHtml: renderIssueSummaryHtml(items.map(item => ({ quantity: item.received, category: item.category }))),
                noteHtml: 'Поступление отражается на складе только после проведения акта закупки.',
                signatureLabels: ['Передал поставщик', 'Принял ответственный со склада'],
                footerText: `Документ сформирован ${currentDate}`
            })
        };
    }

    return null;
};

// Скачивание существующего документа - НЕ печать, просто скачивание
window.downloadDocumentPdfByType = async function downloadDocumentPdfByType(doc) {
    const payload = window.buildDocumentPdfPreviewByType?.(doc);
    if (!payload?.html) {
        const typeLabel = String(doc?.docType || 'неизвестно');
        showNotification(`PDF для типа "${typeLabel}" пока не поддерживается`, 'warning');
        return;
    }
    await exportDocumentPdf(payload.html, payload.fileName || 'Документ.pdf', false);
};

window.generateYearlyDocumentNumber = generateYearlyDocumentNumber;
