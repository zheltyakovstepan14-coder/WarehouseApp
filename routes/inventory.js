const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { normalizeInventoryStatus, logInventoryMovement } = require('../inventory-utils');
const { normalizeAccountingType, inferWriteoffReasonCategory, createPurchaseRequest, createWriteoffAct, generateDocNumber } = require('../accounting-utils');
const XLSX = require('xlsx');

const DEFAULT_WRITEOFF_REASON = 'Истек срок эксплуатации';
const ZERO_STOCK_WRITEOFF_REASON = 'Использован';
const AUTO_WRITEOFF_REASONS = [DEFAULT_WRITEOFF_REASON, ZERO_STOCK_WRITEOFF_REASON];
const ENABLE_AUTO_WRITEOFF_DRAFT = true;
const PURCHASE_STATUS = {
  DRAFT: 'Черновик',
  AGREED: 'Согласована',
  ORDERED: 'Заказана',
  DELIVERED: 'Поставлена',
  CANCELLED: 'Отменена'
};

function normalizePurchaseStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return PURCHASE_STATUS.DRAFT;
  if (normalized === 'draft' || normalized === 'новая' || normalized === 'черновик') return PURCHASE_STATUS.DRAFT;
  if (normalized === 'agreed' || normalized.includes('соглас')) return PURCHASE_STATUS.AGREED;
  if (normalized === 'ordered' || normalized.includes('заказ')) return PURCHASE_STATUS.ORDERED;
  if (normalized === 'delivered' || normalized.includes('постав')) return PURCHASE_STATUS.DELIVERED;
  if (normalized === 'cancelled' || normalized.includes('отмен')) return PURCHASE_STATUS.CANCELLED;
  return PURCHASE_STATUS.DRAFT;
}

function normalizeDashboardCategory(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return null;
  if (normalized.includes('меб')) return 'Мебель';
  if (normalized.includes('эксп') || normalized.includes('витрин') || normalized.includes('панно')) return 'Экспонаты';
  if (normalized.includes('инстру')) return 'Инструменты';
  return null;
}

function inferMovementDeltaSign(operationType = '') {
  const normalized = String(operationType || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return 0;
  if (/выдач|спис|расход|умен|перемещ.*из/.test(normalized)) return -1;
  if (/возврат|поступ|пополн|добав|увелич|откат|перемещ.*в/.test(normalized)) return 1;
  return 0;
}

function mapInventoryRow(row) {
  const totalQuantity = Number(row.total_quantity ?? row.quantity ?? 0);
  const pendingWriteoffRaw = Math.max(0, Number(row.pending_writeoff ?? row.quantity_pending_writeoff ?? 0));
  const rawInRental = Number(row.in_rental ?? 0);
  const rawInEvent = Number(row.in_event ?? 0);
  const normalizedManualStatus = normalizeInventoryStatus(row.status || row.rentalstatus || 'В наличии');
  const isToWriteoff = normalizedManualStatus === 'К списанию';
  const isManualLocked = isToWriteoff || normalizedManualStatus === 'На реставрации' || normalizedManualStatus === 'Списано';
  const pendingWriteoff = isToWriteoff
    ? Math.max(0, totalQuantity)
    : Math.min(Math.max(0, totalQuantity), pendingWriteoffRaw);
  const computedAvailabilityStatus = String(row.availability_status || '').trim();
  const inRental = isManualLocked ? 0 : rawInRental;
  const inEvent = isManualLocked ? 0 : rawInEvent;
  const availableQuantity = isManualLocked
    ? 0
    : Math.max(0, Number(row.available_quantity ?? (totalQuantity - rawInRental - rawInEvent)));

  return {
    id: row.id,
    name: row.name,
    stock: availableQuantity,
    quantity: availableQuantity,
    totalQuantity,
    totalStock: totalQuantity,
    total: totalQuantity,
    inRental,
    inEvent,
    availableQuantity,
    available: availableQuantity,
    pendingWriteoff,
    pending_writeoff: pendingWriteoff,
    rentalStatus: row.rentalstatus || 'На складе',
    status: isManualLocked ? normalizedManualStatus : (computedAvailabilityStatus || 'В наличии'),
    statusReason: row.status_reason || '',
    plannedReturnDate: row.planned_return_date,
    writeoffReason: row.writeoff_reason || '',
    writeoffDate: row.writeoff_date,
    writeoffActNumber: row.writeoff_act_number || '',
    isWriteoffMarker: row.is_writeoff_marker === true,
    is_writeoff_marker: row.is_writeoff_marker === true,
    sourceItemId: row.source_item_id || null,
    source_item_id: row.source_item_id || null,
    category: row.category || 'Склад',
    type: normalizeAccountingType(row.type || (String(row.category || '').toLowerCase().includes('расход') ? 'consumable' : 'asset')),
    requiresPurchase: row.requires_purchase === true,
    requires_purchase: row.requires_purchase === true,
    lifespan: row.lifespan ? Number(row.lifespan) : null,
    balanceDate: row.balance_date,
    balance_date: row.balance_date,
    location: row.location || '',
    minStock: Number(row.minstock || 0),
    minstock: Number(row.minstock || 0),
    description: row.description || '',
    info: row.info || '',
    image: row.image || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function groupWriteoffMarkerRows(items = []) {
  const sourceRows = (Array.isArray(items) ? items : []).filter(item => item?.isWriteoffMarker !== true && item?.is_writeoff_marker !== true);
  const byId = new Map(sourceRows.map(item => [String(item.id || ''), item]));

  for (const marker of (Array.isArray(items) ? items : []).filter(item => item?.isWriteoffMarker === true || item?.is_writeoff_marker === true)) {
    const sourceId = String(marker?.sourceItemId || marker?.source_item_id || '').trim();
    if (!sourceId || !byId.has(sourceId)) continue;
    const source = byId.get(sourceId);
    const markerQty = Math.max(0, Number(marker.totalQuantity ?? marker.totalStock ?? marker.quantity ?? 0));
    const nextPending = Math.max(0, Number(source.pendingWriteoff ?? source.pending_writeoff ?? 0) + markerQty);
    source.pendingWriteoff = nextPending;
    source.pending_writeoff = nextPending;
  }

  return sourceRows;
}

function groupWriteoffActItems(items = []) {
  const groups = new Map();

  for (const rawItem of (Array.isArray(items) ? items : [])) {
    const item = {
      itemId: rawItem.itemId,
      sourceItemId: rawItem.sourceItemId || rawItem.itemId,
      markerItemId: rawItem.markerItemId || rawItem.itemId,
      name: rawItem.name || 'Объект',
      category: rawItem.category || '',
      type: rawItem.type || 'asset',
      basisType: String(rawItem.basisType || rawItem.basis_type || '').trim(),
      basisId: rawItem.basisId ?? rawItem.basis_id ?? null,
      basisLabel: String(rawItem.basisLabel || rawItem.basis_label || '').trim(),
      basisName: String(rawItem.basisName || rawItem.basis_name || '').trim(),
      basisActNumber: String(rawItem.basisActNumber || rawItem.basis_act_number || '').trim(),
      quantity: Math.max(0, toNumber(rawItem.quantity)),
      reason: rawItem.reason || 'Без причины',
      reasonCategory: normalizeWriteoffReasonCategory(rawItem.reasonCategory || rawItem.reason_category, rawItem.reason || 'Без причины', rawItem.type || 'asset'),
      comment: String(rawItem.comment || '').trim()
    };
    if (item.quantity <= 0) continue;

    const key = [
      String(item.name || '').trim().toLowerCase(),
      String(item.category || '').trim().toLowerCase(),
      String(item.type || '').trim().toLowerCase(),
      String(item.reason || '').trim().toLowerCase(),
      String(item.comment || '').trim().toLowerCase(),
      String(item.basisType || '').trim().toLowerCase(),
      String(item.basisId || '').trim().toLowerCase(),
      String(item.basisLabel || '').trim().toLowerCase(),
      String(item.basisName || '').trim().toLowerCase(),
      String(item.basisActNumber || '').trim().toLowerCase()
    ].join('::');

    if (!groups.has(key)) {
      groups.set(key, item);
      continue;
    }

    const grouped = groups.get(key);
    grouped.quantity = Math.max(0, Number(grouped.quantity || 0) + item.quantity);
    if (!grouped.sourceItemId && item.sourceItemId) grouped.sourceItemId = item.sourceItemId;
    if (!grouped.markerItemId && item.markerItemId) grouped.markerItemId = item.markerItemId;
    if (!grouped.basisType && item.basisType) grouped.basisType = item.basisType;
    if ((grouped.basisId === null || grouped.basisId === undefined || grouped.basisId === '') && item.basisId) grouped.basisId = item.basisId;
    if (!grouped.basisLabel && item.basisLabel) grouped.basisLabel = item.basisLabel;
    if (!grouped.basisName && item.basisName) grouped.basisName = item.basisName;
    if (!grouped.basisActNumber && item.basisActNumber) grouped.basisActNumber = item.basisActNumber;
  }

  return Array.from(groups.values());
}

function normalizeInventoryPayload(item = {}) {
  const status = normalizeInventoryStatus(item.status || item.inventoryStatus || item.rentalStatus || item.rentalstatus || 'В наличии');
  const quantity = status === 'Списано' ? 0 : Number(item.quantity ?? item.stock ?? 0);

  return {
    id: item.id || Math.random().toString(36).slice(2, 10),
    name: String(item.name || '').trim(),
    quantity,
    rentalStatus: item.rentalStatus || item.rentalstatus || 'На складе',
    status,
    statusReason: String(item.statusReason || item.status_reason || '').trim(),
    plannedReturnDate: item.plannedReturnDate || item.planned_return_date || null,
    writeoffReason: String(item.writeoffReason || item.writeoff_reason || '').trim(),
    writeoffDate: item.writeoffDate || item.writeoff_date || null,
    writeoffActNumber: String(item.writeoffActNumber || item.writeoff_act_number || '').trim(),
    isWriteoffMarker: item.isWriteoffMarker === true || item.is_writeoff_marker === true,
    sourceItemId: item.sourceItemId || item.source_item_id || null,
    category: item.category || 'Склад',
    type: normalizeAccountingType(item.type || item.accountingType || (String(item.category || '').toLowerCase().includes('расход') ? 'consumable' : 'asset')),
    requiresPurchase: item.requiresPurchase === true || item.requires_purchase === true,
    lifespan: item.lifespan === null || item.lifespan === undefined || item.lifespan === '' ? null : Number(item.lifespan),
    balanceDate: item.balanceDate || item.balance_date || null,
    location: item.location || '',
    minstock: Number(item.minstock ?? item.minStock ?? 0),
    description: item.description || '',
    info: item.info || '',
    image: item.image || ''
  };
}

async function recordInventoryHistory(client, itemId, changedBy, beforeState = {}, afterState = {}) {
  const fields = ['name', 'quantity', 'rentalstatus', 'status', 'status_reason', 'planned_return_date', 'writeoff_reason', 'writeoff_date', 'category', 'type', 'requires_purchase', 'lifespan', 'balance_date', 'location', 'minstock', 'description', 'info', 'image'];

  for (const field of fields) {
    const beforeValue = beforeState[field] ?? '';
    const afterValue = afterState[field] ?? '';

    if (String(beforeValue) === String(afterValue)) {
      continue;
    }

    await client.query(
      `INSERT INTO inventory_history (inventory_id, changed_by, change_type, old_value, new_value, field_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, changedBy, 'update', String(beforeValue), String(afterValue), field]
    );
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWriteoffReasonText(value, fallback = DEFAULT_WRITEOFF_REASON) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeWriteoffReasonCategory(value, reason = '', itemType = 'asset') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['consumable', 'expiry', 'damage', 'loss', 'other'].includes(normalized)) {
    return normalized;
  }
  return inferWriteoffReasonCategory(reason, itemType);
}

function buildExpiryWriteoffComment(item = {}) {
  const balanceDate = toIsoDate(item.balance_date || item.balanceDate || null);
  const lifespan = Number(item.lifespan || 0);
  if (!balanceDate || !Number.isFinite(lifespan) || lifespan <= 0) return '';
  return `Постановка ${balanceDate}, срок ${lifespan} мес`;
}

function normalizeWriteoffDraftItems(items = []) {
  const rawItems = Array.isArray(items) ? items : [];
  const groups = new Map();

  for (const item of rawItems) {
    const itemId = String(item?.itemId || item?.item_id || '').trim();
    const quantity = Math.max(0, toNumber(item?.quantity));
    if (!itemId || quantity <= 0) continue;

    const reason = normalizeWriteoffReasonText(item?.reason);
    const reasonCategory = normalizeWriteoffReasonCategory(item?.reasonCategory || item?.reason_category, reason);
    const comment = String(item?.comment || '').trim();
    const basisType = String(item?.basisType || item?.basis_type || '').trim();
    const basisId = item?.basisId ?? item?.basis_id ?? null;
    const basisLabel = String(item?.basisLabel || item?.basis_label || '').trim();
    const basisName = String(item?.basisName || item?.basis_name || '').trim();
    const basisActNumber = String(item?.basisActNumber || item?.basis_act_number || '').trim();
    const key = `${itemId}::${reason}::${reasonCategory}::${comment}::${basisType}::${basisId || ''}::${basisLabel}::${basisName}::${basisActNumber}`;
    if (!groups.has(key)) {
      groups.set(key, { itemId, quantity, reason, reasonCategory, comment, basisType, basisId, basisLabel, basisName, basisActNumber });
      continue;
    }

    const grouped = groups.get(key);
    grouped.quantity = Math.max(0, Number(grouped.quantity || 0) + quantity);
  }

  return Array.from(groups.values());
}

function addMonthsToDate(dateValue, months) {
  const base = new Date(dateValue);
  if (Number.isNaN(base.getTime())) return null;
  const result = new Date(base);
  result.setMonth(result.getMonth() + Number(months || 0));
  return result;
}

function toIsoDate(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toStartOfDay(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function computeAutoWriteoffPayload(item = {}, now = new Date()) {
  const status = normalizeInventoryStatus(item.status || 'В наличии');
  if (status === 'Списано') return null;

  const accountingType = normalizeAccountingType(item.type || 'asset');

  const quantity = Math.max(0, Number(item.quantity || 0));
  const inRental = Math.max(0, Number(item.in_rental || 0));
  const inEvent = Math.max(0, Number(item.in_event || 0));

  const lifespan = Number(item.lifespan || 0);
  const balanceDate = item.balance_date ? new Date(item.balance_date) : null;
  const endDate = balanceDate && Number.isFinite(lifespan) && lifespan > 0
    ? addMonthsToDate(balanceDate, lifespan)
    : null;

  const dayStart = toStartOfDay(now);
  const expired = Boolean(endDate && dayStart && endDate < dayStart);
  if (expired && quantity > 0) {
    return {
      reason: DEFAULT_WRITEOFF_REASON,
      reasonCategory: 'expiry',
      comment: buildExpiryWriteoffComment(item),
      quantity: Math.max(1, quantity)
    };
  }

  const zeroStock = quantity <= 0 && inRental <= 0 && inEvent <= 0;
  if (zeroStock) {
    return {
      reason: ZERO_STOCK_WRITEOFF_REASON,
      reasonCategory: accountingType === 'consumable' ? 'consumable' : 'other',
      comment: accountingType === 'consumable' ? '' : 'Объект отсутствует на складе',
      quantity: 0
    };
  }

  return null;
}

async function syncAutoWriteoffDraft(client, options = {}) {
  if (!ENABLE_AUTO_WRITEOFF_DRAFT) {
    return;
  }

  const itemIds = Array.isArray(options.itemIds)
    ? [...new Set(options.itemIds.map(id => String(id || '').trim()).filter(Boolean))]
    : [];

  const params = [];
  const whereByIds = itemIds.length
    ? (() => {
        params.push(itemIds);
        return `AND i.id = ANY($${params.length}::text[])`;
      })()
    : '';

  const inventoryResult = await client.query(
    `SELECT i.id,
            i.name,
            i.category,
            i.type,
            i.quantity,
            i.status,
           i.writeoff_reason,
            i.lifespan,
            i.balance_date,
            COALESCE(r_usage.in_rental, 0) AS in_rental,
            COALESCE(e_usage.in_event, 0) AS in_event
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
     ) AS e_usage ON e_usage.item_id = i.id
     WHERE COALESCE(i.is_writeoff_marker, FALSE) = FALSE
       ${whereByIds}
     ORDER BY i.id`,
    params
  );

  const candidates = [];
  const candidateIds = new Set();
  for (const row of inventoryResult.rows) {
    const writeoffMeta = computeAutoWriteoffPayload(row);
    if (!writeoffMeta?.reason) continue;

    const itemId = String(row.id || '').trim();
    if (!itemId) continue;

    const quantity = Math.max(0, Number(writeoffMeta.quantity ?? row.quantity ?? 0));
    if (quantity <= 0) continue;
    candidates.push({
      itemId,
      quantity,
      reason: writeoffMeta.reason,
      reasonCategory: writeoffMeta.reasonCategory,
      comment: writeoffMeta.comment || '',
      itemName: row.name || itemId,
      category: row.category || '',
      itemType: normalizeAccountingType(row.type || 'asset'),
      basisType: 'item',
      basisId: itemId,
      basisLabel: 'Карточка объекта',
      basisName: row.name || itemId,
      basisActNumber: ''
    });
    candidateIds.add(itemId);
  }

  const draftResult = await client.query(
    `SELECT id, act_number
     FROM writeoff_acts
     WHERE status = 'Черновик'
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`
  );
  const draftAct = draftResult.rows[0] || null;

  if (draftAct) {
    const deleteAutoItemsResult = await client.query(
      `DELETE FROM writeoff_act_items
       WHERE act_id = $1
         AND reason = ANY($2::text[])
         AND LOWER(COALESCE(basis_type, 'item')) = 'item'
       RETURNING item_id`,
      [draftAct.id, AUTO_WRITEOFF_REASONS]
    );

    const deletedItemIds = deleteAutoItemsResult.rows
      .map(row => String(row.item_id || '').trim())
      .filter(Boolean);

    if (deletedItemIds.length) {
      await client.query(
        `DELETE FROM inventory
         WHERE COALESCE(is_writeoff_marker, FALSE) = TRUE
           AND id = ANY($1::text[])`,
        [deletedItemIds]
      );
    }

    // Если после очистки авто-позиций черновик пустой — удаляем его,
    // чтобы в UI не появлялись "пустые" акты списания.
    const remainingItemsResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM writeoff_act_items
       WHERE act_id = $1`,
      [draftAct.id]
    );
    const remainingItemsCount = Number(remainingItemsResult.rows[0]?.total || 0);
    if (remainingItemsCount <= 0 && candidates.length === 0) {
      await client.query('DELETE FROM writeoff_acts WHERE id = $1', [draftAct.id]);
    }
  }

  let draftActNumber = draftAct?.act_number || '';
  if (candidates.length) {
    const createdOrUpdatedDraft = await createWriteoffAct(client, {
      basisType: 'rental',
      basisId: null,
      basisLabel: 'Автоматическое списание',
      basisName: 'Автоматическое списание',
      reason: DEFAULT_WRITEOFF_REASON,
      signature: 'Система',
      responsiblePosition: 'Кладовщик',
      createdBy: 'system',
      items: candidates
    });
    draftActNumber = String(createdOrUpdatedDraft?.act_number || draftActNumber || '').trim();
  }

  for (const candidate of candidates) {
    await client.query(
      `UPDATE inventory
       SET status = 'К списанию',
           writeoff_reason = $1,
           writeoff_date = CURRENT_TIMESTAMP,
           writeoff_act_number = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
         AND COALESCE(is_writeoff_marker, FALSE) = FALSE
         AND COALESCE(NULLIF(TRIM(status), ''), 'В наличии') <> 'Списано'`,
      [candidate.reason, draftActNumber, candidate.itemId]
    );
  }

  const staleAutoRows = inventoryResult.rows.filter(row => {
    const itemId = String(row.id || '').trim();
    if (!itemId) return false;
    if (candidateIds.has(itemId)) return false;

    const status = normalizeInventoryStatus(row.status || 'В наличии');
    const reason = normalizeWriteoffReasonText(row.writeoff_reason || '', '');
    return status === 'К списанию' && AUTO_WRITEOFF_REASONS.includes(reason);
  });

  for (const row of staleAutoRows) {
    const itemId = String(row.id || '').trim();
    if (!itemId) continue;
    const fallbackStatus = Number(row.quantity || 0) > 0 ? 'В наличии' : 'Нет в наличии';

    await client.query(
      `UPDATE inventory
       SET status = $1,
           writeoff_reason = '',
           writeoff_date = NULL,
           writeoff_act_number = '',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND COALESCE(is_writeoff_marker, FALSE) = FALSE
         AND COALESCE(NULLIF(TRIM(status), ''), 'В наличии') = 'К списанию'`,
      [fallbackStatus, itemId]
    );
  }
}

async function syncAutoWriteoffDraftInTransaction(options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await syncAutoWriteoffDraft(client, options);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertAssetLifecycleHistory(client, payload = {}) {
  const {
    itemId,
    changeType = 'extend',
    beforeLifespan = null,
    afterLifespan = null,
    beforeEndDate = null,
    afterEndDate = null,
    reason = '',
    changedBy = 'system'
  } = payload;

  if (!itemId) return;

  await client.query(
    `INSERT INTO asset_lifecycle_history (
      item_id, change_type, before_lifespan, after_lifespan,
      before_end_date, after_end_date, reason, changed_by, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)`,
    [
      itemId,
      changeType,
      beforeLifespan,
      afterLifespan,
      beforeEndDate,
      afterEndDate,
      reason || '',
      changedBy || 'system'
    ]
  );
}

function toMonthKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${month}.${date.getFullYear()}`;
}

function formatDateRu(date = new Date()) {
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

// GET all items
router.get('/', authenticate, async (req, res) => {
  try {
    if (ENABLE_AUTO_WRITEOFF_DRAFT) {
      await syncAutoWriteoffDraftInTransaction();
    }

    const result = await pool.query(`
      SELECT
        i.*,
        GREATEST(COALESCE(i.quantity, 0), 0) AS total_quantity,
        LEAST(
          GREATEST(COALESCE(i.quantity, 0), 0),
          GREATEST(
            GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
            GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
          )
        ) AS pending_writeoff,
        COALESCE(r_usage.in_rental, 0) AS in_rental,
        COALESCE(e_usage.in_event, 0) AS in_event,
        GREATEST(
          GREATEST(COALESCE(i.quantity, 0), 0)
          - LEAST(
            GREATEST(COALESCE(i.quantity, 0), 0),
            GREATEST(
              GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
              GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
            )
          )
          - COALESCE(r_usage.in_rental, 0)
          - COALESCE(e_usage.in_event, 0),
          0
        ) AS available_quantity,
        CASE
          WHEN COALESCE(NULLIF(TRIM(i.status), ''), 'В наличии') IN ('На реставрации', 'Списано') THEN i.status
          WHEN LEAST(
            GREATEST(COALESCE(i.quantity, 0), 0),
            GREATEST(
              GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
              GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
            )
          ) >= GREATEST(COALESCE(i.quantity, 0), 0)
            AND GREATEST(COALESCE(i.quantity, 0), 0) > 0 THEN 'Подготовка к списанию'
          WHEN LEAST(
            GREATEST(COALESCE(i.quantity, 0), 0),
            GREATEST(
              GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
              GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
            )
          ) > 0 THEN 'Частично в списании'
          WHEN GREATEST(
            GREATEST(COALESCE(i.quantity, 0), 0)
            - LEAST(
              GREATEST(COALESCE(i.quantity, 0), 0),
              GREATEST(
                GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
                GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
              )
            )
            - COALESCE(r_usage.in_rental, 0)
            - COALESCE(e_usage.in_event, 0),
            0
          ) > 0 THEN 'В наличии'
          WHEN GREATEST(
            GREATEST(COALESCE(i.quantity, 0), 0)
            - LEAST(
              GREATEST(COALESCE(i.quantity, 0), 0),
              GREATEST(
                GREATEST(COALESCE(w_usage.pending_writeoff, 0), 0),
                GREATEST(COALESCE(i.quantity_pending_writeoff, 0), 0)
              )
            )
            - COALESCE(r_usage.in_rental, 0)
            - COALESCE(e_usage.in_event, 0),
            0
          ) = 0 AND (COALESCE(r_usage.in_rental, 0) > 0 OR COALESCE(e_usage.in_event, 0) > 0)
            THEN 'Нет в наличии (в использовании)'
          ELSE 'Нет в наличии'
        END AS availability_status
      FROM inventory i
      LEFT JOIN (
        SELECT
          ri.item_id,
          SUM(ri.quantity) AS in_rental
        FROM rental_items ri
        INNER JOIN rentals r ON r.id = ri.rental_id
        WHERE COALESCE(ri.external_source, FALSE) = FALSE
          AND COALESCE(NULLIF(TRIM(r.status), ''), 'Черновик') IN ('Активна', 'Активно', 'Просрочена', 'Проведен')
        GROUP BY ri.item_id
      ) AS r_usage ON r_usage.item_id = i.id
      LEFT JOIN (
        SELECT
          ei.item_id,
          SUM(ei.quantity) AS in_event
        FROM event_items ei
        INNER JOIN events e ON e.id = ei.event_id
        WHERE COALESCE(ei.external_source, FALSE) = FALSE
          AND COALESCE(NULLIF(TRIM(e.status), ''), 'Черновик') IN ('Активно', 'Активна', 'Просрочена', 'Проведен')
        GROUP BY ei.item_id
      ) AS e_usage ON e_usage.item_id = i.id
      LEFT JOIN (
        SELECT
          wai.item_id,
          SUM(wai.quantity) AS pending_writeoff
        FROM writeoff_act_items wai
        INNER JOIN writeoff_acts wa ON wa.id = wai.act_id
        WHERE COALESCE(NULLIF(TRIM(wa.status), ''), 'Черновик') = 'Черновик'
        GROUP BY wai.item_id
      ) AS w_usage ON w_usage.item_id = i.id
      WHERE COALESCE(i.is_writeoff_marker, FALSE) = FALSE
      ORDER BY i.category, i.name
    `);
    const mappedRows = result.rows.map(mapInventoryRow);
    res.json(groupWriteoffMarkerRows(mappedRows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk upsert items (backward compatibility)
router.put('/', authenticate, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const rawItem of items) {
      const item = normalizeInventoryPayload(rawItem);
      if (!item.name) continue;

      await client.query(
        `INSERT INTO inventory (
           id, name, quantity, rentalstatus, status, status_reason,
           planned_return_date, writeoff_reason, writeoff_date,
           category, type, requires_purchase, lifespan, balance_date,
           location, minstock, description, info, image, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, CURRENT_TIMESTAMP
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           quantity = EXCLUDED.quantity,
           rentalstatus = EXCLUDED.rentalstatus,
           status = EXCLUDED.status,
           status_reason = EXCLUDED.status_reason,
           planned_return_date = EXCLUDED.planned_return_date,
           writeoff_reason = EXCLUDED.writeoff_reason,
           writeoff_date = EXCLUDED.writeoff_date,
           category = EXCLUDED.category,
           type = EXCLUDED.type,
           requires_purchase = EXCLUDED.requires_purchase,
           lifespan = EXCLUDED.lifespan,
           balance_date = EXCLUDED.balance_date,
           location = EXCLUDED.location,
           minstock = EXCLUDED.minstock,
           description = EXCLUDED.description,
           info = EXCLUDED.info,
           image = EXCLUDED.image,
           updated_at = CURRENT_TIMESTAMP`,
        [
          item.id,
          item.name,
          item.quantity,
          item.rentalStatus,
          item.status,
          item.statusReason,
          item.plannedReturnDate,
          item.writeoffReason,
          item.writeoffDate,
          item.category,
          item.type,
          item.requiresPurchase,
          item.lifespan,
          item.balanceDate,
          item.location,
          item.minstock,
          item.description,
          item.info,
          item.image
        ]
      );
    }

    await syncAutoWriteoffDraft(client);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/', authenticate, async (req, res) => {
  const item = normalizeInventoryPayload(req.body || {});
  if (!item.name) {
    return res.status(400).json({ error: 'Название объекта обязательно' });
  }

  if (item.type === 'asset') {
    if (!item.balanceDate) {
      return res.status(400).json({ error: 'Для ОС обязательна дата постановки на баланс' });
    }
    if (!item.lifespan || Number(item.lifespan) <= 0) {
      return res.status(400).json({ error: 'Для ОС обязателен срок эксплуатации (в месяцах)' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO inventory (
         id, name, quantity, rentalstatus, status, status_reason,
         planned_return_date, writeoff_reason, writeoff_date,
         category, type, requires_purchase, lifespan, balance_date,
         location, minstock, description, info, image, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, CURRENT_TIMESTAMP
       )
       RETURNING *`,
      [
        item.id,
        item.name,
        item.quantity,
        item.rentalStatus,
        item.status,
        item.statusReason,
        item.plannedReturnDate,
        item.writeoffReason,
        item.writeoffDate,
        item.category,
        item.type,
        item.requiresPurchase,
        item.lifespan,
        item.balanceDate,
        item.location,
        item.minstock,
        item.description,
        item.info,
        item.image
      ]
    );

    if (item.type === 'asset' && item.balanceDate && item.lifespan) {
      const afterEndDate = toIsoDate(addMonthsToDate(item.balanceDate, item.lifespan));
      await insertAssetLifecycleHistory(client, {
        itemId: item.id,
        changeType: 'balance_setup',
        beforeLifespan: null,
        afterLifespan: Number(item.lifespan),
        beforeEndDate: null,
        afterEndDate,
        reason: 'Постановка на баланс',
        changedBy: req.user?.username || 'system'
      });
    }

    await syncAutoWriteoffDraft(client, { itemIds: [item.id] });

    await client.query('COMMIT');

    res.status(201).json({ success: true, item: mapInventoryRow(result.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

async function updateInventoryItem(req, res) {
  const itemId = req.params.id;
  const updates = normalizeInventoryPayload({ ...req.body, id: itemId });
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [itemId]);
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const currentItem = currentResult.rows[0];

    const nextState = {
      ...currentItem,
      name: updates.name || currentItem.name,
      quantity: updates.quantity,
      rentalstatus: updates.rentalStatus,
      status: updates.status,
      status_reason: updates.statusReason,
      planned_return_date: updates.plannedReturnDate,
      writeoff_reason: updates.writeoffReason,
      writeoff_date: updates.writeoffDate,
      writeoff_act_number: updates.writeoffActNumber,
      category: updates.category || currentItem.category,
      type: updates.type || currentItem.type || 'asset',
      requires_purchase: updates.requiresPurchase,
      lifespan: updates.lifespan,
      balance_date: updates.balanceDate,
      location: updates.location,
      minstock: updates.minstock,
      description: updates.description,
      info: updates.info,
      image: updates.image
    };

    if (nextState.type === 'asset') {
      if (!nextState.balance_date) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Для ОС обязательна дата постановки на баланс' });
      }
      if (!nextState.lifespan || Number(nextState.lifespan) <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Для ОС обязателен срок эксплуатации (в месяцах)' });
      }
    }

    await client.query(
      `UPDATE inventory
       SET name = $1,
           quantity = $2,
           rentalstatus = $3,
           status = $4,
           status_reason = $5,
           planned_return_date = $6,
           writeoff_reason = $7,
           writeoff_date = $8,
           writeoff_act_number = $9,
           category = $10,
             type = $11,
             requires_purchase = $12,
             lifespan = $13,
             balance_date = $14,
             location = $15,
             minstock = $16,
             description = $17,
             info = $18,
             image = $19,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $20`,
      [
        nextState.name,
        nextState.quantity,
        nextState.rentalstatus,
        nextState.status,
        nextState.status_reason,
        nextState.planned_return_date,
        nextState.writeoff_reason,
        nextState.writeoff_date,
        nextState.writeoff_act_number,
        nextState.category,
        nextState.type,
        nextState.requires_purchase,
        nextState.lifespan,
        nextState.balance_date,
        nextState.location,
        nextState.minstock,
        nextState.description,
        nextState.info,
        nextState.image,
        itemId
      ]
    );

    await recordInventoryHistory(client, itemId, user.username || 'system', currentItem, nextState);

    const beforeBalance = currentItem.balance_date;
    const beforeLifespan = currentItem.lifespan ? Number(currentItem.lifespan) : null;
    const beforeEndDate = beforeBalance && beforeLifespan
      ? toIsoDate(addMonthsToDate(beforeBalance, beforeLifespan))
      : null;
    const afterBalance = nextState.balance_date;
    const afterLifespan = nextState.lifespan ? Number(nextState.lifespan) : null;
    const afterEndDate = afterBalance && afterLifespan
      ? toIsoDate(addMonthsToDate(afterBalance, afterLifespan))
      : null;

    if (String(beforeLifespan || '') !== String(afterLifespan || '') || String(beforeBalance || '') !== String(afterBalance || '')) {
      await insertAssetLifecycleHistory(client, {
        itemId,
        changeType: 'update',
        beforeLifespan,
        afterLifespan,
        beforeEndDate,
        afterEndDate,
        reason: 'Изменение параметров ОС в карточке объекта',
        changedBy: user.username || 'system'
      });
    }

    if (String(currentItem.status || '') !== String(nextState.status || '')) {
      await logInventoryMovement(client, {
        inventoryId: itemId,
        itemName: nextState.name,
        category: nextState.category,
        operationType: 'Изменение статуса',
        quantity: nextState.quantity,
        responsibleName: user.username || 'system',
        sourceLocation: currentItem.status || '—',
        destinationLocation: nextState.status || '—',
        documentType: 'inventory',
        documentLabel: `Карточка объекта ${nextState.name}`,
        operationContext: 'inventory',
        notes: nextState.status_reason || nextState.writeoff_reason || '',
        createdBy: user.username || 'system'
      });
    }

    await syncAutoWriteoffDraft(client, { itemIds: [itemId] });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Данные объекта обновлены' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

router.put('/:id', authenticate, updateInventoryItem);
router.post('/:id', authenticate, (req, res, next) => {
  // Let dedicated route handle POST /purchase-requests.
  if (String(req.params?.id || '').trim().toLowerCase() === 'purchase-requests') {
    return next();
  }
  return updateInventoryItem(req, res, next);
});

router.delete('/:id', authenticate, async (req, res) => {
  const itemId = req.params.id;
  const user = req.user || { username: 'system' };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const referencesResult = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM rental_items WHERE item_id = $1) AS rental_refs,
         (SELECT COUNT(*) FROM event_items WHERE item_id = $1) AS event_refs`,
      [itemId]
    );

    const refs = referencesResult.rows[0] || { rental_refs: 0, event_refs: 0 };
    if (Number(refs.rental_refs) > 0 || Number(refs.event_refs) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Объект используется в арендах или мероприятиях. Удаление невозможно.' });
    }

    const existingResult = await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [itemId]);
    if (existingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const existingItem = existingResult.rows[0];
    await client.query('DELETE FROM inventory WHERE id = $1', [itemId]);

    await logInventoryMovement(client, {
      inventoryId: itemId,
      itemName: existingItem.name,
      category: existingItem.category,
      operationType: 'Удаление',
      quantity: existingItem.quantity,
      responsibleName: user.username || 'system',
      sourceLocation: existingItem.status || 'Склад',
      destinationLocation: 'Удалено из учёта',
      documentType: 'inventory',
      documentLabel: `Карточка объекта ${existingItem.name}`,
      operationContext: 'inventory',
      notes: 'Объект удалён из справочника',
      createdBy: user.username || 'system'
    });

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/movements', authenticate, async (req, res) => {
  try {
    const { search = '', dateFrom = '', dateTo = '', operationType = '', responsible = '', inventoryId = '' } = req.query;

    const [manualResult, rentalIssueResult, rentalReturnResult, eventIssueResult, eventReturnResult] = await Promise.all([
      pool.query(
        `SELECT m.*
         FROM inventory_movements m
         WHERE COALESCE(m.operation_context, 'inventory') NOT IN ('rental', 'event')`
      ),
      pool.query(
        `SELECT r.start_date AS operation_date,
                ri.item_id AS inventory_id,
                COALESCE(i.name, 'Не найден') AS item_name,
                COALESCE(i.category, ri.category, 'Склад') AS category,
                'Выдача' AS operation_type,
                ri.quantity,
                CONCAT_WS(' / ', e.name, c.name) AS responsible_name,
                'Склад' AS source_location,
                CONCAT('Аренда №', r.id) AS destination_location,
                'rental' AS document_type,
                r.id AS document_id,
                CONCAT('Акт по аренде №', r.id) AS document_label,
                CONCAT('/api/documents/rentals/', r.id, '/generate') AS document_url,
                'rental' AS operation_context,
                COALESCE(ri.comment, '') AS notes,
                NULL::text AS created_by
         FROM rentals r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN employees e ON e.id = r.employee_id
         INNER JOIN rental_items ri ON ri.rental_id = r.id
         LEFT JOIN inventory i ON i.id = ri.item_id`
      ),
      pool.query(
        `SELECT r.end_date AS operation_date,
                ri.item_id AS inventory_id,
                COALESCE(i.name, 'Не найден') AS item_name,
                COALESCE(i.category, ri.category, 'Склад') AS category,
                'Возврат' AS operation_type,
                ri.quantity,
                CONCAT_WS(' / ', e.name, c.name) AS responsible_name,
                CONCAT('Аренда №', r.id) AS source_location,
                'Склад' AS destination_location,
                'rental' AS document_type,
                r.id AS document_id,
                CONCAT('Акт приёмки №', r.id) AS document_label,
                CONCAT('/api/documents/rentals/', r.id, '/generate') AS document_url,
                'rental' AS operation_context,
                COALESCE(ri.comment, '') AS notes,
                NULL::text AS created_by
         FROM rentals r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN employees e ON e.id = r.employee_id
         INNER JOIN rental_items ri ON ri.rental_id = r.id
         LEFT JOIN inventory i ON i.id = ri.item_id
         WHERE COALESCE(NULLIF(TRIM(r.status), ''), 'Активна') = 'Завершена'`
      ),
      pool.query(
        `SELECT ev.start_date AS operation_date,
                ei.item_id AS inventory_id,
                COALESCE(i.name, 'Не найден') AS item_name,
                COALESCE(i.category, ei.category, 'Склад') AS category,
                'Выдача' AS operation_type,
                ei.quantity,
                COALESCE(emp.name, 'Не указан') AS responsible_name,
                'Склад' AS source_location,
                COALESCE(ev.location, CONCAT('Мероприятие №', ev.id)) AS destination_location,
                'event' AS document_type,
                ev.id AS document_id,
                CONCAT('Акт выдачи №', ev.id) AS document_label,
                CONCAT('/api/documents/events/', ev.id, '/generate') AS document_url,
                'event' AS operation_context,
                COALESCE(ei.comment, '') AS notes,
                NULL::text AS created_by
         FROM events ev
         LEFT JOIN employees emp ON emp.id = ev.employee_id
         INNER JOIN event_items ei ON ei.event_id = ev.id
         LEFT JOIN inventory i ON i.id = ei.item_id`
      ),
      pool.query(
        `SELECT COALESCE(ei.return_date, ev.end_date) AS operation_date,
                ei.item_id AS inventory_id,
                COALESCE(i.name, 'Не найден') AS item_name,
                COALESCE(i.category, ei.category, 'Склад') AS category,
                'Возврат' AS operation_type,
                ei.quantity,
                COALESCE(emp.name, 'Не указан') AS responsible_name,
                COALESCE(ev.location, CONCAT('Мероприятие №', ev.id)) AS source_location,
                'Склад' AS destination_location,
                'event' AS document_type,
                ev.id AS document_id,
                CONCAT('Акт приёмки №', ev.id) AS document_label,
                CONCAT('/api/documents/events/', ev.id, '/generate') AS document_url,
                'event' AS operation_context,
                COALESCE(ei.comment, '') AS notes,
                NULL::text AS created_by
         FROM events ev
         LEFT JOIN employees emp ON emp.id = ev.employee_id
         INNER JOIN event_items ei ON ei.event_id = ev.id
         LEFT JOIN inventory i ON i.id = ei.item_id
         WHERE COALESCE(NULLIF(TRIM(ev.status), ''), 'Планируется') = 'Завершено'`
      )
    ]);

    const rawRows = [
      ...manualResult.rows,
      ...rentalIssueResult.rows,
      ...rentalReturnResult.rows,
      ...eventIssueResult.rows,
      ...eventReturnResult.rows
    ];

    const searchValue = String(search || '').toLowerCase();
    const responsibleValue = String(responsible || '').toLowerCase();
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDateObject = dateTo ? new Date(dateTo) : null;

    const filtered = rawRows.filter(row => {
      const operationDate = row.operation_date ? new Date(row.operation_date) : null;
      const matchesInventory = !inventoryId || String(row.inventory_id) === String(inventoryId);
      const matchesOperation = !operationType || String(row.operation_type || '').toLowerCase() === String(operationType).toLowerCase();
      const matchesResponsible = !responsibleValue || String(row.responsible_name || '').toLowerCase().includes(responsibleValue);
      const matchesSearch = !searchValue || [row.item_name, row.document_label, row.notes, row.inventory_id]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(searchValue));
      const matchesFrom = !fromDate || (operationDate && operationDate >= fromDate);
      const matchesTo = !toDateObject || (operationDate && operationDate <= toDateObject);

      return matchesInventory && matchesOperation && matchesResponsible && matchesSearch && matchesFrom && matchesTo;
    }).sort((a, b) => new Date(b.operation_date) - new Date(a.operation_date));

    res.json(filtered.slice(0, 1000));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/calendar', authenticate, async (req, res) => {
  try {
    const {
      itemId = '',
      type = 'all',
      employeeId = '',
      dateFrom: queryDateFrom = '',
      dateTo: queryDateTo = ''
    } = req.query;

    const buildOverlapCondition = (startField, endField, params, startValue, endValue, startIndex = 1) => {
      const conditions = [];
      let index = startIndex;

      if (startValue) {
        conditions.push(`${endField} >= $${index++}`);
        params.push(startValue);
      }

      if (endValue) {
        conditions.push(`${startField} <= $${index++}`);
        params.push(endValue);
      }

      return { conditions, index };
    };

    const rentalParams = [];
    let rentalIndex = 1;
    const rentalConditions = [`COALESCE(NULLIF(TRIM(r.status), ''), 'Активна') <> 'Завершена'`];
    const rentalOverlap = buildOverlapCondition('r.start_date', 'r.end_date', rentalParams, queryDateFrom, queryDateTo, rentalIndex);
    rentalConditions.push(...rentalOverlap.conditions);
    rentalIndex = rentalOverlap.index;

    if (itemId) {
      rentalConditions.push(`ri.item_id = $${rentalIndex++}`);
      rentalParams.push(String(itemId));
    }

    if (employeeId) {
      rentalConditions.push(`r.employee_id = $${rentalIndex++}`);
      rentalParams.push(Number(employeeId));
    }

    const rentalRows = type === 'event'
      ? []
      : (await pool.query(
          `SELECT r.id,
                  r.start_date,
                  r.end_date,
                  r.status,
                  c.name AS client_name,
                  e.name AS employee_name,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'item_id', ri.item_id,
                        'item_name', COALESCE(i.name, 'Не найден'),
                        'category', COALESCE(i.category, ri.category),
                        'quantity', ri.quantity
                      )
                    ) FILTER (WHERE ri.item_id IS NOT NULL),
                    '[]'::json
                  ) AS items
           FROM rentals r
           LEFT JOIN clients c ON c.id = r.client_id
           LEFT JOIN employees e ON e.id = r.employee_id
           LEFT JOIN rental_items ri ON ri.rental_id = r.id
           LEFT JOIN inventory i ON i.id = ri.item_id
           WHERE ${rentalConditions.join(' AND ')}
           GROUP BY r.id, c.name, e.name
           ORDER BY r.start_date ASC`,
          rentalParams
        )).rows;

    const eventParams = [];
    let eventIndex = 1;
    const eventConditions = [`COALESCE(NULLIF(TRIM(ev.status), ''), 'Планируется') <> 'Завершено'`];
    const eventOverlap = buildOverlapCondition('ev.start_date', 'ev.end_date', eventParams, queryDateFrom, queryDateTo, eventIndex);
    eventConditions.push(...eventOverlap.conditions);
    eventIndex = eventOverlap.index;

    if (itemId) {
      eventConditions.push(`ei.item_id = $${eventIndex++}`);
      eventParams.push(String(itemId));
    }

    if (employeeId) {
      eventConditions.push(`ev.employee_id = $${eventIndex++}`);
      eventParams.push(Number(employeeId));
    }

    const eventRows = type === 'rental'
      ? []
      : (await pool.query(
          `SELECT ev.id,
                  ev.name,
                  ev.start_date,
                  ev.end_date,
                  ev.location,
                  ev.status,
                  emp.name AS employee_name,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'item_id', ei.item_id,
                        'item_name', COALESCE(i.name, 'Не найден'),
                        'category', COALESCE(i.category, ei.category),
                        'quantity', ei.quantity
                      )
                    ) FILTER (WHERE ei.item_id IS NOT NULL),
                    '[]'::json
                  ) AS items
           FROM events ev
           LEFT JOIN employees emp ON emp.id = ev.employee_id
           LEFT JOIN event_items ei ON ei.event_id = ev.id
           LEFT JOIN inventory i ON i.id = ei.item_id
           WHERE ${eventConditions.join(' AND ')}
           GROUP BY ev.id, emp.name
           ORDER BY ev.start_date ASC`,
          eventParams
        )).rows;

    const payload = [
      ...rentalRows.map(row => ({
        id: row.id,
        type: 'rental',
        title: `Аренда №${row.id}`,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        client_name: row.client_name || 'Не указан',
        employee_name: row.employee_name || 'Не указан',
        location: 'Аренда',
        items: Array.isArray(row.items) ? row.items : [],
        document_label: `Акт по аренде №${row.id}`,
        document_url: `/api/documents/rentals/${row.id}/generate`
      })),
      ...eventRows.map(row => ({
        id: row.id,
        type: 'event',
        title: row.name || `Мероприятие №${row.id}`,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        client_name: row.location || 'Мероприятие',
        employee_name: row.employee_name || 'Не указан',
        location: row.location || 'Не указано',
        items: Array.isArray(row.items) ? row.items : [],
        document_label: `Акт по мероприятию №${row.id}`,
        document_url: `/api/documents/events/${row.id}/generate`
      }))
    ].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status-summary', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(status), ''), 'В наличии') AS status_name,
              COUNT(*)::int AS item_count,
              COALESCE(SUM(quantity), 0)::int AS quantity_total
       FROM inventory
       GROUP BY status_name
       ORDER BY item_count DESC, quantity_total DESC, status_name`
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/purchase-requests/:id/status', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const id = Number(req.params.id);
    const status = normalizePurchaseStatus(req.body?.status || '');

    const current = await client.query(
      'SELECT status, item_id, quantity FROM purchase_requests WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    const previousStatus = normalizePurchaseStatus(current.rows[0].status || '');
    const itemId = current.rows[0].item_id;
    const quantity = Math.max(0, Number(current.rows[0].quantity || 0));

    await client.query(
      `UPDATE purchase_requests
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, id]
    );

    if (status === PURCHASE_STATUS.DELIVERED && previousStatus !== PURCHASE_STATUS.DELIVERED && itemId && quantity > 0) {
      await client.query(
        `UPDATE inventory
         SET quantity = GREATEST(0, COALESCE(quantity, 0) + $1),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [quantity, itemId]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/writeoff-acts', authenticate, async (req, res) => {
  try {
    if (ENABLE_AUTO_WRITEOFF_DRAFT) {
      await syncAutoWriteoffDraftInTransaction();
    }

    // Защитная уборка: пустые акты списания (без позиций) удаляем.
    await pool.query(
      `DELETE FROM writeoff_acts wa
       WHERE NOT EXISTS (
         SELECT 1
         FROM writeoff_act_items wai
         WHERE wai.act_id = wa.id
       )`
    );

    const dateFrom = String(req.query?.dateFrom || '').trim();
    const dateTo = String(req.query?.dateTo || '').trim();
    const basisType = String(req.query?.basisType || '').trim().toLowerCase();
    const objectQuery = String(req.query?.object || '').trim();
    const reasonQuery = String(req.query?.reason || '').trim();

    const whereParts = [];
    const params = [];

    if (dateFrom) {
      params.push(`${dateFrom}T00:00:00`);
      whereParts.push(`wa.act_date >= $${params.length}`);
    }

    if (dateTo) {
      params.push(`${dateTo}T23:59:59`);
      whereParts.push(`wa.act_date <= $${params.length}`);
    }

    if (basisType && ['event', 'rental'].includes(basisType)) {
      params.push(basisType);
      whereParts.push(`(
        LOWER(COALESCE(wa.basis_type, '')) = $${params.length}
        OR EXISTS (
          SELECT 1
          FROM writeoff_act_items wai_basis
          WHERE wai_basis.act_id = wa.id
            AND LOWER(COALESCE(wai_basis.basis_type, '')) = $${params.length}
        )
      )`);
    }

    if (objectQuery) {
      params.push(`%${objectQuery.toLowerCase()}%`);
      whereParts.push(`LOWER(COALESCE(wa.basis_name, wa.basis_label, '')) LIKE $${params.length}`);
    }

    if (reasonQuery) {
      params.push(`%${reasonQuery.toLowerCase()}%`);
      whereParts.push(`EXISTS (
        SELECT 1
        FROM writeoff_act_items wai_filter
        WHERE wai_filter.act_id = wa.id
          AND LOWER(COALESCE(wai_filter.reason, '')) LIKE $${params.length}
      )`);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT wa.id,
              wa.public_id,
              wa.act_number,
              wa.status,
              wa.posted_at,
              wa.act_date,
              wa.basis_type,
              wa.basis_id,
              wa.basis_label,
              wa.basis_name,
              wa.basis_act_number,
              wa.reason,
              wa.signature,
              wa.responsible_position,
              wa.created_by,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', wai.id,
                    'item_id', wai.item_id,
                    'item_name', wai.item_name,
                    'item_category', wai.item_category,
                    'item_type', wai.item_type,
                    'basis_type', wai.basis_type,
                    'basis_id', wai.basis_id,
                    'basis_label', wai.basis_label,
                    'basis_name', wai.basis_name,
                    'basis_act_number', wai.basis_act_number,
                    'quantity', wai.quantity,
                    'reason', wai.reason,
                    'reason_category', wai.reason_category,
                    'comment', wai.comment
                  )
                ) FILTER (WHERE wai.id IS NOT NULL),
                '[]'::json
              ) AS items
       FROM writeoff_acts wa
       LEFT JOIN writeoff_act_items wai ON wai.act_id = wa.id
       ${whereSql}
       GROUP BY wa.id
       ORDER BY wa.act_date DESC, wa.id DESC`,
      params
    );

    const payload = result.rows.map(row => {
      const rawItems = Array.isArray(row.items) ? row.items : [];
      const groupedItems = groupWriteoffActItems(rawItems.map(item => ({
        markerItemId: item.item_id,
        itemId: item.item_id,
        sourceItemId: item.item_id,
        name: item.item_name,
        category: item.item_category || '',
        type: item.item_type || 'asset',
        basisType: String(item.basis_type || '').trim() || (String(item.reason_category || '').trim() === 'expiry' ? 'item' : row.basis_type || ''),
        basisId: item.basis_id || item.item_id || row.basis_id || null,
        basisLabel: item.basis_label || (String(item.reason_category || '').trim() === 'expiry' ? 'Карточка объекта' : row.basis_label || ''),
        basisName: item.basis_name || item.item_name || row.basis_name || '',
        basisActNumber: item.basis_act_number || row.basis_act_number || '',
        quantity: toNumber(item.quantity),
        reason: item.reason || row.reason || 'Без причины',
        reasonCategory: normalizeWriteoffReasonCategory(item.reason_category, item.reason || row.reason || '', item.item_type || 'asset'),
        comment: String(item.comment || '').trim()
      })));
      const totalUnits = groupedItems.reduce((sum, item) => sum + toNumber(item.quantity), 0);
      const reasonCategories = [...new Set(groupedItems.map(item => String(item.reasonCategory || '').trim()).filter(Boolean))];
      const reasonSet = [...new Set(groupedItems.map(item => String(item.reason || '').trim()).filter(Boolean))];
      const reasonSummary = reasonSet.length === 1 ? reasonSet[0] : (reasonSet.length > 1 ? 'Смешанная' : (row.reason || 'Без причины'));
      const rawBasisType = String(row.basis_type || '').trim().toLowerCase();
      const normalizedBasisType = rawBasisType.includes('event')
        ? 'event'
        : (rawBasisType.includes('rental') ? 'rental' : (rawBasisType.includes('item') ? 'item' : rawBasisType || 'mixed'));
      const basisName = row.basis_name
        || row.basis_label
        || (normalizedBasisType === 'event'
          ? `Мероприятие №${row.basis_id || '—'}`
          : (normalizedBasisType === 'rental' ? `Аренда №${row.basis_id || '—'}` : 'Смешанное основание'));

      return {
        id: row.public_id || `WRITE-OFF-${String(row.act_number || '').replace(/^АС-/, '')}`,
        dbId: row.id,
        number: row.act_number,
        status: row.status || 'Проведен',
        postedAt: row.posted_at || null,
        date: row.act_date,
        basis: {
          type: normalizedBasisType,
          id: row.basis_id,
          name: basisName,
          actNumber: row.basis_act_number || ''
        },
        items: groupedItems,
        totals: {
          itemsCount: groupedItems.length,
          totalUnits
        },
        reasonSummary,
        reasonCategories,
        responsible: {
          name: row.signature || row.created_by || 'Ответственный',
          position: row.responsible_position || 'Кладовщик'
        },
        createdAt: row.act_date
      };
    });

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/accounting-dashboard', authenticate, async (req, res) => {
  try {
    if (ENABLE_AUTO_WRITEOFF_DRAFT) {
      await syncAutoWriteoffDraftInTransaction();
    }

    const thresholdPercentRaw = toNumber(req.query.thresholdPercent, 100);
    const thresholdPercent = Math.max(1, Math.min(100, thresholdPercentRaw));

    const [
      totalsResult,
      activeAssetsResult,
      criticalConsumablesResult,
      topAssetsResult,
      writeoffDynamicsResult,
      forecastConsumablesResult,
      assetExpiryResult,
      turnoverResult,
      writeoffReasonsResult,
      utilizationResult,
      capacityResult,
      pendingPurchaseResult,
      pendingWriteoffResult,
      writeoffCandidatesResult,
      categoryCurrentBalanceResult,
      categoryMovementResult
    ] = await Promise.all([
      // 1. totalsResult
      pool.query(
        `SELECT
          COUNT(*)::int AS total_items,
          COUNT(*) FILTER (WHERE type = 'asset')::int AS asset_items,
          COUNT(*) FILTER (WHERE type = 'consumable')::int AS consumable_items,
          COALESCE(SUM(quantity), 0)::int AS total_quantity,
          COALESCE(SUM(CASE WHEN type = 'asset' THEN quantity ELSE 0 END), 0)::int AS asset_quantity,
          COALESCE(SUM(CASE WHEN type = 'consumable' THEN quantity ELSE 0 END), 0)::int AS consumable_quantity,
          COALESCE(SUM(
            quantity * CASE WHEN type = 'asset' THEN 2500 ELSE 120 END
          ), 0)::numeric AS estimated_value
        FROM inventory`
      ),
      // 2. activeAssetsResult
      pool.query(
        `SELECT
          COUNT(DISTINCT ri.item_id)::int AS in_rentals,
          (SELECT COUNT(DISTINCT ei.item_id)::int
            FROM event_items ei
            INNER JOIN events ev ON ev.id = ei.event_id
            INNER JOIN inventory ie ON ie.id = ei.item_id
            WHERE COALESCE(NULLIF(TRIM(ev.status),''),'Планируется') <> 'Завершено'
              AND ie.type = 'asset'
          ) AS in_events
        FROM rental_items ri
        INNER JOIN rentals r ON r.id = ri.rental_id
        INNER JOIN inventory i ON i.id = ri.item_id
        WHERE COALESCE(NULLIF(TRIM(r.status),''),'Активна') <> 'Завершена'
          AND i.type = 'asset'`
      ),
      // 3. criticalConsumablesResult — расходники ниже порога
      pool.query(
        `SELECT id, name, quantity,
          COALESCE(minstock, 0) AS minstock,
          ROUND(
            CASE WHEN COALESCE(minstock,0) <= 0 THEN 100
                 ELSE (quantity::numeric / NULLIF(minstock,0)::numeric) * 100
            END, 1
          ) AS stock_percent
        FROM inventory
        WHERE type = 'consumable'
          AND COALESCE(minstock, 0) > 0
          AND quantity < COALESCE(minstock, 0)::numeric * $1::numeric / 100.0
        ORDER BY stock_percent ASC, quantity ASC, name
        LIMIT 20`,
        [thresholdPercent]
      ),
      // 4. topAssetsResult — ТОП-5 ОС по числу использований
      pool.query(
        `WITH usage_union AS (
          SELECT ri.item_id, COUNT(*)::int AS uses
          FROM rental_items ri
          INNER JOIN rentals r ON r.id = ri.rental_id
          GROUP BY ri.item_id
          UNION ALL
          SELECT ei.item_id, COUNT(*)::int AS uses
          FROM event_items ei
          INNER JOIN events e ON e.id = ei.event_id
          GROUP BY ei.item_id
        )
        SELECT i.id, i.name,
               COALESCE(SUM(u.uses), 0)::int AS usage_total
        FROM inventory i
        LEFT JOIN usage_union u ON u.item_id = i.id
        WHERE i.type = 'asset'
        GROUP BY i.id, i.name
        ORDER BY usage_total DESC, i.name
        LIMIT 5`
      ),
      // 5. writeoffDynamicsResult — динамика списаний за 6 мес
      pool.query(
        `SELECT
          DATE_TRUNC('month', wa.act_date) AS month_date,
          TO_CHAR(DATE_TRUNC('month', wa.act_date), 'MM.YYYY') AS month_label,
          COALESCE(SUM(wai.quantity), 0)::int AS total,
          COALESCE(SUM(CASE WHEN i.type = 'asset' THEN wai.quantity ELSE 0 END), 0)::int AS asset_total,
          COALESCE(SUM(CASE WHEN i.type = 'consumable' THEN wai.quantity ELSE 0 END), 0)::int AS consumable_total
        FROM writeoff_acts wa
        INNER JOIN writeoff_act_items wai ON wai.act_id = wa.id
        LEFT JOIN inventory i ON i.id = wai.item_id
        WHERE wa.act_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY month_date, month_label
        ORDER BY month_date`
      ),
      // 6. forecastConsumablesResult — прогноз (12 мес окно)
      pool.query(
        `SELECT
          i.id, i.name,
          COALESCE(i.minstock, 0)::int AS minstock,
          ROUND(COALESCE(SUM(wai.quantity), 0)::numeric / 3.0, 1) AS avg_monthly,
          COALESCE(SUM(wai.quantity), 0)::int AS total_consumed,
          COUNT(DISTINCT DATE_TRUNC('month', wa.act_date))::int AS months_with_data
        FROM inventory i
        LEFT JOIN writeoff_act_items wai ON wai.item_id = i.id
        LEFT JOIN writeoff_acts wa ON wa.id = wai.act_id
          AND wa.act_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
        WHERE i.type = 'consumable'
          AND COALESCE(i.minstock, 0) > 0
        GROUP BY i.id, i.name, i.minstock
        HAVING COALESCE(SUM(wai.quantity), 0) > 0
        ORDER BY avg_monthly DESC, i.name
        LIMIT 10`
      ),
      // 7. assetExpiryResult — ОС с заканчивающимся сроком
      pool.query(
        `WITH asset_lifecycle AS (
          SELECT id, name, category, balance_date, lifespan, status, quantity,
            (balance_date + (lifespan || ' months')::interval)::date AS end_date,
            ((balance_date + (lifespan || ' months')::interval)::date - CURRENT_DATE)::int AS days_left
          FROM inventory
          WHERE type = 'asset'
            AND balance_date IS NOT NULL
            AND lifespan IS NOT NULL
            AND COALESCE(is_writeoff_marker, FALSE) = FALSE
            AND COALESCE(quantity, 0) > 0
            AND COALESCE(NULLIF(TRIM(status), ''), 'В наличии') <> 'Списано'
        )
        SELECT id, name, category, balance_date, lifespan, status, quantity, end_date, days_left
        FROM asset_lifecycle
        WHERE days_left <= 90
        ORDER BY days_left ASC, name
        LIMIT 12`
      ),
      // 8. turnoverResult — оборотная ведомость
      pool.query(
        `SELECT i.id, i.name,
          COALESCE(SUM(wai.quantity), 0)::int AS outgoing,
          COALESCE(i.quantity, 0)::int AS balance,
          (COALESCE(SUM(wai.quantity), 0) + COALESCE(i.quantity, 0))::int AS incoming
        FROM inventory i
        LEFT JOIN writeoff_act_items wai ON wai.item_id = i.id
        LEFT JOIN writeoff_acts wa ON wa.id = wai.act_id
          AND wa.act_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '6 months'
        GROUP BY i.id, i.name, i.quantity
        ORDER BY i.name`
      ),
      // 9. writeoffReasonsResult — списания по причинам с разбивкой по типу
      pool.query(
        `SELECT
          COALESCE(
            NULLIF(TRIM(wai.reason_category), ''),
            CASE
              WHEN LOWER(COALESCE(wai.reason, '')) LIKE '%использован%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%израсход%' THEN 'consumable'
              WHEN LOWER(COALESCE(wai.reason, '')) LIKE '%истек срок%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%износ%' THEN 'expiry'
              WHEN LOWER(COALESCE(wai.reason, '')) LIKE '%утрач%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%потер%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%краж%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%невозврат%' THEN 'loss'
              WHEN LOWER(COALESCE(wai.reason, '')) LIKE '%повреж%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%полом%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%дефект%' OR LOWER(COALESCE(wai.reason, '')) LIKE '%ремонт%' THEN 'damage'
              ELSE 'other'
            END
          ) AS reason_category,
          COALESCE(SUM(wai.quantity), 0)::int AS qty,
          COALESCE(SUM(wai.quantity) FILTER (WHERE i.type = 'asset'), 0)::int AS asset_qty,
          COALESCE(SUM(wai.quantity) FILTER (WHERE i.type = 'consumable'), 0)::int AS consumable_qty
        FROM writeoff_act_items wai
        LEFT JOIN writeoff_acts wa ON wa.id = wai.act_id
        LEFT JOIN inventory i ON i.id = wai.item_id
        WHERE wa.act_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY qty DESC, 1`
      ),
      // 10. utilizationResult — эффективность ОС (180 дней)
      pool.query(
        `WITH period AS (
          SELECT
            DATE_TRUNC('day', CURRENT_DATE - INTERVAL '180 days') AS period_start,
            DATE_TRUNC('day', CURRENT_DATE) AS period_end
        ), usage_union AS (
          SELECT ri.item_id,
            SUM(EXTRACT(EPOCH FROM (LEAST(r.end_date, (SELECT period_end FROM period))
              - GREATEST(r.start_date, (SELECT period_start FROM period)))) / 86400.0) AS days_used
          FROM rental_items ri
          INNER JOIN rentals r ON r.id = ri.rental_id
          WHERE r.end_date >= (SELECT period_start FROM period)
            AND r.start_date <= (SELECT period_end FROM period)
          GROUP BY ri.item_id
          UNION ALL
          SELECT ei.item_id,
            SUM(EXTRACT(EPOCH FROM (LEAST(e.end_date, (SELECT period_end FROM period))
              - GREATEST(e.start_date, (SELECT period_start FROM period)))) / 86400.0) AS days_used
          FROM event_items ei
          INNER JOIN events e ON e.id = ei.event_id
          WHERE e.end_date >= (SELECT period_start FROM period)
            AND e.start_date <= (SELECT period_end FROM period)
          GROUP BY ei.item_id
        )
        SELECT i.id, i.name,
          ROUND(LEAST(
            COALESCE(SUM(u.days_used), 0)::numeric / 180.0 * 100, 100
          ), 1) AS utilization_percent
        FROM inventory i
        LEFT JOIN usage_union u ON u.item_id = i.id
        WHERE i.type = 'asset'
        GROUP BY i.id, i.name
        ORDER BY utilization_percent DESC NULLS LAST, i.name
        LIMIT 20`
      ),
      // 11. capacityResult — загрузка склада по статусам
      pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN status IN ('В аренде','На мероприятии','На реставрации')
            THEN GREATEST(COALESCE(quantity,0), 0) ELSE 0 END), 0)::int AS occupied_qty,
          COALESCE(SUM(CASE WHEN status = 'В наличии'
            THEN GREATEST(COALESCE(quantity,0), 0) ELSE 0 END), 0)::int AS free_qty,
          COALESCE(SUM(GREATEST(COALESCE(quantity,0), 0))
            FILTER (WHERE status <> 'Списано'), 0)::int AS total_qty,
          COUNT(*) FILTER (WHERE status IN ('В аренде','На мероприятии','На реставрации'))::int AS occupied_items,
          COUNT(*) FILTER (WHERE status = 'В наличии')::int AS free_items
        FROM inventory`
      ),
      // 12. pendingPurchaseResult
      pool.query(
        `SELECT COUNT(*)::int AS count
        FROM purchase_requests
        WHERE COALESCE(NULLIF(TRIM(status),''),'Черновик') IN ('Черновик','Согласована','Заказана')`
      ),
      pool.query(
        `SELECT wa.id,
                wa.act_number,
                COALESCE(COUNT(wai.id), 0)::int AS positions,
                COALESCE(SUM(wai.quantity), 0)::int AS units,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'reason_category', COALESCE(NULLIF(TRIM(wai.reason_category), ''), 'other'),
                      'reason', COALESCE(NULLIF(TRIM(wai.reason), ''), 'Без причины'),
                      'positions', 1,
                      'units', wai.quantity
                    )
                  ) FILTER (WHERE wai.id IS NOT NULL),
                  '[]'::json
                ) AS items
         FROM writeoff_acts wa
         LEFT JOIN writeoff_act_items wai ON wai.act_id = wa.id
         WHERE wa.status = 'Черновик'
         GROUP BY wa.id, wa.act_number, wa.created_at
         ORDER BY wa.created_at ASC, wa.id ASC
         LIMIT 1`
      ),
      pool.query(
        `WITH base AS (
           SELECT i.id,
                  i.name,
                  i.category,
                  i.type,
                  i.quantity,
                  i.quantity_pending_writeoff,
                  i.status,
                  i.writeoff_reason,
                  i.writeoff_act_number,
                  i.balance_date,
                  i.lifespan,
                  CASE
                    WHEN i.balance_date IS NOT NULL AND i.lifespan IS NOT NULL
                      THEN (i.balance_date + (i.lifespan || ' months')::interval)::date
                    ELSE NULL
                  END AS end_date
           FROM inventory i
         )
         SELECT id,
                name,
                category,
                type,
                quantity,
                quantity_pending_writeoff,
                status,
                writeoff_reason,
                writeoff_act_number,
                end_date,
                CASE
                  WHEN COALESCE(NULLIF(TRIM(status), ''), 'В наличии') = 'Списано' THEN NULL
                  WHEN COALESCE(quantity_pending_writeoff, 0) > 0 THEN 'pending_writeoff'
                  WHEN type = 'asset' AND end_date IS NOT NULL AND end_date < CURRENT_DATE THEN 'expiry'
                  WHEN COALESCE(NULLIF(TRIM(status), ''), 'В наличии') = 'К списанию' THEN 'status'
                  WHEN COALESCE(quantity, 0) <= 0 THEN 'zero_stock'
                  ELSE NULL
                END AS candidate_reason
         FROM base
         WHERE (
          COALESCE(NULLIF(TRIM(status), ''), 'В наличии') <> 'Списано'
          AND (
            COALESCE(quantity_pending_writeoff, 0) > 0
            OR (type = 'asset' AND end_date IS NOT NULL AND end_date < CURRENT_DATE)
            OR COALESCE(NULLIF(TRIM(status), ''), 'В наличии') = 'К списанию'
            OR COALESCE(quantity, 0) <= 0
          )
         )
         ORDER BY
           CASE WHEN COALESCE(quantity_pending_writeoff, 0) > 0 THEN 0 ELSE 1 END,
           name ASC
         LIMIT 20`
      ),
      pool.query(
        `SELECT category, COALESCE(SUM(quantity), 0)::int AS qty
         FROM inventory
         WHERE category IS NOT NULL
         GROUP BY category`
      ),
      pool.query(
        `SELECT
           DATE_TRUNC('month', operation_date) AS month_date,
           TO_CHAR(DATE_TRUNC('month', operation_date), 'MM.YYYY') AS month_label,
           category,
           operation_type,
           COALESCE(SUM(quantity), 0)::int AS qty
         FROM inventory_movements
         WHERE operation_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
         GROUP BY month_date, month_label, category, operation_type
         ORDER BY month_date ASC`
      )
    ]);

    const totals = totalsResult.rows[0] || {};
    const activeAssets = activeAssetsResult.rows[0] || {};
    const capacity = capacityResult.rows[0] || {};

    const monthMap = new Map();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - offset, 1);
      date.setHours(0, 0, 0, 0);
      const key = toMonthKey(date);
      monthMap.set(key, {
        month: key,
        total: 0,
        asset: 0,
        consumable: 0
      });
    }

    writeoffDynamicsResult.rows.forEach(row => {
      const key = row.month_label;
      if (monthMap.has(key)) {
        monthMap.set(key, {
          month: key,
          total: toNumber(row.total),
          asset: toNumber(row.asset_total),
          consumable: toNumber(row.consumable_total)
        });
      }
    });

    const writeoffDynamics = Array.from(monthMap.values());

    const categoryKeys = ['Мебель', 'Экспонаты', 'Инструменты'];
    const categoryMonthMap = new Map();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - offset, 1);
      date.setHours(0, 0, 0, 0);
      const key = toMonthKey(date);
      categoryMonthMap.set(key, {
        key,
        monthShort: date.toLocaleString('ru-RU', { month: 'short' }).replace('.', ''),
        deltas: { Мебель: 0, Экспонаты: 0, Инструменты: 0 }
      });
    }

    const currentCategoryBalances = { Мебель: 0, Экспонаты: 0, Инструменты: 0 };
    categoryCurrentBalanceResult.rows.forEach((row) => {
      const categoryName = normalizeDashboardCategory(row.category);
      if (!categoryName) return;
      currentCategoryBalances[categoryName] += toNumber(row.qty);
    });

    categoryMovementResult.rows.forEach((row) => {
      const key = String(row.month_label || '').trim();
      if (!categoryMonthMap.has(key)) return;
      const categoryName = normalizeDashboardCategory(row.category);
      if (!categoryName) return;
      const sign = inferMovementDeltaSign(row.operation_type);
      if (sign === 0) return;
      const monthEntry = categoryMonthMap.get(key);
      monthEntry.deltas[categoryName] += sign * toNumber(row.qty);
    });

    const categoryMonths = Array.from(categoryMonthMap.values());
    const categoryHistoryByName = {
      Мебель: new Array(categoryMonths.length).fill(0),
      Экспонаты: new Array(categoryMonths.length).fill(0),
      Инструменты: new Array(categoryMonths.length).fill(0)
    };

    categoryKeys.forEach((categoryName) => {
      let rolling = currentCategoryBalances[categoryName] || 0;
      for (let idx = categoryMonths.length - 1; idx >= 0; idx -= 1) {
        categoryHistoryByName[categoryName][idx] = Math.max(0, Math.round(rolling));
        rolling -= toNumber(categoryMonths[idx].deltas[categoryName]);
      }
    });

    const forecastConsumables = forecastConsumablesResult.rows.map(row => {
      const avgMonthly = toNumber(row.avg_monthly);
      const recommended = Math.max(Math.ceil(avgMonthly * 1.3), toNumber(row.minstock), avgMonthly > 0 ? 1 : 0);
      return {
        id: row.id,
        name: row.name,
        avgMonthly,
        minStock: toNumber(row.minstock),
        recommendedOrder: recommended,
        totalConsumed: toNumber(row.total_consumed),
        monthsWithData: toNumber(row.months_with_data)
      };
    });

    const expiryAssets = assetExpiryResult.rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category || '',
      status: row.status || '',
      quantity: toNumber(row.quantity),
      daysLeft: toNumber(row.days_left),
      isExpired: toNumber(row.days_left) < 0,
      endDate: row.end_date,
      balanceDate: row.balance_date,
      lifespan: toNumber(row.lifespan)
    }));

    res.json({
      dateLabel: formatDateRu(new Date()),
      userName: req.user?.username || 'Пользователь',
      settings: {
        thresholdPercent
      },
      kpi: {
        totalItems: toNumber(totals.total_items),
        assetItems: toNumber(totals.asset_items),
        consumableItems: toNumber(totals.consumable_items),
        totalQuantity: toNumber(totals.total_quantity),
        assetQuantity: toNumber(totals.asset_quantity),
        consumableQuantity: toNumber(totals.consumable_quantity),
        estimatedValue: toNumber(totals.estimated_value),
        pendingPurchase: toNumber(pendingPurchaseResult.rows[0]?.count)
      },
      pendingWriteoffDraft: pendingWriteoffResult.rows[0]
        ? {
            id: Number(pendingWriteoffResult.rows[0].id),
            number: pendingWriteoffResult.rows[0].act_number,
            positions: toNumber(pendingWriteoffResult.rows[0].positions),
            units: toNumber(pendingWriteoffResult.rows[0].units),
            items: Array.isArray(pendingWriteoffResult.rows[0].items) ? pendingWriteoffResult.rows[0].items : []
          }
        : null,
      writeoffCandidates: writeoffCandidatesResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        category: row.category || '',
        type: row.type || 'asset',
        quantity: toNumber(row.quantity),
        pendingWriteoff: toNumber(row.quantity_pending_writeoff),
        status: row.status || '',
        writeoffReason: row.writeoff_reason || '',
        writeoffActNumber: row.writeoff_act_number || '',
        endDate: row.end_date || null,
        candidateReason: row.candidate_reason || ''
      })),
      assets: {
        inRentals: toNumber(activeAssets.in_rentals),
        inEvents: toNumber(activeAssets.in_events),
        topUsed: topAssetsResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          usage: toNumber(row.usage_total)
        }))
      },
      consumables: {
        critical: criticalConsumablesResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          quantity: toNumber(row.quantity),
          minStock: toNumber(row.minstock),
          stockPercent: toNumber(row.stock_percent)
        }))
      },
      writeoffDynamics,
      forecast: {
        consumables: forecastConsumables,
        assetExpiry: expiryAssets
      },
      reports: {
        turnover: turnoverResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          incoming: toNumber(row.incoming),
          outgoing: toNumber(row.outgoing),
          balance: toNumber(row.balance)
        })),
        writeoffReasons: writeoffReasonsResult.rows.map(row => ({
          reasonCategory: row.reason_category,
          quantity: toNumber(row.qty),
          assetQty: toNumber(row.asset_qty),
          consumableQty: toNumber(row.consumable_qty)
        })),
        categoryStockDynamics: {
          months: categoryMonths.map(entry => entry.monthShort),
          furniture: categoryHistoryByName['Мебель'],
          exhibits: categoryHistoryByName['Экспонаты'],
          tools: categoryHistoryByName['Инструменты']
        },
        assetUtilization: utilizationResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          utilizationPercent: toNumber(row.utilization_percent)
        })),
        warehouseCapacity: {
          totalQty: toNumber(capacity.total_qty),
          occupiedQty: toNumber(capacity.occupied_qty),
          freeQty: toNumber(capacity.free_qty),
          occupiedItems: toNumber(capacity.occupied_items),
          freeItems: toNumber(capacity.free_items)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/writeoff-acts/:id/post', authenticate, async (req, res) => {
  const actId = Number(req.params.id);
  if (!Number.isFinite(actId) || actId <= 0) {
    return res.status(400).json({ error: 'Некорректный идентификатор акта' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actResult = await client.query(
      `SELECT id, act_number, status
       FROM writeoff_acts
       WHERE id = $1
       FOR UPDATE`,
      [actId]
    );

    if (!actResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Акт списания не найден' });
    }

    const act = actResult.rows[0];
    if (String(act.status || '').trim() === 'Проведен') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Акт уже проведен' });
    }

    const itemsResult = await client.query(
      `SELECT item_id, quantity, reason, reason_category, comment
       FROM writeoff_act_items
       WHERE act_id = $1`,
      [actId]
    );

    if (!itemsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В акте отсутствуют позиции для списания' });
    }

    const reasonByItemId = new Map();
    for (const row of itemsResult.rows) {
      const itemId = String(row.item_id || '').trim();
      if (!itemId) continue;
      const reason = String(row.reason || '').trim() || 'Списание';
      if (!reasonByItemId.has(itemId)) {
        reasonByItemId.set(itemId, new Set([reason]));
      } else {
        reasonByItemId.get(itemId).add(reason);
      }
    }

    const affectedItemIds = [...new Set(
      itemsResult.rows
        .map(row => String(row.item_id || '').trim())
        .filter(Boolean)
    )];

    for (const row of itemsResult.rows) {
      const itemId = row.item_id;
      const reasonSet = reasonByItemId.get(String(itemId || '').trim());
      const reason = reasonSet && reasonSet.size > 0
        ? Array.from(reasonSet).join('; ')
        : (String(row.reason || '').trim() || 'Списание');

      const itemResult = await client.query(
          `SELECT id, type, quantity, quantity_pending_writeoff, is_writeoff_marker, source_item_id
         FROM inventory
         WHERE id = $1
         FOR UPDATE`,
        [itemId]
      );

      if (!itemResult.rows.length) continue;
      const item = itemResult.rows[0];
      const writeoffQty = Math.max(0, Number(row.quantity || 0));

      const currentTotal = Math.max(0, Number(item.quantity || 0));
      const currentPending = Math.max(0, Number(item.quantity_pending_writeoff || 0));
      const pendingToReduce = Math.min(currentPending, writeoffQty);
      const nextPending = Math.max(0, currentPending - pendingToReduce);
      const nextTotal = Math.max(0, currentTotal - writeoffQty);

      await client.query(
        `UPDATE inventory
         SET quantity = $1,
             quantity_pending_writeoff = $2,
             status = CASE
               WHEN $1 <= 0 THEN 'Списано'
               WHEN COALESCE(NULLIF(TRIM(status), ''), 'В наличии') = 'Списано' THEN 'В наличии'
               ELSE status
             END,
             writeoff_reason = $3,
             writeoff_date = CURRENT_TIMESTAMP,
             writeoff_act_number = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [nextTotal, nextPending, reason, act.act_number, item.id]
      );
    }

    await client.query(
      `UPDATE writeoff_acts
       SET status = 'Проведен',
           posted_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [actId]
    );

    if (affectedItemIds.length) {
      await client.query(
        `WITH ids AS (
           SELECT UNNEST($1::text[]) AS item_id
         ),
         pending AS (
           SELECT
             wai.item_id,
             SUM(wai.quantity) AS pending_qty
           FROM writeoff_act_items wai
           INNER JOIN writeoff_acts wa ON wa.id = wai.act_id
           INNER JOIN ids ON ids.item_id = wai.item_id
           WHERE COALESCE(NULLIF(TRIM(wa.status), ''), 'Черновик') = 'Черновик'
           GROUP BY wai.item_id
         )
         UPDATE inventory i
         SET quantity_pending_writeoff = LEAST(
               GREATEST(COALESCE(i.quantity, 0), 0),
               GREATEST(COALESCE(p.pending_qty, 0), 0)
             ),
             updated_at = CURRENT_TIMESTAMP
         FROM ids
         LEFT JOIN pending p ON p.item_id = ids.item_id
         WHERE i.id = ids.item_id`,
        [affectedItemIds]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, actId, number: act.act_number });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/writeoff-acts/:id', authenticate, async (req, res) => {
  const actId = Number(req.params.id);
  if (!Number.isFinite(actId) || actId <= 0) {
    return res.status(400).json({ error: 'Некорректный идентификатор акта' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actResult = await client.query(
      `SELECT id, act_number, status
       FROM writeoff_acts
       WHERE id = $1
       FOR UPDATE`,
      [actId]
    );

    if (!actResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Акт списания не найден' });
    }

    const act = actResult.rows[0];
    if (String(act.status || '').trim() !== 'Черновик') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Редактирование доступно только для черновика' });
    }

    const normalizedItems = normalizeWriteoffDraftItems(req.body?.items || []);
    if (!normalizedItems.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите хотя бы одну позицию для акта' });
    }

    const groupedBySource = new Map();
    for (const item of normalizedItems) {
      const sourceItemId = item.itemId;
      const key = `${sourceItemId}::${item.reason}::${item.reasonCategory || ''}::${item.comment || ''}::${item.basisType || ''}::${item.basisId || ''}::${item.basisLabel || ''}::${item.basisName || ''}::${item.basisActNumber || ''}`;
      if (!groupedBySource.has(key)) {
        groupedBySource.set(key, {
          sourceItemId,
          quantity: Math.max(0, Number(item.quantity || 0)),
          reason: normalizeWriteoffReasonText(item.reason),
          reasonCategory: normalizeWriteoffReasonCategory(item.reasonCategory, item.reason),
          comment: String(item.comment || '').trim(),
          basisType: String(item.basisType || '').trim(),
          basisId: item.basisId ?? null,
          basisLabel: String(item.basisLabel || '').trim(),
          basisName: String(item.basisName || '').trim(),
          basisActNumber: String(item.basisActNumber || '').trim()
        });
      } else {
        const grouped = groupedBySource.get(key);
        grouped.quantity = Math.max(0, Number(grouped.quantity || 0) + Math.max(0, Number(item.quantity || 0)));
      }
    }

    const finalItems = Array.from(groupedBySource.values()).filter(item => item.sourceItemId && item.quantity > 0);
    if (!finalItems.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Не удалось подготовить позиции для сохранения' });
    }

    const previousItemsResult = await client.query(
      `SELECT item_id, quantity
       FROM writeoff_act_items
       WHERE act_id = $1`,
      [actId]
    );

    const previousTotalsByItem = new Map();
    for (const prev of previousItemsResult.rows) {
      const prevItemId = String(prev.item_id || '').trim();
      if (!prevItemId) continue;
      previousTotalsByItem.set(prevItemId, Math.max(0, Number(previousTotalsByItem.get(prevItemId) || 0) + Math.max(0, Number(prev.quantity || 0))));
    }

    const nextTotalsByItem = new Map();
    for (const nextItem of finalItems) {
      const nextItemId = String(nextItem.sourceItemId || '').trim();
      if (!nextItemId) continue;
      nextTotalsByItem.set(nextItemId, Math.max(0, Number(nextTotalsByItem.get(nextItemId) || 0) + Math.max(0, Number(nextItem.quantity || 0))));
    }

    const allItemIds = new Set([...previousTotalsByItem.keys(), ...nextTotalsByItem.keys()]);
    for (const stockItemId of allItemIds) {
      const stockResult = await client.query(
        `SELECT id, quantity, quantity_pending_writeoff
         FROM inventory
         WHERE id = $1
         FOR UPDATE`,
        [stockItemId]
      );
      if (!stockResult.rows.length) continue;

      const stock = stockResult.rows[0];
      const prevQty = Math.max(0, Number(previousTotalsByItem.get(stockItemId) || 0));
      const nextQty = Math.max(0, Number(nextTotalsByItem.get(stockItemId) || 0));
      const currentPending = Math.max(0, Number(stock.quantity_pending_writeoff || 0));
      const restoredPending = Math.max(0, currentPending - prevQty + nextQty);
      const cappedPending = Math.min(Math.max(0, Number(stock.quantity || 0)), restoredPending);

      await client.query(
        `UPDATE inventory
         SET quantity_pending_writeoff = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [cappedPending, stock.id]
      );
    }

    await client.query('DELETE FROM writeoff_act_items WHERE act_id = $1', [actId]);

    for (const item of finalItems) {
      const sourceResult = await client.query(
        `SELECT id, name, category, type, location
         FROM inventory
         WHERE id = $1
         FOR UPDATE`,
        [item.sourceItemId]
      );

      if (!sourceResult.rows.length) continue;

      const source = sourceResult.rows[0];
      const normalizedReason = normalizeWriteoffReasonText(item.reason);
      const normalizedReasonCategory = normalizeWriteoffReasonCategory(item.reasonCategory, normalizedReason, source.type || 'asset');
      const normalizedComment = String(item.comment || '').trim();

      await client.query(
        `INSERT INTO writeoff_act_items (act_id, item_id, item_name, item_category, item_type, quantity, reason, reason_category, comment, basis_type, basis_id, basis_label, basis_name, basis_act_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          act.id,
          source.id,
          source.name || source.id,
          source.category || '',
          normalizeAccountingType(source.type || 'asset'),
          Math.max(1, Number(item.quantity || 0)),
          normalizedReason,
          normalizedReasonCategory,
          normalizedComment,
          item.basisType || 'item',
          item.basisId === null || item.basisId === undefined ? String(source.id) : String(item.basisId),
          item.basisLabel || 'Карточка объекта',
          item.basisName || source.name || source.id,
          item.basisActNumber || ''
        ]
      );
    }

    const explicitReason = String(req.body?.reason || '').trim();
    const fallbackReason = finalItems.length === 1
      ? normalizeWriteoffReasonText(finalItems[0].reason)
      : 'Смешанная';

    await client.query(
      `UPDATE writeoff_acts
       SET reason = $1,
           signature = COALESCE(NULLIF($2, ''), signature),
           responsible_position = COALESCE(NULLIF($3, ''), responsible_position)
       WHERE id = $4`,
      [
        normalizeWriteoffReasonText(explicitReason || fallbackReason),
        String(req.body?.responsibleName || '').trim(),
        String(req.body?.responsiblePosition || '').trim(),
        act.id
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, actId: act.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/writeoff-acts/:id/unpost', authenticate, async (req, res) => {
  const actId = Number(req.params.id);
  if (!Number.isFinite(actId) || actId <= 0) {
    return res.status(400).json({ error: 'Некорректный идентификатор акта' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actResult = await client.query(
      `SELECT id, act_number, status
       FROM writeoff_acts
       WHERE id = $1
       FOR UPDATE`,
      [actId]
    );

    if (!actResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Акт списания не найден' });
    }

    const act = actResult.rows[0];
    if (String(act.status || '').trim() !== 'Проведен') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Отмена доступна только для проведенного акта' });
    }

    const itemsResult = await client.query(
      `SELECT wai.item_id, wai.quantity
       FROM writeoff_act_items wai
       WHERE wai.act_id = $1
       ORDER BY wai.id ASC`,
      [act.id]
    );

    if (!itemsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В акте отсутствуют позиции для отмены' });
    }

    for (const row of itemsResult.rows) {
      const quantity = Math.max(0, toNumber(row.quantity));
      const itemId = String(row.item_id || '').trim();
      if (!itemId || quantity <= 0) continue;

      const stockResult = await client.query(
        `SELECT id, quantity, quantity_pending_writeoff
         FROM inventory
         WHERE id = $1
         FOR UPDATE`,
        [itemId]
      );
      if (!stockResult.rows.length) continue;

      const stock = stockResult.rows[0];
      const nextTotal = Math.max(0, Number(stock.quantity || 0) + quantity);
      const nextPending = Math.max(0, Number(stock.quantity_pending_writeoff || 0) + quantity);

      await client.query(
        `UPDATE inventory
         SET quantity = $1,
             quantity_pending_writeoff = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [nextTotal, nextPending, stock.id]
      );
    }

    await client.query(
      `UPDATE writeoff_acts
       SET status = 'Черновик',
           posted_at = NULL
       WHERE id = $1`,
      [act.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, actId: act.id, status: 'Черновик' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/writeoff-acts/draft/add-item', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    const itemId = String(req.body?.itemId || '').trim();
    const quantity = Math.max(1, toNumber(req.body?.quantity, 1));
    const reason = String(req.body?.reason || '').trim() || 'Ручное списание';

    if (!itemId) {
      return res.status(400).json({ error: 'Не указан объект для списания' });
    }

    await client.query('BEGIN');

    const itemResult = await client.query(
      `SELECT id, name, category, type, balance_date, lifespan
       FROM inventory
       WHERE id = $1`,
      [itemId]
    );
    if (!itemResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const item = itemResult.rows[0];
    const reasonCategory = normalizeWriteoffReasonCategory(req.body?.reasonCategory, reason, item.type || 'asset');
    const comment = String(req.body?.comment || '').trim() || (reasonCategory === 'expiry' ? buildExpiryWriteoffComment(item) : '');
    const itemBasisType = String(req.body?.basisType || 'item').trim() || 'item';
    const draftAct = await createWriteoffAct(client, {
      basisType: 'item',
      basisId: null,
      basisLabel: 'Карточка объекта',
      basisName: item.name || item.id,
      reason,
      signature: req.user?.username || 'Ответственный',
      responsiblePosition: 'Кладовщик',
      createdBy: req.user?.username || 'system',
      items: [{
        itemId: item.id,
        quantity,
        reason,
        reasonCategory,
        comment,
        itemName: item.name,
        category: item.category || '',
        itemType: item.type || 'asset',
        basisType: itemBasisType,
        basisId: itemBasisType === 'item' ? null : (req.body?.basisId ?? null),
        basisLabel: String(req.body?.basisLabel || 'Карточка объекта').trim(),
        basisName: String(req.body?.basisName || item.name || item.id).trim(),
        basisActNumber: String(req.body?.basisActNumber || '').trim()
      }]
    });

    await client.query('COMMIT');
    res.json({ success: true, draftAct });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/purchase-requests/auto-critical', authenticate, async (req, res) => {
  const thresholdPercent = Math.max(1, Math.min(90, toNumber(req.body?.thresholdPercent, 10)));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const criticalRows = await client.query(
      `SELECT id, name, quantity, COALESCE(minstock, 0) AS minstock
      FROM inventory
      WHERE type = 'consumable'
        AND requires_purchase = TRUE
        AND COALESCE(minstock, 0) > 0
        AND quantity <= GREATEST(1, ROUND(COALESCE(minstock, 0) * $1 / 100.0))
      ORDER BY quantity ASC, minstock DESC, name`,
      [thresholdPercent]
    );

    const created = [];
    for (const row of criticalRows.rows) {
      const requested = Math.max(toNumber(row.minstock), toNumber(row.quantity) + 1);
      const createdRequest = await createPurchaseRequest(client, {
        itemId: row.id,
        requestedQuantity: requested,
        availableQuantity: toNumber(row.quantity),
        sourceType: 'critical_stock',
        sourceId: null,
        notes: `Автозаявка по критическому остатку (${thresholdPercent}% от мин. нормы)`,
        createdBy: req.user?.username || 'system'
      });

      if (createdRequest) {
        created.push({
          id: createdRequest.id,
          requestNumber: createdRequest.request_number,
          itemId: row.id,
          itemName: row.name
        });
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      createdCount: created.length,
      created
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/purchase-requests/apply-delivery', authenticate, async (req, res) => {
  const client = await pool.connect();

  try {
    const deliveryItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const documentNumber = String(req.body?.documentNumber || '').trim();
    const createdBy = req.user?.username || 'system';

    const normalizedItems = deliveryItems
      .map(item => ({
        itemId: String(item?.itemId || '').trim(),
        itemName: String(item?.itemName || '').trim(),
        quantity: Math.max(0, toNumber(item?.quantity, 0))
      }))
      .filter(item => (item.itemId || item.itemName) && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ error: 'Не переданы позиции поставки' });
    }

    await client.query('BEGIN');

    const applied = [];
    for (const item of normalizedItems) {
      let inventoryRow = { rows: [] };
      if (item.itemId) {
        inventoryRow = await client.query(
          `SELECT id, name, category, quantity
           FROM inventory
           WHERE id = $1
           FOR UPDATE`,
          [item.itemId]
        );
      }
      if (!inventoryRow.rows.length && item.itemName) {
        inventoryRow = await client.query(
          `SELECT id, name, category, quantity
           FROM inventory
           WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           LIMIT 1
           FOR UPDATE`,
          [item.itemName]
        );
      }

      if (!inventoryRow.rows.length) {
        continue;
      }

      const current = inventoryRow.rows[0];
      const beforeQty = toNumber(current.quantity, 0);
      const delta = Math.max(0, toNumber(item.quantity, 0));
      const afterQty = beforeQty + delta;

      await client.query(
        `UPDATE inventory
         SET quantity = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [afterQty, current.id]
      );

      await logInventoryMovement(client, {
        inventoryId: current.id,
        itemName: current.name,
        category: current.category || '',
        operationType: 'Поставка закупки',
        quantity: delta,
        responsibleName: createdBy,
        sourceLocation: 'Поставщик',
        destinationLocation: 'Склад',
        documentType: 'purchase_request',
        documentId: null,
        documentLabel: documentNumber ? `Заявка ${documentNumber}` : 'Заявка на закупку',
        operationContext: 'purchase_request',
        notes: 'Поступление по заявке на закупку',
        createdBy,
        operationDate: new Date()
      });

      applied.push({
        itemId: current.id,
        itemName: current.name,
        deliveredQuantity: delta,
        quantityBefore: beforeQty,
        quantityAfter: afterQty
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      appliedCount: applied.length,
      applied
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/purchase-requests/revert-delivery', authenticate, async (req, res) => {
  const client = await pool.connect();

  try {
    const deliveryItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const documentNumber = String(req.body?.documentNumber || '').trim();
    const createdBy = req.user?.username || 'system';

    const normalizedItems = deliveryItems
      .map(item => ({
        itemId: String(item?.itemId || '').trim(),
        itemName: String(item?.itemName || '').trim(),
        quantity: Math.max(0, toNumber(item?.quantity, 0))
      }))
      .filter(item => (item.itemId || item.itemName) && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ error: 'Не переданы позиции для отката поставки' });
    }

    await client.query('BEGIN');

    const applied = [];
    for (const item of normalizedItems) {
      let inventoryRow = { rows: [] };
      if (item.itemId) {
        inventoryRow = await client.query(
          `SELECT id, name, category, quantity
           FROM inventory
           WHERE id = $1
           FOR UPDATE`,
          [item.itemId]
        );
      }
      if (!inventoryRow.rows.length && item.itemName) {
        inventoryRow = await client.query(
          `SELECT id, name, category, quantity
           FROM inventory
           WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           LIMIT 1
           FOR UPDATE`,
          [item.itemName]
        );
      }

      if (!inventoryRow.rows.length) {
        continue;
      }

      const current = inventoryRow.rows[0];
      const beforeQty = toNumber(current.quantity, 0);
      const delta = Math.max(0, toNumber(item.quantity, 0));
      const afterQty = Math.max(0, beforeQty - delta);

      await client.query(
        `UPDATE inventory
         SET quantity = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [afterQty, current.id]
      );

      await logInventoryMovement(client, {
        inventoryId: current.id,
        itemName: current.name,
        category: current.category || '',
        operationType: 'Отмена поставки закупки',
        quantity: delta,
        responsibleName: createdBy,
        sourceLocation: 'Склад',
        destinationLocation: 'Корректировка поставки',
        documentType: 'purchase_request',
        documentId: null,
        documentLabel: documentNumber ? `Заявка ${documentNumber}` : 'Заявка на закупку',
        operationContext: 'purchase_request',
        notes: 'Откат поступления по заявке на закупку',
        createdBy,
        operationDate: new Date()
      });

      applied.push({
        itemId: current.id,
        itemName: current.name,
        revertedQuantity: delta,
        quantityBefore: beforeQty,
        quantityAfter: afterQty
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      appliedCount: applied.length,
      applied
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/analytics-export.xlsx', authenticate, async (req, res) => {
  try {
    const dashboardResult = await pool.query(
      `SELECT
        TO_CHAR(DATE_TRUNC('month', wa.act_date), 'MM.YYYY') AS month_label,
        COALESCE(SUM(wai.quantity), 0)::int AS total
      FROM writeoff_acts wa
      INNER JOIN writeoff_act_items wai ON wai.act_id = wa.id
      WHERE wa.act_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY month_label, DATE_TRUNC('month', wa.act_date)
      ORDER BY DATE_TRUNC('month', wa.act_date)`
    );

    const turnoverResult = await pool.query(
      `SELECT
        i.name,
        (COALESCE(SUM(wai.quantity), 0) + COALESCE(i.quantity, 0))::int AS incoming,
        COALESCE(SUM(wai.quantity), 0)::int AS outgoing,
        COALESCE(i.quantity, 0)::int AS balance
      FROM inventory i
      LEFT JOIN writeoff_act_items wai ON wai.item_id = i.id
      LEFT JOIN writeoff_acts wa ON wa.id = wai.act_id
      GROUP BY i.id, i.name, i.quantity
      ORDER BY i.name`
    );

    const reasonsResult = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(reason), ''), 'Без причины') AS reason,
              COALESCE(SUM(quantity), 0)::int AS qty
      FROM writeoff_act_items
      GROUP BY reason
      ORDER BY qty DESC, reason`
    );

    const months = dashboardResult.rows.map(row => row.month_label);
    const values = dashboardResult.rows.map(row => toNumber(row.total));
    const sparklineText = values.join(' ');

    const workbook = XLSX.utils.book_new();

    const turnoverSheetData = [
      ['Объект', 'Приход', 'Расход', 'Остаток', 'Мини-диаграмма списаний (6 мес)'],
      ...turnoverResult.rows.map(row => [
        row.name,
        toNumber(row.incoming),
        toNumber(row.outgoing),
        toNumber(row.balance),
        sparklineText
      ])
    ];

    const reasonsSheetData = [
      ['Причина списания', 'Количество'],
      ...reasonsResult.rows.map(row => [row.reason, toNumber(row.qty)])
    ];

    const dynamicsSheetData = [
      ['Месяц', 'Списано'],
      ...months.map((label, index) => [label, values[index] || 0])
    ];

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(turnoverSheetData), 'Оборотная ведомость');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(reasonsSheetData), 'Причины списания');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(dynamicsSheetData), 'Динамика 6 мес');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `warehouse_analytics_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET change history for an item
router.get('/purchase-requests', authenticate, async (req, res) => {
  try {
    const statusFilter = req.query.status ? String(req.query.status).trim() : null;
    const requestNumberFilter = req.query.requestNumber ? String(req.query.requestNumber).trim() : null;
    const itemIdFilter = req.query.itemId ? String(req.query.itemId).trim() : null;
    const values = [];
    const conditions = [];
    if (statusFilter) {
      values.push(statusFilter);
      conditions.push(`status = $${values.length}`);
    }
    if (requestNumberFilter) {
      values.push(requestNumberFilter);
      conditions.push(`request_number = $${values.length}`);
    }
    if (itemIdFilter) {
      values.push(itemIdFilter);
      conditions.push(`item_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, request_number, item_id, item_name, item_category,
              quantity, status, source_type, source_id, notes,
              expected_date, created_by, created_at, updated_at
       FROM purchase_requests
       ${where}
       ORDER BY created_at DESC, id DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ручное создание заявки
router.post('/purchase-requests', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { itemId, quantity, notes, expectedDate, sourceType, sourceId, mergeExistingDraft = true } = req.body || {};
    if (!itemId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Укажите объект и количество' });
    }
    const itemRow = await client.query(
      'SELECT id, name, category, quantity AS available FROM inventory WHERE id = $1',
      [itemId]
    );
    if (!itemRow.rows.length) return res.status(404).json({ error: 'Объект не найден' });
    const item = itemRow.rows[0];
    const normalizedSourceType = String(sourceType || '').trim() || 'manual';
    const normalizedSourceId = sourceId === null || sourceId === undefined || sourceId === ''
      ? null
      : Number(sourceId);

    let result;
    if (mergeExistingDraft) {
      const createdRequest = await createPurchaseRequest(client, {
        itemId: item.id,
        requestedQuantity: Number(quantity),
        availableQuantity: Number(item.available || 0),
        sourceType: normalizedSourceType,
        sourceId: normalizedSourceId,
        notes: notes || '',
        createdBy: req.user?.username || 'admin'
      });
      if (!createdRequest) {
        throw new Error('Не удалось создать заявку на закупку');
      }
      result = { rows: [{ id: createdRequest.id, request_number: createdRequest.request_number }] };
    } else {
      const requestNumber = generateDocNumber('PR');
      result = await client.query(
        `INSERT INTO purchase_requests
           (request_number, item_id, item_name, item_category, quantity, status, source_type, source_id, notes, expected_date, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP)
         RETURNING id, request_number`,
        [requestNumber, item.id, item.name, item.category || '', Number(quantity), PURCHASE_STATUS.DRAFT,
         normalizedSourceType, Number.isFinite(normalizedSourceId) ? normalizedSourceId : null,
         notes || '', expectedDate || null, req.user?.username || 'admin']
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/purchase-requests/:id', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = Number(req.params.id);
    const { status, expectedDate } = req.body || {};

    // Текущий статус
    const current = await client.query(
      'SELECT status, item_id, quantity FROM purchase_requests WHERE id = $1',
      [id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Заявка не найдена' });

    const prev = current.rows[0];
    const newStatus = normalizePurchaseStatus(status || prev.status);
    const prevStatus = normalizePurchaseStatus(prev.status || '');

    await client.query(
      `UPDATE purchase_requests
         SET status = $1,
             expected_date = COALESCE($2, expected_date),
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [newStatus, expectedDate || null, id]
    );

    // При переводе в «Поставлена» — увеличиваем остаток
    if (newStatus === PURCHASE_STATUS.DELIVERED && prevStatus !== PURCHASE_STATUS.DELIVERED && prev.item_id) {
      await client.query(
        'UPDATE inventory SET quantity = GREATEST(0, COALESCE(quantity, 0) + $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [Number(prev.quantity || 0), prev.item_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Удаление только для статуса «Черновик»
router.delete('/purchase-requests/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const check = await pool.query('SELECT status FROM purchase_requests WHERE id = $1', [id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    if (normalizePurchaseStatus(check.rows[0].status) !== PURCHASE_STATUS.DRAFT) {
      return res.status(400).json({ error: 'Удалить можно только заявку со статусом «Черновик»' });
    }
    await pool.query('DELETE FROM purchase_requests WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Экспорт заявок в Excel
router.get('/purchase-requests/export.xlsx', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT request_number, item_name, item_category, quantity, status,
              expected_date, source_type, source_id, notes, created_by, created_at
       FROM purchase_requests
       ORDER BY created_at DESC`
    );
    const wb = XLSX.utils.book_new();
    const header = ['№ заявки','Объект','Категория','Кол-во','Статус','Ожид. дата','Основание','Примечания','Кем создана','Дата создания'];
    const rows = result.rows.map(r => [
      r.request_number, r.item_name, r.item_category || '', r.quantity, r.status,
      r.expected_date ? new Date(r.expected_date).toLocaleDateString('ru-RU') : '',
      r.source_type && r.source_id ? `${r.source_type} #${r.source_id}` : (r.source_type || ''),
      r.notes || '', r.created_by || '', new Date(r.created_at).toLocaleDateString('ru-RU')
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = header.map((h, i) => ({ wch: [16,28,14,8,12,14,18,24,14,14][i] || 14 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Заявки на закупку');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="purchase-requests.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/asset-history', authenticate, async (req, res) => {
  try {
    const itemId = req.params.id;

    const itemResult = await pool.query(
      `SELECT id, name, category, type, balance_date, lifespan,
              (balance_date + (lifespan || ' months')::interval)::date AS end_date
       FROM inventory
       WHERE id = $1`,
      [itemId]
    );

    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const item = itemResult.rows[0];

    const lifecycleResult = await pool.query(
      `SELECT id, change_type, before_lifespan, after_lifespan,
              before_end_date, after_end_date, reason, changed_by, created_at
       FROM asset_lifecycle_history
       WHERE item_id = $1
       ORDER BY created_at DESC, id DESC`,
      [itemId]
    );

    const writeoffResult = await pool.query(
      `SELECT wa.id, wa.act_number, wa.act_date, wai.reason, wai.quantity
       FROM writeoff_act_items wai
       INNER JOIN writeoff_acts wa ON wa.id = wai.act_id
       WHERE wai.item_id = $1
       ORDER BY wa.act_date DESC, wa.id DESC`,
      [itemId]
    );

    res.json({
      item: {
        id: item.id,
        name: item.name,
        category: item.category || '',
        type: item.type,
        balanceDate: item.balance_date,
        lifespan: toNumber(item.lifespan),
        endDate: item.end_date
      },
      lifecycle: lifecycleResult.rows,
      writeoffActs: writeoffResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/split-defect', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    const itemId = String(req.params.id || '').trim();
    const quantity = Math.max(0, toNumber(req.body?.quantity));
    const reason = normalizeWriteoffReasonText(req.body?.reason, 'Частичный брак');
    const comment = String(req.body?.comment || '').trim();

    if (!itemId) {
      return res.status(400).json({ error: 'Не указан объект' });
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Количество должно быть больше нуля' });
    }

    await client.query('BEGIN');

    const itemResult = await client.query(
      `SELECT id, name, category, type, quantity, quantity_pending_writeoff, location
       FROM inventory
       WHERE id = $1
       FOR UPDATE`,
      [itemId]
    );

    if (!itemResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const item = itemResult.rows[0];
    const currentQty = Math.max(0, toNumber(item.quantity));
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
         ), 0) AS in_event,
         COALESCE((
           SELECT SUM(wai.quantity)
           FROM writeoff_act_items wai
           INNER JOIN writeoff_acts wa ON wa.id = wai.act_id
           WHERE wai.item_id = $1
             AND COALESCE(NULLIF(TRIM(wa.status), ''), 'Черновик') = 'Черновик'
         ), 0) AS pending_writeoff`,
      [item.id]
    );

    const inRental = Math.max(0, toNumber(usageResult.rows[0]?.in_rental));
    const inEvent = Math.max(0, toNumber(usageResult.rows[0]?.in_event));
    const currentPending = Math.min(currentQty, Math.max(0, toNumber(usageResult.rows[0]?.pending_writeoff)));
    const maxDefectQty = Math.max(0, currentQty - currentPending - inRental - inEvent);
    const splitQty = Math.min(maxDefectQty, quantity);

    if (splitQty <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недостаточно остатка для выделения брака' });
    }

    const accountingType = normalizeAccountingType(item.type || 'asset');
    const reasonCategory = normalizeWriteoffReasonCategory(req.body?.reasonCategory, reason, accountingType);

    const draftAct = await createWriteoffAct(client, {
      basisType: 'item',
      basisId: null,
      basisLabel: 'Карточка объекта',
      basisName: item.name || item.id,
      reason,
      signature: req.user?.username || 'Ответственный',
      responsiblePosition: 'Кладовщик',
      createdBy: req.user?.username || 'system',
      items: [{
        itemId: item.id,
        quantity: splitQty,
        reason,
        reasonCategory,
        comment,
        itemName: item.name,
        category: item.category || '',
        itemType: accountingType,
        basisType: 'item',
        basisId: null,
        basisLabel: 'Карточка объекта',
        basisName: item.name || item.id,
        basisActNumber: ''
      }]
    });

    await logInventoryMovement(client, {
      inventoryId: item.id,
      itemName: item.name,
      category: item.category || '',
      operationType: 'Списание (частичный брак)',
      quantity: splitQty,
      responsibleName: req.user?.username || 'system',
      sourceLocation: item.location || 'Склад',
      destinationLocation: 'К списанию',
      documentType: 'writeoff',
      documentId: draftAct?.id || null,
      documentLabel: draftAct?.number ? `Акт списания ${draftAct.number}` : 'Черновик акта списания',
      operationContext: 'split_defect',
      notes: comment || reason,
      createdBy: req.user?.username || 'system',
      operationDate: new Date()
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      itemId: item.id,
      splitQuantity: splitQty,
      remainingQuantity: maxDefectQty - splitQty,
      draftAct
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/:id/extend-lifespan', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemId = req.params.id;
    const extraMonths = Math.max(1, toNumber(req.body?.additionalMonths, 12));
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите причину продления срока' });
    }

    const itemResult = await client.query(
      `SELECT id, name, type, balance_date, lifespan
       FROM inventory
       WHERE id = $1 FOR UPDATE`,
      [itemId]
    );

    if (!itemResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Объект не найден' });
    }

    const item = itemResult.rows[0];
    if (normalizeAccountingType(item.type) !== 'asset') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Продление доступно только для основных средств' });
    }
    if (!item.balance_date || !item.lifespan) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Для ОС должны быть заполнены дата баланса и срок эксплуатации' });
    }

    const beforeLifespan = toNumber(item.lifespan);
    const afterLifespan = beforeLifespan + extraMonths;
    const beforeEndDate = toIsoDate(addMonthsToDate(item.balance_date, beforeLifespan));
    const afterEndDate = toIsoDate(addMonthsToDate(item.balance_date, afterLifespan));

    await client.query(
      `UPDATE inventory
       SET lifespan = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [afterLifespan, itemId]
    );

    await insertAssetLifecycleHistory(client, {
      itemId,
      changeType: 'extend',
      beforeLifespan,
      afterLifespan,
      beforeEndDate,
      afterEndDate,
      reason,
      changedBy: req.user?.username || 'system'
    });

    await syncAutoWriteoffDraft(client, { itemIds: [itemId] });

    await client.query('COMMIT');
    res.json({
      success: true,
      itemId,
      beforeLifespan,
      afterLifespan,
      beforeEndDate,
      afterEndDate
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
