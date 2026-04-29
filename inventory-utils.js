const INVENTORY_STATUS = Object.freeze({
  AVAILABLE: 'В наличии',
  RENTAL: 'В аренде',
  EVENT: 'На мероприятии',
  TO_WRITEOFF: 'К списанию',
  REPAIR: 'На реставрации',
  WRITTEN_OFF: 'Списано'
});

const INVENTORY_STATUS_VALUES = Object.values(INVENTORY_STATUS);

function normalizeInventoryStatus(value, fallback = INVENTORY_STATUS.AVAILABLE) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/ё/g, 'е');

  if (!raw) return fallback;
  if (/аренд/.test(normalized)) return INVENTORY_STATUS.RENTAL;
  if (/меропр/.test(normalized)) return INVENTORY_STATUS.EVENT;
  if (/к\s*спис/.test(normalized)) return INVENTORY_STATUS.TO_WRITEOFF;
  if (/рестав|ремонт/.test(normalized)) return INVENTORY_STATUS.REPAIR;
  if (/спис/.test(normalized)) return INVENTORY_STATUS.WRITTEN_OFF;
  if (/налич|склад|доступ/.test(normalized)) return INVENTORY_STATUS.AVAILABLE;
  return INVENTORY_STATUS_VALUES.includes(raw) ? raw : fallback;
}

function isManualLockedStatus(status) {
  const normalized = normalizeInventoryStatus(status);
  return normalized === INVENTORY_STATUS.REPAIR || normalized === INVENTORY_STATUS.WRITTEN_OFF || normalized === INVENTORY_STATUS.TO_WRITEOFF;
}

function buildDocumentLabel(documentType, documentId) {
  if (!documentType || !documentId) return '';
  const prefix = documentType === 'event' ? 'Мероприятие' : 'Аренда';
  return `${prefix} №${documentId}`;
}

function buildDocumentUrl(documentType, documentId) {
  if (!documentType || !documentId) return '';
  return documentType === 'event'
    ? `/api/documents/events/${documentId}/generate`
    : `/api/documents/rentals/${documentId}/generate`;
}

async function getInventorySnapshot(client, itemId) {
  const result = await client.query(
    `SELECT id, name, category, quantity, status, status_reason, planned_return_date, writeoff_reason, writeoff_date
     FROM inventory
     WHERE id = $1`,
    [itemId]
  );

  return result.rows[0] || null;
}

async function logInventoryMovement(client, payload = {}) {
  const {
    inventoryId,
    itemName = '',
    category = '',
    operationType = 'Изменение',
    quantity = 0,
    responsibleName = '',
    sourceLocation = '',
    destinationLocation = '',
    documentType = '',
    documentId = null,
    documentLabel = '',
    documentUrl = '',
    operationContext = 'inventory',
    notes = '',
    createdBy = '',
    operationDate = new Date()
  } = payload;

  if (!inventoryId) return null;

  const result = await client.query(
    `INSERT INTO inventory_movements (
       inventory_id,
       item_name,
       category,
       operation_type,
       quantity,
       responsible_name,
       source_location,
       destination_location,
       document_type,
       document_id,
       document_label,
       document_url,
       operation_context,
       notes,
       created_by,
       operation_date
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16
     ) RETURNING id`,
    [
      inventoryId,
      itemName,
      category,
      operationType,
      Number(quantity || 0),
      responsibleName,
      sourceLocation,
      destinationLocation,
      documentType,
      documentId,
      documentLabel || buildDocumentLabel(documentType, documentId),
      documentUrl || buildDocumentUrl(documentType, documentId),
      operationContext,
      notes,
      createdBy,
      operationDate
    ]
  );

  return result.rows[0] || null;
}

async function syncInventoryStatus(client, itemIds = [], options = {}) {
  const { forceStatusMap = null } = options;
  const uniqueIds = [...new Set((itemIds || []).filter(Boolean).map(id => String(id)))];
  const updatedStatuses = {};

  for (const itemId of uniqueIds) {
    const result = await client.query(
      `SELECT i.id,
              i.status,
              i.quantity,
              EXISTS (
                SELECT 1
                FROM rental_items ri
                INNER JOIN rentals r ON r.id = ri.rental_id
                WHERE ri.item_id = i.id
                  AND COALESCE(NULLIF(TRIM(r.status), ''), 'Активна') <> 'Завершена'
              ) AS has_active_rental,
              EXISTS (
                SELECT 1
                FROM event_items ei
                INNER JOIN events e ON e.id = ei.event_id
                WHERE ei.item_id = i.id
                  AND COALESCE(NULLIF(TRIM(e.status), ''), 'Планируется') <> 'Завершено'
              ) AS has_active_event
       FROM inventory i
       WHERE i.id = $1
       FOR UPDATE`,
      [itemId]
    );

    if (result.rows.length === 0) {
      continue;
    }

    const row = result.rows[0];
    const currentStatus = normalizeInventoryStatus(row.status, INVENTORY_STATUS.AVAILABLE);

    let nextStatus;
    if (forceStatusMap && forceStatusMap[itemId]) {
      nextStatus = normalizeInventoryStatus(forceStatusMap[itemId], currentStatus);
    } else if (isManualLockedStatus(currentStatus)) {
      nextStatus = currentStatus;
    } else if (row.has_active_event) {
      nextStatus = INVENTORY_STATUS.EVENT;
    } else if (row.has_active_rental) {
      nextStatus = INVENTORY_STATUS.RENTAL;
    } else {
      nextStatus = INVENTORY_STATUS.AVAILABLE;
    }

    if (nextStatus !== currentStatus) {
      await client.query(
        `UPDATE inventory
         SET status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [nextStatus, itemId]
      );
    }

    updatedStatuses[itemId] = nextStatus;
  }

  return updatedStatuses;
}

module.exports = {
  INVENTORY_STATUS,
  INVENTORY_STATUS_VALUES,
  normalizeInventoryStatus,
  isManualLockedStatus,
  buildDocumentLabel,
  buildDocumentUrl,
  getInventorySnapshot,
  logInventoryMovement,
  syncInventoryStatus
};
