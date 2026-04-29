const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDateFilter(columnName, query = {}) {
    const conditions = [];
    const params = [];
    let index = 1;

    const period = String(query.period || 'all');
    const year = query.year ? Number(query.year) : null;

    if (Number.isFinite(year) && year > 2000) {
        conditions.push(`EXTRACT(YEAR FROM ${columnName}) = $${index++}`);
        params.push(year);
    }

    if (period !== 'all') {
        const now = new Date();
        let fromDate = null;
        let toDate = null;

        if (period === 'month') {
            fromDate = new Date(now);
            fromDate.setMonth(now.getMonth() - 1);
        } else if (period === 'quarter') {
            fromDate = new Date(now);
            fromDate.setMonth(now.getMonth() - 3);
        } else if (period === 'year') {
            fromDate = new Date(now);
            fromDate.setFullYear(now.getFullYear() - 1);
        } else if (period === 'custom') {
            if (query.dateFrom) {
                const parsedFrom = new Date(query.dateFrom);
                if (!Number.isNaN(parsedFrom.getTime())) {
                    fromDate = parsedFrom;
                }
            }

            if (query.dateTo) {
                const parsedTo = new Date(query.dateTo);
                if (!Number.isNaN(parsedTo.getTime())) {
                    toDate = parsedTo;
                }
            }
        }

        if (fromDate) {
            conditions.push(`${columnName} >= $${index++}`);
            params.push(fromDate.toISOString());
        }

        if (toDate) {
            conditions.push(`${columnName} <= $${index++}`);
            params.push(toDate.toISOString());
        }
    }

    return {
        whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params
    };
}

function buildEmptyPayload(title, recommendedChartType = 'bar') {
    return {
        title,
        labels: ['Нет данных'],
        values: [0],
        datasets: [{
            label: title,
            data: [0]
        }],
        tableHeaders: ['Показатель', 'Значение'],
        rows: [['Нет данных', 0]],
        summary: [{ label: 'Состояние', value: 'Данные отсутствуют' }],
        recommendedChartType
    };
}

function applyDraftFilter(baseFilter, query, statusExpression) {
    const includeDrafts = String(query.includeDrafts || 'false').toLowerCase() === 'true';
    if (includeDrafts) {
        return baseFilter;
    }

    const params = [...baseFilter.params, 'Черновик'];
    const predicate = `${statusExpression} <> $${params.length}`;
    const whereClause = baseFilter.whereClause
        ? `${baseFilter.whereClause} AND ${predicate}`
        : `WHERE ${predicate}`;

    return {
        whereClause,
        params
    };
}

function withPercentLabels(rows, labelKey, valueKey) {
    const total = rows.reduce((sum, row) => sum + toNumber(row[valueKey]), 0);
    return rows.map(row => {
        const value = toNumber(row[valueKey]);
        const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
        return {
            ...row,
            percent,
            chartLabel: `${row[labelKey]} (${percent}%)`
        };
    });
}

router.get('/rentals-report', authenticate, async (req, res) => {
    try {
        const { type = 'monthly', grouping = 'month', limit = '5', sortOrder = 'desc' } = req.query;
        const dateFilter = buildDateFilter('r.start_date', req.query);
        const filter = applyDraftFilter(dateFilter, req.query, `COALESCE(NULLIF(TRIM(r.status), ''), 'Черновик')`);
        const params = [...filter.params];
        let payload;

        switch (type) {
            case 'status': {
                const result = await pool.query(
                    `SELECT COALESCE(NULLIF(TRIM(r.status), ''), 'Не указан') AS status,
                            COUNT(*)::int AS count
                     FROM rentals r
                     ${filter.whereClause}
                     GROUP BY status
                     ORDER BY count DESC, status`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload('Аренды по статусам', 'doughnut');
                    break;
                }

                const rows = withPercentLabels(result.rows, 'status', 'count');
                payload = {
                    title: 'Аренды по статусам',
                    labels: rows.map(row => row.chartLabel),
                    values: rows.map(row => toNumber(row.count)),
                    datasets: [{
                        label: 'Количество аренд',
                        data: rows.map(row => toNumber(row.count))
                    }],
                    tableHeaders: ['Статус', 'Количество', 'Доля'],
                    rows: rows.map(row => [row.status, toNumber(row.count), `${row.percent}%`]),
                    summary: [
                        { label: 'Всего аренд', value: rows.reduce((sum, row) => sum + toNumber(row.count), 0) },
                        { label: 'Статусов', value: rows.length }
                    ],
                    recommendedChartType: 'doughnut'
                };
                break;
            }

            case 'items': {
                const parsedLimit = String(limit).toLowerCase() === 'all' ? null : Math.max(1, toNumber(limit, 5));
                const orderDirection = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
                const limitClause = parsedLimit ? `LIMIT ${parsedLimit}` : '';

                const result = await pool.query(
                    `SELECT COALESCE(i.name, 'Неизвестный объект') AS item_name,
                            COUNT(*)::int AS rent_count,
                            COALESCE(SUM(ri.quantity), 0)::int AS quantity_total
                     FROM rental_items ri
                     INNER JOIN rentals r ON r.id = ri.rental_id
                     LEFT JOIN inventory i ON i.id = ri.item_id
                     ${filter.whereClause}
                     GROUP BY item_name
                     ORDER BY rent_count ${orderDirection}, quantity_total ${orderDirection}, item_name
                     ${limitClause}`,
                    params
                );

                const titleSuffix = parsedLimit ? `Топ-${parsedLimit}` : 'Все объекты';

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload(`${titleSuffix} арендуемых объектов`, 'bar');
                    break;
                }

                payload = {
                    title: `${titleSuffix} арендуемых объектов`,
                    labels: result.rows.map(row => row.item_name),
                    values: result.rows.map(row => toNumber(row.rent_count)),
                    datasets: [{
                        label: 'Количество аренд',
                        data: result.rows.map(row => toNumber(row.rent_count))
                    }],
                    tableHeaders: ['Объект', 'Количество аренд', 'Выдано, шт.'],
                    rows: result.rows.map(row => [row.item_name, toNumber(row.rent_count), toNumber(row.quantity_total)]),
                    summary: [
                        { label: 'Объектов в выдаче', value: result.rows.length },
                        { label: 'Выдано всего, шт.', value: result.rows.reduce((sum, row) => sum + toNumber(row.quantity_total), 0) },
                        { label: 'Сортировка', value: orderDirection === 'ASC' ? 'По возрастанию' : 'По убыванию' }
                    ],
                    recommendedChartType: 'bar',
                    chartOptions: { indexAxis: 'y' }
                };
                break;
            }

            case 'clients': {
                const result = await pool.query(
                    `SELECT COALESCE(c.name, 'Неизвестный арендатор') AS client_name,
                            COUNT(DISTINCT r.id)::int AS rental_count,
                            COALESCE(SUM(ri.quantity), 0)::int AS items_total
                     FROM rentals r
                     LEFT JOIN clients c ON c.id = r.client_id
                     LEFT JOIN rental_items ri ON ri.rental_id = r.id
                     ${filter.whereClause}
                     GROUP BY client_name
                     ORDER BY rental_count DESC, items_total DESC, client_name
                     LIMIT 10`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload('Популярные арендаторы', 'bar');
                    break;
                }

                payload = {
                    title: 'Популярные арендаторы',
                    labels: result.rows.map(row => row.client_name),
                    values: result.rows.map(row => toNumber(row.rental_count)),
                    datasets: [{
                        label: 'Количество аренд',
                        data: result.rows.map(row => toNumber(row.rental_count))
                    }],
                    tableHeaders: ['Арендатор', 'Количество аренд', 'Объектов выдано'],
                    rows: result.rows.map(row => [row.client_name, toNumber(row.rental_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Клиентов в рейтинге', value: result.rows.length },
                        { label: 'Аренд в выборке', value: result.rows.reduce((sum, row) => sum + toNumber(row.rental_count), 0) }
                    ],
                    recommendedChartType: 'bar'
                };
                break;
            }

            case 'monthly':
            default: {
                const periodExpression = grouping === 'quarter'
                    ? `CONCAT('Квартал ', EXTRACT(QUARTER FROM r.start_date)::int, ' ', EXTRACT(YEAR FROM r.start_date)::int)`
                    : `TO_CHAR(DATE_TRUNC('month', r.start_date), 'MM.YYYY')`;
                const sortExpression = grouping === 'quarter'
                    ? `DATE_TRUNC('quarter', r.start_date)`
                    : `DATE_TRUNC('month', r.start_date)`;

                const result = await pool.query(
                    `SELECT ${periodExpression} AS period_label,
                            ${sortExpression} AS sort_key,
                            COUNT(DISTINCT r.id)::int AS rental_count,
                            COALESCE(SUM(ri.quantity), 0)::int AS items_total
                     FROM rentals r
                     LEFT JOIN rental_items ri ON ri.rental_id = r.id
                     ${filter.whereClause}
                     GROUP BY period_label, sort_key
                     ORDER BY sort_key`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload(grouping === 'quarter' ? 'Аренды по кварталам' : 'Аренды по месяцам', 'line');
                    break;
                }

                payload = {
                    title: grouping === 'quarter' ? 'Аренды по кварталам' : 'Аренды по месяцам',
                    labels: result.rows.map(row => row.period_label),
                    values: result.rows.map(row => toNumber(row.rental_count)),
                    datasets: [
                        {
                            label: 'Количество аренд',
                            data: result.rows.map(row => toNumber(row.rental_count))
                        },
                        {
                            label: 'Количество выданных объектов',
                            data: result.rows.map(row => toNumber(row.items_total))
                        }
                    ],
                    tableHeaders: ['Период', 'Количество аренд', 'Выдано объектов'],
                    rows: result.rows.map(row => [row.period_label, toNumber(row.rental_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Периодов', value: result.rows.length },
                        { label: 'Аренд всего', value: result.rows.reduce((sum, row) => sum + toNumber(row.rental_count), 0) },
                        { label: 'Выданных объектов', value: result.rows.reduce((sum, row) => sum + toNumber(row.items_total), 0) }
                    ],
                    recommendedChartType: 'line'
                };
                break;
            }
        }

        res.json(payload);
    } catch (error) {
        console.error('Ошибка формирования отчёта по арендам:', error);
        res.status(500).json({ error: `Ошибка при формировании отчёта по арендам: ${error.message}` });
    }
});

router.get('/events-report', authenticate, async (req, res) => {
    try {
        const { type = 'monthly', grouping = 'month', category = '', limit = '10', sortOrder = 'desc' } = req.query;
        const dateFilter = buildDateFilter('e.start_date', req.query);
        const filter = applyDraftFilter(dateFilter, req.query, `COALESCE(NULLIF(TRIM(e.status), ''), 'Черновик')`);
        let params = [...filter.params];
        let payload;

        switch (type) {
            case 'venues': {
                const result = await pool.query(
                    `SELECT COALESCE(NULLIF(TRIM(e.location), ''), 'Не указано') AS location_name,
                            COUNT(DISTINCT e.id)::int AS event_count,
                            COALESCE(SUM(ei.quantity), 0)::int AS items_total
                     FROM events e
                     LEFT JOIN event_items ei ON ei.event_id = e.id
                     ${filter.whereClause}
                     GROUP BY location_name
                     ORDER BY event_count DESC, items_total DESC, location_name
                     LIMIT 10`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload('Мероприятия по местам', 'bar');
                    break;
                }

                payload = {
                    title: 'Мероприятия по местам',
                    labels: result.rows.map(row => row.location_name),
                    values: result.rows.map(row => toNumber(row.event_count)),
                    datasets: [{
                        label: 'Количество мероприятий',
                        data: result.rows.map(row => toNumber(row.event_count))
                    }],
                    tableHeaders: ['Место', 'Мероприятий', 'Задействовано объектов'],
                    rows: result.rows.map((row, index) => [`#${index + 1} ${row.location_name}`, toNumber(row.event_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Локаций в рейтинге', value: result.rows.length },
                        { label: 'Топ-1 место', value: result.rows[0]?.location_name || '—' }
                    ],
                    recommendedChartType: 'bar'
                };
                break;
            }

            case 'items': {
                let categoryClause = '';
                if (category && category !== 'Все') {
                    categoryClause = `${filter.whereClause ? ' AND ' : 'WHERE '}COALESCE(i.category, ei.category, 'Склад') = $${params.length + 1}`;
                    params.push(category);
                }

                const parsedLimit = String(limit).toLowerCase() === 'all' ? null : Math.max(1, toNumber(limit, 10));
                const orderDirection = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
                const limitClause = parsedLimit ? `LIMIT ${parsedLimit}` : '';

                const result = await pool.query(
                    `SELECT COALESCE(i.name, 'Неизвестный объект') AS item_name,
                            COALESCE(i.category, ei.category, 'Склад') AS category_name,
                            COUNT(*)::int AS usage_count,
                            COALESCE(SUM(ei.quantity), 0)::int AS items_total
                     FROM event_items ei
                     INNER JOIN events e ON e.id = ei.event_id
                     LEFT JOIN inventory i ON i.id = ei.item_id
                     ${filter.whereClause}
                     ${categoryClause}
                     GROUP BY item_name, category_name
                     ORDER BY usage_count ${orderDirection}, items_total ${orderDirection}, item_name
                     ${limitClause}`,
                    params
                );

                const titleSuffix = parsedLimit ? `Топ-${parsedLimit}` : 'Все объекты';

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload(`${titleSuffix} использования инвентаря`, 'bar');
                    break;
                }

                payload = {
                    title: `${titleSuffix} по использованию инвентаря`,
                    labels: result.rows.map(row => row.item_name),
                    values: result.rows.map(row => toNumber(row.usage_count)),
                    datasets: [{
                        label: 'Количество использований',
                        data: result.rows.map(row => toNumber(row.usage_count))
                    }],
                    tableHeaders: ['Объект', 'Категория', 'Использований', 'Количество, шт.'],
                    rows: result.rows.map(row => [row.item_name, row.category_name, toNumber(row.usage_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Объектов в отчёте', value: result.rows.length },
                        { label: 'Категория фильтра', value: category || 'Все' },
                        { label: 'Сортировка', value: orderDirection === 'ASC' ? 'По возрастанию' : 'По убыванию' }
                    ],
                    recommendedChartType: 'bar',
                    chartOptions: { indexAxis: 'y' }
                };
                break;
            }

            case 'status': {
                const result = await pool.query(
                    `SELECT COALESCE(NULLIF(TRIM(e.status), ''), 'Не указан') AS status_name,
                            COUNT(*)::int AS count
                     FROM events e
                     ${filter.whereClause}
                     GROUP BY status_name
                     ORDER BY count DESC, status_name`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload('Статусы мероприятий', 'doughnut');
                    break;
                }

                const rows = withPercentLabels(result.rows, 'status_name', 'count');
                payload = {
                    title: 'Статусы мероприятий',
                    labels: rows.map(row => row.chartLabel),
                    values: rows.map(row => toNumber(row.count)),
                    datasets: [{
                        label: 'Количество мероприятий',
                        data: rows.map(row => toNumber(row.count))
                    }],
                    tableHeaders: ['Статус', 'Количество', 'Доля'],
                    rows: rows.map(row => [row.status_name, toNumber(row.count), `${row.percent}%`]),
                    summary: [
                        { label: 'Всего мероприятий', value: rows.reduce((sum, row) => sum + toNumber(row.count), 0) },
                        { label: 'Статусов', value: rows.length }
                    ],
                    recommendedChartType: 'doughnut'
                };
                break;
            }

            case 'duration': {
                const result = await pool.query(
                    `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (e.end_date - e.start_date)) / 3600)::numeric, 2) AS avg_hours,
                            ROUND(MIN(EXTRACT(EPOCH FROM (e.end_date - e.start_date)) / 3600)::numeric, 2) AS min_hours,
                            ROUND(MAX(EXTRACT(EPOCH FROM (e.end_date - e.start_date)) / 3600)::numeric, 2) AS max_hours
                     FROM events e
                     ${filter.whereClause}`,
                    params
                );

                const row = result.rows[0];
                if (!row || row.avg_hours === null) {
                    payload = buildEmptyPayload('Длительность мероприятий', 'bar');
                    break;
                }

                payload = {
                    title: 'Длительность мероприятий',
                    labels: ['Средняя', 'Минимальная', 'Максимальная'],
                    values: [toNumber(row.avg_hours), toNumber(row.min_hours), toNumber(row.max_hours)],
                    datasets: [{
                        label: 'Часы',
                        data: [toNumber(row.avg_hours), toNumber(row.min_hours), toNumber(row.max_hours)]
                    }],
                    tableHeaders: ['Показатель', 'Значение, ч'],
                    rows: [
                        ['Средняя длительность', toNumber(row.avg_hours)],
                        ['Минимальная длительность', toNumber(row.min_hours)],
                        ['Максимальная длительность', toNumber(row.max_hours)]
                    ],
                    summary: [
                        { label: 'Средняя длительность', value: `${toNumber(row.avg_hours)} ч` },
                        { label: 'Максимум', value: `${toNumber(row.max_hours)} ч` }
                    ],
                    recommendedChartType: 'bar'
                };
                break;
            }

            case 'responsibles': {
                const result = await pool.query(
                    `SELECT COALESCE(emp.name, 'Не указан') AS employee_name,
                            COUNT(DISTINCT e.id)::int AS event_count,
                            COALESCE(SUM(ei.quantity), 0)::int AS items_total
                     FROM events e
                     LEFT JOIN employees emp ON emp.id = e.employee_id
                     LEFT JOIN event_items ei ON ei.event_id = e.id
                     ${filter.whereClause}
                     GROUP BY employee_name
                     ORDER BY event_count DESC, items_total DESC, employee_name
                     LIMIT 10`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload('Загруженность ответственных', 'bar');
                    break;
                }

                payload = {
                    title: 'Загруженность ответственных',
                    labels: result.rows.map(row => row.employee_name),
                    values: result.rows.map(row => toNumber(row.event_count)),
                    datasets: [{
                        label: 'Количество мероприятий',
                        data: result.rows.map(row => toNumber(row.event_count))
                    }],
                    tableHeaders: ['Ответственный', 'Количество мероприятий', 'Объектов задействовано'],
                    rows: result.rows.map(row => [row.employee_name, toNumber(row.event_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Ответственных в рейтинге', value: result.rows.length },
                        { label: 'Лидер', value: result.rows[0]?.employee_name || '—' }
                    ],
                    recommendedChartType: 'bar'
                };
                break;
            }

            case 'monthly':
            default: {
                const periodExpression = grouping === 'quarter'
                    ? `CONCAT('Квартал ', EXTRACT(QUARTER FROM e.start_date)::int, ' ', EXTRACT(YEAR FROM e.start_date)::int)`
                    : `TO_CHAR(DATE_TRUNC('month', e.start_date), 'MM.YYYY')`;
                const sortExpression = grouping === 'quarter'
                    ? `DATE_TRUNC('quarter', e.start_date)`
                    : `DATE_TRUNC('month', e.start_date)`;

                const result = await pool.query(
                    `SELECT ${periodExpression} AS period_label,
                            ${sortExpression} AS sort_key,
                            COUNT(DISTINCT e.id)::int AS event_count,
                            COALESCE(SUM(ei.quantity), 0)::int AS items_total
                     FROM events e
                     LEFT JOIN event_items ei ON ei.event_id = e.id
                     ${filter.whereClause}
                     GROUP BY period_label, sort_key
                     ORDER BY sort_key`,
                    params
                );

                if (result.rows.length === 0) {
                    payload = buildEmptyPayload(grouping === 'quarter' ? 'Мероприятия по кварталам' : 'Мероприятия по месяцам', 'line');
                    break;
                }

                payload = {
                    title: grouping === 'quarter' ? 'Мероприятия по кварталам' : 'Мероприятия по месяцам',
                    labels: result.rows.map(row => row.period_label),
                    values: result.rows.map(row => toNumber(row.event_count)),
                    datasets: [
                        {
                            label: 'Количество мероприятий',
                            data: result.rows.map(row => toNumber(row.event_count))
                        },
                        {
                            label: 'Количество задействованных объектов',
                            data: result.rows.map(row => toNumber(row.items_total))
                        }
                    ],
                    tableHeaders: ['Период', 'Мероприятий', 'Задействовано объектов'],
                    rows: result.rows.map(row => [row.period_label, toNumber(row.event_count), toNumber(row.items_total)]),
                    summary: [
                        { label: 'Периодов', value: result.rows.length },
                        { label: 'Мероприятий всего', value: result.rows.reduce((sum, row) => sum + toNumber(row.event_count), 0) },
                        { label: 'Объектов задействовано', value: result.rows.reduce((sum, row) => sum + toNumber(row.items_total), 0) }
                    ],
                    recommendedChartType: 'line'
                };
                break;
            }
        }

        res.json(payload);
    } catch (error) {
        console.error('Ошибка формирования отчёта по мероприятиям:', error);
        res.status(500).json({ error: `Ошибка при формировании отчёта по мероприятиям: ${error.message}` });
    }
});

module.exports = router;