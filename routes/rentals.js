const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { normalizeInventoryStatus, logInventoryMovement, syncInventoryStatus } = require('../inventory-utils');
const { normalizeAccountingType, inferWriteoffReasonCategory, createPurchaseRequest, createWriteoffAct } = require('../accounting-utils');

function normalizeRentalStatus(status) {
  return String(status || '').trim();
}

function isCompletedStatus(status) {
  return normalizeRentalStatus(status) === 'Завершена';
}

function isDraftStatus(status) {
  return normalizeRentalStatus(status) === 'Черновик';
}

function affectsInventory(status) {
  const normalized = normalizeRentalStatus(status);
  if (isDraftStatus(normalized) || isCompletedStatus(normalized)) return false;
  return ['Активна', 'Активно', 'Просрочена', 'Проведен'].includes(normalized);
}

function normalizeCondition(value, fallback = 'Хорошее') {
  const raw = String(value || fallback).trim();
  const normalized = raw.toLowerCase().replace(/ё/g, 'е');

  if (!raw) return fallback;
  if (/утрач|lost|не\s*возвращ/.test(normalized)) return 'Утрачено';
  if (/спис|утилиз|write\s*-?\s*off/.test(normalized)) return 'Подлежит списанию';
  if (/ремонт|repair/.test(normalized)) return 'Требует ремонта';
  if (/повреж|дефект|broken/.test(normalized)) return 'Повреждено';
  return 'Хорошее';
}

function normalizeReturnStatus(condition, explicitStatus) {
  const explicit = String(explicitStatus || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (/не\s*возвращ|утрач/.test(explicit)) return 'Не возвращено';
  if (/замеч/.test(explicit)) return 'Возвращено с замечаниями';
  if (/спис|утилиз/.test(explicit)) return 'Возвращено с замечаниями';

  const normalizedCondition = normalizeCondition(condition).toLowerCase().replace(/ё/g, 'е');
  if (normalizedCondition === 'утрачено') return 'Не возвращено';
  if (normalizedCondition === 'подлежит списанию') return 'Возвращено с замечаниями';
  if (normalizedCondition === 'повреждено' || normalizedCondition === 'требует ремонта') return 'Возвращено с замечаниями';
  return 'Возвращено';
}

function ensureValidDateRange(startDate, endDate, label = 'аренды') {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Некорректная дата ${label}`);
  }

  if (start.getTime() > end.getTime()) {
    throw new Error(`Дата начала ${label} не может быть позже даты окончания`);
  }
}

function parsePackedDocumentComments(rawComment = '') {
  const raw = String(rawComment || '').trim();
  if (!raw) {
    return { issueComment: '', acceptanceComment: '', writeoffComment: '' };
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
    // plain text legacy format
  }

  return { issueComment: raw, acceptanceComment: raw, writeoffComment: '' };
}

function mapRentalItem(item = {}) {
  const quantity = Number(item.quantity ?? item.qty ?? 0);
  const actualCondition = normalizeCondition(item.actual_condition || item.actualCondition || item.condition, 'Хорошее');
  const rawDefectiveQuantity = Number(item.defective_quantity ?? item.defectiveQuantity ?? 0);
  const defectiveQuantity = Number.isFinite(rawDefectiveQuantity)
    ? Math.max(0, Math.min(quantity, rawDefectiveQuantity))
    : 0;
  const packedComments = parsePackedDocumentComments(item.comment || item.notes || '');
  const writeoffComment = String(item.writeoff_comment || item.writeoffComment || packedComments.writeoffComment || '').trim();

  return {
    itemId: item.item_id || item.itemId || null,
    category: item.category || null,
    quantity,
    rentPrice: item.rent_price ?? item.rentPrice ?? null,
    issueCondition: normalizeCondition(item.issue_condition || item.issueCondition || 'Хорошее'),
    actualCondition,
    returnStatus: normalizeReturnStatus(actualCondition, item.return_status || item.returnStatus),
    defectiveQuantity,
    externalSource: item.external_source === true || item.externalSource === true,
    procurementMode: String(item.procurement_mode || item.procurementMode || 'warehouse').trim() || 'warehouse',
    writeoffDecision: String(item.writeoff_decision || item.writeoffDecision || '').trim(),
    writeoffReason: String(item.writeoff_reason || item.writeoffReason || '').trim(),
    comment: String(item.comment || item.notes || '').trim(),
    writeoffComment,
    damagePhoto: item.damage_photo || item.damagePhoto || null
  };
}

async function getRentalMeta(client, rentalId) {
  const result = await client.query(
    `SELECT c.name AS client_name, e.name AS employee_name
     FROM rentals r
     LEFT JOIN clients c ON c.id = r.client_id
     LEFT JOIN employees e ON e.id = r.employee_id
     WHERE r.id = $1`,
    [rentalId]
  );

  return result.rows[0] || { client_name: 'Не указан', employee_name: 'Не указан' };
}

async function createIssuanceAct(client, sourceType, sourceId, createdBy) {
  const result = await client.query(
    `INSERT INTO issuance_acts (act_number, source_type, source_id, created_by, status)
     VALUES ('TEMP', $1, $2, $3, 'Проведен')
     RETURNING id`,
    [sourceType, sourceId, createdBy || 'system']
  );
  const actId = result.rows[0].id;
  const prefix = sourceType === 'rental' ? 'АКП' : 'АКВ';
  const actNumber = `${prefix}-${String(actId).padStart(6, '0')}`;
  await client.query(`UPDATE issuance_acts SET act_number = $1 WHERE id = $2`, [actNumber, actId]);
  return { actId, actNumber };
}

async function logRentalInventoryMovement(client, rentalId, items, operationType, direction = 'issue', options = {}) {
  if (!rentalId || !Array.isArray(items) || items.length === 0) return;

  const meta = await getRentalMeta(client, rentalId);
  const responsibleName = [meta.employee_name, meta.client_name].filter(Boolean).join(' / ');

  for (const rawItem of items) {
    const item = mapRentalItem(rawItem);
    if (!item.itemId || !item.quantity) continue;

    const stockResult = await client.query('SELECT name, category FROM inventory WHERE id = $1', [item.itemId]);
    const stockRow = stockResult.rows[0] || {};

    await logInventoryMovement(client, {
      inventoryId: item.itemId,
      itemName: stockRow.name || item.itemName || item.item_id || item.itemId,
      category: stockRow.category || item.category || '',
      operationType,
      quantity: Number(item.quantity || 0),
      responsibleName,
      sourceLocation: direction === 'issue' ? 'Склад' : `Аренда №${rentalId}`,
      destinationLocation: direction === 'issue' ? `Аренда №${rentalId}` : 'Склад',
      documentType: 'rental',
      documentId: Number(rentalId),
      operationContext: 'rental',
      notes: options.notes || item.comment || '',
      createdBy: options.createdBy || 'system'
    });
  }
}

async function syncStatusesForRentalItems(client, items) {
  const itemIds = (items || [])
    .filter(item => item.external_source !== true && item.externalSource !== true)
    .map(item => item.item_id || item.itemId)
    .filter(Boolean);
  if (itemIds.length) {
    await syncInventoryStatus(client, itemIds);
  }
}

async function ensureItemsAvailable(client, items, { checkAvailability = true } = {}) {
  for (const item of items) {
    if (item.externalSource === true || item.external_source === true) {
      continue;
    }

    if (!item.itemId) {
      throw new Error('Ошибка: найден товар без item_id в позиции аренды');
    }

    if (!item.quantity || item.quantity <= 0) {
      throw new Error(`Ошибка: некорректное количество для товара ${item.itemId}`);
    }

    const stockResult = await client.query('SELECT name, quantity, status, type, requires_purchase FROM inventory WHERE id = $1', [item.itemId]);
    if (stockResult.rows.length === 0) {
      throw new Error(`Предмет ${item.itemId} не найден`);
    }

    const stockRow = stockResult.rows[0];
    const itemName = String(stockRow.name || item.itemId);
    const inventoryStatus = normalizeInventoryStatus(stockRow.status || 'В наличии');
    if (inventoryStatus === 'На реставрации') {
      throw new Error(`Проведение невозможно: объект «${itemName}» (ID ${item.itemId}) имеет статус «На реставрации». Верните объект в статус «В наличии» или замените его в позициях аренды.`);
    }
    if (inventoryStatus === 'Списано') {
      throw new Error(`Проведение невозможно: объект «${itemName}» (ID ${item.itemId}) имеет статус «Списано». Списанный объект нельзя выдать. Удалите его из документа или выберите другой объект.`);
    }
    if (inventoryStatus === 'К списанию') {
      throw new Error(`Проведение невозможно: объект «${itemName}» (ID ${item.itemId}) имеет статус «К списанию». Сначала продлите срок эксплуатации или замените объект в позициях аренды.`);
    }

    const usageResult = await client.query(
      `SELECT
         COALESCE((
           SELECT SUM(ri.quantity)
           FROM rental_items ri
           INNER JOIN rentals r ON r.id = ri.rental_id
           WHERE ri.item_id = $1
             AND COALESCE(ri.external_source, FALSE) = FALSE
             AND COALESCE(NULLIF(TRIM(r.status), ''), 'Черновик') IN ('Активна', 'Активно', 'Просрочена', 'Проведен')
         ), 0) AS in_rental,
         COALESCE((
           SELECT SUM(ei.quantity)
           FROM event_items ei
           INNER JOIN events e ON e.id = ei.event_id
           WHERE ei.item_id = $1
             AND COALESCE(ei.external_source, FALSE) = FALSE
             AND COALESCE(NULLIF(TRIM(e.status), ''), 'Черновик') IN ('Активно', 'Активна', 'Просрочена', 'Проведен')
         ), 0) AS in_event`,
      [item.itemId]
    );

    const inRental = Number(usageResult.rows[0]?.in_rental || 0);
    const inEvent = Number(usageResult.rows[0]?.in_event || 0);
    const available = Math.max(0, Number(stockRow.quantity || 0) - inRental - inEvent);
    const accountingType = normalizeAccountingType(stockRow.type || 'asset');
    const requiresPurchase = stockRow.requires_purchase === true;

    if (checkAvailability && available < item.quantity && !(accountingType === 'consumable' && requiresPurchase)) {
      const nameResult = await client.query('SELECT name FROM inventory WHERE id = $1', [item.itemId]);
      const name = nameResult.rows[0]?.name || item.itemId;
      throw new Error(`Недостаточно «${name}» на складе (остаток: ${available}, требуется: ${item.quantity})`);
    }
  }
}

async function rollbackIssuedItemsToInventory(client, items) {
  // В новой модели общее количество не меняется при выдаче в аренду/мероприятия.
  return;
}

async function returnItemsToInventory(client, items, context = {}) {
  for (const item of items) {
    if (item.externalSource === true || item.external_source === true) continue;

    const stockResult = await client.query(
      'SELECT id, name, status FROM inventory WHERE id = $1 FOR UPDATE',
      [item.itemId]
    );
    const stockRow = stockResult.rows[0];
    if (!stockRow) continue;

    const newStatus = context.sourceType === 'rental' ? 'В аренде' : 'На мероприятии';

    await client.query(
      'UPDATE inventory SET status = $1 WHERE id = $2',
      [newStatus, item.itemId]
    );
  }
}

async function issueItemsFromInventory(client, items, context = {}) {
  const consumableWriteoffItems = [];

  for (const item of items) {
    if (item.externalSource === true || item.external_source === true) continue;

    const stockResult = await client.query(
      'SELECT id, name, quantity, status, type, requires_purchase FROM inventory WHERE id = $1 FOR UPDATE',
      [item.itemId]
    );
    const stockRow = stockResult.rows[0];
    if (!stockRow) continue;

    const lockedStatus = normalizeInventoryStatus(stockRow.status || 'В наличии');
    if (lockedStatus === 'К списанию' || lockedStatus === 'Списано') {
      throw new Error(`Выдача невозможна: объект «${stockRow.name || item.itemId}» имеет статус «${lockedStatus}».`);
    }

    const usageResult = await client.query(
      `SELECT
         COALESCE((
           SELECT SUM(ri.quantity)
           FROM rental_items ri
           INNER JOIN rentals r ON r.id = ri.rental_id
           WHERE ri.item_id = $1
             AND COALESCE(ri.external_source, FALSE) = FALSE
             AND COALESCE(NULLIF(TRIM(r.status), ''), 'Черновик') IN ('Активна', 'Активно', 'Просрочена', 'Проведен')
             AND ($2::INTEGER IS NULL OR r.id <> $2)
         ), 0) AS in_rental,
         COALESCE((
           SELECT SUM(ei.quantity)
           FROM event_items ei
           INNER JOIN events e ON e.id = ei.event_id
           WHERE ei.item_id = $1
             AND COALESCE(ei.external_source, FALSE) = FALSE
             AND COALESCE(NULLIF(TRIM(e.status), ''), 'Черновик') IN ('Активно', 'Активна', 'Просрочена', 'Проведен')
             AND ($3::INTEGER IS NULL OR e.id <> $3)
         ), 0) AS in_event`,
      [
        item.itemId,
        context.sourceType === 'rental' ? Number(context.sourceId || 0) : null,
        context.sourceType === 'event' ? Number(context.sourceId || 0) : null
      ]
    );

    const inRental = Number(usageResult.rows[0]?.in_rental || 0);
    const inEvent = Number(usageResult.rows[0]?.in_event || 0);
    const available = Math.max(0, Number(stockRow.quantity || 0) - inRental - inEvent);
    const requested = Number(item.quantity || 0);
    const shortage = Math.max(0, requested - available);
    const accountingType = normalizeAccountingType(stockRow.type || 'asset');
    const explicitWriteoffReason = String(item.writeoffReason || item.writeoff_reason || '').trim();

    if (shortage > 0 && accountingType === 'consumable' && stockRow.requires_purchase === true) {
      await createPurchaseRequest(client, {
        itemId: stockRow.id,
        requestedQuantity: requested,
        availableQuantity: available,
        sourceType: context.sourceType || 'rental',
        sourceId: context.sourceId || null,
        notes: `Автозаявка при выдаче по аренде №${context.sourceId || ''}`.trim(),
        createdBy: context.createdBy || 'system'
      });
    }

    if (accountingType === 'consumable' && requested > 0) {
      const reason = explicitWriteoffReason || 'Использован';
      consumableWriteoffItems.push({
        itemId: stockRow.id,
        quantity: requested,
        reason,
        reasonCategory: 'consumable',
        comment: String(item.comment || '').trim(),
        itemName: stockRow.name,
        basisType: 'rental',
        basisId: context.sourceId || null,
        basisLabel: context.sourceId ? `Аренда №${context.sourceId}` : 'Аренда',
        basisName: context.sourceId ? `Аренда №${context.sourceId}` : 'Аренда',
        basisActNumber: ''
      });
    }

    // В новой модели выдача резервирует доступное количество, но не меняет общее количество.
  }

  if (context.registerWriteoff === true && consumableWriteoffItems.length && Number(context.sourceId || 0) > 0) {
    const rentalId = Number(context.sourceId);
    const meta = await getRentalMeta(client, rentalId);

    await createWriteoffAct(client, {
      basisType: 'rental',
      basisId: rentalId,
      basisLabel: `Выдача по аренде №${rentalId}`,
      basisName: meta.client_name ? `Аренда: ${meta.client_name}` : `Аренда №${rentalId}`,
      reason: 'Автоматическое списание расходников при выдаче в аренду',
      signature: context.createdBy || 'Ответственный',
      responsiblePosition: 'Кладовщик',
      createdBy: context.createdBy || 'system',
      items: consumableWriteoffItems
    });
  }
}

async function ensureConsumablesInWriteoffDraft(client, rentalId, items, createdBy = 'system') {
  const normalizedRentalId = Number(rentalId || 0);
  if (!normalizedRentalId) return;

  const writeoffItems = [];
  for (const item of items) {
    if (item.external_source === true || item.externalSource === true) continue;

    const itemId = String(item.item_id || item.itemId || '').trim();
    const quantity = Math.max(0, Number(item.quantity || 0));
    if (!itemId || quantity <= 0) continue;

    const stockResult = await client.query(
      'SELECT id, name, type FROM inventory WHERE id = $1 FOR UPDATE',
      [itemId]
    );
    const stockRow = stockResult.rows[0];
    if (!stockRow) continue;
    if (normalizeAccountingType(stockRow.type || 'asset') !== 'consumable') continue;

    const existingResult = await client.query(
      `SELECT COALESCE(SUM(wai.quantity), 0)::numeric AS qty
       FROM writeoff_act_items wai
       INNER JOIN writeoff_acts wa ON wa.id = wai.act_id
       WHERE wai.item_id = $1
         AND wai.basis_type = 'rental'
         AND wai.basis_id = $2
         AND COALESCE(NULLIF(TRIM(wa.status), ''), 'Черновик') IN ('Черновик', 'На согласовании', 'Частично')`,
      [itemId, normalizedRentalId]
    );
    const alreadyRegistered = Math.max(0, Number(existingResult.rows[0]?.qty || 0));
    const missingQty = Math.max(0, quantity - alreadyRegistered);
    if (missingQty <= 0) continue;

    writeoffItems.push({
      itemId,
      quantity: missingQty,
      reason: 'Использован',
      reasonCategory: 'consumable',
      comment: String(item.comment || '').trim(),
      itemName: stockRow.name
    });
  }

  if (!writeoffItems.length) return;

  const meta = await getRentalMeta(client, normalizedRentalId);
  await createWriteoffAct(client, {
    basisType: 'rental',
    basisId: normalizedRentalId,
    basisLabel: `Завершение аренды №${normalizedRentalId}`,
    basisName: meta.client_name ? `Аренда: ${meta.client_name}` : `Аренда №${normalizedRentalId}`,
    reason: 'Автоматическое списание расходников по завершению аренды',
    signature: createdBy || 'Ответственный',
    responsiblePosition: 'Кладовщик',
    createdBy: createdBy || 'system',
    items: writeoffItems
  });
}

async function processReturnedItems(client, rentalId, items, user, options = {}) {
  const writeoffItems = [];

  for (const item of items) {
    if (item.external_source === true || item.externalSource === true) continue;

    const itemId = item.item_id || item.itemId;
    const quantity = Number(item.quantity || 0);
    if (!itemId || quantity <= 0) continue;

    const stockResult = await client.query('SELECT id, name, type FROM inventory WHERE id = $1 FOR UPDATE', [itemId]);
    const stockRow = stockResult.rows[0];
    if (!stockRow) continue;

    const accountingType = normalizeAccountingType(stockRow.type || 'asset');
    const actualCondition = normalizeCondition(item.actual_condition || item.actualCondition || 'Хорошее');
    const returnStatus = normalizeReturnStatus(actualCondition, item.return_status || item.returnStatus || '');
    const writeoffDecisionRaw = String(item.writeoff_decision || item.writeoffDecision || '').trim().toLowerCase();
    const normalizedReason = String(item.writeoff_reason || item.writeoffReason || '').trim();
    const rawDefectiveQuantity = Number(item.defective_quantity ?? item.defectiveQuantity ?? quantity);
    const defectiveQuantity = Math.max(0, Math.min(quantity, Number.isFinite(rawDefectiveQuantity) ? rawDefectiveQuantity : quantity));

    if (accountingType === 'consumable') continue;

    const hasExplicitDecision = writeoffDecisionRaw === 'writeoff' || writeoffDecisionRaw === 'keep' || writeoffDecisionRaw === 'списывать' || writeoffDecisionRaw === 'не списывать';
    const shouldWriteoffByDecision = writeoffDecisionRaw === 'writeoff' || writeoffDecisionRaw === 'списывать';
    const shouldWriteoffByCondition = actualCondition === 'Утрачено' || actualCondition === 'Повреждено';
    const shouldWriteoffByStatus = returnStatus === 'Не возвращено';
    const shouldWriteoffByRemark = actualCondition !== 'Хорошее';
    const shouldWriteoff = hasExplicitDecision
      ? shouldWriteoffByDecision
      : (shouldWriteoffByCondition || shouldWriteoffByStatus || shouldWriteoffByRemark);

    if (shouldWriteoff) {
      const writeoffQty = Math.max(1, defectiveQuantity || quantity);
      const fallbackReason = shouldWriteoffByStatus
        ? 'Невозврат'
        : (actualCondition === 'Утрачено'
          ? 'Невозврат'
          : (actualCondition === 'Требует ремонта' ? 'Требует ремонта' : 'Поломка'));
      const resolvedReason = normalizedReason || fallbackReason;

      writeoffItems.push({
        itemId,
        quantity: writeoffQty,
        reason: resolvedReason,
        reasonCategory: inferWriteoffReasonCategory(resolvedReason, accountingType),
        comment: String(
          item.writeoff_comment
          || item.writeoffComment
          || item.writeoffCommentText
          || parsePackedDocumentComments(item.comment || '').writeoffComment
          || ''
        ).trim(),
        basisType: 'rental',
        basisId: Number(rentalId),
        basisLabel: `Аренда №${rentalId}`,
        basisName: `Аренда №${rentalId}`,
        basisActNumber: options.acceptanceActNumber || ''
      });
    }
  }

  if (writeoffItems.length) {
    const meta = await getRentalMeta(client, rentalId);
    await createWriteoffAct(client, {
      basisType: 'rental',
      basisId: Number(rentalId),
      basisLabel: `Акт приёмки по аренде №${rentalId}`,
      basisName: meta.client_name ? `Аренда: ${meta.client_name}` : `Аренда №${rentalId}`,
      basisActNumber: options.acceptanceActNumber || '',
      reason: 'Черновик списания по результатам приёмки аренды',
      signature: user?.username || 'Ответственный',
      responsiblePosition: 'Кладовщик',
      createdBy: user?.username || 'system',
      items: writeoffItems
    });
  }
}

async function insertRentalItems(client, rentalId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO rental_items (
         rental_id, item_id, category, quantity, rent_price,
         issue_condition, actual_condition, return_status, defective_quantity, writeoff_reason, comment, damage_photo,
         external_source, procurement_mode
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        rentalId,
        item.itemId,
        item.category,
        item.quantity,
        item.rentPrice,
        item.issueCondition,
        item.actualCondition,
        item.returnStatus,
        item.defectiveQuantity,
        item.writeoffReason,
        item.comment,
        item.damagePhoto,
        item.externalSource === true,
        item.procurementMode || 'warehouse'
      ]
    );
  }
}

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.client_id, r.employee_id, r.start_date, r.end_date, r.status,
             r.issuance_act_id, r.issuance_act_number,
             c.name AS client_name, e.name AS employee_name,
             COALESCE(
               json_agg(
                 json_build_object(
                   'item_id', ri.item_id,
                   'category', COALESCE(i.category, ri.category),
                   'quantity', ri.quantity,
                   'rent_price', ri.rent_price,
                   'issue_condition', ri.issue_condition,
                   'actual_condition', ri.actual_condition,
                   'return_status', ri.return_status,
                   'defective_quantity', ri.defective_quantity,
                   'writeoff_reason', ri.writeoff_reason,
                   'external_source', ri.external_source,
                   'procurement_mode', ri.procurement_mode,
                   'comment', ri.comment,
                   'damage_photo', ri.damage_photo,
                   'item_name', COALESCE(i.name, 'Не найден')
                 )
               ) FILTER (WHERE ri.id IS NOT NULL),
               '[]'::json
             ) AS items
      FROM rentals r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN employees e ON r.employee_id = e.id
      LEFT JOIN rental_items ri ON r.id = ri.rental_id
      LEFT JOIN inventory i ON ri.item_id = i.id
      GROUP BY r.id, r.client_id, r.employee_id, r.start_date, r.end_date, r.status, r.issuance_act_id, r.issuance_act_number, c.name, e.name
      ORDER BY r.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', authenticate, async (req, res) => {
  const { client_id, employee_id, start_date, end_date, items = [], status = 'Черновик', acceptance_act_number = '' } = req.body;
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    ensureValidDateRange(start_date, end_date, 'аренды');

    const normalizedItems = items.map(mapRentalItem);
    await ensureItemsAvailable(client, normalizedItems, { checkAvailability: affectsInventory(status) });

    const rentalResult = await client.query(
      `INSERT INTO rentals (client_id, employee_id, start_date, end_date, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [client_id, employee_id, start_date, end_date, status]
    );
    const rentalId = rentalResult.rows[0].id;

    await insertRentalItems(client, rentalId, normalizedItems);

    let issuanceActNumber = null;
    if (affectsInventory(status)) {
      const { actId, actNumber } = await createIssuanceAct(client, 'rental', rentalId, user.username);
      await client.query(
        `UPDATE rentals SET issuance_act_id = $1, issuance_act_number = $2 WHERE id = $3`,
        [actId, actNumber, rentalId]
      );
      issuanceActNumber = actNumber;
      await issueItemsFromInventory(client, normalizedItems, {
        sourceType: 'rental',
        sourceId: rentalId,
        createdBy: user.username || 'system',
        registerWriteoff: true
      });
      await ensureConsumablesInWriteoffDraft(client, rentalId, normalizedItems, user.username || 'system');
      await logRentalInventoryMovement(client, rentalId, normalizedItems, 'Выдача', 'issue', {
        notes: 'Оформление аренды',
        createdBy: user.username || 'system'
      });
    }

    await syncStatusesForRentalItems(client, normalizedItems);

    await client.query('COMMIT');
    res.json({ success: true, rental_id: rentalId, issuance_act_number: issuanceActNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { client_id, employee_id, start_date, end_date, items = [], status = 'Черновик', acceptance_act_number = '' } = req.body;
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    ensureValidDateRange(start_date, end_date, 'аренды');

    const rentalResult = await client.query('SELECT status, issuance_act_id FROM rentals WHERE id = $1 FOR UPDATE', [id]);
    if (rentalResult.rows.length === 0) {
      throw new Error('Аренда не найдена');
    }

    const previousStatus = rentalResult.rows[0].status;
    const existingActId = rentalResult.rows[0].issuance_act_id;
    const oldItemsResult = await client.query('SELECT item_id, quantity, actual_condition, defective_quantity, writeoff_reason, comment, external_source FROM rental_items WHERE rental_id = $1', [id]);

    if (affectsInventory(previousStatus)) {
      await rollbackIssuedItemsToInventory(client, oldItemsResult.rows);
      await logRentalInventoryMovement(client, id, oldItemsResult.rows, 'Возврат', 'return', {
        notes: 'Корректировка состава аренды',
        createdBy: user.username || 'system'
      });
    }

    await client.query('DELETE FROM rental_items WHERE rental_id = $1', [id]);

    const normalizedItems = items.map(mapRentalItem);
    await ensureItemsAvailable(client, normalizedItems, { checkAvailability: affectsInventory(status) });

    await client.query(
      `UPDATE rentals SET client_id = $1, employee_id = $2, start_date = $3, end_date = $4, status = $5 WHERE id = $6`,
      [client_id, employee_id, start_date, end_date, status, id]
    );

    await insertRentalItems(client, id, normalizedItems);

    let issuanceActNumber = null;
    if (affectsInventory(status)) {
      // Первое проведение (draft → недрафт)
      if (!isDraftStatus(previousStatus) && existingActId) {
        // Уже проведено ранее — новый документ не создается
        const actRes = await client.query('SELECT act_number FROM issuance_acts WHERE id = $1', [existingActId]);
        issuanceActNumber = actRes.rows[0]?.act_number || null;
      } else if (isDraftStatus(previousStatus) && !existingActId) {
        // Первое проведение
        const { actId, actNumber } = await createIssuanceAct(client, 'rental', Number(id), user.username);
        await client.query(
          `UPDATE rentals SET issuance_act_id = $1, issuance_act_number = $2 WHERE id = $3`,
          [actId, actNumber, id]
        );
        issuanceActNumber = actNumber;
      } else if (isDraftStatus(previousStatus) && existingActId) {
        // Был черновик с уже выданным номером (не должно быть) — создаем новый
        const { actId, actNumber } = await createIssuanceAct(client, 'rental', Number(id), user.username);
        await client.query(
          `UPDATE rentals SET issuance_act_id = $1, issuance_act_number = $2 WHERE id = $3`,
          [actId, actNumber, id]
        );
        issuanceActNumber = actNumber;
      }
      await issueItemsFromInventory(client, normalizedItems, {
        sourceType: 'rental',
        sourceId: Number(id),
        createdBy: user.username || 'system',
        registerWriteoff: !affectsInventory(previousStatus)
      });
      await ensureConsumablesInWriteoffDraft(client, id, normalizedItems, user.username || 'system');
      await logRentalInventoryMovement(client, id, normalizedItems, 'Выдача', 'issue', {
        notes: 'Обновление аренды',
        createdBy: user.username || 'system'
      });
    } else if (isCompletedStatus(status) && !isCompletedStatus(previousStatus)) {
      await processReturnedItems(client, id, normalizedItems, user, {
        acceptanceActNumber: acceptance_act_number
      });
      await ensureConsumablesInWriteoffDraft(client, id, normalizedItems, user.username || 'system');
      await logRentalInventoryMovement(client, id, normalizedItems, 'Возврат', 'return', {
        notes: 'Завершение аренды при редактировании',
        createdBy: user.username || 'system'
      });
    }

    await syncInventoryStatus(client, [
      ...oldItemsResult.rows.map(item => item.item_id),
      ...normalizedItems.map(item => item.itemId)
    ]);

    await client.query('COMMIT');
    res.json({ success: true, issuance_act_number: issuanceActNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(/не найдена/i.test(err.message) ? 404 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/:id/unpost', authenticate, async (req, res) => {
  const { id } = req.params;
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rentalResult = await client.query(
      'SELECT status, issuance_act_id, issuance_act_number FROM rentals WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (rentalResult.rows.length === 0) throw new Error('Аренда не найдена');

    const { status, issuance_act_id, issuance_act_number } = rentalResult.rows[0];
    const hasIssuanceLink = Boolean(issuance_act_id || String(issuance_act_number || '').trim());
    if (!hasIssuanceLink && !affectsInventory(status)) throw new Error('Аренда не проведена');

    const itemsResult = await client.query(
      'SELECT item_id, quantity, actual_condition, external_source FROM rental_items WHERE rental_id = $1',
      [id]
    );

    if (affectsInventory(status)) {
      await rollbackIssuedItemsToInventory(client, itemsResult.rows);
      await logRentalInventoryMovement(client, id, itemsResult.rows, 'Возврат', 'return', {
        notes: 'Отмена проведения',
        createdBy: user.username || 'system'
      });
    }

    if (issuance_act_id) {
      await client.query(
        `UPDATE issuance_acts SET status = 'Отменен', cancelled_at = NOW(), cancelled_by = $1 WHERE id = $2`,
        [user.username || 'system', issuance_act_id]
      );
    } else if (String(issuance_act_number || '').trim()) {
      await client.query(
        `UPDATE issuance_acts
         SET status = 'Отменен', cancelled_at = NOW(), cancelled_by = $1
         WHERE act_number = $2 AND source_type = 'rental' AND source_id = $3`,
        [user.username || 'system', issuance_act_number, Number(id)]
      );
    }

    await client.query(
      `UPDATE rentals SET status = 'Черновик', issuance_act_id = NULL, issuance_act_number = NULL WHERE id = $1`,
      [id]
    );

    await syncStatusesForRentalItems(client, itemsResult.rows);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(/не найдена|не проведена/i.test(err.message) ? 400 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id/status', authenticate, async (req, res) => {
  const { id } = req.params;
  const { status, items = [], acceptance_act_number = '' } = req.body;
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rentalResult = await client.query('SELECT status, issuance_act_id FROM rentals WHERE id = $1 FOR UPDATE', [id]);
    if (rentalResult.rows.length === 0) {
      throw new Error('Аренда не найдена');
    }

    const previousStatus = rentalResult.rows[0].status;
    const existingActId = rentalResult.rows[0].issuance_act_id;

    for (const item of items.map(mapRentalItem)) {
      await client.query(
        `UPDATE rental_items
         SET actual_condition = $1, return_status = $2, defective_quantity = $3, writeoff_reason = $4, comment = $5, damage_photo = $6
         WHERE rental_id = $7 AND item_id = $8`,
        [item.actualCondition, item.returnStatus, item.defectiveQuantity, item.writeoffReason, item.comment, item.damagePhoto, id, item.itemId]
      );
    }

    const itemsResult = await client.query('SELECT item_id, quantity, actual_condition, defective_quantity, writeoff_reason, comment, external_source FROM rental_items WHERE rental_id = $1', [id]);

    if (!isCompletedStatus(previousStatus) && isCompletedStatus(status)) {
      await processReturnedItems(client, id, itemsResult.rows, user, {
        acceptanceActNumber: acceptance_act_number
      });
      await ensureConsumablesInWriteoffDraft(client, id, itemsResult.rows, user.username || 'system');
      await logRentalInventoryMovement(client, id, itemsResult.rows, 'Возврат', 'return', {
        notes: 'Завершение аренды',
        createdBy: user.username || 'system'
      });
    } else if (isCompletedStatus(previousStatus) && !isCompletedStatus(status) && affectsInventory(status)) {
      // Отмена завершения: выдать предметы снова
      const normalizedItems = itemsResult.rows.map(item => ({ itemId: item.item_id, quantity: Number(item.quantity), external_source: item.external_source === true }));
      await ensureItemsAvailable(client, normalizedItems, { checkAvailability: true });
      await issueItemsFromInventory(client, normalizedItems, {
        sourceType: 'rental',
        sourceId: Number(id),
        createdBy: user.username || 'system',
        registerWriteoff: true
      });
      await ensureConsumablesInWriteoffDraft(client, id, normalizedItems, user.username || 'system');
      await logRentalInventoryMovement(client, id, normalizedItems, 'Выдача', 'issue', {
        notes: 'Отмена завершения аренды',
        createdBy: user.username || 'system'
      });
    }

    if (affectsInventory(status) && !existingActId) {
      let issuanceActNumber = null;
      const created = await createIssuanceAct(client, 'rental', Number(id), user.username);
      issuanceActNumber = created.actNumber;
      await client.query(
        `UPDATE rentals SET issuance_act_id = $1, issuance_act_number = $2 WHERE id = $3`,
        [created.actId, created.actNumber, id]
      );

      if (!affectsInventory(previousStatus)) {
        const normalizedItems = itemsResult.rows.map(item => ({ itemId: item.item_id, quantity: Number(item.quantity), external_source: item.external_source === true }));
        await ensureItemsAvailable(client, normalizedItems, { checkAvailability: true });
        await issueItemsFromInventory(client, normalizedItems, {
          sourceType: 'rental',
          sourceId: Number(id),
          createdBy: user.username || 'system',
          registerWriteoff: true
        });
        await ensureConsumablesInWriteoffDraft(client, id, normalizedItems, user.username || 'system');
        await logRentalInventoryMovement(client, id, normalizedItems, 'Выдача', 'issue', {
          notes: issuanceActNumber ? `Проведение аренды (${issuanceActNumber})` : 'Проведение аренды',
          createdBy: user.username || 'system'
        });
      }
    } else if (!affectsInventory(previousStatus) && affectsInventory(status)) {
      const normalizedItems = itemsResult.rows.map(item => ({ itemId: item.item_id, quantity: Number(item.quantity), external_source: item.external_source === true }));
      await ensureItemsAvailable(client, normalizedItems, { checkAvailability: true });
      await issueItemsFromInventory(client, normalizedItems, {
        sourceType: 'rental',
        sourceId: Number(id),
        createdBy: user.username || 'system',
        registerWriteoff: true
      });
      await ensureConsumablesInWriteoffDraft(client, id, normalizedItems, user.username || 'system');
      await logRentalInventoryMovement(client, id, normalizedItems, 'Выдача', 'issue', {
        notes: 'Проведение аренды',
        createdBy: user.username || 'system'
      });
    } else if (affectsInventory(previousStatus) && !affectsInventory(status)) {
      const normalizedItems = itemsResult.rows.map(item => ({ itemId: item.item_id, quantity: Number(item.quantity), external_source: item.external_source === true }));
      await returnItemsToInventory(client, normalizedItems, {
        sourceType: 'rental',
        sourceId: Number(id),
        createdBy: user.username || 'system'
      });
      await logRentalInventoryMovement(client, id, normalizedItems, 'Возврат', 'return', {
        notes: 'Отмена проведения аренды',
        createdBy: user.username || 'system'
      });
    }

    await client.query('UPDATE rentals SET status = $1 WHERE id = $2', [status, id]);
    await syncStatusesForRentalItems(client, itemsResult.rows);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(/не найдена/i.test(err.message) ? 404 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const restoreStock = req.query.restoreStock !== 'false';
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rentalResult = await client.query('SELECT status FROM rentals WHERE id = $1 FOR UPDATE', [id]);
    if (rentalResult.rows.length === 0) {
      throw new Error('Аренда не найдена');
    }

    const itemsResult = await client.query('SELECT item_id, quantity, actual_condition, external_source FROM rental_items WHERE rental_id = $1', [id]);

    if (affectsInventory(rentalResult.rows[0].status) && restoreStock) {
      await rollbackIssuedItemsToInventory(client, itemsResult.rows);
      await logRentalInventoryMovement(client, id, itemsResult.rows, 'Возврат', 'return', {
        notes: 'Удаление аренды с возвратом на склад',
        createdBy: user.username || 'system'
      });
    }

    await client.query('DELETE FROM rental_items WHERE rental_id = $1', [id]);
    await client.query('DELETE FROM rentals WHERE id = $1', [id]);
    await syncStatusesForRentalItems(client, itemsResult.rows);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(/не найдена/i.test(err.message) ? 404 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
