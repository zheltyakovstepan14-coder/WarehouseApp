function normalizeAccountingType(value, fallback = 'asset') {
  const raw = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!raw) return fallback;
  if (['asset', 'ос', 'основное средство', 'основные средства'].includes(raw)) return 'asset';
  if (['consumable', 'рм', 'расходник', 'расходники', 'расходный материал', 'расходные материалы'].includes(raw)) return 'consumable';
  if (raw.includes('расход')) return 'consumable';
  return fallback;
}

function generateDocNumber(prefix) {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${randomPart}`;
}

function buildWriteoffPublicId(dateStamp, sequence) {
  return `WRITE-OFF-${dateStamp}-${String(sequence).padStart(3, '0')}`;
}

function inferWriteoffReasonCategory(reason = '', itemType = 'asset') {
  const normalizedReason = String(reason || '').trim().toLowerCase().replace(/ё/g, 'е');
  const normalizedType = normalizeAccountingType(itemType || 'asset');

  if (!normalizedReason) return normalizedType === 'consumable' ? 'consumable' : 'other';
  if (normalizedType === 'consumable' || normalizedReason.includes('использован') || normalizedReason.includes('израсход')) {
    return 'consumable';
  }
  if (normalizedReason.includes('истек срок эксплуатации') || normalizedReason.includes('истек срок') || normalizedReason.includes('выработал ресурс') || normalizedReason.includes('износ')) {
    return 'expiry';
  }
  if (normalizedReason.includes('утрач') || normalizedReason.includes('потер') || normalizedReason.includes('краж') || normalizedReason.includes('невозврат') || normalizedReason.includes('не возвращ')) {
    return 'loss';
  }
  if (normalizedReason.includes('повреж') || normalizedReason.includes('полом') || normalizedReason.includes('дефект') || normalizedReason.includes('трещин') || normalizedReason.includes('деформац') || normalizedReason.includes('авари') || normalizedReason.includes('ремонт')) {
    return 'damage';
  }
  return 'other';
}

async function generateWriteoffActNumber(client) {
  const now = new Date();
  const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `АС-${dateStamp}-`;

  const counterResult = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM writeoff_acts
     WHERE act_number LIKE $1`,
    [`${prefix}%`]
  );

  const sequence = Number(counterResult.rows[0]?.count || 0) + 1;
  return {
    actNumber: `${prefix}${String(sequence).padStart(3, '0')}`,
    publicId: buildWriteoffPublicId(dateStamp, sequence)
  };
}

async function createPurchaseRequest(client, payload = {}) {
  const {
    itemId,
    requestedQuantity = 0,
    availableQuantity = 0,
    sourceType = '',
    sourceId = null,
    notes = '',
    createdBy = 'system'
  } = payload;

  if (!itemId) return null;

  const shortage = Math.max(0, Number(requestedQuantity || 0) - Number(availableQuantity || 0));
  if (shortage <= 0) return null;

  const itemResult = await client.query(
    'SELECT id, name, category, type, requires_purchase FROM inventory WHERE id = $1',
    [itemId]
  );

  if (itemResult.rows.length === 0) return null;

  const item = itemResult.rows[0];
  if (normalizeAccountingType(item.type) !== 'consumable' || item.requires_purchase !== true) {
    return null;
  }

  const requestNumber = generateDocNumber('PR');

  const existingDrafts = await client.query(
    `SELECT id, request_number, quantity FROM purchase_requests WHERE item_id = $1 AND status = 'Черновик' ORDER BY updated_at ASC`,
    [item.id]
  );

  if (existingDrafts.rows.length > 0) {
    const totalQuantity = existingDrafts.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) + shortage;
    const firstDraft = existingDrafts.rows[0];
    const duplicateIds = existingDrafts.rows.slice(1).map(row => row.id);

    await client.query(
      `UPDATE purchase_requests SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [totalQuantity, firstDraft.id]
    );

    if (duplicateIds.length > 0) {
      await client.query(
        `DELETE FROM purchase_requests WHERE id = ANY($1::int[])`,
        [duplicateIds]
      );
    }

    return { id: firstDraft.id, request_number: firstDraft.request_number };
  }

  const result = await client.query(
    `INSERT INTO purchase_requests (
      request_number, item_id, item_name, item_category, quantity, status, source_type, source_id, notes, created_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'Черновик', $6, $7, $8, $9, CURRENT_TIMESTAMP)
    RETURNING id, request_number`,
    [
      requestNumber,
      item.id,
      item.name,
      item.category || '',
      shortage,
      sourceType,
      sourceId,
      notes,
      createdBy
    ]
  );

  return result.rows[0] || null;
}

async function createWriteoffAct(client, payload = {}) {
  const {
    basisType = '',
    basisId = null,
    basisLabel = '',
    basisName = '',
    basisActNumber = '',
    reason = 'Автоматическое списание',
    signature = 'Ответственный',
    responsiblePosition = 'Кладовщик',
    createdBy = 'system',
    items = []
  } = payload;

  const normalizedItems = (items || [])
    .map(item => ({
      itemId: item.itemId || item.item_id,
      quantity: Math.max(0, Number(item.quantity || 0)),
      reason: String(item.reason || reason || '').trim(),
      reasonCategory: String(item.reasonCategory || item.reason_category || '').trim(),
      comment: String(item.comment || '').trim(),
      itemName: String(item.itemName || item.item_name || '').trim(),
      category: String(item.category || item.item_category || '').trim(),
      itemType: normalizeAccountingType(item.itemType || item.item_type || 'asset'),
      basisType: String(item.basisType || item.basis_type || basisType || '').trim(),
      basisId: item.basisId ?? item.basis_id ?? basisId ?? null,
      basisLabel: String(item.basisLabel || item.basis_label || basisLabel || '').trim(),
      basisName: String(item.basisName || item.basis_name || basisName || '').trim(),
      basisActNumber: String(item.basisActNumber || item.basis_act_number || basisActNumber || '').trim()
    }))
    .filter(item => item.itemId && item.quantity > 0);

  if (!normalizedItems.length) return null;

  // Группируем одинаковые позиции, чтобы в черновике акта не плодились дубли.
  const groupedItemsMap = new Map();
  for (const item of normalizedItems) {
    const itemReason = item.reason || reason;
    const itemReasonCategory = item.reasonCategory || inferWriteoffReasonCategory(itemReason, item.itemType);
    const itemComment = item.comment || '';
    const key = `${item.itemId}::${itemReason}::${itemReasonCategory}::${itemComment}::${item.basisType || ''}::${item.basisId || ''}::${item.basisLabel || ''}::${item.basisName || ''}::${item.basisActNumber || ''}`;
    const existing = groupedItemsMap.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      if (!existing.itemName && item.itemName) existing.itemName = item.itemName;
      if (!existing.category && item.category) existing.category = item.category;
      if (!existing.comment && itemComment) existing.comment = itemComment;
      if (!existing.reasonCategory && itemReasonCategory) existing.reasonCategory = itemReasonCategory;
      if (!existing.basisType && item.basisType) existing.basisType = item.basisType;
      if ((existing.basisId === null || existing.basisId === undefined || existing.basisId === '') && item.basisId) existing.basisId = item.basisId;
      if (!existing.basisLabel && item.basisLabel) existing.basisLabel = item.basisLabel;
      if (!existing.basisName && item.basisName) existing.basisName = item.basisName;
      if (!existing.basisActNumber && item.basisActNumber) existing.basisActNumber = item.basisActNumber;
    } else {
      groupedItemsMap.set(key, {
        itemId: item.itemId,
        quantity: item.quantity,
        reason: itemReason,
        reasonCategory: itemReasonCategory,
        comment: itemComment,
        itemName: item.itemName,
        category: item.category,
        itemType: item.itemType,
        basisType: item.basisType,
        basisId: item.basisId,
        basisLabel: item.basisLabel,
        basisName: item.basisName,
        basisActNumber: item.basisActNumber
      });
    }
  }
  const groupedItems = Array.from(groupedItemsMap.values()).filter(item => item.quantity > 0);

  if (!groupedItems.length) return null;

  const normalizedBasisType = String(basisType || '').toLowerCase().includes('event') ? 'event' : 'rental';
  const normalizedSignature = String(signature || '').trim() || 'Ответственный';
  const normalizedPosition = String(responsiblePosition || '').trim() || 'Кладовщик';
  const normalizedBasisName = String(basisName || '').trim();
  const normalizedBasisActNumber = String(basisActNumber || '').trim();

  const draftResult = await client.query(
    `SELECT id, public_id, act_number, act_date
     FROM writeoff_acts
     WHERE status = 'Черновик'
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`
  );

  let act = draftResult.rows[0] || null;

  if (!act) {
    const numbering = await generateWriteoffActNumber(client);
    try {
      const actResult = await client.query(
        `INSERT INTO writeoff_acts (
          public_id, act_number, status, basis_type, basis_id, basis_label,
          basis_name, basis_act_number, reason,
          signature, responsible_position, created_by
        ) VALUES ($1, $2, 'Черновик', $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, public_id, act_number, act_date`,
        [
          numbering.publicId,
          numbering.actNumber,
          normalizedBasisType,
          basisId,
          basisLabel,
          normalizedBasisName,
          normalizedBasisActNumber,
          reason,
          normalizedSignature,
          normalizedPosition,
          createdBy
        ]
      );

      act = actResult.rows[0];
    } catch (error) {
      // При гонке по unique draft-индексу берем уже созданный черновик.
      if (String(error?.code || '') !== '23505') throw error;
      const fallbackDraft = await client.query(
        `SELECT id, public_id, act_number, act_date
         FROM writeoff_acts
         WHERE status = 'Черновик'
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE`
      );
      act = fallbackDraft.rows[0] || null;
      if (!act) throw error;
    }
  } else {
    await client.query(
      `UPDATE writeoff_acts
       SET basis_type = CASE WHEN COALESCE(basis_type, '') <> $2 THEN 'mixed' ELSE basis_type END,
           basis_label = CASE WHEN COALESCE(basis_label, '') = '' THEN $1 ELSE basis_label END,
           basis_name = CASE WHEN COALESCE(basis_name, '') = '' THEN $3 ELSE basis_name END,
           basis_act_number = CASE WHEN COALESCE(basis_act_number, '') = '' THEN $4 ELSE basis_act_number END,
           reason = CASE WHEN COALESCE(reason, '') = '' THEN $5 ELSE reason END,
           signature = CASE WHEN COALESCE(signature, '') = '' THEN $6 ELSE signature END,
           responsible_position = CASE WHEN COALESCE(responsible_position, '') = '' THEN $7 ELSE responsible_position END,
           created_by = COALESCE(created_by, $8)
       WHERE id = $9`,
      [
        basisLabel,
        normalizedBasisType,
        normalizedBasisName,
        normalizedBasisActNumber,
        reason,
        normalizedSignature,
        normalizedPosition,
        createdBy,
        act.id
      ]
    );
  }

  for (const item of groupedItems) {
    const inventoryResult = await client.query(
      `SELECT id, name, category, type, quantity, location
       FROM inventory
       WHERE id = $1
       FOR UPDATE`,
      [item.itemId]
    );
    const inventoryRow = inventoryResult.rows[0] || { id: item.itemId, name: item.itemId, category: '', type: 'asset', quantity: 0, location: 'Склад' };
    const accountingType = normalizeAccountingType(inventoryRow.type || 'asset');
    const existingWriteoffItemResult = await client.query(
      `SELECT id, quantity
       FROM writeoff_act_items
       WHERE act_id = $1
         AND reason = $2
         AND COALESCE(reason_category, '') = $3
         AND COALESCE(comment, '') = $4
         AND COALESCE(basis_type, '') = $5
         AND COALESCE(basis_id::text, '') = $6
         AND COALESCE(basis_label, '') = $7
         AND COALESCE(basis_name, '') = $8
         AND COALESCE(basis_act_number, '') = $9
         AND item_id = $10
       LIMIT 1
       FOR UPDATE`,
      [
        act.id,
        item.reason || reason,
        item.reasonCategory || inferWriteoffReasonCategory(item.reason || reason, accountingType),
        item.comment || '',
        item.basisType || normalizedBasisType,
        item.basisId === null || item.basisId === undefined ? '' : String(item.basisId),
        item.basisLabel || basisLabel || '',
        item.basisName || normalizedBasisName,
        item.basisActNumber || normalizedBasisActNumber,
        inventoryRow.id
      ]
    );

    let writeoffItemId = Number(existingWriteoffItemResult.rows[0]?.id || 0);

    if (writeoffItemId > 0) {
      await client.query(
        `UPDATE writeoff_act_items
         SET quantity = GREATEST(0, COALESCE(quantity, 0) + $1),
             item_name = COALESCE(NULLIF(item_name, ''), $2),
             item_category = COALESCE(NULLIF(item_category, ''), $3),
             reason_category = COALESCE(NULLIF(reason_category, ''), $4),
             comment = COALESCE(NULLIF(comment, ''), $5),
             basis_type = COALESCE(NULLIF(basis_type, ''), $6),
             basis_id = COALESCE(NULLIF(basis_id::text, ''), $7),
             basis_label = COALESCE(NULLIF(basis_label, ''), $8),
             basis_name = COALESCE(NULLIF(basis_name, ''), $9),
             basis_act_number = COALESCE(NULLIF(basis_act_number, ''), $10)
         WHERE id = $11`,
        [
          item.quantity,
          item.itemName || inventoryRow.name,
          item.category || inventoryRow.category || '',
          item.reasonCategory || inferWriteoffReasonCategory(item.reason || reason, accountingType),
          item.comment || '',
          item.basisType || normalizedBasisType,
          item.basisId === null || item.basisId === undefined ? null : String(item.basisId),
          item.basisLabel || basisLabel || '',
          item.basisName || normalizedBasisName,
          item.basisActNumber || normalizedBasisActNumber,
          writeoffItemId
        ]
      );
    } else {
      const writeoffItemResult = await client.query(
        `INSERT INTO writeoff_act_items (act_id, item_id, item_name, item_category, quantity, reason, reason_category, comment, basis_type, basis_id, basis_label, basis_name, basis_act_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          act.id,
          inventoryRow.id,
          item.itemName || inventoryRow.name,
          item.category || inventoryRow.category || '',
          item.quantity,
          item.reason || reason,
          item.reasonCategory || inferWriteoffReasonCategory(item.reason || reason, accountingType),
          item.comment || '',
          item.basisType || normalizedBasisType,
          item.basisId === null || item.basisId === undefined ? null : String(item.basisId),
          item.basisLabel || basisLabel || '',
          item.basisName || normalizedBasisName,
          item.basisActNumber || normalizedBasisActNumber
        ]
      );
      writeoffItemId = Number(writeoffItemResult.rows[0]?.id || 0);
    }

    if (writeoffItemId > 0) {
      await client.query(
        `UPDATE inventory
         SET quantity_pending_writeoff = LEAST(
               GREATEST(0, COALESCE(quantity, 0)),
               GREATEST(0, COALESCE(quantity_pending_writeoff, 0) + $1)
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [Math.max(0, Number(item.quantity || 0)), inventoryRow.id]
      );

      await client.query(
        `UPDATE writeoff_act_items
         SET item_id = $1,
             item_name = $2,
             item_category = $3,
             item_type = $4
         WHERE id = $5`,
        [inventoryRow.id, item.itemName || inventoryRow.name, item.category || inventoryRow.category || '', accountingType, writeoffItemId]
      );
    } else {
      await client.query(
        `UPDATE writeoff_act_items
         SET item_type = $1
         WHERE id = $2`,
        [accountingType, writeoffItemId]
      );
    }
  }

  return act;
}

module.exports = {
  normalizeAccountingType,
  inferWriteoffReasonCategory,
  createPurchaseRequest,
  createWriteoffAct,
  generateDocNumber
};
