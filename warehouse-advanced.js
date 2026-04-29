// ============================================================================
// WarehouseApp Advanced Accounting Features
// ============================================================================

(() => {
    const HISTORY_FILTERS_STORAGE_KEY = 'warehouse_history_filters';
    const CALENDAR_FILTERS_STORAGE_KEY = 'warehouse_calendar_filters';
    const RENTALS_TOP_LIMIT_KEY = 'warehouse_rentals_top_limit';
    const RENTALS_TOP_SORT_KEY = 'warehouse_rentals_top_sort';
    const EVENTS_TOP_LIMIT_KEY = 'warehouse_events_top_limit';
    const EVENTS_TOP_SORT_KEY = 'warehouse_events_top_sort';

    let inventoryStatusChartInstance = null;
    let inventoryStatusChartTypeBound = false;
    let dashboardWriteoffChartInstance = null;
    let dashboardReasonChartInstance = null;
    let dashboardCategoryStockChartInstance = null;
    let dashboardLoadTimerId = null;
    let dashboardLoadInFlight = false;
    let dashboardLastLoadedAt = 0;
    let movementHistoryRows = [];
    let calendarEntries = [];
    let advancedConfirmCallback = null;
    let highlightedConflictIds = new Set();
    const UNIFIED_DOCUMENT_PRINT_STYLE = `
        @page { size: A4; margin: 5mm; }
        body { font-family: Arial, sans-serif; color: #222; background: #fff; margin: 0; font-size: 12px; line-height: 1.45; }
        .document { padding: 0; }
        .header { text-align: center; margin-bottom: 12px; }
        .title { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
        .subtitle { margin-top: 6px; font-size: 11px; color: #666; }
        .doc-info { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin: 10px 0 12px; font-size: 11px; }
        .section { margin-bottom: 10px; page-break-inside: avoid; }
        .section-title { font-weight: 700; margin-bottom: 8px; font-size: 12px; }
        .info-box, .note-box { border: 1px solid #d9d9d9; border-radius: 6px; padding: 10px 12px; background: #fafafa; }
        .info-line { margin-bottom: 4px; }
        table, .report-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; font-size: 9.6px; }
        th, td, .report-table th, .report-table td { border: 1px solid #bcbcbc; padding: 5px 6px; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
        th, .report-table th { background: #efefef; text-align: left; }
        .text-center { text-align: center; }
        .summary-section { margin-top: 12px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .summary-card { border: 1px solid #d9d9d9; border-radius: 6px; padding: 8px 10px; background: #fafafa; }
        .summary-label { font-size: 10px; color: #666; }
        .summary-value { font-size: 15px; font-weight: 700; margin-top: 4px; }
        .signature-row { display: flex; gap: 18px; margin-top: 20px; }
        .signature-block { flex: 1; }
        .signature-line { border-bottom: 1px solid #000; height: 24px; margin-top: 16px; }
        .signature-label { font-size: 9px; text-align: center; margin-top: 4px; color: #666; }
        .stamp-row { display: flex; justify-content: space-between; gap: 18px; margin-top: 12px; }
        .stamp-box { flex: 1; border: 1px dashed #9aa3b2; border-radius: 6px; height: 52px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #4b5563; background: #f8fafc; }
        .footer { margin-top: 24px; font-size: 9px; text-align: center; color: #777; }
        .document-card-section-actions, .dashboard-actions, .inline-action-btn, button { display: none !important; }
    `;

    function buildUnifiedPrintStyle(extra = '') {
        return `${UNIFIED_DOCUMENT_PRINT_STYLE}\n${String(extra || '').trim()}`;
    }

    function html(value) {
        if (typeof escapeHtml === 'function') {
            return escapeHtml(value);
        }
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function restoreText(value) {
        if (typeof window.restoreText === 'function') {
            return window.restoreText(value);
        }
        return String(value || '');
    }

    function parseDateSafe(value) {
        if (typeof parseDateValue === 'function') {
            return parseDateValue(value);
        }
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateTimeSafe(value, fallback = '—') {
        if (typeof formatDateTime === 'function') {
            return formatDateTime(value, fallback);
        }
        const date = parseDateSafe(value);
        return date ? date.toLocaleString('ru-RU') : fallback;
    }

    function formatDateOnlySafe(value, fallback = '—') {
        const date = parseDateSafe(value);
        if (!date) return fallback;
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function toDateInputValue(value) {
        const date = parseDateSafe(value) || new Date();
        return date.toISOString().slice(0, 10);
    }

    function toDateTimeLocalInput(value) {
        if (typeof toDateTimeLocalValue === 'function') {
            return toDateTimeLocalValue(value);
        }
        const date = parseDateSafe(value);
        return date ? date.toISOString().slice(0, 16) : '';
    }

    function normalizeInventoryStateLabel(status) {
        const raw = String(status || '').trim();
        const normalized = raw.toLowerCase().replace(/ё/g, 'е');

        if (/нет\s*в\s*наличии\s*\(?.*использ/.test(normalized)) return 'Нет в наличии (в использовании)';
        if (/нет\s*в\s*наличии/.test(normalized)) return 'Нет в наличии';
        if (/частич.*спис/.test(normalized)) return 'Частично в списании';
        if (/к\s*спис/.test(normalized)) return 'К списанию';
        if (/рестав|ремонт/.test(normalized)) return 'На реставрации';
        if (/спис/.test(normalized)) return 'Списано';
        return 'В наличии';
    }

    function getInventoryStatusMeta(itemOrStatus) {
        const isItemObject = itemOrStatus && typeof itemOrStatus === 'object';
        const value = isItemObject ? getInventoryDisplayStatus(itemOrStatus) : normalizeInventoryStateLabel(itemOrStatus);
        switch (value) {
            case 'В аренде':
                return { label: value, className: 'rental', icon: '🔵' };
            case 'На мероприятии':
                return { label: value, className: 'event', icon: '🟠' };
            case 'В аренде / На мероприятии':
                return { label: value, className: 'inuse', icon: '🟠' };
            case 'Частично в аренде':
                return { label: value, className: 'rental', icon: '🔵' };
            case 'Частично на мероприятии':
                return { label: value, className: 'event', icon: '🟠' };
            case 'Частично в аренде/мероприятии':
                return { label: value, className: 'inuse', icon: '🟠' };
            case 'Нет в наличии':
                return { label: value, className: 'unavailable', icon: '🔴' };
            case 'К списанию':
                return { label: value, className: 'towriteoff', icon: '🧾' };
            case 'Частично в списании':
                return { label: value, className: 'towriteoff', icon: '🟡' };
            case 'На реставрации':
                return { label: value, className: 'repair', icon: '🟡' };
            case 'Списано':
                return { label: value, className: 'writtenoff', icon: '⚫' };
            default:
                return { label: 'В наличии', className: 'available', icon: '🟢' };
        }
    }

    function getInventoryDisplayStatus(item) {
        const value = normalizeInventoryStateLabel(item?.status || 'В наличии');
        if (value === 'На реставрации' || value === 'Списано') return value;

        const total = Math.max(0, Number(item?.totalQuantity ?? item?.totalStock ?? item?.quantity ?? 0));
        const pendingRaw = Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
        const pendingWriteoff = Math.min(total, pendingRaw);
        const inRental = Math.max(0, Number(item?.inRental || 0));
        const inEvent = Math.max(0, Number(item?.inEvent || 0));
        const available = Math.max(0, Number(item?.availableQuantity ?? (total - pendingWriteoff - inRental - inEvent)));

        if (total <= 0) return 'Списано';
        if (pendingWriteoff >= total && total > 0) return 'К списанию';
        if (pendingWriteoff > 0) return 'Частично в списании';
        if (inRental > 0 && inEvent > 0) return available > 0 ? 'Частично в аренде/мероприятии' : 'В аренде / На мероприятии';
        if (inRental > 0) return available > 0 ? 'Частично в аренде' : 'В аренде';
        if (inEvent > 0) return available > 0 ? 'Частично на мероприятии' : 'На мероприятии';
        if (available > 0) return 'В наличии';
        return 'Нет в наличии';
    }

    function normalizeAccountingType(value) {
        const raw = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
        if (!raw) return 'asset';
        if (raw === 'consumable' || raw === 'рм' || raw.includes('расход')) return 'consumable';
        return 'asset';
    }

    function getAccountingTypeMeta(type) {
        const normalized = normalizeAccountingType(type);
        if (normalized === 'consumable') {
            return { key: 'consumable', label: '⚡ Расходник' };
        }
        return { key: 'asset', label: '🏗️ ОС' };
    }

    function readJsonStorage(key, fallback = {}) {
        try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    function writeJsonStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value || {}));
    }

    function downloadCsv(headers, rows, fileName) {
        const content = [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
            .join('\n');

        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function downloadExcelFromData(fileName, headers, rows) {
        try {
            console.log('Creating Excel with SheetJS:', fileName);
            
            if (!window.XLSX) {
                console.warn('SheetJS not available, using CSV fallback');
                // Fallback to CSV
                downloadCsv(headers, rows, fileName.replace('.xlsx', '.csv'));
                return;
            }
            
            console.log('SheetJS loaded, creating workbook');
            
            // Create worksheet data with headers
            const worksheetData = [headers, ...rows];
            
            // Create worksheet
            const worksheet = window.XLSX.utils.aoa_to_sheet(worksheetData);
            
            // Set column widths based on content
            const colWidths = headers.map((header, idx) => {
                const maxLength = Math.max(
                    header.length,
                    ...rows.map(row => String(row[idx] || '').length)
                );
                return { wch: Math.min(maxLength + 2, 50) };
            });
            worksheet['!cols'] = colWidths;
            
            // Create workbook
            const workbook = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
            
            // Write file
            window.XLSX.writeFile(workbook, fileName);
            console.log('Excel file created successfully');
            
        } catch (error) {
            console.error('Excel creation error:', error);
            console.warn('Falling back to CSV export');
            try {
                downloadCsv(headers, rows, fileName.replace('.xlsx', '.csv'));
            } catch (csvError) {
                console.error('CSV fallback error:', csvError);
                throw new Error(`Ошибка создания файла: ${error.message}`);
            }
        }
    }

    async function downloadExcelFile(apiEndpoint) {
        try {
            // Get auth headers from global scope
            const getAuthHeaderFn = window.getAuthHeader || (() => ({}));
            const headers = getAuthHeaderFn();
            
            console.log('Downloading Excel from:', apiEndpoint);
            console.log('Auth headers present:', !!headers.Authorization);
            
            const response = await fetch(apiEndpoint, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    ...headers
                },
                credentials: 'include'
            });
            
            console.log('Response status:', response.status);
            console.log('Response headers:', {
                'content-type': response.headers.get('content-type'),
                'content-disposition': response.headers.get('content-disposition'),
                'content-length': response.headers.get('content-length')
            });
            
            if (!response.ok) {
                let errorMessage = `Ошибка ${response.status}`;
                
                // Try to parse error response
                try {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorData.message || errorMessage;
                    } else {
                        const text = await response.text();
                        errorMessage = text || errorMessage;
                    }
                } catch (e) {
                    console.error('Error parsing response:', e);
                }
                
                if (response.status === 401) {
                    throw new Error('Не авторизован. Пожалуйста, перезагрузите страницу.');
                }
                
                throw new Error(errorMessage);
            }
            
            // Check blob size
            const blob = await response.blob();
            console.log('Blob size:', blob.size, 'Type:', blob.type);
            
            if (blob.size === 0) {
                throw new Error('Получен пустой файл');
            }
            
            if (!blob.type.includes('spreadsheet') && !blob.type.includes('application/octet-stream')) {
                console.warn('Unexpected blob type:', blob.type);
            }
            
            // Create download link
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            
            // Extract filename from Content-Disposition header if available
            const contentDisposition = response.headers.get('content-disposition');
            let fileName = 'export.xlsx';
            if (contentDisposition) {
                const fileNameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^";\n]+)/);
                if (fileNameMatch) {
                    fileName = decodeURIComponent(fileNameMatch[1].replace(/\/$/, ''));
                }
            }
            
            link.download = fileName;
            console.log('Downloading as:', fileName);
            
            document.body.appendChild(link);
            link.click();
            
            // Cleanup
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 100);
            
        } catch (error) {
            console.error('Excel download error:', error);
            throw new Error(`Ошибка экспорта: ${error.message}`);
        }
    }

    async function downloadPdf(title, headers, rows, fileName) {
        try {
            console.log('Starting PDF export:', { title, fileName, rowCount: rows.length });
            
            const tableHtml = [headers, ...rows].map((row, index) => {
                const tag = index === 0 ? 'th' : 'td';
                return `<tr>${row.map(cell => `<${tag}>${html(String(cell ?? ''))}</${tag}>`).join('')}</tr>`;
            }).join('');

            console.log('Table HTML generated, length:', tableHtml.length);

            const doc = `
                <!doctype html>
                <html lang="ru">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${html(fileName || title || 'report')}</title>
                    <style>
                        @page { size: A4; margin: 8mm; orphans: 0; widows: 0; }
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        html, body { 
                            margin: 0;
                            padding: 0;
                            height: 100%;
                        }
                        body { 
                            font-family: "Arial", "Segoe UI", sans-serif; 
                            color: #111827; 
                            background: white;
                            line-height: 1.3;
                        }
                        h1 { 
                            margin: 0;
                            padding: 0;
                            font-size: 16px;
                            font-weight: bold;
                            margin-bottom: 2px;
                        }
                        .meta { 
                            margin: 0;
                            padding: 0;
                            margin-bottom: 4px;
                            color: #4b5563; 
                            font-size: 10px;
                        }
                        table { 
                            width: 100%; 
                            border-collapse: collapse;
                            page-break-inside: avoid;
                            margin: 0;
                            padding: 0;
                        }
                        th, td { 
                            border: 1px solid #d1d5db; 
                            padding: 4px 3px;
                            font-size: 10px; 
                            text-align: left;
                            word-break: break-word;
                            vertical-align: top;
                        }
                        th { 
                            background: #f3f4f6;
                            font-weight: bold;
                            padding: 5px 3px;
                        }
                        tr { 
                            page-break-inside: avoid;
                            height: auto;
                        }
                    </style>
                </head>
                <body>
                    <h1>${html(title)}</h1>
                    <div class="meta">Дата: ${html(new Date().toLocaleString('ru-RU'))}</div>
                    <table>${tableHtml}</table>
                </body>
                </html>
            `;

            // Use blob URL approach - no window.open() needed
            const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            
            // Create iframe in hidden container
            const container = document.createElement('div');
            container.style.display = 'none';
            document.body.appendChild(container);
            
            const iframe = document.createElement('iframe');
            iframe.src = blobUrl;
            iframe.style.display = 'none';
            container.appendChild(iframe);
            
            console.log('iframe created, waiting for load');
            
            // Wait for iframe to load
            iframe.onload = function() {
                console.log('iframe loaded, triggering print');
                try {
                    if (iframe.contentWindow) {
                        iframe.contentWindow.focus();
                        iframe.contentWindow.print();
                        console.log('Print triggered successfully');
                    }
                } catch (e) {
                    console.error('Error triggering print:', e);
                }
                
                // Cleanup after print dialog closes (user may take time)
                setTimeout(() => {
                    try {
                        document.body.removeChild(container);
                        URL.revokeObjectURL(blobUrl);
                        console.log('Cleanup completed');
                    } catch (e) {
                        console.warn('Cleanup error:', e);
                    }
                }, 1000);
            };
            
            iframe.onerror = function() {
                console.error('iframe load error');
                document.body.removeChild(container);
                URL.revokeObjectURL(blobUrl);
                throw new Error('Не удалось загрузить содержимое для печати');
            };
            
        } catch (error) {
            console.error('PDF export error:', error);
            throw error;
        }
    }

    function buildInventoryRowsFromSelection(selectedItems) {
        return selectedItems.map(item => [
            item.name,
            item.category,
            Number(item.totalQuantity ?? item.quantity ?? 0),
            Number(item.inRental || 0),
            Number(item.inEvent || 0),
            Number(item.availableQuantity ?? item.quantity ?? 0),
            getAccountingTypeMeta(item.type).label,
            normalizeInventoryStateLabel(item.status)
        ]);
    }

    function updateSelectedCount(selector, targetId) {
        const count = document.querySelectorAll(selector).length;
        const target = document.getElementById(targetId);
        if (target) {
            target.textContent = `Выбрано: ${count}`;
        }
        return count;
    }

    function getSelectedInventoryItems(fromMainTable = true) {
        const selector = fromMainTable
            ? '.inventory-main-checkbox:checked'
            : '.inventory-checkbox:checked';
        const ids = Array.from(document.querySelectorAll(selector)).map(cb => String(cb.dataset.id));
        return inventory.filter(item => ids.includes(String(item.id)));
    }

    function getSelectedRentalsData() {
        const ids = Array.from(document.querySelectorAll('.rental-checkbox:checked'))
            .map(cb => Number(cb.dataset.index))
            .map(index => rentals[index])
            .filter(Boolean);
        return ids;
    }

    function getSelectedEventsData() {
        return Array.from(document.querySelectorAll('.event-checkbox:checked'))
            .map(cb => Number(cb.dataset.index))
            .map(index => events[index])
            .filter(Boolean);
    }

    function populateInventoryLinkedSelectors() {
        const itemSelectors = [
            document.getElementById('historyObjectFilter'),
            document.getElementById('calendarItemFilter')
        ].filter(Boolean);

        itemSelectors.forEach(select => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Все объекты</option>';
            inventory
                .slice()
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
                .forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = `${item.name} (${item.category || 'Склад'})`;
                    select.appendChild(option);
                });
            select.value = currentValue || '';
        });

        const employeeSelect = document.getElementById('calendarEmployeeFilter');
        if (employeeSelect) {
            const currentValue = employeeSelect.value;
            employeeSelect.innerHTML = '<option value="">Все ответственные</option>';
            employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.id;
                option.textContent = employee.name;
                employeeSelect.appendChild(option);
            });
            employeeSelect.value = currentValue || '';
        }
    }

    function renderInventoryStatusReport(data = inventory) {
        const summaryContainer = document.getElementById('inventoryStatusSummary');
        const canvas = document.getElementById('inventoryStatusChart');
        const chartTypeSelect = document.getElementById('inventoryStatusChartType');
        if (!summaryContainer || !canvas || typeof Chart === 'undefined') return;

        const grouped = new Map();
        const totals = {
            objects: 0,
            totalQty: 0,
            available: 0,
            inRental: 0,
            inEvent: 0,
            pendingWriteoff: 0
        };
        (data || []).forEach(item => {
            const status = normalizeInventoryStateLabel(item.status);
            const entry = grouped.get(status) || { count: 0, quantity: 0 };
            entry.count += 1;
            entry.quantity += Number(item.quantity || 0);
            grouped.set(status, entry);

            totals.objects += 1;
            totals.totalQty += Math.max(0, Number(item?.totalQuantity ?? item?.quantity ?? 0));
            totals.available += Math.max(0, Number(item?.availableQuantity ?? item?.quantity ?? 0));
            totals.inRental += Math.max(0, Number(item?.inRental ?? item?.in_rental ?? 0));
            totals.inEvent += Math.max(0, Number(item?.inEvent ?? item?.in_event ?? 0));
            totals.pendingWriteoff += Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
        });

        const labels = Array.from(grouped.keys());
        const chartType = ['doughnut', 'pie', 'bar', 'line'].includes(String(chartTypeSelect?.value || '').trim())
            ? chartTypeSelect.value
            : 'doughnut';
        const palette = [
            'rgba(34, 197, 94, 0.78)',
            'rgba(59, 130, 246, 0.78)',
            'rgba(249, 115, 22, 0.78)',
            'rgba(245, 158, 11, 0.78)',
            'rgba(168, 85, 247, 0.78)',
            'rgba(236, 72, 153, 0.78)',
            'rgba(14, 165, 233, 0.78)',
            'rgba(107, 114, 128, 0.78)'
        ];
        let chartLabels = [
            'Всего единиц',
            'Доступно',
            'В аренде',
            'На мероприятии',
            'Ожидает списания'
        ];
        let chartCounts = [
            totals.totalQty,
            totals.available,
            totals.inRental,
            totals.inEvent,
            totals.pendingWriteoff
        ].map(value => Math.max(0, Number(value || 0)));

        // Если метрики пустые, показываем распределение по статусам как fallback.
        if (chartCounts.every(value => value === 0) && labels.length > 0) {
            chartLabels = labels;
            chartCounts = labels.map(label => grouped.get(label)?.count || 0);
        }

        const colors = chartLabels.map((_, idx) => palette[idx % palette.length]);
        const theme = window.WarehouseDashboard?.getDashboardChartTheme?.() || {};
        const chartTickColor = theme.tick || '#eaf2ff';
        const chartGridColor = theme.grid || 'rgba(186, 206, 232, 0.22)';

        const totalsHtml = `
            <div class="inventory-status-totals-grid">
                <div class="inventory-total-card"><strong>Всего объектов</strong><span>${totals.objects}</span></div>
                <div class="inventory-total-card"><strong>Всего единиц</strong><span>${totals.totalQty} шт.</span></div>
                <div class="inventory-total-card"><strong>Доступно</strong><span>${totals.available} шт.</span></div>
                <div class="inventory-total-card"><strong>В аренде</strong><span>${totals.inRental} шт.</span></div>
                <div class="inventory-total-card"><strong>На мероприятии</strong><span>${totals.inEvent} шт.</span></div>
                <div class="inventory-total-card"><strong>Ожидает списания</strong><span>${totals.pendingWriteoff} шт.</span></div>
            </div>
        `;

        const byStatusHtml = labels.length
            ? labels.map(label => {
                const meta = getInventoryStatusMeta(label);
                const group = grouped.get(label);
                return `
                    <div class="report-summary-item">
                        <strong>${meta.icon} ${html(label)}</strong>
                        <span>Объектов: ${group.count}</span>
                        <span>Остаток: ${group.quantity} шт.</span>
                    </div>
                `;
            }).join('')
            : '<div class="report-summary-item"><strong>Нет данных</strong><span>Объекты отсутствуют</span></div>';
        summaryContainer.innerHTML = `${totalsHtml}${byStatusHtml}`;

        if (inventoryStatusChartInstance) {
            inventoryStatusChartInstance.destroy();
        }

        inventoryStatusChartInstance = new Chart(canvas.getContext('2d'), {
            type: chartType,
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Объекты по статусам',
                    data: chartCounts,
                    backgroundColor: colors,
                    borderColor: colors.map(color => color.replace('0.78', '1')),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: chartTickColor,
                            boxWidth: 14,
                            boxHeight: 9,
                            padding: 16,
                            font: { size: 12, weight: '600' }
                        }
                    },
                    title: {
                        display: true,
                        text: 'Итоги склада (единицы)',
                        color: chartTickColor
                    }
                },
                scales: (chartType === 'bar' || chartType === 'line')
                    ? {
                        y: { beginAtZero: true, ticks: { color: chartTickColor }, grid: { color: chartGridColor, drawBorder: false } },
                        x: { ticks: { color: chartTickColor }, grid: { color: chartGridColor, drawBorder: false } }
                    }
                    : undefined
            }
        });

        if (chartTypeSelect && !inventoryStatusChartTypeBound) {
            inventoryStatusChartTypeBound = true;
            chartTypeSelect.addEventListener('change', () => {
                renderInventoryStatusReport(inventory);
            });
        }
    }

    // ---------------------------------------------------------------------
    // Confirm modal enhancement
    // ---------------------------------------------------------------------

    window.showConfirmModal = function showConfirmModalAdvanced(title, message, callback, options = {}) {
        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const detailsEl = document.getElementById('confirmModalDetails');
        const optionRow = document.getElementById('confirmModalOptionRow');
        const optionLabel = document.getElementById('confirmModalOptionLabel');
        const optionCheckbox = document.getElementById('confirmModalOptionCheckbox');
        const confirmButton = document.getElementById('confirmActionButton');
        const cancelButton = document.getElementById('confirmCancelButton');
        const modal = document.getElementById('confirmModal');

        if (!modal || !titleEl || !messageEl) return;

        titleEl.textContent = title || 'Подтверждение действия';
        messageEl.innerHTML = options.allowHtmlMessage
            ? String(message || '')
            : html(message || '').replace(/\n/g, '<br>');

        if (detailsEl) {
            const detailsHtml = options.detailsHtml || '';
            detailsEl.style.display = detailsHtml ? 'block' : 'none';
            detailsEl.innerHTML = detailsHtml;
        }

        if (optionRow && optionLabel && optionCheckbox) {
            const checkboxLabel = options.checkboxLabel || '';
            optionRow.style.display = checkboxLabel ? 'flex' : 'none';
            optionLabel.textContent = checkboxLabel;
            optionCheckbox.checked = options.checkboxChecked !== false;
        }

        if (confirmButton) confirmButton.textContent = options.confirmText || 'Подтвердить';
        if (cancelButton) cancelButton.textContent = options.cancelText || 'Отмена';

        advancedConfirmCallback = callback;
        modal.style.display = 'block';
    };

    window.closeConfirmModal = function closeConfirmModalAdvanced() {
        const modal = document.getElementById('confirmModal');
        const detailsEl = document.getElementById('confirmModalDetails');
        const optionRow = document.getElementById('confirmModalOptionRow');
        if (modal) modal.style.display = 'none';
        if (detailsEl) {
            detailsEl.style.display = 'none';
            detailsEl.innerHTML = '';
        }
        if (optionRow) optionRow.style.display = 'none';
        advancedConfirmCallback = null;
    };

    window.confirmAction = function confirmActionAdvanced() {
        if (typeof advancedConfirmCallback !== 'function') {
            window.closeConfirmModal();
            return;
        }
        const optionCheckbox = document.getElementById('confirmModalOptionCheckbox');
        const callback = advancedConfirmCallback;
        window.closeConfirmModal();
        callback({ optionChecked: optionCheckbox ? optionCheckbox.checked : true });
    };

    // ---------------------------------------------------------------------
    // Inventory table, statuses and bulk actions
    // ---------------------------------------------------------------------

    const originalNormalizeInventoryItem = window.normalizeInventoryItem;
    if (typeof originalNormalizeInventoryItem === 'function') {
        window.normalizeInventoryItem = function normalizeInventoryItemAdvanced(item) {
            const base = originalNormalizeInventoryItem(item);
            return {
                ...base,
                type: normalizeAccountingType(item.type || base.type || ''),
                requiresPurchase: item.requiresPurchase === true || item.requires_purchase === true || base.requiresPurchase === true,
                lifespan: item.lifespan ?? base.lifespan ?? null,
                balanceDate: item.balanceDate || item.balance_date || base.balanceDate || '',
                status: normalizeInventoryStateLabel(item.status || item.inventoryStatus || base.status || 'В наличии'),
                statusReason: item.statusReason || item.status_reason || '',
                plannedReturnDate: item.plannedReturnDate || item.planned_return_date || '',
                writeoffReason: item.writeoffReason || item.writeoff_reason || '',
                writeoffDate: item.writeoffDate || item.writeoff_date || ''
            };
        };
    }

    window.toggleInventoryStatusFields = function toggleInventoryStatusFields() {
        const status = normalizeInventoryStateLabel(document.getElementById('itemStatus')?.value || 'В наличии');
        const repairFields = document.getElementById('itemRepairFields');
        const writeoffFields = document.getElementById('itemWriteoffFields');

        if (repairFields) {
            repairFields.style.display = status === 'На реставрации' ? 'block' : 'none';
        }
        if (writeoffFields) {
            writeoffFields.style.display = status === 'Списано' ? 'block' : 'none';
        }
    };

    const originalOpenAddModal = window.openAddModal;
    window.openAddModal = function openAddModalAdvanced(category) {
        if (typeof originalOpenAddModal === 'function') {
            originalOpenAddModal(category);
        }
        const statusField = document.getElementById('itemStatus');
        const stockField = document.getElementById('itemStock');
        const reasonField = document.getElementById('itemStatusReason');
        const plannedDateField = document.getElementById('itemPlannedReturnDate');
        const writeoffReasonField = document.getElementById('itemWriteoffReason');
        const writeoffDateField = document.getElementById('itemWriteoffDate');

        if (statusField) statusField.value = 'В наличии';
        if (stockField) stockField.value = '';
        if (reasonField) reasonField.value = '';
        if (plannedDateField) plannedDateField.value = '';
        if (writeoffReasonField) writeoffReasonField.value = '';
        if (writeoffDateField) writeoffDateField.value = '';
        window.toggleInventoryStatusFields();
    };

    const originalOpenEditModal = window.openEditModal;
    window.openEditModal = function openEditModalAdvanced(item) {
        if (typeof originalOpenEditModal === 'function') {
            originalOpenEditModal(item);
        }
        const statusField = document.getElementById('itemStatus');
        const reasonField = document.getElementById('itemStatusReason');
        const plannedDateField = document.getElementById('itemPlannedReturnDate');
        const writeoffReasonField = document.getElementById('itemWriteoffReason');
        const writeoffDateField = document.getElementById('itemWriteoffDate');

        if (statusField) statusField.value = normalizeInventoryStateLabel(item?.status || 'В наличии');
        if (reasonField) reasonField.value = item?.statusReason || item?.status_reason || '';
        if (plannedDateField) plannedDateField.value = toDateTimeLocalInput(item?.plannedReturnDate || item?.planned_return_date);
        if (writeoffReasonField) writeoffReasonField.value = item?.writeoffReason || item?.writeoff_reason || '';
        if (writeoffDateField) writeoffDateField.value = toDateTimeLocalInput(item?.writeoffDate || item?.writeoff_date);
        window.toggleInventoryStatusFields();
    };

    const originalCloseModal = window.closeModal;
    window.closeModal = function closeModalAdvanced() {
        if (typeof originalCloseModal === 'function') {
            originalCloseModal();
        }
        const statusField = document.getElementById('itemStatus');
        if (statusField) statusField.value = 'В наличии';
        window.toggleInventoryStatusFields();
    };

    window.renderAllTable = function renderAllTableAdvanced(data = inventory) {
        const tableBody = document.getElementById('tableSklad');
        if (!tableBody) return;

        const canEditStock = typeof RBAC !== 'undefined' && RBAC.hasPermission('stock', 'edit');
        const canManageStock = typeof RBAC !== 'undefined' && (
            RBAC.hasPermission('stock', 'create')
            || RBAC.hasPermission('stock', 'edit')
            || RBAC.hasPermission('stock', 'delete')
            || RBAC.hasPermission('stock', 'changeQty')
        );

        tableBody.innerHTML = '';
        (data || []).forEach((item, index) => {
            const totalQty = Number(item.totalQuantity ?? item.totalStock ?? item.quantity ?? 0);
            const lifecycleMeta = getInventoryStatusMeta(item);
            const pendingWriteoffQty = Math.max(0, Number(item.pendingWriteoff ?? item.pending_writeoff ?? 0));
            const inRentalQty = Number(item.inRental || 0);
            const inEventQty = Number(item.inEvent || 0);
            const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
            const eligibleByTotals = Math.max(0, totalQty - pendingWriteoffQty - inRentalQty - inEventQty);
            const writeoffEligibleQty = Math.max(0, Math.min(availableQty, eligibleByTotals));
            const availabilityMeta = typeof getInventoryAvailabilityMeta === 'function'
                ? getInventoryAvailabilityMeta(availableQty)
                : { badgeClass: 'available', icon: '✅', label: 'В наличии', rowClass: '' };
            const accountingMeta = getAccountingTypeMeta(item.type);
            const isWrittenOff = lifecycleMeta.label === 'Списано';
            const isMarker = item.isWriteoffMarker === true || item.is_writeoff_marker === true;
            const canSendToWriteoff = lifecycleMeta.label !== 'Списано' && !isMarker;
            const canSplitDefect = !isMarker && writeoffEligibleQty > 0;
            const writeoffCellHtml = isMarker
                ? `<span class="stock-badge low">📄 В акте ${html(item.writeoffActNumber || item.writeoff_act_number || '')}</span>`
                : canSplitDefect
                    ? '<button type="button" class="inline-action-btn split-defect-btn">Списать</button>'
                    : '';
            const actionsHtml = [
                '<button type="button" class="inline-action-btn open-item-btn">Открыть</button>',
                canEditStock ? '<button type="button" class="inline-action-btn edit-item-btn">Редактировать</button>' : '',
                writeoffCellHtml
            ].filter(Boolean).join('');
            const row = document.createElement('tr');
            const stockRowClass = totalQty === 0
                ? 'stock-row-writtenoff'
                : pendingWriteoffQty > 0
                    ? 'stock-row-pending-writeoff'
                    : inRentalQty > 0
                        ? 'stock-row-rental'
                        : inEventQty > 0
                            ? 'stock-row-event'
                            : availableQty > 0
                                ? 'stock-row-available'
                                : (availabilityMeta.rowClass || 'stock-row-out');
            row.className = `${stockRowClass} ${accountingMeta.key === 'consumable' ? 'stock-row-consumable' : ''}`.trim();
            row.innerHTML = `
                <td>${canManageStock ? `<input type="checkbox" class="inventory-main-checkbox" data-id="${html(item.id)}">` : `<span class="stock-row-number">${index + 1}</span>`}</td>
                <td class="${isWrittenOff ? 'writeoff-row-strike' : ''}">${html(item.name)}</td>
                <td>${html(item.category)}</td>
                <td><span class="quantity-badge ${totalQty === 0 ? 'zero' : ''}">${totalQty}</span></td>
                <td><span class="quantity-badge ${inRentalQty === 0 ? 'zero' : ''}">${inRentalQty}</span></td>
                <td><span class="quantity-badge ${inEventQty === 0 ? 'zero' : ''}">${inEventQty}</span></td>
                <td><span class="quantity-badge ${availableQty === 0 ? 'zero' : ''}">${availableQty}</span></td>
                <td><span class="quantity-badge ${pendingWriteoffQty === 0 ? 'zero' : ''}">${pendingWriteoffQty}</span></td>
                <td><span class="accounting-type-chip ${accountingMeta.key}">${accountingMeta.label}</span></td>
                <td>
                    <span class="inventory-status-badge ${lifecycleMeta.className}">${lifecycleMeta.icon} ${lifecycleMeta.label}</span>
                    ${item.plannedReturnDate || item.planned_return_date ? `<div class="small-muted">до ${html(formatDateTimeSafe(item.plannedReturnDate || item.planned_return_date, '—'))}</div>` : ''}
                </td>
                <td><div class="stock-actions-cell">${actionsHtml}</div></td>
            `;

            row.addEventListener('dblclick', () => window.openItemCard(item));
            row.querySelector('.open-item-btn')?.addEventListener('click', event => {
                event.stopPropagation();
                window.openItemCard(item);
            });
            row.querySelector('.edit-item-btn')?.addEventListener('click', event => {
                event.stopPropagation();
                window.openEditModal(item);
            });
            row.querySelector('.split-defect-btn')?.addEventListener('click', event => {
                event.stopPropagation();
                if (typeof window.openSplitDefectModal === 'function') {
                    window.openSplitDefectModal(item);
                }
            });
            row.querySelector('.inventory-main-checkbox')?.addEventListener('change', () => {
                updateSelectedCount('.inventory-main-checkbox:checked', 'inventorySelectedCount');
            });

            tableBody.appendChild(row);
        });

        updateSelectedCount('.inventory-main-checkbox:checked', 'inventorySelectedCount');
    };

    window.searchData = function searchDataAdvanced() {
        const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
        const category = document.getElementById('categoryFilter')?.value || '';
        const stockStatus = document.getElementById('statusFilter')?.value || '';
        const lifecycleStatus = document.getElementById('inventoryStateFilter')?.value || '';
        const accountingType = document.getElementById('accountingTypeFilter')?.value || '';

        const filtered = inventory.filter(item => {
            const matchesText = !query || String(item.name || '').toLowerCase().includes(query);
            const matchesCategory = !category || item.category === category;
            const matchesLifecycle = !lifecycleStatus || getInventoryDisplayStatus(item) === lifecycleStatus;
            const matchesAccountingType = !accountingType || normalizeAccountingType(item.type) === accountingType;

            const qty = Number(item.availableQuantity ?? item.quantity ?? 0);
            let matchesStockStatus = true;
            if (stockStatus === 'available') matchesStockStatus = qty > 10;
            if (stockStatus === 'low') matchesStockStatus = qty > 0 && qty <= 10;
            if (stockStatus === 'out') matchesStockStatus = qty === 0;

            return matchesText && matchesCategory && matchesLifecycle && matchesAccountingType && matchesStockStatus;
        });

        window.renderAllTable(filtered);
        renderInventoryStatusReport(filtered);
    };

    window.selectAllInventory = function selectAllInventory() {
        const canBulkOperate = typeof RBAC !== 'undefined' && (
            RBAC.hasPermission('stock', 'edit')
            || RBAC.hasPermission('stock', 'delete')
            || RBAC.hasPermission('stock', 'changeQty')
            || RBAC.hasPermission('reports', 'export')
        );
        if (!canBulkOperate) {
            showNotification('Недостаточно прав для массовых операций со складом', 'error');
            return;
        }

        const checked = !!document.getElementById('selectAllInventory')?.checked;
        document.querySelectorAll('.inventory-main-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        updateSelectedCount('.inventory-main-checkbox:checked', 'inventorySelectedCount');
    };

    async function updateInventoryItemStatus(item, status) {
        const totalQty = Number(item.totalQuantity ?? item.quantity ?? 0);
        await apiFetch(`/api/inventory/${item.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                ...item,
                status,
                quantity: status === 'Списано' ? 0 : totalQty,
                statusReason: status === 'На реставрации' ? (item.statusReason || 'Массовое обновление статуса') : (status === 'Списано' ? '' : (item.statusReason || '')),
                writeoffReason: status === 'Списано' ? (item.writeoffReason || 'Массовое списание') : ''
            })
        });
    }

    function rememberInventoryBulkUndo(actionLabel, selectedItems) {
        if (!Array.isArray(selectedItems) || !selectedItems.length) return;
        window.__inventoryBulkUndo = {
            at: Date.now(),
            actionLabel,
            snapshot: selectedItems.map(item => ({
                id: item.id,
                quantity: Number(item.totalQuantity ?? item.quantity ?? 0),
                status: item.status || 'В наличии',
                statusReason: item.statusReason || '',
                writeoffReason: item.writeoffReason || ''
            }))
        };
        const undoBtn = document.getElementById('inventoryUndoLastActionBtn');
        if (undoBtn) {
            undoBtn.style.display = '';
            undoBtn.textContent = `Отменить: ${actionLabel}`;
        }
    }

    window.undoLastInventoryBulkAction = async function undoLastInventoryBulkAction() {
        const undo = window.__inventoryBulkUndo;
        if (!undo?.snapshot?.length) {
            showNotification('Нет действий для отмены', 'info');
            return;
        }
        if (Date.now() - Number(undo.at || 0) > 30000) {
            showNotification('Окно отмены истекло (30 сек)', 'warning');
            window.__inventoryBulkUndo = null;
            const undoBtn = document.getElementById('inventoryUndoLastActionBtn');
            if (undoBtn) undoBtn.style.display = 'none';
            return;
        }
        try {
            for (const row of undo.snapshot) {
                await apiFetch(`/api/inventory/${row.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        id: row.id,
                        quantity: row.quantity,
                        stock: row.quantity,
                        status: row.status,
                        statusReason: row.statusReason,
                        writeoffReason: row.writeoffReason
                    })
                });
            }
            await loadData();
            showNotification(`Отменено: ${undo.actionLabel}`, 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка отмены действия', 'error');
        } finally {
            window.__inventoryBulkUndo = null;
            const undoBtn = document.getElementById('inventoryUndoLastActionBtn');
            if (undoBtn) undoBtn.style.display = 'none';
        }
    };

    window.applyInventoryBulkPreset = function applyInventoryBulkPreset() {
        const value = String(document.getElementById('inventoryBulkPresetSelect')?.value || '');
        if (!value) {
            showNotification('Выберите шаблон массового действия', 'info');
            return;
        }
        if (value === 'to-writeoff') {
            const statusSelect = document.getElementById('inventoryBulkStatus');
            if (statusSelect) statusSelect.value = 'Списано';
            window.applyBulkInventoryStatus();
            return;
        }
        if (value === 'set-restoration') {
            const statusSelect = document.getElementById('inventoryBulkStatus');
            if (statusSelect) statusSelect.value = 'На реставрации';
            window.applyBulkInventoryStatus();
            return;
        }
        if (value === 'set-zero') {
            const qtyInput = document.getElementById('inventoryBulkQuantityValue');
            if (qtyInput) qtyInput.value = '0';
            window.applyBulkInventoryQuantity();
        }
    };

    window.applyBulkInventoryStatus = async function applyBulkInventoryStatus() {
        if (typeof requirePermission === 'function' && !requirePermission('stock', 'edit', 'Недостаточно прав для изменения статуса объектов')) return;
        const selectedItems = getSelectedInventoryItems(true);
        const status = document.getElementById('inventoryBulkStatus')?.value || '';

        if (!selectedItems.length) {
            showNotification('Выберите объекты на складе.', 'warning');
            return;
        }
        if (!status) {
            showNotification('Выберите новый статус.', 'warning');
            return;
        }

        showConfirmModal(
            'Массовое изменение статуса',
            `Изменить статус для ${selectedItems.length} выбранных объектов на «${status}»?`,
            async () => {
                try {
                    rememberInventoryBulkUndo(`статус «${status}»`, selectedItems);
                    for (const item of selectedItems) {
                        await updateInventoryItemStatus(item, status);
                    }
                    await loadData();
                    showNotification(`Статус обновлён для ${selectedItems.length} объектов`, 'success');
                } catch (error) {
                    console.error('Ошибка массового обновления статусов:', error);
                    showNotification(error.message || 'Ошибка при массовом обновлении статусов', 'error');
                }
            },
            {
                confirmText: 'Изменить',
                cancelText: 'Отмена'
            }
        );
    };

    window.applyBulkInventoryQuantity = async function applyBulkInventoryQuantity() {
        if (typeof requirePermission === 'function' && !requirePermission('stock', 'changeQty', 'Недостаточно прав для изменения количества')) return;
        const selectedItems = getSelectedInventoryItems(true);
        const rawValue = Number(document.getElementById('inventoryBulkQuantityValue')?.value || 0);

        if (!selectedItems.length) {
            showNotification('Выберите объекты на складе.', 'warning');
            return;
        }
        if (!Number.isFinite(rawValue) || rawValue < 0) {
            showNotification('Введите корректное количество (0 и больше).', 'warning');
            return;
        }

        showConfirmModal(
            'Массовое изменение количества',
            `Установить количество ${rawValue} для ${selectedItems.length} выбранных объектов?`,
            async () => {
                try {
                    rememberInventoryBulkUndo(`количество ${rawValue}`, selectedItems);
                    for (const item of selectedItems) {
                        await apiFetch(`/api/inventory/${item.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({
                                ...item,
                                quantity: rawValue,
                                stock: rawValue
                            })
                        });
                    }

                    await loadData();
                    showNotification(`Количество обновлено для ${selectedItems.length} объектов`, 'success');
                } catch (error) {
                    console.error('Ошибка массового изменения количества:', error);
                    showNotification(error.message || 'Ошибка изменения количества', 'error');
                }
            },
            {
                confirmText: 'Применить',
                cancelText: 'Отмена'
            }
        );
    };

    window.exportSelectedInventory = async function exportSelectedInventory(format = 'excel') {
        if (typeof requirePermission === 'function' && !requirePermission('reports', 'export', 'Недостаточно прав для экспорта отчётов')) return;
        const selectedItems = getSelectedInventoryItems(true);
        if (!selectedItems.length) {
            showNotification('Нет выбранных объектов для экспорта.', 'warning');
            return;
        }

        const headers = ['Объект', 'Категория', 'Всего', 'В аренде', 'На мероприятии', 'Доступно', 'Тип учета', 'Статус'];
        const rows = buildInventoryRowsFromSelection(selectedItems);

        try {
            console.log(`Starting ${format} export for ${selectedItems.length} items`);
            if (format === 'pdf') {
                await downloadPdf('Склад — выбранные объекты', headers, rows, 'warehouse_selected_inventory.pdf');
                showNotification('Файл готов к печати', 'success');
            } else if (format === 'excel') {
                // Use local Excel export for selected items (SheetJS)
                downloadExcelFromData('warehouse_selected_inventory.xlsx', headers, rows);
                showNotification('Экспорт выбранных объектов выполнен', 'success');
            }
        } catch (error) {
            console.error('Export error:', error);
            showNotification(error.message || 'Ошибка экспорта', 'error');
        }
    };

    window.deleteSelectedInventory = function deleteSelectedInventory() {
        if (typeof requirePermission === 'function' && !requirePermission('stock', 'delete', 'Недостаточно прав для удаления объектов')) return;
        const selectedItems = getSelectedInventoryItems(true);
        if (!selectedItems.length) {
            showNotification('Выберите объекты для удаления.', 'warning');
            return;
        }

        showConfirmModal(
            'Удаление объектов со склада',
            `Удалить ${selectedItems.length} выбранных объектов?`,
            async () => {
                try {
                    for (const item of selectedItems) {
                        await apiFetch(`/api/inventory/${item.id}`, { method: 'DELETE' });
                    }
                    await loadData();
                    showNotification(`Удалено объектов: ${selectedItems.length}`, 'success');
                } catch (error) {
                    console.error('Ошибка удаления объектов:', error);
                    showNotification(error.message || 'Ошибка удаления объектов', 'error');
                }
            },
            {
                detailsHtml: `<strong>Внимание:</strong> объекты будут удалены из справочника, если не используются в арендах или мероприятиях.`,
                confirmText: 'Удалить',
                cancelText: 'Отмена'
            }
        );
    };

    window.deleteItem = function deleteItemAdvanced() {
        if (typeof requirePermission === 'function' && !requirePermission('stock', 'delete', 'Недостаточно прав для удаления объектов')) return;
        if (!editingItem) {
            showNotification('Нет выбранного объекта для удаления', 'warning');
            return;
        }

        showConfirmModal(
            'Удаление объекта',
            `Удалить объект «${editingItem.name}»?`,
            async () => {
                try {
                    await apiFetch(`/api/inventory/${editingItem.id}`, { method: 'DELETE' });
                    window.closeModal();
                    await loadData();
                    showNotification('Объект удалён', 'success');
                } catch (error) {
                    console.error('Ошибка удаления объекта:', error);
                    showNotification(`Ошибка удаления: ${error.message}`, 'error');
                }
            },
            {
                detailsHtml: '<strong>Важно:</strong> объект можно удалить только если он не участвует в активных арендах и мероприятиях.',
                confirmText: 'Удалить',
                cancelText: 'Отмена'
            }
        );
    };

    window.handleItemFormSubmit = async function handleItemFormSubmitAdvanced(event) {
        event.preventDefault();
        if (typeof requirePermission === 'function' && !requirePermission('stock', editingItem ? 'edit' : 'create', editingItem ? 'Недостаточно прав для редактирования объектов' : 'Недостаточно прав для добавления объектов')) return;

        const category = document.getElementById('itemForm').dataset.category || 'Склад';
        const imageUrl = document.getElementById('itemImageUrl').value.trim();
        const accountingType = document.querySelector('input[name="itemAccountingType"]:checked')?.value || 'asset';
        const requiresPurchase = document.getElementById('itemRequiresPurchase')?.checked === true;
        const minStock = Math.max(0, Number(document.getElementById('itemMinStock')?.value || 0));
        const lifespanRaw = document.getElementById('itemLifespan')?.value || '';
        const balanceDate = document.getElementById('itemBalanceDate')?.value || null;
        const status = normalizeInventoryStateLabel(document.getElementById('itemStatus')?.value || 'В наличии');
        const repairReason = document.getElementById('itemStatusReason')?.value.trim() || '';
        const plannedReturnDate = document.getElementById('itemPlannedReturnDate')?.value || null;
        const writeoffReason = document.getElementById('itemWriteoffReason')?.value.trim() || '';
        const writeoffDate = document.getElementById('itemWriteoffDate')?.value || null;
        const quantityValue = Number(document.getElementById('itemStock').value || 0);
        const unitCostValue = Math.max(0, Number(document.getElementById('itemUnitCost')?.value || 0));

        const item = {
            id: editingItem ? editingItem.id : generateItemId(category),
            name: document.getElementById('itemName').value.trim(),
            category,
            type: accountingType,
            requires_purchase: accountingType === 'consumable' ? requiresPurchase : false,
            lifespan: accountingType === 'asset' && lifespanRaw ? Number(lifespanRaw) : null,
            balance_date: accountingType === 'asset' ? balanceDate : null,
            quantity: status === 'Списано' ? 0 : quantityValue,
            stock: status === 'Списано' ? 0 : quantityValue,
            description: document.getElementById('itemDescription').value.trim(),
            info: document.getElementById('itemInfo').value.trim(),
            image: selectedImageData || imageUrl || (editingItem ? editingItem.image : ''),
            rentalStatus: 'На складе',
            status,
            statusReason: repairReason,
            plannedReturnDate,
            writeoffReason,
            writeoffDate,
            minStock: accountingType === 'consumable' ? minStock : 0,
            minstock: accountingType === 'consumable' ? minStock : 0,
            location: editingItem?.location || ''
        };

        if (!item.name) {
            showNotification('Введите название объекта', 'error');
            return;
        }

        if (accountingType === 'consumable' && minStock <= 0) {
            showNotification('Для расходника укажите минимальную норму больше нуля', 'error');
            return;
        }

        try {
            if (editingItem) {
                await apiFetch(`/api/inventory/${editingItem.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(item)
                });
                if (typeof setItemUnitCost === 'function') {
                    setItemUnitCost({ id: item.id, name: item.name }, unitCostValue);
                }
                if (typeof window.clearPendingDeliveryAdjustmentsForItem === 'function') {
                    window.clearPendingDeliveryAdjustmentsForItem({ id: item.id, name: item.name });
                }
                showNotification('Карточка объекта обновлена', 'success');
            } else {
                await apiFetch('/api/inventory', {
                    method: 'POST',
                    body: JSON.stringify(item)
                });
                if (typeof setItemUnitCost === 'function') {
                    setItemUnitCost({ id: item.id, name: item.name }, unitCostValue);
                }
                if (typeof window.clearPendingDeliveryAdjustmentsForItem === 'function') {
                    window.clearPendingDeliveryAdjustmentsForItem({ id: item.id, name: item.name });
                }
                showNotification('Объект добавлен успешно', 'success');
            }

            if (status === 'Списано') {
                launchWriteoffConfetti();
            }

            window.closeModal();
            await loadData();
        } catch (error) {
            console.error('Ошибка сохранения объекта:', error);
            showNotification(`Ошибка сохранения объекта: ${error.message}`, 'error');
        }
    };

    // ---------------------------------------------------------------------
    // Rentals / Events bulk operations and confirmations
    // ---------------------------------------------------------------------

    function buildRentalExportRows(selected) {
        return selected.map(rental => [
            `Аренда #${rental.id}`,
            rental.client_name || '—',
            formatDateTimeSafe(rental.start_date),
            formatDateTimeSafe(rental.end_date),
            rental.employee_name || '—',
            rental.status || '—'
        ]);
    }

    function buildEventExportRows(selected) {
        return selected.map(event => [
            event.name || `Мероприятие #${event.id}`,
            formatDateTimeSafe(event.start_date),
            formatDateTimeSafe(event.end_date),
            event.location || '—',
            event.employee_name || '—',
            event.status || '—'
        ]);
    }

    const originalRenderRentalsTable = window.renderRentalsTable;
    window.renderRentalsTable = function renderRentalsTableAdvanced(...args) {
        if (typeof originalRenderRentalsTable === 'function') {
            originalRenderRentalsTable.apply(this, args);
        }
        document.querySelectorAll('.rental-checkbox').forEach(cb => {
            cb.addEventListener('change', () => updateSelectedCount('.rental-checkbox:checked', 'rentalsSelectedCount'));
        });
        updateSelectedCount('.rental-checkbox:checked', 'rentalsSelectedCount');
    };

    const originalRenderEventsTable = window.renderEventsTable;
    window.renderEventsTable = function renderEventsTableAdvanced(...args) {
        if (typeof originalRenderEventsTable === 'function') {
            originalRenderEventsTable.apply(this, args);
        }
        document.querySelectorAll('.event-checkbox').forEach(cb => {
            cb.addEventListener('change', () => updateSelectedCount('.event-checkbox:checked', 'eventsSelectedCount'));
        });
        updateSelectedCount('.event-checkbox:checked', 'eventsSelectedCount');
    };

    const originalSelectAllRentals = window.selectAllRentals;
    window.selectAllRentals = function selectAllRentalsAdvanced() {
        if (typeof originalSelectAllRentals === 'function') {
            originalSelectAllRentals();
        }
        updateSelectedCount('.rental-checkbox:checked', 'rentalsSelectedCount');
    };

    const originalSelectAllEvents = window.selectAllEvents;
    window.selectAllEvents = function selectAllEventsAdvanced() {
        if (typeof originalSelectAllEvents === 'function') {
            originalSelectAllEvents();
        }
        updateSelectedCount('.event-checkbox:checked', 'eventsSelectedCount');
    };

    window.applyBulkRentalStatus = async function applyBulkRentalStatus() {
        if (typeof requirePermission === 'function' && !requirePermission('rental', 'changeStatus', 'Недостаточно прав для изменения статуса аренды')) return;
        const selected = getSelectedRentalsData();
        const status = document.getElementById('rentalsBulkStatus')?.value || '';
        if (!selected.length) {
            showNotification('Выберите аренды для изменения статуса.', 'warning');
            return;
        }
        if (!status) {
            showNotification('Выберите новый статус для аренды.', 'warning');
            return;
        }

        showConfirmModal(
            'Массовое изменение статуса аренд',
            `Изменить статус у ${selected.length} записей на «${status}»?`,
            async () => {
                try {
                    for (const rental of selected) {
                        await apiFetch(`/api/rentals/${rental.id}/status`, {
                            method: 'PUT',
                            body: JSON.stringify({ status })
                        });

                        if (status === 'Завершена' && typeof ensureAcceptanceDocumentRecord === 'function') {
                            ensureAcceptanceDocumentRecord('rental', { ...rental, status });
                        }
                    }
                    await loadData();
                    showNotification(`Статус обновлён для ${selected.length} аренд`, 'success');
                } catch (error) {
                    console.error('Ошибка массового обновления аренд:', error);
                    showNotification(error.message || 'Ошибка изменения статусов аренды', 'error');
                }
            },
            { confirmText: 'Изменить', cancelText: 'Отмена' }
        );
    };

    window.applyBulkEventStatus = async function applyBulkEventStatus() {
        if (typeof requirePermission === 'function' && !requirePermission('events', 'changeStatus', 'Недостаточно прав для изменения статуса мероприятия')) return;
        const selected = getSelectedEventsData();
        const status = document.getElementById('eventsBulkStatus')?.value || '';
        if (!selected.length) {
            showNotification('Выберите мероприятия для изменения статуса.', 'warning');
            return;
        }
        if (!status) {
            showNotification('Выберите новый статус для мероприятия.', 'warning');
            return;
        }

        showConfirmModal(
            'Массовое изменение статуса мероприятий',
            `Изменить статус у ${selected.length} мероприятий на «${status}»?`,
            async () => {
                try {
                    for (const entry of selected) {
                        await apiFetch(`/api/events/${entry.id}/status`, {
                            method: 'PUT',
                            body: JSON.stringify({ status })
                        });

                        if (status === 'Завершено' && typeof ensureAcceptanceDocumentRecord === 'function') {
                            ensureAcceptanceDocumentRecord('event', { ...entry, status });
                        }
                    }
                    await loadData();
                    showNotification(`Статус обновлён для ${selected.length} мероприятий`, 'success');
                } catch (error) {
                    console.error('Ошибка массового обновления мероприятий:', error);
                    showNotification(error.message || 'Ошибка изменения статусов мероприятий', 'error');
                }
            },
            { confirmText: 'Изменить', cancelText: 'Отмена' }
        );
    };

    window.exportSelectedRentals = async function exportSelectedRentals(format = 'excel') {
        if (typeof requirePermission === 'function' && !requirePermission('reports', 'export', 'Недостаточно прав для экспорта отчётов')) return;
        const selected = getSelectedRentalsData();
        if (!selected.length) {
            showNotification('Выберите аренды для экспорта.', 'warning');
            return;
        }
        const headers = ['Аренда', 'Арендатор', 'Начало', 'Окончание', 'Ответственный', 'Статус'];
        const rows = buildRentalExportRows(selected);
        try {
            console.log(`Starting ${format} export for ${selected.length} rentals`);
            if (format === 'pdf') {
                await downloadPdf('Аренды — выбранные записи', headers, rows, 'rentals_selected.pdf');
                showNotification('Файл готов к печати', 'success');
            } else if (format === 'excel') {
                // Use local Excel export for selected items
                downloadExcelFromData('rentals_selected.xlsx', headers, rows);
                showNotification('Экспорт аренд выполнен', 'success');
            }
        } catch (error) {
            console.error('Export error:', error);
            showNotification(error.message || 'Ошибка экспорта аренд', 'error');
        }
    };

    window.exportSelectedEvents = async function exportSelectedEvents(format = 'excel') {
        if (typeof requirePermission === 'function' && !requirePermission('reports', 'export', 'Недостаточно прав для экспорта отчётов')) return;
        const selected = getSelectedEventsData();
        if (!selected.length) {
            showNotification('Выберите мероприятия для экспорта.', 'warning');
            return;
        }
        const headers = ['Мероприятие', 'Начало', 'Окончание', 'Место', 'Ответственный', 'Статус'];
        const rows = buildEventExportRows(selected);
        try {
            console.log(`Starting ${format} export for ${selected.length} events`);
            if (format === 'pdf') {
                await downloadPdf('Мероприятия — выбранные записи', headers, rows, 'events_selected.pdf');
                showNotification('Файл готов к печати', 'success');
            } else if (format === 'excel') {
                // Use local Excel export for selected items
                downloadExcelFromData('events_selected.xlsx', headers, rows);
                showNotification('Экспорт мероприятий выполнен', 'success');
            }
        } catch (error) {
            console.error('Export error:', error);
            showNotification(error.message || 'Ошибка экспорта мероприятий', 'error');
        }
    };

    window.deleteSelectedRentals = function deleteSelectedRentalsAdvanced() {
        if (typeof requirePermission === 'function' && !requirePermission('rental', 'delete', 'Недостаточно прав для удаления аренды')) return;
        const selected = getSelectedRentalsData();
        if (!selected.length) {
            showNotification('⚠ Выберите аренды для удаления', 'warning');
            return;
        }

        const totalItems = selected.reduce((sum, rental) => sum + (Array.isArray(rental.items) ? rental.items.reduce((inner, item) => inner + Number(item.quantity || 0), 0) : 0), 0);
        showConfirmModal(
            'Удаление аренды',
            `Удалить ${selected.length} выбранных аренд?`,
            async ({ optionChecked }) => {
                try {
                    for (const rental of selected) {
                        await apiFetch(`/api/rentals/${rental.id}?restoreStock=${optionChecked !== false}`, { method: 'DELETE' });
                    }
                    await loadData();
                    showNotification(`✓ ${selected.length} аренд удалено`, 'success');
                } catch (error) {
                    console.error('Ошибка удаления аренды:', error);
                    showNotification(error.message || 'Ошибка при удалении аренды', 'error');
                }
            },
            {
                detailsHtml: `В выбранных арендах числится <strong>${totalItems}</strong> объектов. Действие нельзя отменить.`,
                checkboxLabel: 'Вернуть связанные объекты на склад автоматически',
                checkboxChecked: true,
                confirmText: 'Удалить',
                cancelText: 'Отмена'
            }
        );
    };

    window.deleteSelectedEvents = function deleteSelectedEventsAdvanced() {
        if (typeof requirePermission === 'function' && !requirePermission('events', 'delete', 'Недостаточно прав для удаления мероприятий')) return;
        const selected = getSelectedEventsData();
        if (!selected.length) {
            showNotification('Выберите мероприятия для удаления.', 'warning');
            return;
        }

        const totalItems = selected.reduce((sum, entry) => sum + (Array.isArray(entry.items) ? entry.items.reduce((inner, item) => inner + Number(item.quantity || 0), 0) : 0), 0);
        showConfirmModal(
            'Удаление мероприятия',
            `Удалить ${selected.length} выбранных мероприятий?`,
            async ({ optionChecked }) => {
                try {
                    for (const entry of selected) {
                        await apiFetch(`/api/events/${entry.id}?restoreStock=${optionChecked !== false}`, { method: 'DELETE' });
                    }
                    await loadData();
                    showNotification(`✓ ${selected.length} мероприятий удалено`, 'success');
                } catch (error) {
                    console.error('Ошибка удаления мероприятий:', error);
                    showNotification(error.message || 'Ошибка при удалении мероприятий', 'error');
                }
            },
            {
                detailsHtml: `В выбранных мероприятиях задействовано <strong>${totalItems}</strong> объектов.`,
                checkboxLabel: 'Вернуть объекты на склад автоматически',
                checkboxChecked: true,
                confirmText: 'Удалить',
                cancelText: 'Отмена'
            }
        );
    };

    window.updateRentalStatus = async function updateRentalStatusAdvanced(rentalId, status, rental) {
        if (status === 'Завершена') {
            const selectElement = document.querySelector(`.rental-status-select[data-id="${rentalId}"]`);
            if (selectElement) {
                selectElement.value = rental.status || 'Активна';
            }
            await openEditRentalModal({ ...rental, status }, { forceCompletion: true });
            showNotification('Заполните состояние объектов и сохраните аренду, чтобы завершить её корректно.', 'warning');
            return;
        }

        try {
            await apiFetch(`/api/rentals/${rentalId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status })
            });
            await loadData();
            showNotification('Статус аренды обновлён', 'success');
        } catch (error) {
            console.error('Ошибка обновления статуса аренды:', error);
            showNotification(error.message || 'Ошибка при обновлении статуса', 'error');
            await loadData();
        }
    };

    window.updateEventStatus = async function updateEventStatusAdvanced(eventId, status, eventObj) {
        if (status === 'Завершено') {
            const selectElement = document.querySelector(`.event-status-select[data-id="${eventId}"]`);
            if (selectElement) {
                selectElement.value = eventObj.status || 'Черновик';
            }
            await openEditEventModal({ ...eventObj, status }, { forceCompletion: true });
            showNotification('Заполните состояние объектов и сохраните мероприятие, чтобы завершить его корректно.', 'warning');
            return;
        }

        try {
            await apiFetch(`/api/events/${eventId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status })
            });

            if (status === 'Активно' && typeof generateIssuanceActForEvent === 'function') {
                const ok = confirm('Мероприятие активно. Сформировать акт выдачи?');
                if (ok) generateIssuanceActForEvent(eventObj);
            }

            await loadData();
            showNotification('Статус мероприятия обновлён', 'success');
        } catch (error) {
            console.error('Ошибка обновления статуса мероприятия:', error);
            showNotification(error.message || 'Ошибка при обновлении статуса', 'error');
            await loadData();
        }
    };

    // ---------------------------------------------------------------------
    // History page
    // ---------------------------------------------------------------------

    function restoreHistoryFilters() {
        const filters = readJsonStorage(HISTORY_FILTERS_STORAGE_KEY, {});
        const map = {
            historyObjectFilter: filters.inventoryId || '',
            historyOperationFilter: filters.operationType || '',
            historyDateFromFilter: filters.dateFrom || '',
            historyDateToFilter: filters.dateTo || '',
            historyResponsibleFilter: filters.responsible || '',
            historySearchInput: filters.search || ''
        };

        Object.entries(map).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
    }

    function getHistoryFilters() {
        const filters = {
            inventoryId: document.getElementById('historyObjectFilter')?.value || '',
            operationType: document.getElementById('historyOperationFilter')?.value || '',
            dateFrom: document.getElementById('historyDateFromFilter')?.value || '',
            dateTo: document.getElementById('historyDateToFilter')?.value || '',
            responsible: document.getElementById('historyResponsibleFilter')?.value || '',
            search: document.getElementById('historySearchInput')?.value || ''
        };
        writeJsonStorage(HISTORY_FILTERS_STORAGE_KEY, filters);
        return filters;
    }

    function renderMovementHistoryTable(rows = []) {
        const tbody = document.getElementById('historyTableBody');
        const detailsPanel = document.getElementById('historyDetailsPanel');
        if (!tbody) return;

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-table-message">История перемещений пока пуста.</td></tr>';
            if (detailsPanel) {
                detailsPanel.style.display = 'none';
                detailsPanel.innerHTML = '';
            }
            return;
        }

        tbody.innerHTML = '';
        rows.forEach((movement, index) => {
            const row = document.createElement('tr');
            row.className = 'history-row-clickable';
            const direction = [movement.source_location, movement.destination_location].filter(Boolean).join(' → ') || '—';
            row.innerHTML = `
                <td>${html(formatDateTimeSafe(movement.operation_date))}</td>
                <td>${html(movement.item_name || movement.inventory_id || '—')}</td>
                <td>${html(movement.category || '—')}</td>
                <td>${html(movement.operation_type || '—')}</td>
                <td>${html(String(movement.quantity ?? '—'))}</td>
                <td>${html(movement.responsible_name || '—')}</td>
                <td>${html(direction)}</td>
                <td>${html(movement.document_label || 'Без документа')}</td>
            `;
            row.addEventListener('click', () => {
                const entry = movementHistoryRows[index];
                if (!detailsPanel || !entry) return;

                const direction = [entry.source_location, entry.destination_location].filter(Boolean).join(' → ') || '—';
                detailsPanel.style.display = 'block';
                detailsPanel.innerHTML = `
                    <div class="history-details-card">
                        <h3>Детали перемещения</h3>
                        <p><strong>Дата:</strong> ${html(formatDateTimeSafe(entry.operation_date))}</p>
                        <p><strong>Объект:</strong> ${html(entry.item_name || entry.inventory_id || '—')}</p>
                        <p><strong>Категория:</strong> ${html(entry.category || '—')}</p>
                        <p><strong>Операция:</strong> ${html(entry.operation_type || '—')}</p>
                        <p><strong>Количество:</strong> ${html(String(entry.quantity ?? '—'))}</p>
                        <p><strong>Кто:</strong> ${html(entry.responsible_name || '—')}</p>
                        <p><strong>Куда/Откуда:</strong> ${html(direction)}</p>
                        <p><strong>Документ:</strong> ${html(entry.document_label || 'Без документа')}</p>
                        <button type="button" class="inline-action-btn" id="openHistoryDocumentBtn">Открыть документ</button>
                    </div>
                `;

                detailsPanel.querySelector('#openHistoryDocumentBtn')?.addEventListener('click', () => openMovementDocument(entry));
            });
            row.addEventListener('dblclick', () => openMovementDocument(movementHistoryRows[index]));
            tbody.appendChild(row);
        });
    }

    window.loadMovementHistory = async function loadMovementHistory(showToast = false) {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        try {
            const filters = getHistoryFilters();
            const params = new URLSearchParams(filters);
            const data = await apiFetch(`/api/inventory/movements?${params.toString()}`);
            movementHistoryRows = Array.isArray(data) ? data : [];
            renderMovementHistoryTable(movementHistoryRows);
            if (showToast) {
                showNotification('История перемещений обновлена', 'success');
            }
        } catch (error) {
            console.error('Ошибка загрузки истории перемещений:', error);
            showNotification(error.message || 'Ошибка загрузки истории перемещений', 'error');
        }
    };

    async function openMovementDocument(movement) {
        if (!movement) return;

        const isReturn = /возврат/i.test(String(movement.operation_type || ''));
        try {
            if (movement.document_type === 'event') {
                const eventEntry = events.find(entry => String(entry.id) === String(movement.document_id));
                if (eventEntry) {
                    if (isReturn && typeof generateAcceptanceActForEvent === 'function') {
                        await generateAcceptanceActForEvent(eventEntry);
                        return;
                    }
                    if (typeof generateIssuanceActForEvent === 'function') {
                        await generateIssuanceActForEvent(eventEntry);
                        return;
                    }
                }
            }

            if (movement.document_type === 'rental') {
                const rentalEntry = rentals.find(entry => String(entry.id) === String(movement.document_id));
                if (rentalEntry) {
                    if (isReturn && typeof generateAcceptanceAct === 'function') {
                        await generateAcceptanceAct(rentalEntry);
                        return;
                    }
                    if (typeof generateIssuanceAct === 'function') {
                        await generateIssuanceAct(rentalEntry);
                        return;
                    }
                }
            }

            if (movement.document_url) {
                window.open(movement.document_url, '_blank', 'noopener');
            } else {
                showNotification('Для этой записи документ не привязан.', 'warning');
            }
        } catch (error) {
            console.error('Ошибка открытия документа:', error);
            showNotification(error.message || 'Не удалось открыть документ', 'error');
        }
    }

    window.exportMovementHistory = async function exportMovementHistory(format = 'excel') {
        if (typeof requirePermission === 'function' && !requirePermission('reports', 'export', 'Недостаточно прав для экспорта отчётов')) return;
        if (!movementHistoryRows.length) {
            showNotification('Нет данных истории для экспорта.', 'warning');
            return;
        }

        const headers = ['Дата', 'Объект', 'Категория', 'Операция', 'Количество', 'Кто', 'Куда/Откуда', 'Документ'];
        const rows = movementHistoryRows.map(entry => [
            formatDateTimeSafe(entry.operation_date),
            entry.item_name || entry.inventory_id || '—',
            entry.category || '—',
            entry.operation_type || '—',
            Number(entry.quantity || 0),
            entry.responsible_name || '—',
            [entry.source_location, entry.destination_location].filter(Boolean).join(' → ') || '—',
            entry.document_label || '—'
        ]);

        try {
            console.log(`Starting ${format} export for ${rows.length} records`);
            if (format === 'pdf') {
                await downloadPdf('История перемещений', headers, rows, 'movement_history.pdf');
                showNotification('Файл готов к печати', 'success');
            } else if (format === 'excel') {
                // Use local Excel export for history
                downloadExcelFromData('movement_history.xlsx', headers, rows);
                showNotification('Экспорт истории выполнен', 'success');
            }
        } catch (error) {
            console.error('Export error:', error);
            showNotification(error.message || 'Ошибка экспорта истории', 'error');
        }
    };

    // ---------------------------------------------------------------------
    // Occupancy calendar
    // ---------------------------------------------------------------------

    function restoreCalendarFilters() {
        const filters = readJsonStorage(CALENDAR_FILTERS_STORAGE_KEY, {});
        const referenceDate = filters.referenceDate || toDateInputValue(new Date());

        const map = {
            calendarViewMode: filters.viewMode || 'month',
            calendarReferenceDate: referenceDate,
            calendarItemFilter: filters.itemId || '',
            calendarTypeFilter: filters.type || 'all',
            calendarEmployeeFilter: filters.employeeId || ''
        };

        Object.entries(map).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
    }

    function getCalendarFilters() {
        const filters = {
            viewMode: document.getElementById('calendarViewMode')?.value || 'month',
            referenceDate: document.getElementById('calendarReferenceDate')?.value || toDateInputValue(new Date()),
            itemId: document.getElementById('calendarItemFilter')?.value || '',
            type: document.getElementById('calendarTypeFilter')?.value || 'all',
            employeeId: document.getElementById('calendarEmployeeFilter')?.value || ''
        };
        writeJsonStorage(CALENDAR_FILTERS_STORAGE_KEY, filters);
        return filters;
    }

    function getCalendarRange(viewMode, referenceDateValue) {
        const referenceDate = parseDateSafe(referenceDateValue) || new Date();
        const start = new Date(referenceDate);
        const end = new Date(referenceDate);

        if (viewMode === 'day') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

        if (viewMode === 'week') {
            const day = start.getDay() || 7;
            start.setDate(start.getDate() - day + 1);
            start.setHours(0, 0, 0, 0);
            end.setTime(start.getTime());
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        const day = start.getDay() || 7;
        start.setDate(start.getDate() - day + 1);
        end.setMonth(referenceDate.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        const endDay = end.getDay() || 7;
        end.setDate(end.getDate() + (7 - endDay));
        return { start, end };
    }

    function rangesOverlap(startA, endA, startB, endB) {
        return startA <= endB && startB <= endA;
    }

    function isDraftCalendarEntry(entry) {
        return String(entry?.status || '').trim() === 'Черновик';
    }

    function detectCalendarConflicts(rows) {
        const prepared = (rows || []).map((entry, index) => ({
            ...entry,
            __index: index,
            items: Array.isArray(entry.items) ? entry.items : []
        }));

        return prepared.map(entry => {
            const start = parseDateSafe(entry.start_date);
            const end = parseDateSafe(entry.end_date);
            const entryIsDraft = isDraftCalendarEntry(entry);
            const itemIds = new Set(entry.items.map(item => String(item.item_id || item.itemId || '')));
            const conflictDetails = prepared.filter(other => {
                if (other.__index === entry.__index) return false;
                if (entryIsDraft || isDraftCalendarEntry(other)) return false;
                const otherStart = parseDateSafe(other.start_date);
                const otherEnd = parseDateSafe(other.end_date);
                if (!start || !end || !otherStart || !otherEnd) return false;
                if (!rangesOverlap(start, end, otherStart, otherEnd)) return false;
                return other.items.some(item => itemIds.has(String(item.item_id || item.itemId || '')));
            }).map(other => {
                const overlappingItems = other.items.filter(item => itemIds.has(String(item.item_id || item.itemId || '')));
                return {
                    ...other,
                    overlappingItems
                };
            });

            return {
                ...entry,
                hasConflict: conflictDetails.length > 0,
                conflictDetails,
                isDraft: entryIsDraft
            };
        });
    }

    function getConflictTooltip(entry) {
        if (!entry?.hasConflict || !Array.isArray(entry.conflictDetails) || !entry.conflictDetails.length) {
            return '';
        }

        const conflictNames = entry.conflictDetails.map(conflict => {
            const label = conflict.type === 'event' ? 'Мероприятие' : 'Аренда';
            return `${label} №${conflict.id}`;
        });

        return `⚠ Конфликт: ${conflictNames.join(', ')}`;
    }

    function buildConflictDetailsHtml(entry) {
        const commonItems = Array.from(new Set((entry.items || []).map(item => item.item_name || item.name).filter(Boolean)));
        const list = (entry.conflictDetails || []).map(conflict => {
            const label = conflict.type === 'event'
                ? `Мероприятие №${conflict.id} (${conflict.location || 'Без места'})`
                : `Аренда №${conflict.id} (${conflict.client_name || 'Без арендатора'})`;
            const conflictItems = (conflict.overlappingItems || []).map(item => item.item_name || item.name).filter(Boolean).join(', ') || '—';

            return `<li><strong>${html(label)}</strong> — ${html(formatDateTimeSafe(conflict.start_date))} — ${html(formatDateTimeSafe(conflict.end_date))}<br><span>Пересекающиеся объекты: ${html(conflictItems)}</span></li>`;
        }).join('');

        return `
            <strong>⚠ Конфликт занятости</strong><br>
            <strong>Объекты:</strong> ${html(commonItems.join(', ') || '—')}<br>
            <strong>Период:</strong> ${html(formatDateTimeSafe(entry.start_date))} — ${html(formatDateTimeSafe(entry.end_date))}<br><br>
            <strong>Конфликт с:</strong>
            <ul class="calendar-conflict-list">${list}</ul>
            <strong>Рекомендация:</strong> объект пересекается по датам с другими активными записями.
        `;
    }

    function highlightConflictEntries(entry) {
        highlightedConflictIds = new Set([`${entry.type}-${entry.id}`]);
        (entry.conflictDetails || []).forEach(conflict => {
            highlightedConflictIds.add(`${conflict.type}-${conflict.id}`);
        });
        document.querySelectorAll('.calendar-entry').forEach(button => {
            const id = button.getAttribute('data-calendar-id');
            button.classList.toggle('highlighted', highlightedConflictIds.has(String(id)));
        });
    }

    function renderCalendarSummary(entries) {
        const summary = document.getElementById('calendarSummary');
        if (!summary) return;

        const rentalCount = entries.filter(entry => entry.type === 'rental').length;
        const eventCount = entries.filter(entry => entry.type === 'event').length;
        const conflictCount = entries.filter(entry => entry.hasConflict).length;

        summary.innerHTML = `
            <div class="calendar-summary-card"><strong>Аренды</strong><span>${rentalCount}</span></div>
            <div class="calendar-summary-card"><strong>Мероприятия</strong><span>${eventCount}</span></div>
            <div class="calendar-summary-card"><strong>Конфликты</strong><span>${conflictCount}</span></div>
        `;
    }

    function renderCalendarGrid(entries, viewMode, referenceDateValue) {
        const container = document.getElementById('calendarGrid');
        if (!container) return;

        const { start, end } = getCalendarRange(viewMode, referenceDateValue);
        const days = [];
        const cursor = new Date(start);
        while (cursor <= end) {
            days.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }

        container.style.gridTemplateColumns = viewMode === 'day'
            ? '1fr'
            : (viewMode === 'week' ? 'repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))');

        container.innerHTML = days.map(day => {
            const dayStart = new Date(day);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);

            const dayEntries = entries.filter(entry => {
                const startDate = parseDateSafe(entry.start_date);
                const endDate = parseDateSafe(entry.end_date);
                return startDate && endDate && rangesOverlap(startDate, endDate, dayStart, dayEnd);
            });

            const content = dayEntries.length
                ? dayEntries.map(entry => {
                    const itemNames = (entry.items || []).map(item => item.item_name || item.name).filter(Boolean).join(', ');
                    return `
                        <button type="button" class="calendar-entry ${entry.type} ${entry.isDraft ? 'draft' : ''} ${entry.hasConflict ? 'conflict' : ''}" data-calendar-id="${entry.type}-${entry.id}" title="${html(getConflictTooltip(entry))}">
                            <strong>${html(entry.title || `${entry.type} #${entry.id}`)}</strong><br>
                            <span>${html(formatDateTimeSafe(entry.start_date))} — ${html(formatDateTimeSafe(entry.end_date))}</span><br>
                            <span>${html(itemNames || entry.location || 'Без деталей')}</span>
                        </button>
                    `;
                }).join('')
                : '<div class="calendar-empty">Свободно</div>';

            return `
                <div class="calendar-cell">
                    <div class="calendar-cell-header">
                        <span>${html(day.toLocaleDateString('ru-RU', { weekday: 'short' }))}</span>
                        <span>${html(day.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }))}</span>
                    </div>
                    ${content}
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-calendar-id]').forEach(button => {
            button.addEventListener('click', () => {
                const [type, id] = String(button.getAttribute('data-calendar-id') || '').split('-');
                const entry = entries.find(item => String(item.type) === String(type) && String(item.id) === String(id));
                if (entry) {
                    const itemsText = (entry.items || []).map(item => `${item.item_name || item.name} — ${item.quantity} шт.`).join('<br>') || '—';
                    const detailsHtml = entry.hasConflict
                        ? buildConflictDetailsHtml(entry)
                        : `
                            <strong>Период:</strong> ${html(formatDateTimeSafe(entry.start_date))} — ${html(formatDateTimeSafe(entry.end_date))}<br>
                            <strong>Ответственный:</strong> ${html(entry.employee_name || '—')}<br>
                            <strong>Локация / клиент:</strong> ${html(entry.location || entry.client_name || '—')}<br>
                            <strong>Объекты:</strong><br>${itemsText}
                        `;

                    showConfirmModal(
                        entry.hasConflict ? '⚠ Конфликт занятости' : 'Детали занятости',
                        `${html(entry.title || 'Запись')}`,
                        () => openMovementDocument({
                            document_type: entry.type === 'event' ? 'event' : 'rental',
                            document_id: entry.id,
                            operation_type: 'Выдача',
                            document_url: entry.document_url
                        }),
                        {
                            detailsHtml,
                            confirmText: entry.hasConflict ? 'Показать на календаре' : 'Открыть документ',
                            cancelText: 'Закрыть'
                        }
                    );

                    if (entry.hasConflict) {
                        advancedConfirmCallback = () => highlightConflictEntries(entry);
                    }
                }
            });
        });
    }

    window.loadOccupancyCalendar = async function loadOccupancyCalendar(showToast = false) {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        try {
            const filters = getCalendarFilters();
            const range = getCalendarRange(filters.viewMode, filters.referenceDate);
            const params = new URLSearchParams({
                itemId: filters.itemId || '',
                type: filters.type || 'all',
                employeeId: filters.employeeId || '',
                dateFrom: range.start.toISOString(),
                dateTo: range.end.toISOString()
            });

            const data = await apiFetch(`/api/inventory/calendar?${params.toString()}`);
            calendarEntries = detectCalendarConflicts(Array.isArray(data) ? data : []);
            highlightedConflictIds = new Set();
            renderCalendarSummary(calendarEntries);
            renderCalendarGrid(calendarEntries, filters.viewMode, filters.referenceDate);

            if (showToast) {
                showNotification('Календарь занятости обновлён', 'success');
            }
        } catch (error) {
            console.error('Ошибка загрузки календаря:', error);
            showNotification(error.message || 'Ошибка загрузки календаря занятости', 'error');
        }
    };

    window.resetCalendarFilters = function resetCalendarFilters() {
        const referenceDate = toDateInputValue(new Date());
        const map = {
            calendarViewMode: 'month',
            calendarReferenceDate: referenceDate,
            calendarItemFilter: '',
            calendarTypeFilter: 'all',
            calendarEmployeeFilter: ''
        };

        Object.entries(map).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });

        window.loadOccupancyCalendar();
    };

    // ---------------------------------------------------------------------
    // Top objects report preferences
    // ---------------------------------------------------------------------

    function applyStoredTopReportPreferences() {
        const rentalsTopLimit = document.getElementById('rentalsTopLimit');
        const rentalsTopSort = document.getElementById('rentalsTopSortOrder');
        const eventsTopLimit = document.getElementById('eventsTopLimit');
        const eventsTopSort = document.getElementById('eventsTopSortOrder');

        if (rentalsTopLimit) rentalsTopLimit.value = localStorage.getItem(RENTALS_TOP_LIMIT_KEY) || '5';
        if (rentalsTopSort) rentalsTopSort.value = localStorage.getItem(RENTALS_TOP_SORT_KEY) || 'desc';
        if (eventsTopLimit) eventsTopLimit.value = localStorage.getItem(EVENTS_TOP_LIMIT_KEY) || '10';
        if (eventsTopSort) eventsTopSort.value = localStorage.getItem(EVENTS_TOP_SORT_KEY) || 'desc';
    }

    window.handleTopReportPreferenceChange = function handleTopReportPreferenceChange(kind) {
        if (kind === 'rentals') {
            localStorage.setItem(RENTALS_TOP_LIMIT_KEY, document.getElementById('rentalsTopLimit')?.value || '5');
            localStorage.setItem(RENTALS_TOP_SORT_KEY, document.getElementById('rentalsTopSortOrder')?.value || 'desc');
            updateRentalsChart();
            return;
        }

        localStorage.setItem(EVENTS_TOP_LIMIT_KEY, document.getElementById('eventsTopLimit')?.value || '10');
        localStorage.setItem(EVENTS_TOP_SORT_KEY, document.getElementById('eventsTopSortOrder')?.value || 'desc');
        updateEventsChart();
    };

    const originalGetRentalsReportQuery = window.getRentalsReportQuery;
    window.getRentalsReportQuery = function getRentalsReportQueryAdvanced() {
        const params = new URLSearchParams((originalGetRentalsReportQuery?.() || '/api/rentals-report').split('?')[1] || '');
        params.set('limit', document.getElementById('rentalsTopLimit')?.value || localStorage.getItem(RENTALS_TOP_LIMIT_KEY) || '5');
        params.set('sortOrder', document.getElementById('rentalsTopSortOrder')?.value || localStorage.getItem(RENTALS_TOP_SORT_KEY) || 'desc');
        return `/api/rentals-report?${params.toString()}`;
    };

    const originalGetEventsReportQuery = window.getEventsReportQuery;
    window.getEventsReportQuery = function getEventsReportQueryAdvanced() {
        const params = new URLSearchParams((originalGetEventsReportQuery?.() || '/api/events-report').split('?')[1] || '');
        params.set('limit', document.getElementById('eventsTopLimit')?.value || localStorage.getItem(EVENTS_TOP_LIMIT_KEY) || '10');
        params.set('sortOrder', document.getElementById('eventsTopSortOrder')?.value || localStorage.getItem(EVENTS_TOP_SORT_KEY) || 'desc');
        return `/api/events-report?${params.toString()}`;
    };

    const originalGetRentalsChartTitle = window.getRentalsChartTitle;
    window.getRentalsChartTitle = function getRentalsChartTitleAdvanced(type) {
        if (type === 'items') {
            const limit = document.getElementById('rentalsTopLimit')?.value || '5';
            return limit === 'all' ? 'Все арендуемые объекты' : `Топ-${limit} арендуемых объектов`;
        }
        return typeof originalGetRentalsChartTitle === 'function'
            ? originalGetRentalsChartTitle(type)
            : 'Отчёт по арендам';
    };

    const originalGetEventsChartTitle = window.getEventsChartTitle;
    window.getEventsChartTitle = function getEventsChartTitleAdvanced(type) {
        if (type === 'items') {
            const limit = document.getElementById('eventsTopLimit')?.value || '10';
            return limit === 'all' ? 'Все объекты по использованию' : `Топ-${limit} объектов по использованию`;
        }
        return typeof originalGetEventsChartTitle === 'function'
            ? originalGetEventsChartTitle(type)
            : 'Отчёт по мероприятиям';
    };

    const originalHandleRentalsReportTypeChange = window.handleRentalsReportTypeChange;
    window.handleRentalsReportTypeChange = function handleRentalsReportTypeChangeAdvanced() {
        applyStoredTopReportPreferences();
        if (typeof originalHandleRentalsReportTypeChange === 'function') {
            originalHandleRentalsReportTypeChange();
        }
        const visible = (document.getElementById('rentalsReportType')?.value || '') === 'items';
        const limitGroup = document.getElementById('rentalsTopLimitGroup');
        const sortGroup = document.getElementById('rentalsTopSortGroup');
        if (limitGroup) limitGroup.style.display = visible ? 'block' : 'none';
        if (sortGroup) sortGroup.style.display = visible ? 'block' : 'none';
    };

    const originalHandleEventsReportTypeChange = window.handleEventsReportTypeChange;
    window.handleEventsReportTypeChange = function handleEventsReportTypeChangeAdvanced() {
        applyStoredTopReportPreferences();
        if (typeof originalHandleEventsReportTypeChange === 'function') {
            originalHandleEventsReportTypeChange();
        }
        const visible = (document.getElementById('eventsReportType')?.value || '') === 'items';
        const limitGroup = document.getElementById('eventsTopLimitGroup');
        const sortGroup = document.getElementById('eventsTopSortGroup');
        if (limitGroup) limitGroup.style.display = visible ? 'block' : 'none';
        if (sortGroup) sortGroup.style.display = visible ? 'block' : 'none';
    };

    // ---------------------------------------------------------------------
    // Wrappers around data lifecycle
    // ---------------------------------------------------------------------

    const originalLoadData = window.loadData;
    window.loadData = async function loadDataAdvanced(...args) {
        const result = await originalLoadData.apply(this, args);
        populateInventoryLinkedSelectors();
        renderInventoryStatusReport();
        return result;
    };

    const originalRefreshAllData = window.refreshAllData;
    window.refreshAllData = async function refreshAllDataAdvanced(...args) {
        const result = await originalRefreshAllData.apply(this, args);
        populateInventoryLinkedSelectors();
        renderInventoryStatusReport();
        applyStoredTopReportPreferences();
        return result;
    };

    const originalRenderAll = window.renderAll;
    window.renderAll = function renderAllAdvanced(...args) {
        if (typeof originalRenderAll === 'function') {
            originalRenderAll.apply(this, args);
        }
        populateInventoryLinkedSelectors();
        renderInventoryStatusReport();
    };

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('ru-RU');
    }

    function launchWriteoffConfetti() {
        const layer = document.createElement('div');
        layer.className = 'confetti-layer';
        const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#ec4899'];

        for (let i = 0; i < 28; i += 1) {
            const dot = document.createElement('div');
            dot.className = 'confetti-dot';
            dot.style.left = `${Math.random() * 100}%`;
            dot.style.top = `${8 + Math.random() * 18}%`;
            dot.style.background = colors[i % colors.length];
            dot.style.animationDelay = `${Math.random() * 160}ms`;
            dot.style.transform = `rotate(${Math.random() * 360}deg)`;
            layer.appendChild(dot);
        }

        document.body.appendChild(layer);
        setTimeout(() => {
            layer.remove();
        }, 1200);
        showNotification('Списание выполнено. Готово!', 'success');
    }

    function buildTopAssetsHtml(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return '<p style="color:var(--muted-text);font-size:13px;">Данные по использованию отсутствуют</p>';
        }
        const max = Math.max(...items.map(entry => Number(entry.usage || 0)), 1);
        return `<ul class="top5-list">${items.map((entry, idx) => {
            const usage = Number(entry.usage || 0);
            const width = Math.max(4, Math.round((usage / max) * 100));
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
            return `<li class="top5-item">
                <span class="top5-name">${medal} ${html(entry.name)}</span>
                <span class="top5-count">${usage} раз</span>
                <div class="top5-bar-track"><div class="top5-bar-fill" style="width:${width}%"></div></div>
            </li>`;
        }).join('')}</ul>`;
    }

    function buildCriticalHtml(items) {
        const draft = getDraftPurchaseRequest();
        const draftLine = draft
            ? `<div class="critical-draft-line">📋 Активная заявка № ${html(draft.number || '—')} (${Array.isArray(draft.items) ? draft.items.length : 0} поз.) — статус: ${html(getPurchaseStatusLabel(draft.status))}</div>`
            : '<div class="critical-draft-line">📋 Активная заявка отсутствует</div>';

        if (!Array.isArray(items) || items.length === 0) {
            return `<p style="color:var(--state-success-500);font-size:13px;padding:8px 0;">✅ Критических остатков нет</p>${draftLine}`;
        }

        return `<ul class="critical-list">${items.slice(0, 8).map(entry => {
            const qty = Number(entry.quantity || 0);
            const min = Number(entry.minStock || 0);
            const pct = Number(entry.stockPercent || 0);
            const danger = pct <= 5;
            return `<li class="critical-item${danger ? ' critical-danger' : ''}">
                <div>
                    <div class="critical-name">${html(entry.name)}</div>
                    <div class="critical-qty">${qty} шт из мин. ${min} шт</div>
                    <div class="critical-next-step">Ниже минимальной нормы. Рекомендуется сформировать заявку на пополнение.</div>
                </div>
                <span class="critical-badge">${pct}%</span>
            </li>`;
        }).join('')}</ul>${draftLine}`;
    }

    function isActiveExpiredAsset(item) {
        const daysLeft = Number(item?.daysLeft ?? item?.days_left ?? 1);
        const qty = Number(item?.quantity ?? item?.totalQuantity ?? 0);
        const status = String(item?.status || '').trim().toLowerCase();
        const isWrittenOff = status.includes('списан');
        const isPendingWriteoff = status.includes('к списанию');
        return daysLeft <= 0 && qty > 0 && !isWrittenOff && !isPendingWriteoff;
    }

    function buildTodayFocusHtml(payload, criticalItems, forecast) {
        const pendingPurchase = Number(payload?.kpi?.pendingPurchase || 0);
        const pendingWriteoff = Number(payload?.pendingWriteoffDraft?.positions || 0);
        const expiredCount = Array.isArray(forecast?.assetExpiry)
            ? forecast.assetExpiry.filter(isActiveExpiredAsset).length
            : 0;
        const criticalCount = Array.isArray(criticalItems) ? criticalItems.length : 0;
        const cards = [
            {
                title: 'Просрочки',
                value: expiredCount,
                hint: expiredCount > 0 ? 'Есть объекты с истекшим сроком эксплуатации' : 'Просроченных объектов нет',
                action: `<button type="button" class="dashboard-action-btn" onclick="openDashboardWriteoffAction()">Перейти к списанию</button>`
            },
            {
                title: 'Дефицит',
                value: criticalCount,
                hint: criticalCount > 0 ? 'Есть позиции ниже минимальной нормы' : 'Критичного дефицита нет',
                action: `<button type="button" class="dashboard-action-btn" onclick="openDashboardDeficitAction()">Открыть дефицит</button>`
            },
            {
                title: 'Неподтвержденные заявки',
                value: pendingPurchase,
                hint: pendingPurchase > 0 ? 'Есть заявки на согласование/заказ' : 'Ожидающих заявок нет',
                action: `<button type="button" class="dashboard-action-btn" onclick="openDashboardRequestsAction()">Открыть заявки</button>`
            },
            {
                title: 'Неподписанные документы',
                value: pendingWriteoff,
                hint: pendingWriteoff > 0 ? 'Есть черновик акта списания к проведению' : 'Неподписанных документов нет',
                action: `<button type="button" class="dashboard-action-btn" onclick="openDashboardDocumentsAction()">Открыть документы</button>`
            }
        ];
        return `
            <h3>Что важно сегодня</h3>
            <div class="today-focus-grid">
                ${cards.map(card => `<article class="today-focus-card">
                    <div class="today-focus-title">${html(card.title)}</div>
                    <div class="today-focus-value">${html(card.value)}</div>
                    <div class="today-focus-hint">${html(card.hint)}</div>
                    ${card.action}
                </article>`).join('')}
            </div>
        `;
    }

    function buildForecastConsumablesHtml(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return '<p style="color:var(--muted-text);font-size:13px;padding:8px 0;">📭 Недостаточно данных для прогноза (нужно минимум 3 месяца истории списаний и мин. норма > 0)</p>';
        }
        const rows = items.slice(0, 6).map(entry => {
            const avg = Number(entry.avgMonthly || 0);
            const rec = Number(entry.recommendedOrder || 0);
            return `<li class="forecast-item">
                <div class="forecast-name">${html(entry.name)}</div>
                <div class="forecast-detail">Средний расход: <strong>${avg}</strong> шт/мес → <span class="forecast-rec-inline">заказ: <strong>${rec}</strong> шт</span></div>
            </li>`;
        }).join('');
        return `<ul class="forecast-list">${rows}</ul>
            <div class="dashboard-actions" style="margin-top:10px;">
                <button type="button" class="btn-accent" onclick="createAutoPurchaseFromCritical()">➕ Сформировать заявку</button>
            </div>`;
    }

    function buildAssetExpiryHtml(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return '<p style="color:var(--state-success-500);font-size:13px;padding:8px 0;">✅ Ближайших окончаний срока эксплуатации не найдено</p>';
        }
        return `<ul class="expiry-list">${items.slice(0, 8).map(entry => {
            const days = Number(entry.daysLeft ?? entry.days_left ?? 0);
            const endDate = entry.endDate || entry.end_date || '';
            const category = entry.category ? ` <span class="expiry-category">${html(entry.category)}</span>` : '';
            const cls = days <= 0 ? 'expiry-red' : days <= 30 ? 'expiry-red' : 'expiry-orange';
            const label = days <= 0 ? '⛔ Истёк!' : days === 1 ? '1 день' : `${days} дн.`;
            const dateLabel = endDate ? ` (до ${html(endDate)})` : '';
            const itemIdAttr = entry.id ? ` data-item-id="${entry.id}"` : '';
            return `<li class="expiry-item ${cls}">
                <span class="expiry-name">${html(entry.name)}${category}</span>
                <span class="expiry-months">${label}${dateLabel}</span>
                <button type="button" class="inline-action-btn" onclick="addAssetToWriteoffDraft(${entry.id || 0})"${itemIdAttr}>Списать</button>
                <button type="button" class="btn-extend-dashboard" onclick="if(typeof openExtendLifespanModal==='function')openExtendLifespanModal(${entry.id || 0})"${itemIdAttr}>Продлить</button>
            </li>`;
        }).join('')}</ul>`;
    }

    function buildDashboardActionCenter(payload, criticalItems) {
        const pendingDrafts = Number(payload?.pendingWriteoffDraft?.totals?.itemsCount || 0);
        const criticalCount = Array.isArray(criticalItems) ? criticalItems.length : 0;
        const canOpenDocuments = typeof canAccessPage === 'function' ? canAccessPage('documentsHub') : true;
        const canOpenRequests = typeof canAccessPage === 'function' ? canAccessPage('purchaseRequests') : true;
        const canOpenStock = typeof canAccessPage === 'function' ? canAccessPage('sklad') : true;
        const canOpenWriteoff = typeof canAccessPage === 'function' ? canAccessPage('writeoffActs') : true;
        const actions = [
            canOpenDocuments ? `<button type="button" class="dashboard-action-btn" onclick="openDashboardDocumentsAction()">Провести документы</button>` : '',
            canOpenRequests ? `<button type="button" class="dashboard-action-btn" onclick="openDashboardRequestsAction()">Согласовать заявки</button>` : '',
            canOpenStock ? `<button type="button" class="dashboard-action-btn" onclick="openDashboardDeficitAction()">Проверить дефицит (${criticalCount})</button>` : '',
            canOpenWriteoff ? `<button type="button" class="dashboard-action-btn" onclick="openDashboardWriteoffAction()">Списание (${pendingDrafts})</button>` : ''
        ].filter(Boolean);
        return `
            <h3>Быстрые действия</h3>
            <div class="dashboard-action-grid">
                ${actions.length ? actions.join('') : '<div class="empty-table-message">Нет доступных быстрых действий для текущей роли.</div>'}
            </div>
        `;
    }

    async function addAssetToWriteoffDraft(itemId) {
        const normalizedId = Number(itemId || 0);
        if (!normalizedId) {
            showNotification('Не удалось определить объект для списания', 'warning');
            return;
        }
        try {
            await apiFetch('/api/inventory/writeoff-acts/draft/add-item', {
                method: 'POST',
                body: JSON.stringify({
                    itemId: String(normalizedId),
                    quantity: 1,
                    reason: 'Истек срок эксплуатации',
                    reasonCategory: 'expiry',
                    basisType: 'item',
                    basisId: String(normalizedId),
                    basisLabel: 'Карточка объекта'
                })
            });
            showNotification('Объект добавлен в черновик акта списания', 'success');
            await loadWriteoffActs();
            await loadAccountingDashboard();
        } catch (error) {
            showNotification(error.message || 'Ошибка добавления в акт списания', 'error');
        }
    }

    function renderDashboardWriteoffChart(payload, mode = 'all', chartType = 'line') {
        const canvas = document.getElementById('dashboardWriteoffChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const theme = window.WarehouseDashboard?.getDashboardChartTheme?.() || {};
        const chartTickColor = theme.tick || '#eaf2ff';
        const chartGridColor = theme.grid || 'rgba(186, 206, 232, 0.24)';

        const rows = Array.isArray(payload?.writeoffDynamics) ? payload.writeoffDynamics : [];
        const labels = rows.map(entry => entry.month);
        let datasets;
        let title;
        if (mode === 'all') {
            title = 'Динамика списаний за 6 месяцев';
            datasets = [
                {
                    label: 'Все списания',
                    data: rows.map(e => Number(e.total || 0)),
                    borderColor: '#0f766e', backgroundColor: 'rgba(15,118,110,0.10)',
                    fill: true, tension: 0.35, pointRadius: 5, pointHoverRadius: 7
                },
                {
                    label: 'ОС',
                    data: rows.map(e => Number(e.asset || 0)),
                    borderColor: '#1d4ed8', backgroundColor: 'rgba(29,78,216,0.08)',
                    fill: false, tension: 0.35, pointRadius: 4, pointHoverRadius: 6,
                    borderDash: [5, 3]
                },
                {
                    label: 'Расходники',
                    data: rows.map(e => Number(e.consumable || 0)),
                    borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
                    fill: false, tension: 0.35, pointRadius: 4, pointHoverRadius: 6,
                    borderDash: [3, 3]
                }
            ];
        } else {
            const isAsset = mode === 'asset';
            title = isAsset ? 'Динамика списаний ОС (6 мес)' : 'Динамика списаний расходников (6 мес)';
            datasets = [{
                label: title,
                data: rows.map(e => Number(isAsset ? (e.asset || 0) : (e.consumable || 0))),
                borderColor: isAsset ? '#1d4ed8' : '#f59e0b',
                backgroundColor: isAsset ? 'rgba(29,78,216,0.12)' : 'rgba(245,158,11,0.12)',
                fill: true, tension: 0.35, pointRadius: 5, pointHoverRadius: 7
            }];
        }

        if (dashboardWriteoffChartInstance) {
            dashboardWriteoffChartInstance.destroy();
        }

        dashboardWriteoffChartInstance = new Chart(canvas.getContext('2d'), {
            type: chartType,
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: mode === 'all', position: 'top', labels: { color: chartTickColor } },
                    title: { display: true, text: title, font: { size: 13 }, color: chartTickColor }
                },
                scales: {
                    y: {
                        min: 0,
                        ticks: { precision: 0, color: chartTickColor },
                        grid: { color: chartGridColor, drawBorder: false }
                    },
                    x: { ticks: { color: chartTickColor }, grid: { display: false, drawBorder: false } }
                }
            }
        });
    }

    function renderWriteoffReasonsChart(payload, chartType = 'doughnut') {
        const canvas = document.getElementById('dashboardWriteoffReasonsChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const theme = window.WarehouseDashboard?.getDashboardChartTheme?.() || {};
        const chartTickColor = theme.tick || '#eaf2ff';
        const chartGridColor = theme.grid || 'rgba(186, 206, 232, 0.24)';
        const chartGridSoftColor = theme.gridSoft || 'rgba(186, 206, 232, 0.14)';

        const filterMode = canvas.dataset.filterMode || 'all';
        const allReasons = Array.isArray(payload?.reports?.writeoffReasons) ? payload.reports.writeoffReasons : [];
        const reasons = allReasons.map(r => ({
            reason: getWriteoffReasonCategoryReportLabel(r.reasonCategory || 'other'),
            qty: filterMode === 'asset' ? Number(r.assetQty || 0)
               : filterMode === 'consumable' ? Number(r.consumableQty || 0)
               : Number(r.quantity || 0)
        })).filter(r => r.qty > 0);

        if (dashboardReasonChartInstance) {
            dashboardReasonChartInstance.destroy();
        }

        if (!reasons.length) {
            dashboardReasonChartInstance = null;
            canvas.parentElement.innerHTML = '<p style="color:var(--muted-text);font-size:13px;padding:24px 0;text-align:center;">Нет данных о списаниях за 12 мес</p>';
            return;
        }

        const normalizedType = ['doughnut', 'pie', 'bar', 'line'].includes(chartType) ? chartType : 'doughnut';

        dashboardReasonChartInstance = new Chart(canvas.getContext('2d'), {
            type: normalizedType,
            data: {
                labels: reasons.map(r => r.reason),
                datasets: [{
                    data: reasons.map(r => r.qty),
                    backgroundColor: ['#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#3b82f6', '#6b7280'],
                    borderColor: normalizedType === 'line' ? '#1d4ed8' : undefined,
                    fill: normalizedType === 'line' ? false : undefined,
                    tension: normalizedType === 'line' ? 0.35 : undefined
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: chartTickColor }, display: normalizedType !== 'bar' && normalizedType !== 'line' },
                    tooltip: { callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.parsed} шт`
                    }},
                    title: { display: false }
                },
                scales: normalizedType === 'bar' || normalizedType === 'line'
                    ? {
                        y: { beginAtZero: true, ticks: { precision: 0, color: chartTickColor }, grid: { color: chartGridColor, drawBorder: false } },
                        x: { ticks: { autoSkip: false, color: chartTickColor }, grid: { color: chartGridSoftColor, drawBorder: false } }
                    }
                    : {}
            }
        });
    }

    function renderCategoryStockDynamicsChart(payload) {
        const canvas = document.getElementById('dashboardCategoryStockChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const css = getComputedStyle(document.documentElement);
        const accentColor = css.getPropertyValue('--color-accent-500').trim() || '#4f8cff';
        const successColor = css.getPropertyValue('--state-success-500').trim() || '#22c55e';
        const warningColor = css.getPropertyValue('--state-warning-500').trim() || '#f59e0b';
        const accentSoft = css.getPropertyValue('--color-accent-soft').trim() || 'rgba(79, 140, 255, 0.14)';
        const successSoft = css.getPropertyValue('--state-success-soft').trim() || 'rgba(34, 197, 94, 0.18)';
        const warningSoft = css.getPropertyValue('--state-warning-soft').trim() || 'rgba(245, 158, 11, 0.18)';
        const theme = window.WarehouseDashboard?.getDashboardChartTheme?.() || {};
        const chartTickColor = theme.tick || '#eaf2ff';
        const chartGridColor = theme.grid || 'rgba(186, 206, 232, 0.28)';

        const dynamics = payload?.reports?.categoryStockDynamics || {};
        const labels = Array.isArray(dynamics.months) ? dynamics.months : [];
        const furniture = Array.isArray(dynamics.furniture) ? dynamics.furniture : [];
        const exhibits = Array.isArray(dynamics.exhibits) ? dynamics.exhibits : [];
        const tools = Array.isArray(dynamics.tools) ? dynamics.tools : [];

        if (dashboardCategoryStockChartInstance) {
            dashboardCategoryStockChartInstance.destroy();
        }

        dashboardCategoryStockChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Мебель',
                        data: furniture,
                        borderColor: accentColor,
                        backgroundColor: accentSoft,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        fill: false
                    },
                    {
                        label: 'Экспонаты',
                        data: exhibits,
                        borderColor: successColor,
                        backgroundColor: successSoft,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        fill: false
                    },
                    {
                        label: 'Инструменты',
                        data: tools,
                        borderColor: warningColor,
                        backgroundColor: warningSoft,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: chartTickColor
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${Number(context.parsed?.y || 0).toLocaleString('ru-RU')} ед.`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { autoSkip: false, color: chartTickColor },
                        grid: { color: chartGridColor, drawBorder: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: chartTickColor },
                        grid: { color: chartGridColor, drawBorder: false }
                    }
                }
            }
        });
    }

    function buildUtilizationMiniHtml(rows) {
        const all = (rows || []);
        if (!all.length) return '<p style="color:var(--muted-text);font-size:13px;">Нет данных</p>';
        const top5 = all.slice(0, 5);
        return `<ul class="utilization-list">${top5.map(entry => {
            const pct = Number(entry.utilizationPercent || 0);
            const color = pct >= 70 ? 'var(--state-success-500)' : pct >= 30 ? 'var(--state-warning-500)' : 'var(--color-text-secondary)';
            return `<li class="utilization-item">
                <span class="util-name">${html(entry.name)}</span>
                <div class="util-bar-track"><div class="util-bar-fill" style="width:${Math.min(100, pct)}%;background:${color};"></div></div>
                <span class="util-pct">${pct}%</span>
            </li>`;
        }).join('')}</ul>`;
    }

    function buildCapacityHtml(capacity) {
        const total = Number(capacity?.totalQty ?? capacity?.totalPositions ?? 0);
        const occupied = Number(capacity?.occupiedQty ?? capacity?.occupiedPositions ?? 0);
        const free = Number(capacity?.freeQty ?? capacity?.freePositions ?? 0);
        const occupiedItems = Number(capacity?.occupiedItems ?? 0);
        const freeItems = Number(capacity?.freeItems ?? 0);
        const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
        const color = pct >= 80 ? 'var(--state-danger-500)' : pct >= 50 ? 'var(--state-warning-500)' : 'var(--state-success-500)';
        return `
            <div class="capacity-bar-wrap">
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill" style="width:${pct}%;background:${color};"></div>
                </div>
                <span class="capacity-percent" style="color:${color};">${pct}%</span>
            </div>
            <div class="capacity-stats">
                <span>🔴 Занято: <strong>${occupied}</strong> ед. (${occupiedItems} наим.)</span>
                <span>🟢 Свободно: <strong>${free}</strong> ед. (${freeItems} наим.)</span>
                <span style="color:var(--muted-text)">Всего: <strong>${total}</strong> ед.</span>
            </div>
        `;
    }

    function buildRecentActivityHtml() {
        let items = [];
        try {
            const raw = JSON.parse(localStorage.getItem('warehouse_ui_notifications_v1') || '[]');
            items = Array.isArray(raw) ? raw : [];
        } catch {
            items = [];
        }
        const rows = items.slice(0, 6);
        if (!rows.length) {
            return '<div class="empty-table-message">Лента изменений пока пустая.</div>';
        }
        const toRuFeedText = (value) => {
            const raw = String(value || '').trim();
            const lower = raw.toLowerCase();
            if (lower === 'failed to fetch') return 'Ошибка сети: не удалось получить данные';
            if (lower.includes('network') && lower.includes('error')) return 'Сетевая ошибка при обмене с сервером';
            if (lower.includes('timeout')) return 'Превышено время ожидания ответа сервера';
            return raw;
        };

        return `<ul class="activity-feed-list">${rows.map(item => `
            <li>
                <strong>${html(toRuFeedText(String(item.text || '')).slice(0, 84))}</strong>
                <span>${html(formatDateTime(item.createdAt, ''))}</span>
            </li>
        `).join('')}</ul>`;
    }

    async function createAutoPurchaseFromCritical() {
        try {
            const threshold = Number(document.getElementById('criticalThresholdInput')?.value || 100);
            const draft = await updateDraftPurchaseRequest({
                forceCreate: true,
                thresholdPercent: threshold,
                alignWithCritical: true
            });
            showNotification(`Черновик заявки ${draft?.number || ''} обновлен`, 'success');
            await loadPurchaseRequests();
            await loadAccountingDashboard();
            if (typeof showPage === 'function') showPage('purchaseRequests');
            if (draft?.number) openPurchaseRequestDocument(draft.number);
        } catch (error) {
            showNotification(error.message || 'Ошибка формирования автозакупки', 'error');
        }
    }

    function downloadDashboardChartPng() {
        const canvas = document.getElementById('dashboardWriteoffChart');
        if (!canvas) return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `списания_динамика_${new Date().toISOString().slice(0, 10)}.png`;
        link.click();
    }

    async function exportDashboardAnalyticsExcel() {
        try {
            await downloadExcelFile('/api/inventory/analytics-export.xlsx');
            showNotification('Excel-отчёт с аналитикой выгружен', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка экспорта Excel', 'error');
        }
    }

    const originalOpenItemCard = window.openItemCard;
    window.openItemCard = function openItemCardAdvanced(item) {
        if (typeof originalOpenItemCard === 'function') {
            originalOpenItemCard(item);
        }
    };

    function scheduleDashboardLoad(options = {}) {
        const force = options.force === true;
        const now = Date.now();
        if (!force && dashboardLoadInFlight) return;
        if (!force && now - dashboardLastLoadedAt < 10000) return;
        if (dashboardLoadTimerId) {
            clearTimeout(dashboardLoadTimerId);
        }
        dashboardLoadTimerId = setTimeout(() => {
            dashboardLoadTimerId = null;
            loadAccountingDashboard();
        }, 30);
    }

    async function loadAccountingDashboard() {
        const container = document.getElementById('accountingWidgets');
        if (!container) return;
        if (dashboardLoadInFlight) return;
        dashboardLoadInFlight = true;

        try {
            const threshold = Number(document.getElementById('criticalThresholdInput')?.value || 100);
            const payload = await apiFetch(`/api/inventory/accounting-dashboard?thresholdPercent=${threshold}`);
            const kpi = payload?.kpi || {};
            // Важно: критичность считаем локально из актуального inventory,
            // чтобы после офлайн-поставки/локального обновления виджет не показывал устаревшие API-значения.
            const critical = getLowStockConsumables(threshold).map(item => ({
                id: item.id,
                name: item.name,
                quantity: Number(item.stock || 0),
                minStock: Number(item.minNorm || 0),
                stockPercent: Number(item.ratio || 0)
            }));
            const topAssets = payload?.assets?.topUsed || [];
            const forecast = payload?.forecast || {};
            const reports = payload?.reports || {};
            const todayFocus = document.getElementById('todayFocusBlock');
            const actionCenter = document.getElementById('dashboardActionCenter');
            if (todayFocus) {
                todayFocus.innerHTML = buildTodayFocusHtml(payload, critical, forecast);
                todayFocus.style.display = 'block';
            }
            if (actionCenter) {
                actionCenter.innerHTML = buildDashboardActionCenter(payload, critical);
                actionCenter.style.display = 'block';
            }

            await updateDraftPurchaseRequest({
                thresholdPercent: Number(payload?.settings?.thresholdPercent || 100)
            });

            container.innerHTML = `
                <section class="dashboard-hero">
                    <div>
                        <div class="dash-hero-date">📅 ${html(payload?.dateLabel || '')}</div>
                        <div class="dash-hero-greet">👋 Здравствуйте, ${html(payload?.userName || 'Пользователь')}!</div>
                        <div class="dash-hero-sub">Склад работает в штатном режиме</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                        <div class="dash-hero-badge">🟢 Система активна</div>
                        <div style="display:flex;gap:6px;">
                            <button type="button" id="dashboardReloadAllBtn">🔄 Обновить всё</button>
                            <button type="button" id="dashboardPdfBtn">📄 Экспорт PDF</button>
                        </div>
                    </div>
                </section>

                <section class="dashboard-kpi-grid">
                    <article class="kpi-card kpi-card--total">
                        <span class="kpi-icon">📦</span>
                        <div class="kpi-value">${Number(kpi.totalQuantity || 0).toLocaleString('ru-RU')}</div>
                        <div class="kpi-caption">Всего единиц на складе</div>
                        <div class="kpi-trend kpi-trend--up">↗ за месяц</div>
                    </article>
                    <article class="kpi-card kpi-card--assets">
                        <span class="kpi-icon">🏗️</span>
                        <div class="kpi-value">${Number(kpi.assetQuantity || 0).toLocaleString('ru-RU')}</div>
                        <div class="kpi-caption">Основные средства</div>
                        <div class="kpi-trend">ОС — возвращаются</div>
                    </article>
                    <article class="kpi-card kpi-card--consumables">
                        <span class="kpi-icon">⚡</span>
                        <div class="kpi-value">${Number(kpi.consumableQuantity || 0).toLocaleString('ru-RU')}</div>
                        <div class="kpi-caption">Расходные материалы</div>
                        <div class="kpi-trend">РМ — списываются</div>
                    </article>
                </section>

                <section class="dashboard-2col">
                    <article class="dashboard-panel">
                        <h3>📊 Топ-5 самых используемых объектов (ОС)</h3>
                        ${buildTopAssetsHtml(topAssets)}
                    </article>
                    <article class="dashboard-panel">
                        <h3>⚠️ Заканчиваются (расходники)</h3>
                        <div class="critical-threshold-row">
                            <label for="criticalThresholdInput">Порог критичности:</label>
                            <input id="criticalThresholdInput" type="number" min="1" max="100" value="${Number(payload?.settings?.thresholdPercent || 100)}" />
                            <span style="color:var(--muted-text)">% от мин. нормы (100 = все ниже нормы)</span>
                        </div>
                        ${buildCriticalHtml(critical)}
                        <div class="dashboard-actions">
                            <button type="button" id="dashboardReloadCriticalBtn">🔄 Обновить порог</button>
                            <button type="button" id="dashboardAutoPurchaseBtn" class="btn-accent">➕ Сформировать заявку</button>
                        </div>
                    </article>
                </section>

                <section class="writeoff-chart-wrap">
                    <h3>📈 Динамика списаний за последние 6 месяцев</h3>
                    <div class="dashboard-actions" style="margin-bottom:14px;">
                        <button type="button" class="dashboard-writeoff-filter active" data-mode="all">Все</button>
                        <button type="button" class="dashboard-writeoff-filter" data-mode="asset">🏗️ ОС</button>
                        <button type="button" class="dashboard-writeoff-filter" data-mode="consumable">⚡ РМ</button>
                        <select id="dashboardChartType" style="margin-left:10px;">
                            <option value="bar">Столбчатая</option>
                            <option value="line">Линейная</option>
                        </select>
                    </div>
                    <div style="height:260px;"><canvas id="dashboardWriteoffChart"></canvas></div>
                </section>

                <section class="dashboard-panel">
                    <h3>⚠️ Ожидает списания</h3>
                    ${buildPendingWriteoffDraftHtml(payload?.pendingWriteoffDraft)}
                </section>

                <section class="dashboard-extended-reports">
                    <h3>📚 Расширенные отчёты</h3>
                    <div class="reports-grid">
                        <article class="report-mini-card">
                            <h4>📊 Динамика остатков по категориям</h4>
                            <div style="height:220px;"><canvas id="dashboardCategoryStockChart"></canvas></div>
                        </article>
                        <article class="report-mini-card">
                            <h4>🥧 Списания по причинам</h4>
                            <div class="dashboard-actions" style="margin-bottom:6px;">
                                <button type="button" class="dashboard-reasons-filter active" data-mode="all">Все</button>
                                <button type="button" class="dashboard-reasons-filter" data-mode="asset">🏗️ ОС</button>
                                <button type="button" class="dashboard-reasons-filter" data-mode="consumable">⚡ РМ</button>
                                <select id="dashboardReasonsChartType" style="margin-left:10px;">
                                    <option value="doughnut">Кольцевая</option>
                                    <option value="pie">Круговая</option>
                                    <option value="bar">Столбчатая</option>
                                    <option value="line">Линейная</option>
                                </select>
                            </div>
                            <div style="height:200px;"><canvas id="dashboardWriteoffReasonsChart"></canvas></div>
                        </article>
                        <article class="report-mini-card">
                            <h4>📈 Эффективность использования ОС</h4>
                            ${buildUtilizationMiniHtml(reports?.assetUtilization || [])}
                        </article>
                        <article class="report-mini-card">
                            <h4>🏭 Загрузка склада</h4>
                            ${buildCapacityHtml(reports?.warehouseCapacity || {})}
                        </article>
                        <article class="report-mini-card">
                            <h4>🧾 Лента изменений</h4>
                            ${buildRecentActivityHtml()}
                        </article>
                    </div>
                </section>
            `;

            renderDashboardWriteoffChart(payload, 'all');
            const reasonsChartType = document.getElementById('dashboardReasonsChartType')?.value || 'doughnut';
            renderWriteoffReasonsChart(payload, reasonsChartType);
            renderCategoryStockDynamicsChart(payload);

            // Event listeners
            const chartTypeSelect = document.getElementById('dashboardChartType');
            if (chartTypeSelect) {
                chartTypeSelect.addEventListener('change', () => {
                    const currentMode = document.querySelector('.dashboard-writeoff-filter.active')?.dataset.mode || 'all';
                    renderDashboardWriteoffChart(payload, currentMode, chartTypeSelect.value);
                });
            }

            // Toast for expired assets
            const expiredAssets = (forecast?.assetExpiry || []).filter(isActiveExpiredAsset);
            const expiredCount = expiredAssets.length;
            if (expiredCount > 0) {
                const names = expiredAssets
                    .map(item => String(item?.name || '').trim())
                    .filter(Boolean)
                    .slice(0, 4);
                const details = names.length
                    ? `Просроченные объекты: ${names.join(', ')}${expiredCount > names.length ? ' ...' : ''}`
                    : '';
                showNotification(`У ${expiredCount} объект${expiredCount === 1 ? 'а' : 'ов'} истёк срок эксплуатации. Рекомендуется провести списание.`, 'warning', {
                    key: 'expired-assets-warning',
                    category: 'inventory-expiry',
                    details,
                    actionPage: 'sklad',
                    actionLabel: 'Открыть Склад'
                });
            }

            const writeoffFilterButtons = container.querySelectorAll('.dashboard-writeoff-filter');
            writeoffFilterButtons.forEach(button => {
                button.addEventListener('click', () => {
                    writeoffFilterButtons.forEach(b => b.classList.remove('active'));
                    button.classList.add('active');
                    const chartType = document.getElementById('dashboardChartType')?.value || 'line';
                    renderDashboardWriteoffChart(payload, button.dataset.mode || 'all', chartType);
                });
            });

            document.getElementById('dashboardReloadCriticalBtn')?.addEventListener('click', async () => {
                await loadAccountingDashboard();
            });
            const reasonsFilterBtns = container.querySelectorAll('.dashboard-reasons-filter');
            reasonsFilterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    reasonsFilterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const canvas = document.getElementById('dashboardWriteoffReasonsChart');
                    if (canvas) canvas.dataset.filterMode = btn.dataset.mode || 'all';
                    const type = document.getElementById('dashboardReasonsChartType')?.value || 'doughnut';
                    renderWriteoffReasonsChart(payload, type);
                });
            });
            document.getElementById('dashboardReasonsChartType')?.addEventListener('change', () => {
                const type = document.getElementById('dashboardReasonsChartType')?.value || 'doughnut';
                renderWriteoffReasonsChart(payload, type);
            });

            document.getElementById('dashboardReloadAllBtn')?.addEventListener('click', async () => {
                await loadAccountingDashboard();
            });
            document.getElementById('dashboardPdfBtn')?.addEventListener('click', () => window.print());
            document.getElementById('dashboardAutoPurchaseBtn')?.addEventListener('click', createAutoPurchaseFromCritical);
            document.getElementById('dashboardWriteoffPngBtn')?.addEventListener('click', downloadDashboardChartPng);
            document.getElementById('dashboardAnalyticsExcelBtn')?.addEventListener('click', exportDashboardAnalyticsExcel);

            const candidates = Array.isArray(payload?.writeoffCandidates) ? payload.writeoffCandidates : [];
            container.querySelectorAll('.writeoff-candidate-open').forEach(button => {
                button.addEventListener('click', async () => {
                    const id = String(button.dataset.id || '').trim();
                    if (!id) return;
                    if (typeof showPage === 'function') showPage('sklad');
                    if (typeof loadData === 'function') {
                        await loadData();
                    }
                    if (typeof findInventoryItem === 'function' && typeof openItemCard === 'function') {
                        const item = findInventoryItem(id);
                        if (item) openItemCard(item);
                    }
                });
            });

            container.querySelectorAll('.writeoff-candidate-add').forEach(button => {
                button.addEventListener('click', async () => {
                    const id = String(button.dataset.id || '').trim();
                    const candidate = candidates.find(row => String(row?.id || '') === id);
                    if (!candidate) return;
                    try {
                        await addWriteoffCandidateToDraft(candidate);
                        showNotification(`Позиция «${candidate.name || candidate.id}» добавлена в черновик`, 'success');
                        await loadAccountingDashboard();
                    } catch (error) {
                        showNotification(error.message || 'Не удалось добавить позицию в черновик', 'error');
                    }
                });
            });

            document.getElementById('dashboardWriteoffCandidatesAddAll')?.addEventListener('click', async () => {
                if (!candidates.length) {
                    showNotification('Нет кандидатов для добавления', 'info');
                    return;
                }

                let added = 0;
                for (const candidate of candidates) {
                    try {
                        await addWriteoffCandidateToDraft(candidate);
                        added += 1;
                    } catch (error) {
                        console.warn('Не удалось добавить кандидата к списанию:', candidate?.id, error);
                    }
                }

                showNotification(`Добавлено в черновик: ${added} из ${candidates.length}`, added > 0 ? 'success' : 'warning');
                await loadAccountingDashboard();
            });


            dashboardLastLoadedAt = Date.now();
        } catch (error) {
            container.innerHTML = `<article class="accounting-widget loading">Ошибка загрузки дашборда: ${html(error.message || 'неизвестная ошибка')}</article>`;
        } finally {
            dashboardLoadInFlight = false;
        }
    }

    async function loadPurchaseRequests() {
        const tbody = document.getElementById('purchaseRequestsTableBody');
        if (!tbody) return;

        try {
            const rows = await apiFetch('/api/inventory/purchase-requests');
            if (!Array.isArray(rows) || rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-table-message">Заявки на закупку отсутствуют</td></tr>';
                return;
            }

            tbody.innerHTML = rows.map(row => {
                const currentStatus = String(row.status || 'Черновик');
                const statusOptions = ['Черновик', 'Согласована', 'Заказана', 'Поставлена', 'Отменена']
                    .map(status => `<option value="${status}" ${status === currentStatus ? 'selected' : ''}>${status}</option>`)
                    .join('');

                const sourceLabel = row.source_type && row.source_id
                    ? `${html(row.source_type)} #${html(row.source_id)}`
                    : '—';

                return `
                    <tr>
                        <td>${html(row.request_number)}</td>
                        <td>${html(formatDateTimeSafe(row.created_at, '—'))}</td>
                        <td>${html(row.item_name || row.item_id || 'Не указан')}</td>
                        <td>${Number(row.quantity || 0)}</td>
                        <td>
                            <select class="purchase-request-status" data-id="${Number(row.id)}">${statusOptions}</select>
                        </td>
                        <td>${sourceLabel}</td>
                        <td><button type="button" class="inline-action-btn purchase-request-save" data-id="${Number(row.id)}">Сохранить</button></td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.purchase-request-save').forEach(button => {
                button.addEventListener('click', async () => {
                    const requestId = Number(button.dataset.id);
                    const select = tbody.querySelector(`.purchase-request-status[data-id="${requestId}"]`);
                    const status = select?.value || 'Черновик';

                    try {
                        await apiFetch(`/api/inventory/purchase-requests/${requestId}/status`, {
                            method: 'PUT',
                            body: JSON.stringify({ status })
                        });
                        showNotification('Статус заявки обновлён', 'success');
                        await loadPurchaseRequests();
                        await loadAccountingDashboard();
                    } catch (error) {
                        showNotification(error.message || 'Ошибка обновления статуса заявки', 'error');
                    }
                });
            });
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-table-message">Ошибка загрузки заявок: ${html(error.message || 'неизвестная ошибка')}</td></tr>`;
        }
    }

    const DOCUMENTS_REGISTRY_STORAGE_KEY = 'warehouse_documents_registry_v1';

    let writeoffActsCache = [];
    let selectedWriteoffAct = null;
    let writeoffActEditMode = false;
    let selectedDocumentCard = null;
    let documentCardEditMode = false;

    function readDocumentsRegistry() {
        const data = readJsonStorage(DOCUMENTS_REGISTRY_STORAGE_KEY, []);
        return Array.isArray(data) ? data : [];
    }

    function writeDocumentsRegistry(rows) {
        writeJsonStorage(DOCUMENTS_REGISTRY_STORAGE_KEY, Array.isArray(rows) ? rows : []);
    }

    function normalizeDocType(type) {
        const value = String(type || '').trim().toLowerCase();
        if (value === 'issuance') return 'issuance';
        if (value === 'transfer') return 'transfer';
        if (value === 'acceptance') return 'acceptance';
        if (value === 'writeoff') return 'writeoff';
        if (value === 'purchase_act' || value === 'purchase-act' || value === 'act_purchase') return 'purchase_act';
        if (value === 'purchase_request' || value === 'purchase-request' || value === 'purchase') return 'purchase_request';
        return 'issuance';
    }

    function getDocTypeLabel(type) {
        switch (normalizeDocType(type)) {
            case 'transfer': return 'Акт передачи';
            case 'acceptance': return 'Акт приемки';
            case 'writeoff': return 'Акт списания';
            case 'purchase_act': return 'Акт закупки';
            case 'purchase_request': return 'Заявка на закупку';
            default: return 'Акт выдачи';
        }
    }

    function normalizeDocumentDisplayStatus(status) {
        const normalized = String(restoreText(status || '')).trim().toLowerCase().replace(/ё/g, 'е');
        if (!normalized) return 'Черновик';
        if (['проведен', 'поставлено', 'поставлен', 'получен', 'получено', 'posted', 'delivered', 'completed'].includes(normalized)) return 'Проведен';
        if (['отменен', 'отменено', 'cancelled', 'rejected'].includes(normalized)) return 'Отменен';
        if (['частично', 'частично поставлено', 'частично получен', 'частично получено', 'partial'].includes(normalized)) return 'Частично';
        return 'Черновик';
    }

    function getStatusBadgeClass(status) {
        const normalized = String(restoreText(status || '')).trim().toLowerCase().replace(/ё/g, 'е');
        switch (normalized) {
            case 'проведен':
            case 'поставлено':
            case 'поставлен':
            case 'получен':
            case 'получено':
            case 'posted':
            case 'delivered':
            case 'completed':
                return 'doc-status doc-status-posted';
            case 'отменен':
            case 'отменено':
            case 'cancelled':
            case 'rejected':
                return 'doc-status doc-status-cancelled';
            case 'частично':
            case 'частично поставлено':
            case 'частично получен':
            case 'частично получено':
            case 'partial':
                return 'doc-status doc-status-partial';
            default:
                return 'doc-status doc-status-draft';
        }
    }

    function isAcceptancePartial(doc) {
        if (normalizeDocType(doc?.docType) !== 'acceptance') return false;
        const items = Array.isArray(doc?.items) ? doc.items : [];
        return items.some(item => {
            const status = String(item.returnStatus || item.return_status || '').toLowerCase();
            const condition = String(item.actualCondition || item.actual_condition || '').toLowerCase();
            return status.includes('не возвращ') || condition.includes('утрач');
        });
    }

    function computeAcceptanceReturnedText(doc) {
        const items = Array.isArray(doc?.items) ? doc.items : [];
        const total = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const notReturned = items.reduce((sum, item) => {
            const status = String(item.returnStatus || item.return_status || '').toLowerCase();
            const condition = String(item.actualCondition || item.actual_condition || '').toLowerCase();
            const missed = status.includes('не возвращ') || condition.includes('утрач');
            return sum + (missed ? Number(item.quantity || 0) : 0);
        }, 0);
        return `${Math.max(total - notReturned, 0)} из ${total}`;
    }

    function evaluateDocumentConditions(docType, entity, items = []) {
        const errors = [];
        if (!entity) errors.push('Отсутствует основание документа');
        if (!Array.isArray(items) || items.length === 0) errors.push('Пустой список позиций');

        const hasInvalidQuantity = (items || []).some(item => Number(item.quantity || 0) <= 0);
        if (hasInvalidQuantity) errors.push('Есть позиции с некорректным количеством');

        let status = errors.length ? 'Черновик' : 'Проведен';
        if (docType === 'acceptance' && !errors.length && isAcceptancePartial({ docType, items })) {
            status = 'Частично';
        }

        return { status, errors };
    }

    function upsertDocumentRecord(record) {
        const list = readDocumentsRegistry();
        const docType = normalizeDocType(record.docType);
        const basisId = record?.entity?.id || record?.basisId;
        const basisType = String(record.basisType || '').trim();

        // Ищем существующий документ по типу документа, основанию и его ID
        // Это предотвращает дублирование документов для одного основания
        const index = list.findIndex(item => 
            normalizeDocType(item.docType) === docType &&
            (item?.entity?.id || item?.basisId) === basisId &&
            String(item.basisType || '').trim() === basisType
        );

        const next = {
            ...record,
            docType: docType,
            createdAt: record.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (index >= 0) {
            // Обновляем существующий документ, но сохраняем исходный номер если он был
            const existing = list[index];
            list[index] = { 
                ...existing,
                ...next,
                number: existing.number || next.number, // Сохраняем исходный номер
                createdAt: existing.createdAt // Сохраняем исходное время создания
            };
        } else {
            list.push(next);
        }

        writeDocumentsRegistry(list);
        return next;
    }

    function getDocumentsByType(docType) {
        const type = normalizeDocType(docType);
        return readDocumentsRegistry()
            .filter(doc => normalizeDocType(doc.docType) === type)
            .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
    }

    function applyDocumentFilters(rows, options = {}) {
        const dateFrom = String(options.dateFrom || '').trim();
        const dateTo = String(options.dateTo || '').trim();
        const basisType = String(options.basisType || '').trim();
        const counterparty = String(options.counterparty || '').toLowerCase().trim();

        return (rows || []).filter(row => {
            const date = parseDateSafe(row.date || row.createdAt);
            const matchesFrom = !dateFrom || (date && date >= new Date(`${dateFrom}T00:00:00`));
            const matchesTo = !dateTo || (date && date <= new Date(`${dateTo}T23:59:59`));
            const matchesBasis = !basisType || String(row.basisType || '') === basisType;
            const matchesCounterparty = !counterparty || String(row.counterparty || '').toLowerCase().includes(counterparty);
            return matchesFrom && matchesTo && matchesBasis && matchesCounterparty;
        });
    }

    function renderDocumentActionsCell(doc, isWriteoff = false) {
        const number = html(String(restoreText(doc.number || '')).replace(/'/g, '&#39;'));
        const normalizedStatus = restoreText(doc.status || '');
        const conductDisabled = normalizedStatus === 'Проведен' || isWriteoff;
        const cancelDisabled = normalizedStatus === 'Отменен' || isWriteoff;
        const canDelete = !isWriteoff && normalizedStatus === 'Отменен';
        const showBasisAction = canNavigateToDocumentBasis(doc);

        return `
            <button type="button" class="inline-action-btn" onclick="openDocumentCardByNumber('${number}')">Открыть</button>
            ${showBasisAction ? `<button type="button" class="inline-action-btn" onclick="goToDocumentBasisByNumber('${number}')" title="Перейти к основанию">↗</button>` : ''}
            <button type="button" class="inline-action-btn" onclick="downloadDocumentPdfByNumber('${number}')">PDF</button>
            <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${number}', 'Проведен')" ${conductDisabled ? 'disabled' : ''}>Провести</button>
            <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${number}', 'Отменен')" ${cancelDisabled ? 'disabled' : ''}>Отменить</button>
            ${canDelete ? `<button type="button" class="inline-action-btn" onclick="deleteDocumentByNumber('${number}')">Удалить</button>` : ''}
        `;
    }

    function renderTypedDocumentsTable(tbodyId, docType) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        const prefix = normalizeDocType(docType);
        const isIssuanceOrTransfer = prefix === 'issuance' || prefix === 'transfer';
        const filters = {
            dateFrom: document.getElementById(`${prefix}DateFromFilter`)?.value || '',
            dateTo: document.getElementById(`${prefix}DateToFilter`)?.value || '',
            basisType: isIssuanceOrTransfer ? '' : (document.getElementById(`${prefix}BasisFilter`)?.value || ''),
            counterparty: document.getElementById(`${prefix}CounterpartyFilter`)?.value || ''
        };

        const rows = applyDocumentFilters(getDocumentsByType(docType), filters);
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-table-message">Документы не найдены</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(doc => {
            const docNumber = html(String(doc.number || '').replace(/'/g, '&#39;'));
            if (normalizeDocType(docType) === 'acceptance') {
                return `
                    <tr ondblclick="openDocumentCardByNumber('${docNumber}')" class="document-row-interactive ${String(restoreText(doc.status || '')).trim() === 'Отменен' ? 'document-row-cancelled' : ''}">
                        <td>${html(restoreText(doc.number || '—'))}</td>
                        <td>${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</td>
                        <td>${html(restoreText(doc.basisLabel || '—'))}</td>
                        <td>${html(restoreText(doc.counterparty || '—'))}</td>
                        <td>${html(computeAcceptanceReturnedText(doc))}</td>
                        <td><span class="${getStatusBadgeClass(restoreText(doc.status))}">${html(restoreText(doc.status || 'Черновик'))}</span></td>
                        <td>${renderDocumentActionsCell(doc)}</td>
                    </tr>
                `;
            }

            return `
                <tr ondblclick="openDocumentCardByNumber('${docNumber}')" class="document-row-interactive ${String(restoreText(doc.status || '')).trim() === 'Отменен' ? 'document-row-cancelled' : ''}">
                    <td>${html(restoreText(doc.number || '—'))}</td>
                    <td>${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</td>
                    <td>${html(restoreText(doc.basisLabel || '—'))}</td>
                    <td>${html(restoreText(doc.counterparty || '—'))}</td>
                    <td>${Number(doc.amount || 0).toLocaleString('ru-RU')} ₽</td>
                    <td><span class="${getStatusBadgeClass(restoreText(doc.status))}">${html(restoreText(doc.status || 'Черновик'))}</span></td>
                    <td>${renderDocumentActionsCell(doc)}</td>
                </tr>
            `;
        }).join('');
    }

    function buildUnifiedDocumentsRows() {
        const localDocs = readDocumentsRegistry().map(doc => ({
            kind: 'local',
            docType: normalizeDocType(restoreText(doc.docType)),
            number: restoreText(doc.number),
            date: doc.date || doc.createdAt,
            basisLabel: restoreText(doc.basisLabel || ''),
            basisType: restoreText(doc.basisType || ''),
            basisId: doc?.entity?.id || null,
            entity: doc.entity || null,
            counterparty: restoreText(doc.counterparty || ''),
            amount: Number(doc.amount || 0),
            status: restoreText(doc.status || 'Черновик')
        }));

        const writeoffDocs = writeoffActsCache.map(act => ({
            kind: 'writeoff',
            docType: 'writeoff',
            number: act.number,
            date: act.date || act.createdAt,
            basisLabel: formatWriteoffBasisLabel(act.basis || {}),
            basisType: act?.basis?.type || '',
            basisId: act?.basis?.id || null,
            entity: null,
            counterparty: act?.basis?.name || '',
            amount: 0,
            status: 'Проведен'
        }));

        const purchaseActDocs = readPurchaseActDocuments().map(doc => ({
            kind: 'purchase_act',
            docType: 'purchase_act',
            number: restoreText(doc.number),
            date: doc.date || doc.createdAt,
            basisLabel: restoreText(doc.basisLabel || `Заявка ${doc.basisId || '—'}`),
            basisType: 'purchase_request',
            basisId: doc.basisId || null,
            entity: null,
            counterparty: restoreText(doc.counterparty || ''),
            amount: 0,
            status: restoreText(doc.status || 'Проведен')
        }));

        return [...localDocs, ...writeoffDocs, ...purchaseActDocs]
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }

    function applyDocumentsHubFilters(rows) {
        const type = String(document.getElementById('documentsHubTypeFilter')?.value || '').trim();
        const dateFrom = String(document.getElementById('documentsHubDateFromFilter')?.value || '').trim();
        const dateTo = String(document.getElementById('documentsHubDateToFilter')?.value || '').trim();
        const query = String(document.getElementById('documentsHubSearchFilter')?.value || '').toLowerCase().trim();

        return (rows || []).filter(row => {
            const rowDate = parseDateSafe(row.date || row.createdAt);
            const matchesType = !type || String(row.docType || '') === type;
            const matchesFrom = !dateFrom || (rowDate && rowDate >= new Date(`${dateFrom}T00:00:00`));
            const matchesTo = !dateTo || (rowDate && rowDate <= new Date(`${dateTo}T23:59:59`));

            if (!query) {
                return matchesType && matchesFrom && matchesTo;
            }

            const searchableText = [
                row.number || '',
                row.basisLabel || '',
                getDocTypeLabel(row.docType) || '',
                row.status || ''
            ].join(' ').toLowerCase();

            return matchesType && matchesFrom && matchesTo && searchableText.includes(query);
        });
    }

    function renderDocumentsHubSummary(rows) {
        const cards = document.getElementById('documentsHubSummaryCards');
        const typesPanel = document.getElementById('documentsHubTypesSummary');
        const statusesPanel = document.getElementById('documentsHubStatusesSummary');
        if (!cards || !typesPanel || !statusesPanel) return;

        const total = rows.length;
        const uniqueBases = new Set(rows.map(row => String(row.basisLabel || '').trim()).filter(Boolean)).size;
        const latestRow = rows[0] || null;
        const latestDate = latestRow ? formatDateTimeSafe(latestRow.date || latestRow.createdAt, '—') : '—';
        const avgPerBasis = uniqueBases ? (total / uniqueBases).toFixed(1).replace('.', ',') : '0';

        cards.innerHTML = `
            <div class="calendar-summary-card documents-hub-summary-card documents-hub-summary-total">
                <div class="documents-hub-summary-head">
                    <strong>Документов</strong>
                    <span class="documents-hub-summary-chip">Всего</span>
                </div>
                <span class="documents-hub-summary-value">${total}</span>
                <span class="documents-hub-summary-note">по текущим фильтрам</span>
            </div>
            <div class="calendar-summary-card documents-hub-summary-card documents-hub-summary-bases">
                <div class="documents-hub-summary-head">
                    <strong>Оснований</strong>
                    <span class="documents-hub-summary-chip">Уникальные</span>
                </div>
                <span class="documents-hub-summary-value">${uniqueBases}</span>
                <span class="documents-hub-summary-note">в среднем ${avgPerBasis} док./основание</span>
            </div>
            <div class="calendar-summary-card documents-hub-summary-card documents-hub-summary-latest">
                <div class="documents-hub-summary-head">
                    <strong>Последний документ</strong>
                    <span class="documents-hub-summary-chip">Обновление</span>
                </div>
                <span class="documents-hub-summary-value documents-hub-summary-date">${html(latestDate)}</span>
                <span class="documents-hub-summary-note">дата последней операции</span>
            </div>
        `;

        if (!rows.length) {
            typesPanel.innerHTML = '<div class="report-summary-item"><strong>Нет данных</strong><span>По текущим фильтрам документы не найдены</span></div>';
            statusesPanel.innerHTML = '<div class="report-summary-item"><strong>Нет данных</strong><span>Измените фильтры, чтобы увидеть сводку</span></div>';
            return;
        }

        const renderBars = (items, labelResolver) => {
            const maxValue = Math.max(...items.map(item => item.count), 1);
            return `<ul class="top5-list">${items.map(item => `
                <li class="top5-item">
                    <span class="top5-name">${html(labelResolver(item.key))}</span>
                    <span class="top5-value">${item.count}</span>
                    <span class="top5-bar-track"><span class="top5-bar-fill" style="width:${Math.round((item.count / maxValue) * 100)}%"></span></span>
                </li>
            `).join('')}</ul>`;
        };

        const typeCounts = Object.entries(rows.reduce((acc, row) => {
            const key = normalizeDocType(row.docType);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {}))
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => right.count - left.count);

        const statusCounts = Object.entries(rows.reduce((acc, row) => {
            const key = normalizeDocumentDisplayStatus(row.status);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {}))
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => right.count - left.count);

        typesPanel.innerHTML = renderBars(typeCounts, key => getDocTypeLabel(key));
        statusesPanel.innerHTML = renderBars(statusCounts, key => normalizeDocumentDisplayStatus(key));
    }

    function loadDocumentsHub() {
        const tbody = document.getElementById('documentsHubTableBody');
        if (!tbody) return;

        const rows = applyDocumentsHubFilters(buildUnifiedDocumentsRows());
        renderDocumentsHubSummary(rows);
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-table-message">Документы не найдены. Измените фильтры или сбросьте условия поиска.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const safeNumber = html(String(row.number || '')).replace(/'/g, '&#39;');
            const status = normalizeDocumentDisplayStatus(row.status);
            const isCancelled = status === 'Отменен' || status === 'Отменено';
            const isWriteoff = normalizeDocType(row.docType) === 'writeoff';
            const isPurchaseRequest = normalizeDocType(row.docType) === 'purchase_request';
            const conductDisabled = status === 'Проведен' || isWriteoff;
            const cancelDisabled = isCancelled || isWriteoff;
            const canDelete = isCancelled && !isWriteoff;

            const openHandler = isPurchaseRequest
                ? `openPurchaseRequestDocumentByNumber('${safeNumber}')`
                : `openDocumentCardByNumber('${safeNumber}')`;

            return `
                <tr ondblclick="${openHandler}" class="document-row-interactive ${isCancelled ? 'document-row-cancelled' : ''}">
                    <td>${html(getDocTypeLabel(row.docType))}</td>
                    <td>${html(row.number || '—')}</td>
                    <td>${html(formatDateTimeSafe(row.date, '—'))}</td>
                    <td>${html(row.basisLabel || '—')}</td>
                    <td><span class="${getStatusBadgeClass(row.status)}">${html(status)}</span></td>
                    <td>
                        <div class="documents-hub-actions">
                            ${isPurchaseRequest
                                ? `<button type="button" class="inline-action-btn" onclick="openPurchaseRequestDocumentByNumber('${safeNumber}')">Открыть</button>
                                   <button type="button" class="inline-action-btn" onclick="downloadPurchaseRequestPdfByNumber('${safeNumber}')">PDF</button>`
                                : `<button type="button" class="inline-action-btn" onclick="openDocumentCardByNumber('${safeNumber}')">Открыть</button>
                                   ${canNavigateToDocumentBasis(row) ? `<button type="button" class="inline-action-btn" onclick="goToDocumentBasisByNumber('${safeNumber}')" title="Перейти к основанию">↗</button>` : ''}
                                   <button type="button" class="inline-action-btn" onclick="downloadDocumentPdfByNumber('${safeNumber}')">PDF</button>
                                   <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${safeNumber}', 'Проведен')" ${conductDisabled ? 'disabled' : ''}>Провести</button>
                                   <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${safeNumber}', 'Отменен')" ${cancelDisabled ? 'disabled' : ''}>Отменить</button>
                                   ${canDelete ? `<button type="button" class="inline-action-btn" onclick="deleteDocumentByNumber('${safeNumber}')">Удалить</button>` : ''}`}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function cloneDocumentRecord(doc) {
        try {
            return JSON.parse(JSON.stringify(doc || {}));
        } catch (error) {
            return {
                ...(doc || {}),
                items: Array.isArray(doc?.items) ? doc.items.map(item => ({ ...item })) : [],
                history: Array.isArray(doc?.history) ? doc.history.map(entry => ({ ...entry })) : []
            };
        }
    }

    function toDateTimeInputValue(value) {
        const date = parseDateSafe(value);
        if (!date) return '';
        const tzOffset = date.getTimezoneOffset();
        return new Date(date.getTime() - tzOffset * 60000).toISOString().slice(0, 16);
    }

    function parseInputDateTime(value, fallback = '') {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
    }

    function getDocumentItemQuantity(item) {
        return Number(item?.quantity || 0);
    }

    function getDocumentItemPrice(item) {
        return Number(item?.rentPrice ?? item?.rent_price ?? item?.price ?? item?.unitPrice ?? 0);
    }

    function getDocumentItemName(item) {
        return item?.name || item?.item_name || item?.itemName || item?.itemId || item?.item_id || 'Объект';
    }

    function getDocumentItemCategory(item) {
        return item?.category || '—';
    }

    function getDocumentTotalAmount(items = []) {
        return (items || []).reduce((sum, item) => sum + getDocumentItemQuantity(item) * getDocumentItemPrice(item), 0);
    }

    function formatCurrency(value) {
        return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
    }

    function getBasisTypeLabel(basisType) {
        if (basisType === 'event') return 'Мероприятие';
        if (basisType === 'rental') return 'Аренда';
        return 'Основание';
    }

    function canEditDocument(doc) {
        if (!doc || doc.source === 'writeoff') return false;
        const status = String(doc.status || 'Черновик').trim();
        return status !== 'Отменен';
    }

    function canNavigateToDocumentBasis(doc) {
        const basisType = String(doc?.basisType || '').trim();
        if (['rental', 'event'].includes(basisType)) {
            return Boolean(doc?.entity?.id || doc?.basisId);
        }
        if (basisType === 'purchase_request') {
            return Boolean(String(doc?.basisId || '').trim());
        }
        return false;
    }

    function resolveDocumentBasisInfo(doc) {
        const entity = doc?.entity || null;
        const basisType = String(doc?.basisType || '').trim();
        const typeLabel = getBasisTypeLabel(basisType);

        if (basisType === 'rental') {
            return {
                typeLabel,
                title: doc?.basisLabel || (entity?.id ? `Аренда №${entity.id}` : '—'),
                startDate: entity?.start_date || '',
                endDate: entity?.end_date || '',
                responsible: entity?.employee_name || '—',
                buttonLabel: 'Перейти к аренде'
            };
        }

        if (basisType === 'event') {
            return {
                typeLabel,
                title: doc?.basisLabel || entity?.name || '—',
                startDate: entity?.start_date || '',
                endDate: entity?.end_date || '',
                responsible: entity?.employee_name || '—',
                buttonLabel: 'Перейти к мероприятию'
            };
        }

        if (basisType === 'purchase_request') {
            return {
                typeLabel: 'Заявка на закупку',
                title: doc?.basisLabel || (doc?.basisId ? `Заявка №${doc.basisId}` : '—'),
                startDate: doc?.date || '',
                endDate: doc?.endDate || '',
                responsible: doc?.responsible?.name || doc?.responsible || '—',
                buttonLabel: 'Перейти к заявке'
            };
        }

        return {
            typeLabel,
            title: doc?.basisLabel || '—',
            startDate: '',
            endDate: '',
            responsible: doc?.counterparty || '—',
            buttonLabel: 'Перейти к основанию'
        };
    }

    function ensureDocumentHistoryArray(doc) {
        if (Array.isArray(doc?.history) && doc.history.length) {
            return doc.history.map(entry => ({ ...entry }));
        }

        return [{
            date: doc?.createdAt || doc?.date || new Date().toISOString(),
            text: `Создан (статус: ${restoreText(String(doc?.status || 'Черновик'))})`
        }];
    }

    function buildDocumentHistory(doc) {
        return ensureDocumentHistoryArray(doc)
            .map(entry => ({
                date: entry.date || doc?.updatedAt || doc?.date || new Date().toISOString(),
                text: restoreText(entry.text || 'Изменение документа')
            }))
            .sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0));
    }

    function renderDocumentItemsTable(items, options = {}) {
        const {
            quantityEditable = false,
            priceEditable = false,
            allowDelete = false
        } = options;

        if (!items.length) {
            return '<p>Позиции отсутствуют</p>';
        }

        return `
            <div class="report-table-wrapper">
                <table class="report-table document-items-table">
                    <thead>
                        <tr>
                            <th>Объект</th>
                            <th>Категория</th>
                            <th>Количество</th>
                            <th>Цена</th>
                            <th>Сумма</th>
                            ${allowDelete ? '<th>Действия</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, index) => {
                            const quantity = getDocumentItemQuantity(item);
                            const price = getDocumentItemPrice(item);
                            const lineTotal = quantity * price;

                            return `
                                <tr data-document-item-index="${index}" data-quantity="${quantity}">
                                    <td>${html(getDocumentItemName(item))}</td>
                                    <td>${html(getDocumentItemCategory(item))}</td>
                                    <td>${quantityEditable ? `<input type="number" min="1" step="1" class="document-item-input document-item-qty-input" value="${quantity}" oninput="recalculateDocumentCardTotals()">` : quantity}</td>
                                    <td>${priceEditable ? `<input type="number" min="0" step="0.01" class="document-item-input document-item-price-input" value="${price}" oninput="recalculateDocumentCardTotals()">` : formatCurrency(price)}</td>
                                    <td class="document-item-total">${formatCurrency(lineTotal)}</td>
                                    ${allowDelete ? `<td><button type="button" class="inline-action-btn" onclick="removeDocumentPosition(${index})" title="Удалить">🗑️</button></td>` : ''}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderDocumentCardContent(doc, { editable = false } = {}) {
        const items = Array.isArray(doc?.items) ? doc.items : [];
        const basisInfo = resolveDocumentBasisInfo(doc);
        const history = buildDocumentHistory(doc);
        const restrictions = getEditableFieldsForStatus(doc);

        // Determine which fields should be editable
        const numberEditable = editable && restrictions.number;
        const dateEditable = editable && restrictions.date;
        const positionsEditable = editable && restrictions.positions;

        return `
            <div id="documentCardPrintableArea" class="document-card-layout">
                <section class="dashboard-panel">
                    <h3>Основная информация</h3>
                    <div class="document-card-grid">
                        <div>
                            <strong>Тип документа:</strong> 
                            ${html(getDocTypeLabel(doc?.docType))}
                            ${editable ? '<div class="document-card-note">(не редактируется)</div>' : ''}
                        </div>
                        <div>
                            <strong>Номер:</strong> 
                            ${numberEditable ? 
                                `<input type="text" id="documentCardNumberInput" class="document-card-input document-number-input" value="${html(doc?.number || '')}" placeholder="${getDocumentNumberPrefix(doc?.docType)}-000001" onchange="validateDocumentNumber('${html(String(doc?.docType).replace(/'/g, '&#39;'))}')">
                                <div id="documentCardNumberError" class="document-input-error"></div>` 
                                : html(doc?.number || '—')
                            }
                        </div>
                        <div>
                            <strong>Дата:</strong> 
                            ${dateEditable ? `<input type="datetime-local" id="documentCardDateInput" class="document-card-input" value="${html(toDateTimeInputValue(doc?.date || doc?.createdAt))}" onchange="recalculateDocumentCardTotals()">` : html(formatDateTimeSafe(doc?.date || doc?.createdAt, '—'))}
                        </div>
                        <div>
                            <strong>Статус:</strong> 
                            <span class="${getStatusBadgeClass(doc?.status)}">${html(restoreText(doc?.status || 'Черновик'))}</span>
                            ${editable ? '<div class="document-card-note">(меняется кнопками Провести/Отменить)</div>' : ''}
                        </div>
                    </div>
                </section>
                <section class="dashboard-panel">
                    <h3>Основание</h3>
                    <div class="document-card-grid">
                        <div><strong>Тип основания:</strong> ${html(basisInfo.typeLabel)}</div>
                        <div><strong>Название:</strong> ${html(basisInfo.title)}</div>
                        <div><strong>Дата начала:</strong> ${html(formatDateTimeSafe(basisInfo.startDate, '—'))}</div>
                        <div><strong>Дата окончания:</strong> ${html(formatDateTimeSafe(basisInfo.endDate, '—'))}</div>
                        <div><strong>Ответственный:</strong> ${html(basisInfo.responsible)}</div>
                        <div><strong>Контрагент:</strong> ${html(doc?.counterparty || '—')}</div>
                    </div>
                    ${canNavigateToDocumentBasis(doc) ? `<div class="document-card-section-actions"><button type="button" class="inline-action-btn" onclick="goToSelectedDocumentBasis()">↗ ${html(basisInfo.buttonLabel)}</button></div>` : ''}
                </section>
                <section class="dashboard-panel">
                    <h3>Позиции документа</h3>
                    ${renderDocumentItemsTable(items, {
                        quantityEditable: editable && restrictions.quantity,
                        priceEditable: editable && restrictions.price,
                        allowDelete: editable && restrictions.positions
                    })}
                    ${positionsEditable ? `<div class="document-card-section-actions"><button type="button" class="inline-action-btn" onclick="addDocumentPosition()">➕ Добавить позицию</button></div>` : ''}
                    <div class="document-card-total">Итого: <span id="documentCardTotalValue">${formatCurrency(getDocumentTotalAmount(items))}</span></div>
                </section>
                <section class="dashboard-panel">
                    <h3>История изменений</h3>
                    <div class="report-summary-list">
                        ${history.map(entry => `
                            <div class="report-summary-item">
                                <strong>${html(formatDateTimeSafe(entry.date, '—'))}</strong>
                                <span>${html(entry.text)}</span>
                            </div>
                        `).join('')}
                    </div>
                </section>
            </div>
        `;
    }

    function findDocumentByNumber(number) {
        const normalized = String(number || '').trim();
        const local = readDocumentsRegistry().find(doc => String(doc.number || '').trim() === normalized);
        if (local) return { ...local, source: 'local', docType: normalizeDocType(local.docType) };

        const purchaseAct = readPurchaseActDocuments().find(doc => String(doc.number || '').trim() === normalized);
        if (purchaseAct) {
            return {
                source: 'purchase_act',
                docType: 'purchase_act',
                number: purchaseAct.number,
                date: purchaseAct.date || purchaseAct.createdAt,
                status: purchaseAct.status || 'Черновик',
                basisLabel: purchaseAct.basisLabel || `Заявка на закупку № ${purchaseAct.basisId || '—'}`,
                basisType: 'purchase_request',
                basisId: purchaseAct.basisId || '',
                counterparty: purchaseAct.counterparty || '',
                responsible: purchaseAct.responsible || null,
                endDate: purchaseAct.endDate || null,
                items: purchaseAct.items || [],
                history: purchaseAct.history || []
            };
        }

        const writeoff = writeoffActsCache.find(doc => String(doc.number || '').trim() === normalized);
        if (writeoff) {
            return {
                source: 'writeoff',
                docType: 'writeoff',
                number: writeoff.number,
                date: writeoff.date || writeoff.createdAt,
                status: 'Проведен',
                basisLabel: formatWriteoffBasisLabel(writeoff.basis || {}),
                basisType: writeoff?.basis?.type || '',
                basisId: writeoff?.basis?.id || null,
                counterparty: writeoff?.basis?.name || '',
                items: writeoff.items || [],
                writeoffRef: writeoff
            };
        }

        return null;
    }

    function openDocumentCard(doc) {
        if (!doc) return;
        selectedDocumentCard = cloneDocumentRecord(doc);
        documentCardEditMode = false;

        const modal = document.getElementById('documentCardModal');
        const title = document.getElementById('documentCardTitle');
        const content = document.getElementById('documentCardContent');
        if (!modal || !title || !content) return;

        title.textContent = `${getDocTypeLabel(doc.docType)} № ${restoreText(doc.number || '—')} от ${formatDateTimeSafe(doc.date || doc.createdAt, '—')}`;
        content.innerHTML = renderDocumentCardContent(selectedDocumentCard, { editable: false });
        const inlinePanel = document.getElementById('documentCardInlinePdfPanel');
        const inlineFrame = document.getElementById('documentCardInlinePdfFrame');
        if (inlinePanel) inlinePanel.style.display = 'none';
        if (inlineFrame) inlineFrame.srcdoc = '';

        const conductBtn = document.getElementById('documentCardConductBtn');
        const cancelBtn = document.getElementById('documentCardCancelBtn');
        const editCancelBtn = document.getElementById('documentCardEditCancelBtn');
        const editBtn = document.getElementById('documentCardEditBtn');
        const saveBtn = document.getElementById('documentCardSaveBtn');
        const basisBtn = document.getElementById('documentCardBasisBtn');
        if (conductBtn) {
            let conductBlockedByRequest = false;
            let conductBlockedByResponsible = false;
            if (doc.source === 'purchase_act') {
                const basisNumber = String(doc?.basisId || '').trim();
                const request = basisNumber ? getPurchaseRequestByNumber(basisNumber) : null;
                const requestStatus = normalizePurchaseRequestStatus(request?.status);
                conductBlockedByRequest = !request || !['completed', 'closed'].includes(requestStatus);
                conductBlockedByResponsible = !(request?.preparedBy && request?.approvedBy);
            }
            conductBtn.disabled = doc.source === 'writeoff' || doc.status === 'Проведен' || conductBlockedByRequest || conductBlockedByResponsible;
        }
        if (cancelBtn) cancelBtn.disabled = doc.source === 'writeoff' || doc.status === 'Отменен';
        if (editBtn) {
            editBtn.style.display = 'inline-flex';
            editBtn.disabled = !canEditDocument(doc);
        }
        if (saveBtn) saveBtn.style.display = 'none';
        if (editCancelBtn) editCancelBtn.style.display = 'none';
        if (basisBtn) {
            basisBtn.style.display = canNavigateToDocumentBasis(doc) ? 'inline-flex' : 'none';
            basisBtn.textContent = `↗ ${resolveDocumentBasisInfo(doc).buttonLabel}`;
        }

        modal.style.display = 'block';
    }

    function closeDocumentCardModal() {
        const modal = document.getElementById('documentCardModal');
        if (modal) modal.style.display = 'none';
        const panel = document.getElementById('documentCardInlinePdfPanel');
        const frame = document.getElementById('documentCardInlinePdfFrame');
        if (panel) panel.style.display = 'none';
        if (frame) frame.srcdoc = '';
        selectedDocumentCard = null;
        documentCardEditMode = false;
    }

    function getDocumentCardPreviewHtml() {
        if (selectedDocumentCard && typeof window.buildDocumentPdfPreviewByType === 'function') {
            const payload = window.buildDocumentPdfPreviewByType(selectedDocumentCard);
            if (payload?.html) {
                return payload.html;
            }
        }
        const area = document.getElementById('documentCardPrintableArea');
        if (!area) return '';
        const unifiedPrintStyle = buildUnifiedPrintStyle(`
            .document-card-layout { display: flex; flex-direction: column; gap: 10px; max-width: 1120px; margin: 0 auto; }
            .dashboard-panel { border: 1px solid #d9d9d9; border-radius: 6px; padding: 10px 12px; background: #fff; box-shadow: none; }
            .dashboard-panel h3 { margin: 0 0 8px; font-size: 12px; font-weight: 700; }
            .document-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 12px; margin-bottom: 8px; }
            .report-table-wrapper, .report-table-scroll { overflow: visible !important; }
            .document-card-total { margin-top: 8px; text-align: right; font-weight: 700; }
            .doc-status, .pr-badge { border: 1px solid #d1d5db; background: #f9fafb; color: #374151; }
            body { padding: 14px; }
        `);
        return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><title>Предпросмотр документа</title><style>${unifiedPrintStyle}</style></head><body>${area.outerHTML}</body></html>`;
    }

    window.openInlineDocumentPdfPreviewFromCard = function openInlineDocumentPdfPreviewFromCard() {
        if (!selectedDocumentCard) {
            showNotification('Документ не выбран', 'warning');
            return;
        }
        const panel = document.getElementById('documentCardInlinePdfPanel');
        const frame = document.getElementById('documentCardInlinePdfFrame');
        const htmlContent = getDocumentCardPreviewHtml();
        if (!panel || !frame || !htmlContent) {
            showNotification('Не удалось сформировать предпросмотр PDF', 'error');
            return;
        }
        frame.srcdoc = htmlContent;
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    window.closeInlineDocumentPdfPreview = function closeInlineDocumentPdfPreview() {
        const panel = document.getElementById('documentCardInlinePdfPanel');
        const frame = document.getElementById('documentCardInlinePdfFrame');
        if (frame) frame.srcdoc = '';
        if (panel) panel.style.display = 'none';
    };

    window.printInlineDocumentPdfPreview = function printInlineDocumentPdfPreview() {
        const frame = document.getElementById('documentCardInlinePdfFrame');
        if (!frame?.contentWindow) {
            showNotification('Сначала откройте предпросмотр PDF', 'warning');
            return;
        }
        frame.contentWindow.focus();
        frame.contentWindow.print();
    };

    window.downloadInlineDocumentPdfPreview = async function downloadInlineDocumentPdfPreview() {
        const frame = document.getElementById('documentCardInlinePdfFrame');
        const frameDoc = frame?.contentDocument || frame?.contentWindow?.document;
        if (!frameDoc?.body) {
            showNotification('Сначала откройте предпросмотр PDF', 'warning');
            return;
        }

        const JsPdf = window.jspdf?.jsPDF;
        if (!JsPdf || typeof window.html2canvas !== 'function') {
            showNotification('Библиотеки PDF недоступны. Используйте Печать → Сохранить как PDF', 'warning');
            return;
        }

        try {
            const canvas = await window.html2canvas(frameDoc.body, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true
            });

            const pdf = new JsPdf('p', 'mm', 'a4');
            const pageWidth = 210;
            const pageHeight = 297;
            const imageWidth = pageWidth - 20;
            const imageHeight = (canvas.height * imageWidth) / canvas.width;
            const imageData = canvas.toDataURL('image/png');

            let heightLeft = imageHeight;
            let position = 10;

            pdf.addImage(imageData, 'PNG', 10, position, imageWidth, imageHeight);
            heightLeft -= (pageHeight - 20);

            while (heightLeft > 0) {
                pdf.addPage();
                position = heightLeft - imageHeight + 10;
                pdf.addImage(imageData, 'PNG', 10, position, imageWidth, imageHeight);
                heightLeft -= (pageHeight - 20);
            }

            const number = String(selectedDocumentCard?.number || 'document').replace(/[^\w\-а-яА-Я]/g, '_');
            pdf.save(`Документ_${number}.pdf`);
            showNotification('PDF скачан', 'success');
        } catch (error) {
            showNotification(error?.message || 'Не удалось скачать PDF. Используйте Печать → Сохранить как PDF', 'error');
        }
    };

    async function syncDocumentBasisStatus(doc, status) {
        const type = normalizeDocType(doc?.docType);
        const basisType = String(doc?.basisType || '').trim();
        const basisId = Number(doc?.entity?.id || doc?.basisId || 0);

        if (!['issuance', 'transfer'].includes(type)) return;
        if (!['rental', 'event'].includes(basisType) || !basisId || typeof apiFetch !== 'function') return;

        const endpointBase = basisType === 'rental' ? 'rentals' : 'events';
        if (status === 'Отменен') {
            const entity = await fetchDocumentBasisEntity(doc);
            const hasIssuanceLink = Boolean(entity?.issuance_act_id || String(entity?.issuance_act_number || '').trim());
            if (!hasIssuanceLink) {
                return;
            }
            await apiFetch(`/api/${endpointBase}/${basisId}/unpost`, { method: 'POST' });
            return;
        }

        if (status === 'Проведен') {
            const entity = await fetchDocumentBasisEntity(doc);
            const targetStatus = basisType === 'rental' ? 'Активна' : 'Активно';
            await apiFetch(`/api/${endpointBase}/${basisId}/status`, {
                method: 'PUT',
                body: JSON.stringify({
                    status: targetStatus,
                    items: Array.isArray(entity?.items) ? entity.items : [],
                    acceptance_act_number: entity?.acceptance_act_number || ''
                })
            });
        }
    }

    async function updateDocumentStatus(number, status) {
        const purchaseActs = readPurchaseActDocuments();
        const purchaseActIndex = purchaseActs.findIndex(item => String(item.number || '').trim() === String(number || '').trim());
        if (purchaseActIndex >= 0) {
            const currentAct = purchaseActs[purchaseActIndex];
            const previousStatus = String(currentAct.status || 'Черновик').trim();
            const targetStatus = String(status || '').trim();

            if (!['Черновик', 'Проведен', 'Отменен'].includes(targetStatus)) {
                throw new Error('Недопустимый статус акта закупки');
            }

            if (targetStatus === 'Проведен') {
                const basisNumber = String(currentAct?.basisId || '').trim();
                const request = basisNumber ? getPurchaseRequestByNumber(basisNumber) : null;
                const requestStatus = normalizePurchaseRequestStatus(request?.status);
                if (!request || !['completed', 'closed'].includes(requestStatus)) {
                    throw new Error('Проведение акта закупки доступно только после полного получения заявки');
                }
                if (!(request.preparedBy && request.approvedBy)) {
                    throw new Error('Нельзя провести акт без заполненных ответственных (кладовщик и руководитель)');
                }
            }

            const applyActInventoryDelta = async (act, sign = 1) => {
                const actItems = Array.isArray(act?.items) ? act.items : [];
                const byId = new Map();
                const byName = new Map();

                actItems.forEach(item => {
                    const qty = Math.max(0, Number(item.quantity || 0));
                    if (!qty) return;
                    const idKey = String(item.itemId || '').trim();
                    const nameKey = String(item.name || '').trim().toLowerCase();
                    if (idKey) byId.set(idKey, Number(byId.get(idKey) || 0) + qty);
                    if (nameKey) byName.set(nameKey, Number(byName.get(nameKey) || 0) + qty);
                });

                const applyToList = list => (Array.isArray(list) ? list : []).map(item => {
                    const idKey = String(item?.id || '').trim();
                    const nameKey = String(item?.name || '').trim().toLowerCase();
                    const byIdQty = Number(byId.get(idKey) || 0);
                    const byNameQty = Number(byName.get(nameKey) || 0);
                    const delta = byIdQty > 0 ? byIdQty : byNameQty;
                    if (!delta) return item;
                    const base = Math.max(0, Number(item?.quantity ?? item?.stock ?? 0));
                    const nextQty = sign > 0 ? base + delta : Math.max(0, base - delta);
                    return { ...item, quantity: nextQty, stock: nextQty };
                });

                try {
                    if (Array.isArray(inventory)) {
                        inventory = applyToList(inventory);
                    }
                } catch (_) { }

                try {
                    const raw = JSON.parse(localStorage.getItem('warehouse_inventory') || '[]');
                    localStorage.setItem('warehouse_inventory', JSON.stringify(applyToList(raw)));
                } catch (_) { }

                if (typeof saveLocalBackup === 'function') {
                    try { saveLocalBackup(); } catch (_) { }
                }

                const deliveryItems = actItems
                    .map(item => ({
                        itemId: String(item?.itemId || '').trim(),
                        itemName: String(item?.name || '').trim(),
                        quantity: Math.max(0, Number(item?.quantity || 0))
                    }))
                    .filter(item => (item.itemId || item.itemName) && item.quantity > 0);

                if (deliveryItems.length > 0 && typeof apiFetch === 'function') {
                    const endpoint = sign > 0
                        ? '/api/inventory/purchase-requests/apply-delivery'
                        : '/api/inventory/purchase-requests/revert-delivery';
                    await apiFetch(endpoint, {
                        method: 'POST',
                        body: JSON.stringify({
                            documentNumber: String(act?.basisId || ''),
                            items: deliveryItems
                        })
                    });
                }
            };

            const syncLinkedPurchaseRequestByActStatus = (act, nextStatus) => {
                const basisNumber = String(act?.basisId || '').trim();
                if (!basisNumber) return;
                const docs = readPurchaseRequestDocuments();
                const idx = docs.findIndex(doc => String(doc.number || '').trim() === basisNumber);
                if (idx < 0) return;

                const req = normalizePurchaseRequestDocument(docs[idx]);
                const actQtyById = new Map((act.items || []).map(item => [String(item.itemId || ''), Math.max(0, Number(item.quantity || 0))]));
                if (nextStatus === 'Отменен') {
                    const revertedItems = (req.items || []).map(item => {
                        const rollbackQty = Number(actQtyById.get(String(item.itemId || '')) || 0);
                        const required = Math.max(0, Number(item.requiredQuantity || 0));
                        const ordered = Math.max(0, Number(item.orderedQuantity || 0));
                        const delivered = Math.max(0, Number(item.deliveredQuantity || 0) - rollbackQty);
                        let nextItemStatus = normalizePurchaseItemStatus(item.status, 'draft');

                        if (!['refused', 'cancelled'].includes(nextItemStatus)) {
                            if (required > 0 && delivered >= required) nextItemStatus = 'completed';
                            else if (delivered > 0) nextItemStatus = 'partial';
                            else if (ordered > 0) nextItemStatus = 'ordered';
                            else if (['approved', 'approval', 'draft'].includes(nextItemStatus)) nextItemStatus = nextItemStatus;
                            else nextItemStatus = 'draft';
                        }

                        return normalizePurchaseRequestItem({
                            ...item,
                            deliveredQuantity: delivered,
                            status: nextItemStatus
                        });
                    });

                    const recomputedStatus = calculatePurchaseRequestStatusByItems(revertedItems, 'ordered');
                    docs[idx] = normalizePurchaseRequestDocument({
                        ...req,
                        status: recomputedStatus,
                        deliveredAt: recomputedStatus === 'completed' ? (req.deliveredAt || new Date().toISOString()) : null,
                        closedAt: recomputedStatus === 'completed' ? req.closedAt : null,
                        items: revertedItems,
                        updatedAt: new Date().toISOString()
                    });
                } else if (nextStatus === 'Проведен') {
                    // Проведение акта не должно повторно менять количество поставки в заявке.
                    docs[idx] = normalizePurchaseRequestDocument({
                        ...req,
                        updatedAt: new Date().toISOString()
                    });
                }
                writePurchaseRequestDocuments(docs);
            };

            if (previousStatus !== targetStatus) {
                if (previousStatus === 'Проведен' && targetStatus === 'Отменен') {
                    await applyActInventoryDelta(currentAct, -1);
                    syncLinkedPurchaseRequestByActStatus(currentAct, 'Отменен');
                }
                if (previousStatus === 'Черновик' && targetStatus === 'Отменен') {
                    syncLinkedPurchaseRequestByActStatus(currentAct, 'Отменен');
                }
                if (previousStatus === 'Черновик' && targetStatus === 'Проведен') {
                    await applyActInventoryDelta(currentAct, +1);
                    syncLinkedPurchaseRequestByActStatus(currentAct, 'Проведен');
                }
                if (previousStatus === 'Отменен' && targetStatus === 'Проведен') {
                    await applyActInventoryDelta(currentAct, +1);
                    syncLinkedPurchaseRequestByActStatus(currentAct, 'Проведен');
                }
            }

            const actHistory = Array.isArray(currentAct.history) ? [...currentAct.history] : [];
            actHistory.push({ date: new Date().toISOString(), text: `Статус изменен: ${status}` });
            purchaseActs[purchaseActIndex] = normalizePurchaseActDocument({
                ...currentAct,
                status,
                responsible: currentAct.responsible || (String(status || '').trim() === 'Проведен'
                    ? (getPurchaseRequestByNumber(String(currentAct.basisId || '').trim())?.preparedBy
                        || getPurchaseRequestByNumber(String(currentAct.basisId || '').trim())?.approvedBy
                        || null)
                    : currentAct.responsible),
                updatedAt: new Date().toISOString(),
                history: actHistory
            });
            writePurchaseActDocuments(purchaseActs);
            return true;
        }

        const docs = readDocumentsRegistry();
        const index = docs.findIndex(item => String(item.number || '').trim() === String(number || '').trim());
        if (index < 0) return false;
        const current = docs[index];
        const nextDate = status === 'Проведен' && String(current.status || '').trim() === 'Отменен'
            ? new Date().toISOString()
            : (current.date || current.createdAt || new Date().toISOString());

        if (current.source === 'writeoff') {
            throw new Error('Для акта списания изменение статуса недоступно');
        }

        await syncDocumentBasisStatus(current, status);

        const history = ensureDocumentHistoryArray(current);
        history.push({
            date: new Date().toISOString(),
            text: `Статус изменен: ${status}`
        });
        docs[index] = {
            ...current,
            status,
            date: nextDate,
            updatedAt: new Date().toISOString(),
            history
        };
        writeDocumentsRegistry(docs);
        return true;
    }

    async function fetchDocumentBasisEntity(doc) {
        const basisType = String(doc?.basisType || '').trim();
        const basisId = Number(doc?.entity?.id || doc?.basisId || 0);
        if (!['rental', 'event'].includes(basisType) || !basisId || typeof apiFetch !== 'function') {
            return doc?.entity || null;
        }

        const endpoint = basisType === 'rental' ? '/api/rentals' : '/api/events';
        const rows = await apiFetch(endpoint, { timeoutMs: 15000, retryOnTimeout: false });
        const items = Array.isArray(rows) ? rows : [];
        return items.find(item => Number(item?.id || 0) === basisId) || doc?.entity || null;
    }

    async function goToDocumentBasis(doc) {
        if (!canNavigateToDocumentBasis(doc)) {
            showNotification('Для документа не найдено основание', 'warning');
            return;
        }

        const basisType = String(doc?.basisType || '').trim();
        if (basisType === 'purchase_request') {
            const number = String(doc?.basisId || '').trim();
            if (!number) {
                showNotification('Не найден номер заявки-основания', 'warning');
                return;
            }
            closeDocumentCardModal();
            if (typeof showPage === 'function') {
                showPage('purchaseRequests');
            }
            if (typeof openPurchaseRequestDocumentByNumber === 'function') {
                openPurchaseRequestDocumentByNumber(number);
            }
            return;
        }

        const entity = await fetchDocumentBasisEntity(doc);
        if (!entity?.id) {
            showNotification('Не удалось открыть основание документа', 'warning');
            return;
        }

        closeDocumentCardModal();
        if (typeof showPage === 'function') {
            showPage(basisType === 'rental' ? 'rentals' : 'events');
        }

        if (basisType === 'rental' && typeof openEditRentalModal === 'function') {
            await openEditRentalModal(entity);
            return;
        }

        if (basisType === 'event' && typeof openEditEventModal === 'function') {
            await openEditEventModal(entity);
        }
    }

    function collectDocumentCardDraftValues() {
        if (!selectedDocumentCard) return null;
        const content = document.getElementById('documentCardContent');
        if (!content) return null;

        const numberInput = document.getElementById('documentCardNumberInput');
        const dateInput = document.getElementById('documentCardDateInput');
        const rows = [...content.querySelectorAll('tr[data-document-item-index]')];
        const items = rows.map((row, index) => {
            const currentItem = Array.isArray(selectedDocumentCard.items) ? selectedDocumentCard.items[index] || {} : {};
            const quantityInput = row.querySelector('.document-item-qty-input');
            const priceInput = row.querySelector('.document-item-price-input');
            const quantity = quantityInput
                ? Number(quantityInput.value || 0)
                : Number(currentItem.quantity || row.getAttribute('data-quantity') || 0);
            const price = priceInput
                ? Number(priceInput.value || 0)
                : Number(getDocumentItemPrice(currentItem));

            if (!quantity || quantity < 0) {
                throw new Error('Количество должно быть больше нуля');
            }

            return {
                ...currentItem,
                quantity,
                rentPrice: price,
                rent_price: price,
                price
            };
        });

        return {
            number: numberInput ? String(numberInput.value || '').trim() : String(selectedDocumentCard.number || '').trim(),
            date: parseInputDateTime(dateInput?.value, selectedDocumentCard.date || selectedDocumentCard.createdAt || new Date().toISOString()),
            items,
            amount: getDocumentTotalAmount(items)
        };
    }

    async function syncDocumentBasisSource(doc) {
        const basisType = String(doc?.basisType || '').trim();
        const entity = doc?.entity || null;
        if (!entity?.id || typeof apiFetch !== 'function') return;

        const normalizedItems = (doc.items || []).map(item => ({
            item_id: item.item_id || item.itemId || null,
            itemId: item.itemId || item.item_id || null,
            category: item.category || null,
            quantity: Number(item.quantity || 0),
            rent_price: getDocumentItemPrice(item),
            rentPrice: getDocumentItemPrice(item),
            issue_condition: item.issue_condition || item.issueCondition || 'Хорошее',
            actual_condition: item.actual_condition || item.actualCondition || 'Хорошее',
            return_status: item.return_status || item.returnStatus || 'Возвращено',
            writeoff_reason: item.writeoff_reason || item.writeoffReason || '',
            comment: item.comment || ''
        }));

        if (basisType === 'rental') {
            await apiFetch(`/api/rentals/${entity.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    client_id: entity.client_id,
                    employee_id: entity.employee_id,
                    start_date: entity.start_date,
                    end_date: entity.end_date,
                    status: entity.status || 'Черновик',
                    acceptance_act_number: entity.acceptance_act_number || '',
                    items: normalizedItems
                })
            });
            return;
        }

        if (basisType === 'event') {
            await apiFetch(`/api/events/${entity.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: entity.name,
                    location: entity.location || '',
                    employee_id: entity.employee_id,
                    start_date: entity.start_date,
                    end_date: entity.end_date,
                    status: entity.status || 'Черновик',
                    acceptance_act_number: entity.acceptance_act_number || '',
                    items: normalizedItems
                })
            });
        }
    }

    function rerenderDocumentCard(editable) {
        if (!selectedDocumentCard) return;
        documentCardEditMode = editable;

        const title = document.getElementById('documentCardTitle');
        const content = document.getElementById('documentCardContent');
        const editBtn = document.getElementById('documentCardEditBtn');
        const saveBtn = document.getElementById('documentCardSaveBtn');
        const editCancelBtn = document.getElementById('documentCardEditCancelBtn');
        if (!title || !content) return;

        title.textContent = `${getDocTypeLabel(selectedDocumentCard.docType)} № ${selectedDocumentCard.number || '—'} от ${formatDateTimeSafe(selectedDocumentCard.date || selectedDocumentCard.createdAt, '—')}`;
        content.innerHTML = renderDocumentCardContent(selectedDocumentCard, { editable });
        const inlinePanel = document.getElementById('documentCardInlinePdfPanel');
        const inlineFrame = document.getElementById('documentCardInlinePdfFrame');
        if (inlinePanel) inlinePanel.style.display = 'none';
        if (inlineFrame) inlineFrame.srcdoc = '';
        if (editBtn) editBtn.style.display = editable ? 'none' : 'inline-flex';
        if (saveBtn) saveBtn.style.display = editable ? 'inline-flex' : 'none';
        if (editCancelBtn) editCancelBtn.style.display = editable ? 'inline-flex' : 'none';
    }

    function deleteDocument(number) {
        const purchaseActs = readPurchaseActDocuments();
        const nextActs = purchaseActs.filter(item => String(item.number || '').trim() !== String(number || '').trim());
        if (nextActs.length !== purchaseActs.length) {
            writePurchaseActDocuments(nextActs);
            return;
        }

        const docs = readDocumentsRegistry();
        const next = docs.filter(item => String(item.number || '').trim() !== String(number || '').trim());
        writeDocumentsRegistry(next);
    }

    // ========== DOCUMENT VALIDATION FUNCTIONS ==========

    /**
     * Get the expected number format prefix for document type
     */
    function getDocumentNumberPrefix(docType) {
        const type = normalizeDocType(docType);
        switch (type) {
            case 'issuance': return 'АКВ'; // Акт выдачи
            case 'transfer': return 'АКП'; // Акт передачи
            case 'acceptance': return 'ПР'; // Акт приемки
            case 'writeoff': return 'АС'; // Акт списания
            case 'purchase_act': return 'ПА'; // Акт закупки
            default: return 'АКВ';
        }
    }

    /**
     * Validate document number format (format: XX-XXXXXX where XX is prefix)
     */
    function validateNumberFormat(docType, number) {
        if (!number) return false;
        const prefix = getDocumentNumberPrefix(docType);
        const pattern = new RegExp(`^${prefix}-\\d{6}$`);
        return pattern.test(String(number).trim());
    }

    /**
     * Get error message for invalid format
     */
    function getNumberFormatError(docType) {
        const prefix = getDocumentNumberPrefix(docType);
        return `Номер должен быть в формате ${prefix}-000001`;
    }

    /**
     * Check if document number already exists (excluding current document)
     */
    function checkNumberUniqueness(docType, newNumber, excludeNumber = null) {
        const docs = readDocumentsRegistry();
        const type = normalizeDocType(docType);
        const exists = docs.find(doc =>
            normalizeDocType(doc.docType) === type &&
            String(doc.number || '').trim() === String(newNumber || '').trim() &&
            (!excludeNumber || String(doc.number || '').trim() !== String(excludeNumber || '').trim())
        );
        return !exists; // return true if unique
    }

    /**
     * Get error message for duplicate number
     */
    function getNumberDuplicateError(number) {
        return `Документ с номером ${number} уже существует!`;
    }

    /**
     * Can this document be edited based on its status?
     */
    function canEditDocumentByStatus(doc) {
        const status = String(doc?.status || '').trim();
        // Only drafts can be fully edited
        // Conducted docs can have limited edits
        // Cancelled docs cannot be edited
        return status !== 'Отменен';
    }

    /**
     * Get editable field restrictions based on document status
     */
    function getEditableFieldsForStatus(doc) {
        const status = String(doc?.status || '').trim();
        if (status === 'Черновик') {
            // Full editing
            return {
                number: true,
                date: true,
                quantity: true,
                price: true,
                positions: true // add/remove positions
            };
        } else if (status === 'Проведен') {
            // Limited editing
            return {
                number: true,
                date: true,
                quantity: false, // cannot change quantity for conducted
                price: true,
                positions: false // cannot add/remove positions
            };
        } else if (status === 'Частично') {
            // Similar to conducted
            return {
                number: true,
                date: true,
                quantity: false,
                price: true,
                positions: false
            };
        } else {
            // Cancelled - no edits
            return {
                number: false,
                date: false,
                quantity: false,
                price: false,
                positions: false
            };
        }
    }

    /**
     * Validate all document fields before saving
     */
    function validateDocumentBeforeSave(doc) {
        const errors = [];

        // Validate number format
        if (!validateNumberFormat(doc.docType, doc.number)) {
            errors.push(getNumberFormatError(doc.docType));
        }

        // Validate unique number (excluding current doc if it exists)
        if (!checkNumberUniqueness(doc.docType, doc.number, selectedDocumentCard?.number)) {
            errors.push(getNumberDuplicateError(doc.number));
        }

        // Validate date
        if (!doc.date) {
            errors.push('Дата документа не указана');
        }

        // Validate items
        if (!Array.isArray(doc.items) || doc.items.length === 0) {
            errors.push('Добавьте хотя бы одну позицию');
        }

        // Validate items have quantities
        const hasInvalidItems = (doc.items || []).some(item => {
            const qty = Number(item.quantity || 0);
            return qty <= 0;
        });

        if (hasInvalidItems) {
            errors.push('Все позиции должны иметь положительное количество');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Add new position to document (from inventory selector)
     */
    function addNewItemToDocument(doc, inventoryItem) {
        if (!doc || !inventoryItem) return null;

        const newItem = {
            item_id: inventoryItem.id,
            itemId: inventoryItem.id,
            name: inventoryItem.name,
            category: inventoryItem.category,
            quantity: 1,
            price: inventoryItem.price || 0,
            rent_price: inventoryItem.rent_price || 0,
            rentPrice: inventoryItem.rent_price || 0,
            issueCondition: 'Хорошее',
            issue_condition: 'Хорошее',
            actualCondition: 'Хорошее',
            actual_condition: 'Хорошее',
            returnStatus: 'Возвращено',
            return_status: 'Возвращено'
        };

        const items = Array.isArray(doc.items) ? [...doc.items] : [];
        items.push(newItem);

        return {
            ...doc,
            items,
            amount: getDocumentTotalAmount(items)
        };
    }

    /**
     * Remove item from document by index
     */
    function removeItemFromDocument(doc, itemIndex) {
        if (!doc || itemIndex < 0) return null;

        const items = Array.isArray(doc.items) ? doc.items.filter((_, idx) => idx !== itemIndex) : [];

        return {
            ...doc,
            items,
            amount: getDocumentTotalAmount(items)
        };
    }

    /**
     * Update item quantity in document
     */
    function updateItemQuantity(doc, itemIndex, newQuantity) {
        if (!doc || itemIndex < 0) return null;

        const items = Array.isArray(doc.items) ? [...doc.items] : [];
        if (itemIndex >= items.length) return null;

        const qty = Number(newQuantity || 0);
        if (qty < 0) return null;

        items[itemIndex] = {
            ...items[itemIndex],
            quantity: qty
        };

        return {
            ...doc,
            items,
            amount: getDocumentTotalAmount(items)
        };
    }

    /**
     * Update item price in document
     */
    function updateItemPrice(doc, itemIndex, newPrice) {
        if (!doc || itemIndex < 0) return null;

        const items = Array.isArray(doc.items) ? [...doc.items] : [];
        if (itemIndex >= items.length) return null;

        const price = Number(newPrice || 0);
        if (price < 0) return null;

        items[itemIndex] = {
            ...items[itemIndex],
            price,
            rent_price: price,
            rentPrice: price
        };

        return {
            ...doc,
            items,
            amount: getDocumentTotalAmount(items)
        };
    }

    function refreshDocumentsPages() {
        loadIssuanceActs();
        loadTransferActs();
        loadAcceptanceActs();
        loadPurchaseActs();
        loadDocumentsHub();
    }

    function loadIssuanceActs() {
        renderTypedDocumentsTable('issuanceActsTableBody', 'issuance');
    }

    function loadTransferActs() {
        renderTypedDocumentsTable('transferActsTableBody', 'transfer');
    }

    function loadAcceptanceActs() {
        renderTypedDocumentsTable('acceptanceActsTableBody', 'acceptance');
    }

    function loadPurchaseActs() {
        const tbody = document.getElementById('purchaseActsTableBody');
        if (!tbody) return;

        const dateFrom = String(document.getElementById('purchaseActDateFromFilter')?.value || '').trim();
        const dateTo = String(document.getElementById('purchaseActDateToFilter')?.value || '').trim();
        const basisFilter = String(document.getElementById('purchaseActBasisFilter')?.value || '').toLowerCase().trim();

        const rows = readPurchaseActDocuments().filter(doc => {
            const rowDate = parseDateSafe(doc.date || doc.createdAt);
            const matchesFrom = !dateFrom || (rowDate && rowDate >= new Date(`${dateFrom}T00:00:00`));
            const matchesTo = !dateTo || (rowDate && rowDate <= new Date(`${dateTo}T23:59:59`));
            const matchesBasis = !basisFilter || String(doc.basisId || '').toLowerCase().includes(basisFilter);
            return matchesFrom && matchesTo && matchesBasis;
        });

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-table-message">Акты закупки отсутствуют</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(doc => {
            const items = Array.isArray(doc.items) ? doc.items : [];
            const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const safeNumber = html(String(restoreText(doc.number || ''))).replace(/'/g, '&#39;');
            const rawStatus = String(restoreText(doc.status || 'Черновик')).trim();
            const status = ['Черновик', 'Проведен', 'Отменен'].includes(rawStatus) ? rawStatus : 'Черновик';
            const conductDisabled = status === 'Проведен';
            const cancelDisabled = status === 'Отменен';
            const canDelete = status === 'Отменен';
            return `
                <tr class="document-row-interactive ${status === 'Отменен' ? 'document-row-cancelled' : ''}" ondblclick="openDocumentCardByNumber('${safeNumber}')">
                    <td>${html(restoreText(doc.number || '—'))}</td>
                    <td>${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</td>
                    <td>${html(doc.basisId || '—')}</td>
                    <td>${items.length}</td>
                    <td>${totalUnits}</td>
                    <td><span class="${getStatusBadgeClass(status)}">${html(status)}</span></td>
                    <td>
                        <button type="button" class="inline-action-btn" onclick="openDocumentCardByNumber('${safeNumber}')">Открыть</button>
                        <button type="button" class="inline-action-btn" onclick="goToDocumentBasisByNumber('${safeNumber}')" title="Перейти к заявке">↗</button>
                        <button type="button" class="inline-action-btn" onclick="downloadDocumentPdfByNumber('${safeNumber}')">PDF</button>
                        <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${safeNumber}', 'Проведен')" ${conductDisabled ? 'disabled' : ''}>Провести</button>
                        <button type="button" class="inline-action-btn" onclick="setDocumentStatusByNumber('${safeNumber}', 'Отменен')" ${cancelDisabled ? 'disabled' : ''}>Отменить</button>
                        ${canDelete ? `<button type="button" class="inline-action-btn" onclick="deleteDocumentByNumber('${safeNumber}')">Удалить</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    function readWriteoffFilters() {
        return {
            dateFrom: document.getElementById('writeoffDateFromFilter')?.value || '',
            dateTo: document.getElementById('writeoffDateToFilter')?.value || '',
            basisType: document.getElementById('writeoffBasisTypeFilter')?.value || '',
            reasonCategory: document.getElementById('writeoffReasonCategoryFilter')?.value || '',
            incidentSource: document.getElementById('writeoffIncidentSourceFilter')?.value || '',
            object: document.getElementById('writeoffObjectFilter')?.value.trim() || '',
            reason: document.getElementById('writeoffReasonFilter')?.value.trim() || ''
        };
    }

    function buildWriteoffQuery(filters) {
        const params = new URLSearchParams();
        const backendFilters = {
            dateFrom: filters?.dateFrom || '',
            dateTo: filters?.dateTo || '',
            basisType: filters?.basisType || '',
            object: filters?.object || '',
            reason: filters?.reason || ''
        };
        Object.entries(backendFilters).forEach(([key, value]) => {
            if (String(value || '').trim()) params.set(key, value);
        });
        const query = params.toString();
        return query ? `/api/inventory/writeoff-acts?${query}` : '/api/inventory/writeoff-acts';
    }

    function getWriteoffReasonCategoryKey(value = '', itemType = 'asset') {
        const normalized = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
        const normalizedType = String(itemType || '').trim().toLowerCase();
        if (['consumable', 'expiry', 'damage', 'loss', 'other'].includes(normalized)) return normalized;
        if (!normalized) return normalizedType === 'consumable' ? 'consumable' : 'other';
        if (normalizedType === 'consumable' || normalized.includes('использован') || normalized.includes('израсход')) return 'consumable';
        if (normalized.includes('истек срок') || normalized.includes('выработал ресурс') || normalized.includes('износ')) return 'expiry';
        if (normalized.includes('утрач') || normalized.includes('потер') || normalized.includes('краж') || normalized.includes('невозврат') || normalized.includes('не возвращ')) return 'loss';
        if (normalized.includes('повреж') || normalized.includes('полом') || normalized.includes('дефект') || normalized.includes('трещин') || normalized.includes('деформац') || normalized.includes('авари') || normalized.includes('ремонт')) return 'damage';
        return 'other';
    }

    function getWriteoffReasonCategoryLabel(value = '', itemType = 'asset') {
        switch (getWriteoffReasonCategoryKey(value, itemType)) {
            case 'consumable': return 'Использован';
            case 'expiry': return 'Истек срок';
            case 'damage': return 'Повреждено';
            case 'loss': return 'Утрачено';
            default: return 'Другое';
        }
    }

    function getWriteoffReasonCategoryReportLabel(value = '', itemType = 'asset') {
        switch (getWriteoffReasonCategoryKey(value, itemType)) {
            case 'consumable': return 'Использован (расходники)';
            case 'expiry': return 'Истек срок эксплуатации';
            case 'damage': return 'Повреждено';
            case 'loss': return 'Утрачено';
            default: return 'Другое';
        }
    }

    function normalizeReasonCategory(reason = '', itemType = 'asset') {
        return getWriteoffReasonCategoryLabel(reason, itemType);
    }

    function getWriteoffReasonSuggestions() {
        return [
            'Использован',
            'Истек срок эксплуатации',
            'Повреждено',
            'Невозврат',
            'Утеря',
            'Поломка',
            'Утрачено',
            'Списание по решению руководства'
        ];
    }

    function buildWriteoffPositionsSummary(items = [], limit = 4) {
        const rows = (Array.isArray(items) ? items : []).slice(0, limit);
        const summary = rows.map(item => `${String(item.name || item.itemId || 'Объект').trim()}(${Number(item.quantity || 0)})`).join(', ');
        if ((items || []).length > limit) {
            return `${summary}, ...`;
        }
        return summary || '—';
    }

    function formatWriteoffItemBasisLabel(item = {}) {
        const basisType = restoreText(String(item?.basisType || item?.basis_type || '').trim().toLowerCase());
        const basisName = restoreText(String(item?.basisName || item?.basis_name || '').trim());
        const basisLabel = restoreText(String(item?.basisLabel || item?.basis_label || '').trim());
        const basisActNumber = restoreText(String(item?.basisActNumber || item?.basis_act_number || '').trim());

        if (basisType === 'item' || basisLabel === 'Карточка объекта') {
            return 'Карточка объекта';
        }
        if (basisType === 'event') {
            return basisActNumber ? `Мероприятие ${basisActNumber}` : `Мероприятие: ${basisName || basisLabel || '—'}`;
        }
        if (basisType === 'rental') {
            return basisActNumber ? `Аренда ${basisActNumber}` : `Аренда: ${basisName || basisLabel || '—'}`;
        }
        return basisLabel || basisName || '—';
    }

    function buildWriteoffPositionsTooltip(items = []) {
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) return 'Позиции отсутствуют';
        return rows.map(item => {
            const reason = String(item.reason || 'Без причины').trim();
            const comment = String(item.comment || '').trim();
            const basis = formatWriteoffItemBasisLabel(item);
            return `• ${String(item.name || item.itemId || 'Объект').trim()} — ${reason}${comment ? ` (${comment})` : ''}; Основание: ${basis}`;
        }).join('\n');
    }

    function buildPendingWriteoffDraftHtml(draft) {
        if (!draft) {
            return '<p style="color:var(--state-success-500);">Не проведенных актов списания нет</p>';
        }

        const grouped = new Map();
        (Array.isArray(draft.items) ? draft.items : []).forEach(item => {
            const key = getWriteoffReasonCategoryKey(item.reason_category || item.reasonCategory || item.reason || '');
            const existing = grouped.get(key) || { positions: 0, units: 0 };
            existing.positions += Number(item.positions || 1);
            existing.units += Number(item.units || item.quantity || 0);
            grouped.set(key, existing);
        });

        const lines = ['consumable', 'expiry', 'damage', 'loss', 'other']
            .filter(key => grouped.has(key))
            .map(key => {
                const meta = grouped.get(key);
                return `<li>• ${html(getWriteoffReasonCategoryReportLabel(key))}: ${Number(meta.positions || 0)} поз., ${Number(meta.units || 0)} ед.</li>`;
            }).join('');

        return `
            <p>Черновик акта списания № ${html(draft.number || '—')} (${Number(draft.positions || 0)} позиций, ${Number(draft.units || 0)} единиц)</p>
            ${lines ? `<ul class="pending-writeoff-breakdown">${lines}</ul>` : ''}
            <div class="dashboard-actions">
                <button type="button" class="btn-accent" onclick="showPage('writeoffActs');openDraftWriteoffAct()">Перейти к акту списания</button>
            </div>`;
    }

    function getCandidateReasonLabel(reason) {
        switch (String(reason || '').trim()) {
            case 'in_draft': return 'Уже в черновике';
            case 'expiry': return 'Истек срок эксплуатации';
            case 'status': return 'Статус: К списанию';
            case 'zero_stock': return 'Нулевой остаток';
            default: return 'Требует проверки';
        }
    }

    function mapCandidateReasonCategory(reason) {
        switch (String(reason || '').trim()) {
            case 'expiry': return 'expiry';
            case 'zero_stock': return 'consumable';
            default: return 'other';
        }
    }

    async function addWriteoffCandidateToDraft(candidate) {
        const qty = Math.max(1, Number(candidate?.quantity || 1));
        const reason = String(candidate?.writeoffReason || getCandidateReasonLabel(candidate?.candidateReason)).trim() || 'Ручное списание';
        const reasonCategory = mapCandidateReasonCategory(candidate?.candidateReason);

        await apiFetch('/api/inventory/writeoff-acts/draft/add-item', {
            method: 'POST',
            body: JSON.stringify({
                itemId: String(candidate?.id || '').trim(),
                quantity: qty,
                reason,
                reasonCategory,
                comment: String(candidate?.endDate || '').trim()
                    ? `Основание: окончание срока эксплуатации (${formatDateOnlySafe(candidate.endDate, '—')})`
                    : '',
                basisType: 'item',
                basisId: String(candidate?.id || '').trim(),
                basisLabel: 'Карточка объекта',
                basisName: String(candidate?.name || candidate?.id || '').trim()
            })
        });
    }

    function buildWriteoffCandidatesHtml(candidates = []) {
        const rows = Array.isArray(candidates) ? candidates.slice(0, 10) : [];
        if (!rows.length) {
            return '<p style="color:var(--state-success-500);">Кандидатов к списанию не обнаружено</p>';
        }

        const items = rows.map(row => {
            const reasonLabel = getCandidateReasonLabel(row?.candidateReason);
            return `
                <li class="writeoff-candidate-item" data-item-id="${html(row.id)}">
                    <div>
                        <strong>${html(row.name || row.id || 'Объект')}</strong>
                        <div style="font-size:12px;color:var(--muted-text);">
                            ${html(row.category || 'Без категории')} • ${html(reasonLabel)}
                            ${row?.endDate ? ` • до ${html(formatDateOnlySafe(row.endDate, '—'))}` : ''}
                        </div>
                    </div>
                    <div class="dashboard-actions" style="margin:0;gap:6px;">
                        <button type="button" class="inline-action-btn writeoff-candidate-open" data-id="${html(row.id)}">Открыть</button>
                        <button type="button" class="inline-action-btn writeoff-candidate-add" data-id="${html(row.id)}">В черновик</button>
                    </div>
                </li>`;
        }).join('');

        return `
            <ul class="writeoff-candidates-list" style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">${items}</ul>
            <div class="dashboard-actions" style="margin-top:10px;">
                <button type="button" id="dashboardWriteoffCandidatesAddAll" class="btn-accent">Добавить все в черновик</button>
                <button type="button" onclick="showPage('writeoffActs');openDraftWriteoffAct()">Открыть черновик акта</button>
            </div>`;
    }

    function resolveIncidentSourceLabel(act = {}) {
        return act?.basis?.type === 'event' ? 'Возврат мероприятия' : 'Возврат аренды';
    }

    function summarizeActReason(items = [], fallback = '') {
        const uniqueReasons = [...new Set((items || []).map(item => String(item.reason || '').trim()).filter(Boolean))];
        if (uniqueReasons.length === 1) return uniqueReasons[0];
        if (uniqueReasons.length > 1) return 'Смешанная';
        return fallback || 'Без причины';
    }

    function formatAccountingTypeLabel(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'consumable' || raw.includes('расход')) return '⚡ Расходник';
        return '🏗️ ОС';
    }

    function formatWriteoffBasisLabel(basis = {}) {
        const rawType = String(basis?.type || '').trim().toLowerCase();
        if (rawType === 'item' || rawType === 'card') return 'Карточка объекта';
        const typeLabel = rawType === 'event' ? 'Мероприятие' : 'Аренда';
        return `${typeLabel}: ${restoreText(basis.name || '—')}`;
    }

    function buildWriteoffBasisAction(item = {}) {
        const basisType = String(item?.basisType || item?.basis_type || '').trim().toLowerCase();
        const basisId = String(item?.basisId || item?.basis_id || '').trim();
        const basisLabel = formatWriteoffItemBasisLabel(item);
        const sourceItemId = String(item?.sourceItemId || item?.source_item_id || item?.itemId || '').trim();
        const safeLabel = html(basisLabel);

        if (basisType === 'item' || basisLabel === 'Карточка объекта') {
            return `<button type="button" class="writeoff-item-link" onclick="openWriteoffBasisLink('item', '${html(sourceItemId).replace(/'/g, '&#39;')}', '${html(sourceItemId).replace(/'/g, '&#39;')}')">${safeLabel} 🔗</button>`;
        }
        if ((basisType === 'rental' || basisType === 'event') && basisId) {
            return `<button type="button" class="writeoff-item-link" onclick="openWriteoffBasisLink('${html(basisType).replace(/'/g, '&#39;')}', '${html(basisId).replace(/'/g, '&#39;')}', '${html(sourceItemId).replace(/'/g, '&#39;')}')">${safeLabel} 🔗</button>`;
        }
        return safeLabel;
    }

    function findWriteoffActByNumber(number) {
        return writeoffActsCache.find(act => String(act.number || '').trim() === String(number || '').trim()) || null;
    }

    function groupWriteoffItemsForDisplay(items) {
        const groups = new Map();
        for (const item of (Array.isArray(items) ? items : [])) {
            const key = [
                String(item.name || item.itemId || '').trim().toLowerCase(),
                String(item.category || '').trim().toLowerCase(),
                String(item.type || '').trim().toLowerCase(),
                String(item.reason || '').trim().toLowerCase(),
                String(item.comment || '').trim().toLowerCase(),
                String(item.basisType || item.basis_type || '').trim().toLowerCase(),
                String(item.basisId || item.basis_id || '').trim().toLowerCase(),
                String(item.basisLabel || item.basis_label || '').trim().toLowerCase(),
                String(item.basisName || item.basis_name || '').trim().toLowerCase(),
                String(item.basisActNumber || item.basis_act_number || '').trim().toLowerCase()
            ].join('::');
            if (!groups.has(key)) {
                groups.set(key, {
                    ...item,
                    quantity: Number(item.quantity || 0),
                    sourceItemId: item.sourceItemId || item.itemId || null,
                    markerItemId: item.markerItemId || item.itemId || null,
                    basisType: item.basisType || item.basis_type || '',
                    basisId: item.basisId || item.basis_id || null,
                    basisLabel: item.basisLabel || item.basis_label || '',
                    basisName: item.basisName || item.basis_name || '',
                    basisActNumber: item.basisActNumber || item.basis_act_number || ''
                });
            } else {
                const grouped = groups.get(key);
                grouped.quantity += Number(item.quantity || 0);
                if (!grouped.sourceItemId && (item.sourceItemId || item.itemId)) {
                    grouped.sourceItemId = item.sourceItemId || item.itemId;
                }
                if (!grouped.markerItemId && (item.markerItemId || item.itemId)) {
                    grouped.markerItemId = item.markerItemId || item.itemId;
                }
                if (!grouped.basisType && (item.basisType || item.basis_type)) grouped.basisType = item.basisType || item.basis_type;
                if ((!grouped.basisId && grouped.basisId !== 0) && (item.basisId || item.basis_id)) grouped.basisId = item.basisId || item.basis_id;
                if (!grouped.basisLabel && (item.basisLabel || item.basis_label)) grouped.basisLabel = item.basisLabel || item.basis_label;
                if (!grouped.basisName && (item.basisName || item.basis_name)) grouped.basisName = item.basisName || item.basis_name;
                if (!grouped.basisActNumber && (item.basisActNumber || item.basis_act_number)) grouped.basisActNumber = item.basisActNumber || item.basis_act_number;
            }
        }
        return Array.from(groups.values());
    }

    function renderWriteoffActDetailsContent(act, options = {}) {
        const printMode = options.printMode === true;
        const rawItems = Array.isArray(act?.items) ? act.items : [];
        const items = groupWriteoffItemsForDisplay(rawItems);
        const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const itemsCount = items.length;
        const incidentSource = resolveIncidentSourceLabel(act);
        const isDraft = String(act?.status || '').trim() === 'Черновик';
        const isPosted = String(act?.status || '').trim() === 'Проведен';
        const editMode = options.editMode === true && isDraft;

        if (printMode) {
            // Официальный документ — как акт передачи / выдачи
            const currentDate = html(formatDateOnlySafe(act?.date || act?.createdAt, '—'));
            const responsible = html(`${act?.responsible?.name || '—'} (${act?.responsible?.position || 'Кладовщик'})`);
            return `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>${buildUnifiedPrintStyle('.summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }')}</style>
</head>
<body>
<div class="document">
  <div class="header">
    <div class="title">АКТ СПИСАНИЯ № ${html(act?.number || '—')}</div>
    <div class="subtitle">списание материальных ценностей</div>
  </div>
  <div class="doc-info">
    <div><strong>Дата составления:</strong> ${currentDate}</div>
    <div><strong>Основание:</strong> ${html(act?.basis?.actNumber || '—')}</div>
    <div><strong>Статус:</strong> ${isPosted ? 'Проведён' : 'Черновик'}</div>
  </div>
  <div class="section">
    <div class="section-title">Сведения об объекте</div>
    <div class="info-box">
      <div class="info-line">• Объект: ${html(act?.basis?.name || '—')}</div>
      <div class="info-line">• Ответственное лицо: ${responsible}</div>
      <div class="info-line">• Источник: ${html(incidentSource)}</div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Сведения о списываемых материальных ценностях</div>
    <table>
      <thead>
        <tr>
          <th>Наименование</th>
          <th>Категория</th>
          <th class="text-center">Кол-во (ед.)</th>
          <th>Причина списания</th>
          <th>Основание</th>
          <th>Комментарий</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `
        <tr>
          <td>${html(item.name || item.itemId || '—')}</td>
          <td>${html(item.category || '—')}</td>
          <td class="text-center">${Number(item.quantity || 0)}</td>
          <td>${html(item.reason || 'Без причины')}</td>
          <td>${html(formatWriteoffItemBasisLabel(item))}</td>
          <td>${html(item.comment || '—')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="section summary-section">
    <div class="section-title">Итоги</div>
    <div class="summary-grid">
      <div class="summary-card"><div class="summary-label">Наименований</div><div class="summary-value">${itemsCount}</div></div>
      <div class="summary-card"><div class="summary-label">Всего единиц</div><div class="summary-value">${totalUnits}</div></div>
      <div class="summary-card"><div class="summary-label">Дата списания</div><div class="summary-value" style="font-size:13px">${currentDate}</div></div>
    </div>
    <p style="margin-top:10px;font-size:11px">Итого: Списано <strong>${itemsCount}</strong> наименований в количестве <strong>${totalUnits}</strong> единиц.</p>
  </div>
  <div class="section">
    <div class="section-title">Подписи</div>
    <div class="signature-row">
      <div class="signature-block">
        <div>Ответственное лицо (кладовщик)</div>
        <div class="signature-line"></div>
        <div class="signature-label">(подпись)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Ф.И.О., дата)</div>
      </div>
      <div class="signature-block">
        <div>Комиссия / принял</div>
        <div class="signature-line"></div>
        <div class="signature-label">(подпись)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Ф.И.О., дата)</div>
      </div>
    </div>
        <div class="stamp-row">
            <div class="stamp-box">М.П.</div>
            <div class="stamp-box">М.П.</div>
        </div>
  </div>
  <div class="footer">Документ сформирован ${currentDate} | Акт № ${html(act?.number || '—')}</div>
</div>
</body>
</html>`;
        }

        // UI-режим (не в печать) — оригинальный вид карточки
        const reasonSuggestions = getWriteoffReasonSuggestions().map(value => `<option value="${html(value)}"></option>`).join('');
        return `
            <div class="writeoff-act-document" id="writeoffActPrintableArea">
                <div class="writeoff-act-header">
                    <h3>АКТ СПИСАНИЯ № ${html(act?.number || '—')}</h3>
                </div>
                <div class="writeoff-act-meta">
                    <div><strong>Дата:</strong> ${html(formatDateTimeSafe(act?.date || act?.createdAt, '—'))}</div>
                    <div><strong>Основание:</strong> ${html(act?.basis?.actNumber || '—')}</div>
                    <div><strong>Объект:</strong> ${html(act?.basis?.name || '—')}</div>
                    <div><strong>Статус:</strong> ${html(act?.status || 'Проведен')}</div>
                    <div><strong>Ответственный:</strong> ${html(`${act?.responsible?.name || '—'} (${act?.responsible?.position || '—'})`)}</div>
                </div>
                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Объект</th>
                                <th>Категория</th>
                                <th>Кол-во</th>
                                <th>Причина списания</th>
                                <th>Основание</th>
                                <th>Комментарий</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(item => {
                                const cardItemId = item.sourceItemId || item.markerItemId || item.itemId;
                                const canOpenCard = Boolean(cardItemId);
                                const itemId = html(String(item.itemId || ''));
                                const itemName = html(String(item.name || item.itemId || '—'));
                                const itemCategory = html(String(item.category || ''));
                                const itemType = html(String(item.type || 'asset'));
                                const itemReason = html(String(item.reason || ''));
                                const itemComment = html(String(item.comment || ''));
                                const itemQty = Math.max(1, Number(item.quantity || 0));
                                const basisAction = buildWriteoffBasisAction(item);
                                const itemOpenButton = canOpenCard
                                    ? `<button type="button" class="writeoff-item-link" onclick="openItemCardFromWriteoff('${html(String(cardItemId)).replace(/'/g, '&#39;')}', '${html(String(item.sourceItemId || '')).replace(/'/g, '&#39;')}')">${itemName}</button>`
                                    : itemName;
                                return `
                                <tr ${editMode ? `data-writeoff-edit-row="1" data-item-id="${itemId}" data-item-name="${itemName}" data-item-category="${itemCategory}" data-item-type="${itemType}" data-basis-type="${html(String(item.basisType || item.basis_type || ''))}" data-basis-id="${html(String(item.basisId || item.basis_id || ''))}" data-basis-label="${html(String(item.basisLabel || item.basis_label || ''))}" data-basis-name="${html(String(item.basisName || item.basis_name || ''))}" data-basis-act-number="${html(String(item.basisActNumber || item.basis_act_number || ''))}"` : ''}>
                                    <td>${itemOpenButton}</td>
                                    <td>${html(item.category || '—')}</td>
                                    <td>${editMode ? `<input type="number" class="writeoff-edit-qty" min="1" step="1" value="${itemQty}" style="width:88px;">` : Number(item.quantity || 0)}</td>
                                    <td>${editMode ? `<input type="text" class="writeoff-edit-reason" list="writeoffReasonSuggestions" value="${itemReason}" style="min-width:240px;">` : html(item.reason || 'Без причины')}</td>
                                    <td>${basisAction}</td>
                                    <td>${editMode ? `<input type="text" class="writeoff-edit-comment" value="${itemComment}" style="min-width:240px;">` : html(item.comment || '—')}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                ${editMode ? `<datalist id="writeoffReasonSuggestions">${reasonSuggestions}</datalist>` : ''}
                <div class="writeoff-act-summary">Итого: ${itemsCount} позиций, ${totalUnits} единиц${isDraft ? ' (черновик)' : ''}</div>
                <div class="writeoff-modal-signature">
                    ___________________________<br>
                    (должность, Ф.И.О., дата)
                </div>
            </div>
        `;
    }

    async function downloadWriteoffPdf(act) {
        if (!act) {
            showNotification('Не выбран акт списания для PDF', 'warning');
            return;
        }

        const htmlContent = renderWriteoffActDetailsContent(act, { printMode: true });
        const fileName = `Акт_списания_${act.number || 'без_номера'}.pdf`;
        if (typeof exportDocumentPdf === 'function') {
            await exportDocumentPdf(`<!doctype html><html lang="ru"><head><meta charset="UTF-8"></head><body>${htmlContent}</body></html>`, fileName, false);
            return;
        }

        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0.01;pointer-events:none;z-index:-1;background:#fff';
        document.body.appendChild(iframe);

        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iframeDoc) throw new Error('Не удалось открыть документ для печати');

            iframeDoc.open();
            iframeDoc.write(htmlContent);
            iframeDoc.close();

            await new Promise(resolve => setTimeout(resolve, 350));

            const iframeWindow = iframe.contentWindow;
            if (!iframeWindow) throw new Error('Не удалось подготовить окно печати');

            iframeWindow.focus();

            iframeWindow.print();
            showNotification(`Открыт предпросмотр печати: ${fileName}`, 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка генерации PDF', 'error');
        } finally {
            setTimeout(() => iframe.remove(), 1500);
        }
    }

    async function loadWriteoffActs() {
        const tbody = document.getElementById('writeoffActsTableBody');
        if (!tbody) return;

        try {
            const filters = readWriteoffFilters();
            const rows = await apiFetch(buildWriteoffQuery(filters));
            const loadedRows = Array.isArray(rows) ? rows : [];

            writeoffActsCache = loadedRows.filter(row => {
                const items = Array.isArray(row?.items) ? row.items : [];
                const incidentSource = resolveIncidentSourceLabel(row);
                const reasonCategoryKeys = [...new Set(items.map(item => getWriteoffReasonCategoryKey(item.reasonCategory || item.reason_category || item.reason || '', item.type || item.item_type || 'asset')))];

                const matchesReasonCategory = !String(filters.reasonCategory || '').trim() || reasonCategoryKeys.includes(String(filters.reasonCategory));
                const matchesIncidentSource = !String(filters.incidentSource || '').trim() || String(incidentSource) === String(filters.incidentSource);
                return matchesReasonCategory && matchesIncidentSource;
            });

            if (writeoffActsCache.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-table-message">Акты списания отсутствуют</td></tr>';
                return;
            }

            tbody.innerHTML = writeoffActsCache.map((row, index) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const positionsSummary = buildWriteoffPositionsSummary(items);
                const positionsTooltip = buildWriteoffPositionsTooltip(items);
                const totalUnits = Number(row?.totals?.totalUnits || items.reduce((sum, item) => sum + Number(item.quantity || 0), 0));

                return `
                    <tr data-writeoff-index="${index}">
                        <td>${html(row.number || row.act_number || '—')}</td>
                        <td>${html(formatDateTimeSafe(row.date || row.createdAt || row.act_date, '—'))}</td>
                        <td class="writeoff-positions-cell">
                            <span class="writeoff-positions-summary" title="${html(positionsTooltip)}">${html(positionsSummary)}</span>
                        </td>
                        <td>${totalUnits}</td>
                        <td><span class="${getStatusBadgeClass(row.status)}">${html(row.status || 'Проведен')}</span></td>
                        <td>
                            <div class="writeoff-actions">
                                <button type="button" class="inline-action-btn writeoff-open-btn" data-index="${index}">Открыть</button>
                                <button type="button" class="inline-action-btn writeoff-pdf-btn" data-index="${index}">PDF</button>
                                ${String(row.status || '').trim() === 'Черновик' ? `<button type="button" class="inline-action-btn writeoff-post-btn" data-index="${index}">Провести</button>` : ''}
                                ${String(row.status || '').trim() === 'Проведен' ? `<button type="button" class="inline-action-btn writeoff-unpost-btn" data-index="${index}">Отменить</button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.writeoff-open-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const index = Number(button.dataset.index);
                    const act = writeoffActsCache[index];
                    if (act) openWriteoffActDetails(act);
                });
            });

            tbody.querySelectorAll('.writeoff-pdf-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const index = Number(button.dataset.index);
                    const act = writeoffActsCache[index];
                    await downloadWriteoffPdf(act);
                });
            });

            tbody.querySelectorAll('.writeoff-post-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const index = Number(button.dataset.index);
                    const act = writeoffActsCache[index];
                    if (!act?.dbId) return;
                    try {
                        await apiFetch(`/api/inventory/writeoff-acts/${Number(act.dbId)}/post`, { method: 'POST' });
                        showNotification(`Акт ${act.number || ''} проведен`, 'success');
                        await loadData();
                        await loadWriteoffActs();
                        await loadAccountingDashboard();
                    } catch (error) {
                        showNotification(error.message || 'Ошибка проведения акта списания', 'error');
                    }
                });
            });

            tbody.querySelectorAll('.writeoff-unpost-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const index = Number(button.dataset.index);
                    const act = writeoffActsCache[index];
                    if (!act?.dbId) return;

                    if (!window.confirm(`Отменить проведение акта ${act.number || ''}? Документ вернется в черновик.`)) {
                        return;
                    }

                    try {
                        await apiFetch(`/api/inventory/writeoff-acts/${Number(act.dbId)}/unpost`, { method: 'POST' });
                        showNotification(`Акт ${act.number || ''} переведен в черновик`, 'success');
                        await loadData();
                        await loadWriteoffActs();
                        await loadAccountingDashboard();
                    } catch (error) {
                        showNotification(error.message || 'Ошибка отмены проведения акта списания', 'error');
                    }
                });
            });

            tbody.querySelectorAll('tr[data-writeoff-index]').forEach(row => {
                row.addEventListener('click', () => {
                    const index = Number(row.dataset.writeoffIndex);
                    const act = writeoffActsCache[index];
                    if (act) openWriteoffActDetails(act);
                });
            });
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-table-message">Ошибка загрузки актов: ${html(error.message || 'неизвестная ошибка')}</td></tr>`;
        }
    }

    function syncWriteoffActModalButtons() {
        const status = String(selectedWriteoffAct?.status || '').trim();
        const isDraft = status === 'Черновик';
        const isPosted = status === 'Проведен';

        const postBtn = document.getElementById('writeoffActPostBtn');
        const editBtn = document.getElementById('writeoffActEditBtn');
        const saveBtn = document.getElementById('writeoffActSaveBtn');
        const editCancelBtn = document.getElementById('writeoffActEditCancelBtn');
        const unpostBtn = document.getElementById('writeoffActUnpostBtn');

        if (postBtn) {
            postBtn.style.display = isDraft && !writeoffActEditMode ? '' : 'none';
            postBtn.disabled = false;
        }
        if (editBtn) editBtn.style.display = isDraft && !writeoffActEditMode ? '' : 'none';
        if (saveBtn) saveBtn.style.display = isDraft && writeoffActEditMode ? '' : 'none';
        if (editCancelBtn) editCancelBtn.style.display = isDraft && writeoffActEditMode ? '' : 'none';
        if (unpostBtn) unpostBtn.style.display = isPosted ? '' : 'none';
    }

    function renderSelectedWriteoffActContent() {
        const content = document.getElementById('writeoffActDetailsContent');
        if (!content || !selectedWriteoffAct) return;
        content.innerHTML = renderWriteoffActDetailsContent(selectedWriteoffAct, { editMode: writeoffActEditMode });
    }

    function openWriteoffActDetails(act) {
        if (!act) return;
        writeoffActEditMode = false;
        selectedWriteoffAct = act;
        const modal = document.getElementById('writeoffActDetailsModal');
        const title = document.getElementById('writeoffActDetailsTitle');

        if (!modal || !title) return;

        title.textContent = `Акт списания № ${act.number || '—'}`;
        renderSelectedWriteoffActContent();
        syncWriteoffActModalButtons();
        modal.style.display = 'block';
    }

    function closeWriteoffActDetailsModal() {
        writeoffActEditMode = false;
        const modal = document.getElementById('writeoffActDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function collectWriteoffDraftEdits() {
        const content = document.getElementById('writeoffActDetailsContent');
        const rows = Array.from(content?.querySelectorAll('tr[data-writeoff-edit-row="1"]') || []);

        return rows.map(row => {
            const qtyField = row.querySelector('.writeoff-edit-qty');
            const reasonField = row.querySelector('.writeoff-edit-reason');
            const commentField = row.querySelector('.writeoff-edit-comment');
            const itemId = String(row.getAttribute('data-item-id') || '').trim();
            const reason = String(reasonField?.value || '').trim() || 'Списание по решению руководства';

            return {
                itemId,
                itemName: String(row.getAttribute('data-item-name') || '').trim(),
                category: String(row.getAttribute('data-item-category') || '').trim(),
                type: String(row.getAttribute('data-item-type') || '').trim(),
                quantity: Math.max(1, Number(qtyField?.value || 1)),
                reason,
                reasonCategory: getWriteoffReasonCategoryKey(reason, String(row.getAttribute('data-item-type') || '').trim()),
                comment: String(commentField?.value || '').trim(),
                basisType: String(row.getAttribute('data-basis-type') || '').trim(),
                basisId: String(row.getAttribute('data-basis-id') || '').trim(),
                basisLabel: String(row.getAttribute('data-basis-label') || '').trim(),
                basisName: String(row.getAttribute('data-basis-name') || '').trim(),
                basisActNumber: String(row.getAttribute('data-basis-act-number') || '').trim()
            };
        }).filter(item => item.itemId && item.quantity > 0);
    }

    async function saveWriteoffActChanges() {
        if (!selectedWriteoffAct?.dbId) {
            showNotification('Не выбран акт списания', 'warning');
            return;
        }

        const status = String(selectedWriteoffAct.status || '').trim();
        if (status !== 'Черновик') {
            showNotification('Редактирование доступно только для черновика', 'warning');
            return;
        }

        const editedItems = collectWriteoffDraftEdits();
        if (!editedItems.length) {
            showNotification('Добавьте хотя бы одну позицию для сохранения', 'warning');
            return;
        }

        try {
            await apiFetch(`/api/inventory/writeoff-acts/${Number(selectedWriteoffAct.dbId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: editedItems })
            });

            await loadData();
            await loadWriteoffActs();
            const refreshedAct = findWriteoffActByNumber(selectedWriteoffAct.number);
            if (refreshedAct) selectedWriteoffAct = refreshedAct;

            writeoffActEditMode = false;
            renderSelectedWriteoffActContent();
            syncWriteoffActModalButtons();
            showNotification('Черновик акта списания обновлен', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка сохранения акта списания', 'error');
        }
    }

    async function unpostWriteoffAct() {
        if (!selectedWriteoffAct?.dbId) {
            showNotification('Не выбран акт списания', 'warning');
            return;
        }

        if (!window.confirm(`Отменить проведение акта ${selectedWriteoffAct.number || ''}? Документ вернется в черновик.`)) {
            return;
        }

        try {
            await apiFetch(`/api/inventory/writeoff-acts/${Number(selectedWriteoffAct.dbId)}/unpost`, { method: 'POST' });
            await loadData();
            await loadWriteoffActs();

            const refreshedAct = findWriteoffActByNumber(selectedWriteoffAct.number);
            if (refreshedAct) selectedWriteoffAct = refreshedAct;

            writeoffActEditMode = false;
            renderSelectedWriteoffActContent();
            syncWriteoffActModalButtons();
            await loadAccountingDashboard();
            showNotification(`Акт ${selectedWriteoffAct.number || ''} переведен в черновик`, 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка отмены проведения акта списания', 'error');
        }
    }

    function enableWriteoffActEditing() {
        if (!selectedWriteoffAct) return;
        const status = String(selectedWriteoffAct.status || '').trim();
        if (status !== 'Черновик') {
            showNotification('Редактирование доступно только для черновика', 'warning');
            return;
        }
        writeoffActEditMode = true;
        renderSelectedWriteoffActContent();
        syncWriteoffActModalButtons();
    }

    function cancelWriteoffActEditing() {
        writeoffActEditMode = false;
        renderSelectedWriteoffActContent();
        syncWriteoffActModalButtons();
    }

    async function exportWriteoffActsToExcel() {
        if (!writeoffActsCache.length) {
            showNotification('Нет данных для экспорта', 'warning');
            return;
        }

        const headers = ['№ акта', 'Дата', 'Позиции', 'Всего ед.', 'Статус', 'Детали'];
        const rows = writeoffActsCache.map(act => [
            act.number || '',
            formatDateTimeSafe(act.date || act.createdAt || ''),
            buildWriteoffPositionsSummary(act.items || [], 20),
            Number(act?.totals?.totalUnits || 0),
            act.status || '',
            buildWriteoffPositionsTooltip(act.items || [])
        ]);

        downloadExcelFromData('writeoff_acts.xlsx', headers, rows);
        showNotification('Акты списания экспортированы в Excel', 'success');
    }

    async function loadEventWriteoffActs(eventRef) {
        const section = document.getElementById('eventWriteoffActsSection');
        const list = document.getElementById('eventWriteoffActsList');
        if (!section || !list) return;

        const eventId = Number(eventRef?.id || eventRef || 0);
        const acceptanceNumber = String(eventRef?.acceptance_act_number || eventRef?.acceptanceActNumber || '').trim().toUpperCase();

        if (!eventId && !acceptanceNumber) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.textContent = 'Загрузка...';

        try {
            const rows = await apiFetch('/api/inventory/writeoff-acts?basisType=event');
            const acts = (Array.isArray(rows) ? rows : []).filter(row => {
                const headerId = Number(row?.basis?.id || 0);
                const headerAct = String(row?.basis?.actNumber || '').trim().toUpperCase();
                const matchesHeader = (eventId > 0 && headerId === eventId)
                    || (acceptanceNumber && headerAct === acceptanceNumber);

                const matchesItems = Array.isArray(row?.items) && row.items.some(item => {
                    const itemType = String(item?.basisType || item?.basis_type || '').trim().toLowerCase();
                    const itemId = Number(item?.basisId || item?.basis_id || 0);
                    const itemAct = String(item?.basisActNumber || item?.basis_act_number || '').trim().toUpperCase();
                    return (itemType === 'event' && eventId > 0 && itemId === eventId)
                        || (acceptanceNumber && itemAct === acceptanceNumber);
                });

                return matchesHeader || matchesItems;
            });

            if (!acts.length) {
                list.innerHTML = 'Для этого мероприятия акты списания не найдены.';
                return;
            }

            list.innerHTML = acts.map(act => `
                <div class="event-writeoff-act-row">
                    <div>
                        <strong>${html(act.number || '—')}</strong><br>
                        ${html(formatDateTimeSafe(act.date || act.createdAt, '—'))}
                    </div>
                    <div>
                        Позиций: ${Number(act?.totals?.itemsCount || 0)}, единиц: ${Number(act?.totals?.totalUnits || 0)}
                    </div>
                    <div>
                        <button type="button" class="inline-action-btn" onclick="openWriteoffActDetailsByNumber('${html(String(act.number || '')).replace(/'/g, '&#39;')}')">Открыть</button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            list.innerHTML = `Ошибка загрузки: ${html(error.message || 'неизвестная ошибка')}`;
        }
    }

    function resetWriteoffActsFilters() {
        const ids = ['writeoffDateFromFilter', 'writeoffDateToFilter', 'writeoffBasisTypeFilter', 'writeoffReasonCategoryFilter', 'writeoffIncidentSourceFilter', 'writeoffObjectFilter', 'writeoffReasonFilter'];
        ids.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            if (element.tagName === 'SELECT') element.selectedIndex = 0;
            else element.value = '';
        });
        loadWriteoffActs();
    }

    const originalOpenEditEventModal = window.openEditEventModal;
    window.openEditEventModal = async function openEditEventModalWithWriteoff(event, options = {}) {
        if (typeof originalOpenEditEventModal === 'function') {
            await originalOpenEditEventModal(event, options);
        }
        await loadEventWriteoffActs(event);
    };

    window.loadWriteoffActs = loadWriteoffActs;
    window.resetWriteoffActsFilters = resetWriteoffActsFilters;
    window.exportWriteoffActsToExcel = exportWriteoffActsToExcel;
    window.addAssetToWriteoffDraft = addAssetToWriteoffDraft;
    window.closeWriteoffActDetailsModal = closeWriteoffActDetailsModal;
    window.enableWriteoffActEditing = enableWriteoffActEditing;
    window.cancelWriteoffActEditing = cancelWriteoffActEditing;
    window.saveWriteoffActChanges = saveWriteoffActChanges;
    window.unpostWriteoffAct = unpostWriteoffAct;
    window.downloadWriteoffActPdf = async function downloadWriteoffActPdf() {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'print', 'Недостаточно прав для печати/PDF документов')) return;
        await downloadWriteoffPdf(selectedWriteoffAct);
    };
    window.printWriteoffActDetails = function printWriteoffActDetails() {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'print', 'Недостаточно прав для печати/PDF документов')) return;
        const area = document.getElementById('writeoffActPrintableArea');
        if (!area) return;

        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);

        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (!frameDoc) {
            frame.remove();
            return;
        }

        frameDoc.open();
        frameDoc.write(renderWriteoffActDetailsContent(selectedWriteoffAct, { printMode: true }));
        frameDoc.close();

        setTimeout(() => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(() => frame.remove(), 800);
        }, 200);
    };
    window.openWriteoffActDetails = function openWriteoffActDetailsGlobal(act) {
        openWriteoffActDetails(act);
    };
    window.openWriteoffActDetailsByNumber = async function openWriteoffActDetailsByNumber(number) {
        if (!writeoffActsCache.length) {
            await loadWriteoffActs();
        }
        const act = findWriteoffActByNumber(number);
        if (!act) {
            showNotification('Акт списания не найден', 'warning');
            return;
        }
        openWriteoffActDetails(act);
    };
    window.openWriteoffBasisLink = async function openWriteoffBasisLink(basisType, basisId = '', sourceItemId = '') {
        try {
            const normalizedType = String(basisType || '').trim().toLowerCase();
            const normalizedId = String(basisId || '').trim();
            const normalizedSourceItemId = String(sourceItemId || '').trim();

            if (typeof loadData === 'function') {
                await loadData();
            }

            if (normalizedType === 'item' || normalizedType === 'card') {
                await window.openItemCardFromWriteoff(normalizedSourceItemId || normalizedId, normalizedSourceItemId || normalizedId);
                return;
            }

            if (normalizedType === 'rental') {
                const rental = typeof window.findRentalById === 'function' ? window.findRentalById(normalizedId) : null;
                if (!rental) {
                    showNotification('Основание аренды не найдено', 'warning');
                    return;
                }
                if (typeof window.showPage === 'function') window.showPage('rentals');
                if (typeof window.openEditRentalModal === 'function') {
                    await window.openEditRentalModal(rental);
                }
                return;
            }

            if (normalizedType === 'event') {
                const event = typeof window.findEventById === 'function' ? window.findEventById(normalizedId) : null;
                if (!event) {
                    showNotification('Основание мероприятия не найдено', 'warning');
                    return;
                }
                if (typeof window.showPage === 'function') window.showPage('events');
                if (typeof window.openEditEventModal === 'function') {
                    await window.openEditEventModal(event);
                }
                return;
            }

            showNotification('Основание не поддерживает переход', 'info');
        } catch (error) {
            showNotification(error.message || 'Ошибка перехода к основанию', 'error');
        }
    };
    window.openItemCardFromWriteoff = async function openItemCardFromWriteoff(itemId, sourceItemId = '') {
        try {
            const primaryId = String(itemId || '').trim();
            const sourceId = String(sourceItemId || '').trim();
            if (!primaryId && !sourceId) return;

            const markerMatch = primaryId.match(/^WO-\d+-(.+)$/i);
            const markerSourceId = markerMatch?.[1] ? String(markerMatch[1]).trim() : '';

            if (typeof window.showPage === 'function') {
                window.showPage('sklad');
            }

            if (typeof loadData === 'function') {
                await loadData();
            }
            const candidateIds = [primaryId, sourceId, markerSourceId]
                .map(value => String(value || '').trim())
                .filter(Boolean);

            let item = null;
            if (typeof window.findInventoryItem === 'function') {
                for (const candidateId of candidateIds) {
                    item = window.findInventoryItem(candidateId);
                    if (item) break;
                }
            }

            if (!item) {
                showNotification('Объект не найден в справочнике склада', 'warning');
                return;
            }

            if (typeof window.openItemCard === 'function') {
                window.openItemCard(item);
            }
        } catch (error) {
            showNotification(error.message || 'Ошибка перехода к карточке объекта', 'error');
        }
    };
    window.postWriteoffAct = async function postWriteoffAct() {
        if (!selectedWriteoffAct?.dbId) {
            showNotification('Не выбран акт списания', 'warning');
            return;
        }
        try {
            await apiFetch(`/api/inventory/writeoff-acts/${Number(selectedWriteoffAct.dbId)}/post`, {
                method: 'POST'
            });
            showNotification(`Акт ${selectedWriteoffAct.number || ''} проведен`, 'success');
            await loadData();
            await loadWriteoffActs();
            closeWriteoffActDetailsModal();
            await loadAccountingDashboard();
        } catch (error) {
            showNotification(error.message || 'Ошибка проведения акта списания', 'error');
        }
    };
    window.openDraftWriteoffAct = async function openDraftWriteoffAct() {
        if (!writeoffActsCache.length) {
            await loadWriteoffActs();
        }
        const draft = writeoffActsCache.find(act => String(act.status || '').trim() === 'Черновик');
        if (!draft) {
            showNotification('Активный черновик акта списания не найден', 'warning');
            return;
        }
        openWriteoffActDetails(draft);
    };
    window.loadIssuanceActs = loadIssuanceActs;
    window.loadTransferActs = loadTransferActs;
    window.loadAcceptanceActs = loadAcceptanceActs;
    window.closeDocumentCardModal = closeDocumentCardModal;
    window.resetDocumentTypeFilters = function resetDocumentTypeFilters(docType) {
        const prefix = normalizeDocType(docType);
        ['DateFromFilter', 'DateToFilter', 'BasisFilter', 'CounterpartyFilter'].forEach(suffix => {
            const element = document.getElementById(`${prefix}${suffix}`);
            if (!element) return;
            if (element.tagName === 'SELECT') element.selectedIndex = 0;
            else element.value = '';
        });
        if (docType === 'purchaseAct') {
            ['purchaseActDateFromFilter', 'purchaseActDateToFilter', 'purchaseActBasisFilter'].forEach(id => {
                const element = document.getElementById(id);
                if (!element) return;
                if (element.tagName === 'SELECT') element.selectedIndex = 0;
                else element.value = '';
            });
            loadPurchaseActs();
            return;
        }
        if (prefix === 'issuance') loadIssuanceActs();
        if (prefix === 'transfer') loadTransferActs();
        if (prefix === 'acceptance') loadAcceptanceActs();
        if (prefix === 'purchase_act') loadPurchaseActs();
    };
    window.resetDocumentsHubFilters = function resetDocumentsHubFilters() {
        ['documentsHubTypeFilter', 'documentsHubDateFromFilter', 'documentsHubDateToFilter', 'documentsHubSearchFilter'].forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            if (element.tagName === 'SELECT') element.selectedIndex = 0;
            else element.value = '';
        });
        loadDocumentsHub();
    };
    window.openDocumentCardByNumber = async function openDocumentCardByNumber(number) {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'view', 'Недостаточно прав для просмотра документов')) return;
        if (!writeoffActsCache.length) {
            await loadWriteoffActs();
        }
        const doc = findDocumentByNumber(number);
        if (!doc) {
            showNotification('Документ не найден', 'warning');
            return;
        }
        if (doc.source === 'purchase_request') {
            openPurchaseRequestDocument(doc.number);
            return;
        }
        if (doc.source === 'writeoff' && typeof window.openWriteoffActDetailsByNumber === 'function') {
            await window.openWriteoffActDetailsByNumber(doc.number);
            return;
        }
        openDocumentCard(doc);
    };
    window.goToDocumentBasisByNumber = async function goToDocumentBasisByNumber(number) {
        const doc = findDocumentByNumber(number);
        if (!doc) {
            showNotification('Документ не найден', 'warning');
            return;
        }
        await goToDocumentBasis(doc);
    };
    window.goToSelectedDocumentBasis = async function goToSelectedDocumentBasis() {
        if (!selectedDocumentCard) return;
        await goToDocumentBasis(selectedDocumentCard);
    };
    window.enableDocumentCardEditing = function enableDocumentCardEditing() {
        if (!selectedDocumentCard) return;
        if (!canEditDocument(selectedDocumentCard)) {
            showNotification('Редактирование разрешено только для черновиков', 'warning');
            return;
        }
        rerenderDocumentCard(true);
    };
    window.recalculateDocumentCardTotals = function recalculateDocumentCardTotals() {
        const content = document.getElementById('documentCardContent');
        if (!content) return;

        let total = 0;
        content.querySelectorAll('tr[data-document-item-index]').forEach(row => {
            const qtyInput = row.querySelector('.document-item-qty-input');
            const priceInput = row.querySelector('.document-item-price-input');
            const quantity = qtyInput ? Number(qtyInput.value || 0) : Number(row.getAttribute('data-quantity') || 0);
            const price = priceInput
                ? Number(priceInput.value || 0)
                : Number((row.querySelector('.document-item-total')?.textContent || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) / Math.max(quantity, 1);
            const lineTotal = quantity * price;
            total += lineTotal;
            const totalCell = row.querySelector('.document-item-total');
            if (totalCell) totalCell.textContent = formatCurrency(lineTotal);
        });

        const totalNode = document.getElementById('documentCardTotalValue');
        if (totalNode) totalNode.textContent = formatCurrency(total);
    };
    window.saveDocumentCardChanges = async function saveDocumentCardChanges() {
        if (!selectedDocumentCard) return;
        if (!canEditDocument(selectedDocumentCard)) {
            showNotification('Редактирование для отмененных документов недоступно', 'warning');
            return;
        }

        try {
            const draftValues = collectDocumentCardDraftValues();
            if (!draftValues) return;

            const nextDocCandidate = {
                ...selectedDocumentCard,
                number: draftValues.number,
                date: draftValues.date,
                items: draftValues.items,
                amount: draftValues.amount
            };

            const validation = validateDocumentBeforeSave(nextDocCandidate);
            if (!validation.isValid) {
                showNotification(validation.errors.join('; '), 'error');
                return;
            }

            const history = ensureDocumentHistoryArray(selectedDocumentCard);
            history.push({
                date: new Date().toISOString(),
                text: 'Документ обновлен'
            });

            const nextDoc = {
                ...nextDocCandidate,
                updatedAt: new Date().toISOString(),
                history
            };

            await syncDocumentBasisSource(nextDoc);
            upsertDocumentRecord(nextDoc);
            selectedDocumentCard = cloneDocumentRecord(nextDoc);
            rerenderDocumentCard(false);
            refreshDocumentsPages();
            if (typeof refreshAllData === 'function') {
                await refreshAllData();
            }
            showNotification('Документ обновлен', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка обновления документа', 'error');
        }
    };
    window.cancelDocumentCardEditing = function cancelDocumentCardEditing() {
        if (!selectedDocumentCard) return;
        rerenderDocumentCard(false);
        showNotification('Изменения отменены', 'info');
    };
    window.printDocumentFromCard = function printDocumentFromCard() {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'print', 'Недостаточно прав для печати документов')) return;
        const area = document.getElementById('documentCardPrintableArea');
        if (!area) return;

        const unifiedPrintStyle = buildUnifiedPrintStyle(`
            .document-card-layout { display: flex; flex-direction: column; gap: 10px; }
            .dashboard-panel { border: 1px solid #d9d9d9; border-radius: 6px; padding: 10px 12px; background: #fff; box-shadow: none; }
            .dashboard-panel h3 { margin: 0 0 8px; font-size: 12px; font-weight: 700; }
            .document-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 12px; margin-bottom: 8px; }
            .report-table-wrapper, .report-table-scroll { overflow: visible !important; }
            .document-card-total { margin-top: 8px; text-align: right; font-weight: 700; }
            .doc-status, .pr-badge { border: 1px solid #d1d5db; background: #f9fafb; color: #374151; }
        `);

        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);

        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (!frameDoc) {
            frame.remove();
            return;
        }

        frameDoc.open();
        frameDoc.write(`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><title>Документ</title><style>${unifiedPrintStyle}</style></head><body>${area.outerHTML}</body></html>`);
        frameDoc.close();

        setTimeout(() => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(() => frame.remove(), 800);
        }, 200);
    };
    window.setDocumentStatus = function setDocumentStatus(status) {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'changeStatus', 'Недостаточно прав для изменения статуса документа')) return;
        if (!selectedDocumentCard?.number) return;
        if (selectedDocumentCard.source === 'writeoff') {
            showNotification('Для акта списания изменение статуса недоступно', 'warning');
            return;
        }
        (async () => {
            try {
                const updated = await updateDocumentStatus(selectedDocumentCard.number, status);
                if (!updated) {
                    showNotification('Документ не найден', 'warning');
                    return;
                }
                selectedDocumentCard.status = status;
                openDocumentCard(selectedDocumentCard);
                refreshDocumentsPages();
                if (typeof refreshAllData === 'function') {
                    await refreshAllData();
                }
                if (typeof window.refreshOpenEntityRelatedDocuments === 'function') {
                    await window.refreshOpenEntityRelatedDocuments();
                }
                showNotification(`Статус документа изменён: ${status}`, 'success');
            } catch (error) {
                showNotification(error.message || 'Ошибка изменения статуса документа', 'error');
            }
        })();
    };
    window.setDocumentStatusByNumber = async function setDocumentStatusByNumber(number, status) {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'changeStatus', 'Недостаточно прав для изменения статуса документа')) return;
        try {
            if (!await updateDocumentStatus(number, status)) {
                showNotification('Документ не найден', 'warning');
                return;
            }
            refreshDocumentsPages();
            if (typeof refreshAllData === 'function') {
                await refreshAllData();
            }
            if (typeof window.refreshOpenEntityRelatedDocuments === 'function') {
                await window.refreshOpenEntityRelatedDocuments();
            }
            showNotification(`Статус документа изменён: ${status}`, 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка изменения статуса документа', 'error');
        }
    };
    window.deleteDocumentByNumber = async function deleteDocumentByNumber(number) {
        const doc = findDocumentByNumber(number);
        if (!doc) {
            showNotification('Документ не найден', 'warning');
            return;
        }
        if (doc.source === 'writeoff') {
            showNotification('Акты списания удалять нельзя', 'warning');
            return;
        }
        if (String(doc.status || '').trim() !== 'Отменен') {
            showNotification('Сначала отмените проведение документа, затем удаляйте.', 'warning');
            return;
        }

        const docType = normalizeDocType(doc.docType);
        const basisType = String(doc.basisType || '').trim();
        if (['issuance', 'transfer'].includes(docType) && ['rental', 'event'].includes(basisType)) {
            try {
                const entity = await fetchDocumentBasisEntity(doc);
                const linkedNumber = String(entity?.issuance_act_number || '').trim();
                if (linkedNumber) {
                    showNotification('Документ всё ещё привязан к основанию. Выполните отмену проведения основания и повторите удаление.', 'warning');
                    return;
                }
            } catch (error) {
                showNotification(error.message || 'Не удалось проверить связь документа с основанием', 'error');
                return;
            }
        }

        deleteDocument(number);
        if (selectedDocumentCard?.number === number) closeDocumentCardModal();
        refreshDocumentsPages();
        if (typeof refreshAllData === 'function') {
            await refreshAllData();
        }
        if (typeof window.refreshOpenEntityRelatedDocuments === 'function') {
            await window.refreshOpenEntityRelatedDocuments();
        }
        showNotification('Документ удалён', 'success');
    };
    window.downloadDocumentPdfByNumber = async function downloadDocumentPdfByNumber(number) {
        if (typeof requirePermission === 'function' && !requirePermission('documents', 'print', 'Недостаточно прав для печати/PDF документов')) return;
        const doc = findDocumentByNumber(number);
        if (!doc) {
            showNotification('Документ не найден', 'warning');
            return;
        }
        if (doc.source === 'purchase_request') {
            await downloadPurchaseRequestPdf(doc.number);
            return;
        }
        if (doc.docType === 'writeoff') {
            await downloadWriteoffPdf(doc.writeoffRef || doc);
            return;
        }
        if (typeof window.downloadDocumentPdfByType === 'function') {
            await window.downloadDocumentPdfByType(doc);
            return;
        }
        showNotification('Генератор PDF не подключен', 'error');
    };
    window.downloadDocumentFromCard = async function downloadDocumentFromCard() {
        if (!selectedDocumentCard) return;
        await window.downloadDocumentPdfByNumber(selectedDocumentCard.number);
    };
    window.hasDocumentRecord = function hasDocumentRecord(docType, basisLabel) {
        const type = normalizeDocType(docType);
        const basis = String(basisLabel || '').trim();
        if (!basis) return false;
        return readDocumentsRegistry().some(doc => (
            normalizeDocType(doc.docType) === type
            && String(doc.basisLabel || '').trim() === basis
            && String(doc.status || '').trim() !== 'Отменен'
        ));
    };
    window.getDocumentNumbersByBasis = function getDocumentNumbersByBasis(docType, basisLabel) {
        const type = normalizeDocType(docType);
        const basis = String(basisLabel || '').trim();
        if (!basis) return [];

        return readDocumentsRegistry()
            .filter(doc => (
                normalizeDocType(doc.docType) === type
                && String(doc.basisLabel || '').trim() === basis
                && String(doc.status || '').trim() !== 'Отменен'
            ))
            .sort((left, right) => new Date(right.updatedAt || right.date || 0) - new Date(left.updatedAt || left.date || 0))
            .map(doc => String(doc.number || '').trim())
            .filter(Boolean);
    };
    window.removeDocumentsByTypeAndBasis = function removeDocumentsByTypeAndBasis(docType, basisType) {
        const type = normalizeDocType(docType);
        const basis = String(basisType || '').trim();
        const list = readDocumentsRegistry().filter(doc =>
            !(normalizeDocType(doc.docType) === type && String(doc.basisType || '').trim() === basis)
        );
        writeDocumentsRegistry(list);
        refreshDocumentsPages();
    };
    window.registerDocumentRecordSilent = function registerDocumentRecordSilent(record) {
        const docType = normalizeDocType(record?.docType);
        const items = Array.isArray(record?.items) ? record.items : [];
        const validation = evaluateDocumentConditions(docType, record?.entity || {}, items);
        const persisted = upsertDocumentRecord({
            ...record,
            docType,
            status: record?.status || validation.status,
            validationErrors: validation.errors,
            date: record?.date || new Date().toISOString()
        });
        refreshDocumentsPages();
        return persisted;
    };
    window.registerDocumentRecord = function registerDocumentRecord(record) {
        const docType = normalizeDocType(record?.docType);
        const items = Array.isArray(record?.items) ? record.items : [];
        const validation = evaluateDocumentConditions(docType, record?.entity || {}, items);
        const persisted = upsertDocumentRecord({
            ...record,
            docType,
            status: record?.status || validation.status,
            validationErrors: validation.errors,
            date: record?.date || new Date().toISOString()
        });

        if (validation.errors.length) {
            showNotification(`Документ ${persisted.number}: сохранён как черновик`, 'warning');
        } else {
            showNotification(`Документ ${persisted.number} создан`, 'success');
        }

        refreshDocumentsPages();
        return persisted;
    };

    const originalShowPage = window.showPage;
    window.showPage = function showPageAdvanced(pageId) {
        if (typeof originalShowPage === 'function') {
            originalShowPage(pageId);
        }
        if (pageId === 'history') {
            window.loadMovementHistory();
        }
        if (pageId === 'calendar') {
            window.loadOccupancyCalendar();
        }
        if (pageId === 'sklad') {
            renderInventoryStatusReport();
        }
        if (pageId === 'dashboard') {
            scheduleDashboardLoad();
        }
        if (pageId === 'purchaseRequests') {
            loadPurchaseRequests();
        }
        if (pageId === 'writeoffActs') {
            loadWriteoffActs();
        }
        if (pageId === 'documentsHub') {
            loadWriteoffActs().finally(() => loadDocumentsHub());
        }
        if (pageId === 'issuanceActs') {
            loadIssuanceActs();
        }
        if (pageId === 'transferActs') {
            loadTransferActs();
        }
        if (pageId === 'acceptanceActs') {
            loadAcceptanceActs();
        }
        if (pageId === 'purchaseActs') {
            loadPurchaseActs();
        }
    };

    const PURCHASE_REQUEST_DOCS_STORAGE_KEY = 'warehouse_purchase_request_documents_v1';
    const PURCHASE_ACTS_STORAGE_KEY = 'warehouse_purchase_acts_v1';
    const PURCHASE_REQUEST_STATUSES = ['draft', 'approval', 'approved', 'approved_partial', 'rejected', 'ordered', 'partial', 'completed', 'closed'];
    const PURCHASE_REQUEST_STATUS_LABELS = {
        draft: 'Черновик',
        approval: 'На согласовании',
        approved: 'Согласован',
        approved_partial: 'Согласована частично',
        rejected: 'Отклонена',
        ordered: 'Заказан',
        partial: 'Частично получен',
        completed: 'Получен',
        closed: 'Закрыта'
    };
    const PURCHASE_ITEM_STATUSES = ['draft', 'approval', 'approved', 'ordered', 'partial', 'completed', 'refused', 'cancelled'];
    const PURCHASE_ITEM_STATUS_LABELS = {
        draft: 'Черновик',
        approval: 'На согласовании',
        approved: 'Согласована',
        ordered: 'Заказана',
        partial: 'Частично получена',
        completed: 'Получена',
        refused: 'Отклонена',
        cancelled: 'Отменена'
    };

    let selectedPurchaseRequestNumber = null;
    let selectedPurchaseDeliveryNumber = null;
    let purchaseRequestEditMode = false;

    function getPurchaseStatusLabel(status) {
        const key = normalizePurchaseRequestStatus(restoreText(status || 'draft'));
        return PURCHASE_REQUEST_STATUS_LABELS[key] || PURCHASE_REQUEST_STATUS_LABELS.draft;
    }

    function normalizePurchaseRequestStatus(value, fallback = 'draft') {
        const raw = String(restoreText(value || '')).trim().toLowerCase().replace(/ё/g, 'е');
        if (!raw) return fallback;

        const aliases = {
            pending: 'approval',
            partial_approved: 'approved_partial',
            approved_partial: 'approved_partial',
            cancelled: 'rejected',
            canceled: 'rejected',
            canceled_by_manager: 'rejected',
            черновик: 'draft',
            новая: 'draft',
            'на согласовании': 'approval',
            согласование: 'approval',
            согласована: 'approved',
            'согласована частично': 'approved_partial',
            'частично согласована': 'approved_partial',
            заказана: 'ordered',
            поставлена: 'ordered',
            'частично поставлено': 'partial',
            'частично получен': 'partial',
            'частично получено': 'partial',
            получен: 'completed',
            получено: 'completed',
            отменена: 'rejected',
            закрыта: 'closed'
        };
        const normalized = aliases[raw] || raw;
        return PURCHASE_REQUEST_STATUSES.includes(normalized) ? normalized : fallback;
    }

    function normalizePurchaseItemStatus(value, fallback = 'draft') {
        const raw = String(restoreText(value || '')).trim().toLowerCase();
        if (!raw) return fallback;
        const aliases = {
            pending: 'approval',
            waiting: 'draft',
            approval_pending: 'approval',
            approved_item: 'approved',
            rejected: 'refused',
            declined: 'refused',
            denied: 'refused',
            canceled: 'cancelled',
            cancelled: 'cancelled'
        };
        const normalized = aliases[raw] || raw;
        return PURCHASE_ITEM_STATUSES.includes(normalized) ? normalized : fallback;
    }

    function getPurchaseItemStatusLabel(status) {
        const key = normalizePurchaseItemStatus(status);
        return PURCHASE_ITEM_STATUS_LABELS[key] || PURCHASE_ITEM_STATUS_LABELS.draft;
    }

    function getPurchaseStatusBadgeClass(status) {
        const key = normalizePurchaseRequestStatus(status);
        if (key === 'completed' || key === 'closed') return 'doc-status doc-status-posted';
        if (key === 'rejected') return 'doc-status doc-status-cancelled';
        if (key === 'partial') return 'doc-status doc-status-partial';
        return 'doc-status doc-status-draft';
    }

    function getEmployeesList() {
        return (typeof employees !== 'undefined' && Array.isArray(employees)) ? employees : [];
    }

    function findEmployeeById(employeeId) {
        const id = String(employeeId || '').trim();
        if (!id) return null;
        return getEmployeesList().find(e => String(e?.id || '').trim() === id) || null;
    }

    function normalizeResponsibleRef(value, fallbackPosition = '') {
        if (!value) return null;
        if (typeof value === 'string') {
            const name = String(value || '').trim();
            if (!name) return null;
            return { id: '', name, position: fallbackPosition || '—' };
        }

        const id = String(value.id || value.employeeId || '').trim();
        const name = String(value.name || value.fullName || '').trim();
        const position = String(value.position || fallbackPosition || '').trim();

        if (!id && !name) return null;

        const employee = id ? findEmployeeById(id) : null;
        return {
            id: id || String(employee?.id || '').trim(),
            name: name || String(employee?.name || '').trim(),
            position: position || String(employee?.position || '').trim() || '—'
        };
    }

    function findDefaultEmployeeByRole(roleKind) {
        const list = getEmployeesList();
        const isMatch = roleKind === 'approved'
            ? (position => position.includes('руковод'))
            : (position => position.includes('кладов'));

        return list.find(e => {
            const position = String(e?.position || '').trim().toLowerCase();
            return Boolean(position) && isMatch(position);
        }) || null;
    }

    function resolvePurchaseResponsibleRef(doc, roleKind) {
        const roleFallback = roleKind === 'approved' ? 'руководитель' : 'кладовщик';
        const primary = roleKind === 'approved' ? doc?.approvedBy : doc?.preparedBy;
        const legacyName = roleKind === 'approved'
            ? (doc?.approvedByName || doc?.approved_by_name || '')
            : (doc?.preparedByName || doc?.prepared_by_name || '');
        const legacyId = roleKind === 'approved'
            ? (doc?.approvedById || doc?.approved_by_id || '')
            : (doc?.preparedById || doc?.prepared_by_id || '');

        const resolvedPrimary = normalizeResponsibleRef(primary, roleFallback);
        if (resolvedPrimary && (String(resolvedPrimary.id || '').trim() || String(resolvedPrimary.name || '').trim())) {
            return resolvedPrimary;
        }

        const resolvedLegacyId = normalizeResponsibleRef({ id: legacyId }, roleFallback);
        if (resolvedLegacyId && String(resolvedLegacyId.name || '').trim()) {
            return resolvedLegacyId;
        }

        const resolvedLegacyName = normalizeResponsibleRef(String(legacyName || '').trim(), roleFallback);
        if (resolvedLegacyName) {
            return resolvedLegacyName;
        }

        const defaultEmployee = findDefaultEmployeeByRole(roleKind);
        if (!defaultEmployee) return null;
        return normalizeResponsibleRef(defaultEmployee, roleFallback);
    }

    function calculatePurchaseRequestStatusByItems(items = [], fallback = 'draft') {
        const statuses = (Array.isArray(items) ? items : []).map(item => normalizePurchaseItemStatus(item?.status, 'draft'));
        if (!statuses.length) return fallback;
        if (statuses.every(status => status === 'completed' || status === 'refused' || status === 'cancelled')) return 'completed';
        if (statuses.some(status => status === 'partial')) return 'partial';
        if (statuses.some(status => status === 'ordered')) return 'ordered';
        if (statuses.every(status => status === 'approved' || status === 'refused' || status === 'cancelled')) return 'approved';
        if (statuses.some(status => status === 'approved')) return 'approved_partial';
        if (statuses.some(status => status === 'approval')) return 'approval';
        if (statuses.some(status => status === 'draft')) return 'draft';
        if (statuses.every(status => status === 'refused' || status === 'cancelled')) return 'rejected';
        return fallback;
    }

    function normalizePurchaseRequestItem(item = {}) {
        const name = String(item.name || item.item_name || '').trim();
        const rawItemId = item.itemId ?? item.item_id ?? item.id ?? '';
        let itemId = String(rawItemId || '').trim();
        if (!itemId && name) {
            itemId = `name:${name.toLowerCase()}`;
        }

        const requiredQuantity = Math.max(0, Number(item.requiredQuantity ?? item.required_quantity ?? item.quantity ?? 0));
        const orderedQuantity = Math.max(0, Number(item.orderedQuantity ?? item.ordered_quantity ?? 0));
        const deliveredQuantity = Math.max(0, Number(item.deliveredQuantity ?? item.delivered_quantity ?? 0));
        let status = normalizePurchaseItemStatus(item.status, 'draft');

        if (!['refused', 'cancelled'].includes(status)) {
            if (deliveredQuantity >= requiredQuantity && requiredQuantity > 0) {
                status = 'completed';
            } else if (deliveredQuantity > 0) {
                status = 'partial';
            } else if (orderedQuantity > 0 && status === 'ordered') {
                status = 'ordered';
            } else if (!['draft', 'approval', 'approved'].includes(status)) {
                status = 'draft';
            }
        }

        return {
            itemId,
            name,
            category: String(item.category || '').trim(),
            requiredQuantity,
            orderedQuantity,
            deliveredQuantity,
            status,
            unit: String(item.unit || 'шт').trim() || 'шт',
            comment: String(item.comment || item.notes || '').trim(),
            rejectionReason: String(item.rejectionReason || item.rejection_reason || '').trim(),
            manualAdded: item.manualAdded === true || item.manual_added === true
        };
    }

    function normalizePurchaseRequestDocument(doc = {}) {
        const status = normalizePurchaseRequestStatus(doc.status, 'draft');

        const createdAt = doc.createdAt || doc.date || new Date().toISOString();
        const updatedAt = doc.updatedAt || createdAt;
        const items = (Array.isArray(doc.items) ? doc.items : [])
            .map(normalizePurchaseRequestItem);

        return {
            id: String(doc.id || doc.number || '').trim(),
            number: String(doc.number || '').trim(),
            date: doc.date || createdAt,
            status,
            items,
            createdAt,
            updatedAt,
            orderedAt: doc.orderedAt || null,
            deliveredAt: doc.deliveredAt || null,
            closedAt: doc.closedAt || null,
            rejectionReason: String(doc.rejectionReason || doc.rejectReason || '').trim(),
            preparedBy: doc.preparedBy || null,
            approvedBy: doc.approvedBy || null,
            linkedSources: Array.isArray(doc.linkedSources) ? doc.linkedSources : [],
            manualCreated: doc.manualCreated === true
        };
    }

    function readPurchaseRequestDocuments() {
        const docs = readJsonStorage(PURCHASE_REQUEST_DOCS_STORAGE_KEY, []);
        return (Array.isArray(docs) ? docs : [])
            .map(normalizePurchaseRequestDocument)
            .map(doc => {
                if (normalizePurchaseRequestStatus(doc.status) === 'draft') return doc;
                return recomputePurchaseDocumentStatus(doc);
            })
            .filter(doc => doc.number)
            .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0));
    }

    function writePurchaseRequestDocuments(docs) {
        const normalized = (Array.isArray(docs) ? docs : []).map(normalizePurchaseRequestDocument);
        writeJsonStorage(PURCHASE_REQUEST_DOCS_STORAGE_KEY, normalized);
    }

    function buildNextPurchaseRequestNumber(existing = []) {
        const maxSeq = (existing || []).reduce((max, doc) => {
            const match = String(doc.number || '').match(/ЗК-(\d{6})/);
            const seq = match ? Number(match[1]) : 0;
            return Math.max(max, seq);
        }, 0);
        return `ЗК-${String(maxSeq + 1).padStart(6, '0')}`;
    }

    function calculateRecommendedQuantity(item) {
        return Math.ceil(Math.max(0, Number(item?.minNorm || 0)) * 1.5);
    }

    function getCriticalThresholdPercent(override = null) {
        if (override !== null && override !== undefined) {
            return Math.max(1, Math.min(100, Number(override || 100)));
        }
        const input = document.getElementById('criticalThresholdInput');
        return Math.max(1, Math.min(100, Number(input?.value || 100)));
    }

    function getLowStockConsumables(thresholdPercent = 100) {
        const list = Array.isArray(inventory) ? inventory : [];
        const threshold = Math.max(1, Math.min(100, Number(thresholdPercent || 100)));

        return list
            .filter(item => normalizeAccountingType(item?.type || item?.accountingType) === 'consumable')
            .map(item => {
                const minNorm = Math.max(0, Number(item?.minStock ?? item?.minstock ?? 0));
                const stock = Math.max(0, Number(item?.quantity ?? item?.stock ?? 0));
                const ratio = minNorm > 0 ? (stock / minNorm) * 100 : 100;
                return {
                    id: String(item?.id || '').trim(),
                    name: item?.name || 'Без названия',
                    category: item?.category || 'Расходники',
                    unit: 'шт',
                    stock,
                    minNorm,
                    ratio
                };
            })
            .filter(item => item.id && item.minNorm > 0 && item.stock < item.minNorm * threshold / 100)
            .sort((a, b) => a.ratio - b.ratio);
    }

    function getDraftPurchaseRequest() {
        return readPurchaseRequestDocuments().find(doc => doc.status === 'draft') || null;
    }

    function getPurchaseRequestByNumber(number) {
        const normalized = String(number || '').trim();
        if (!normalized) return null;
        return readPurchaseRequestDocuments().find(doc => String(doc.number || '').trim() === normalized) || null;
    }

    function createNewPurchaseRequest(status = 'draft', options = {}) {
        const docs = readPurchaseRequestDocuments();
        const number = buildNextPurchaseRequestNumber(docs);
        const now = new Date().toISOString();
        const document = normalizePurchaseRequestDocument({
            id: number,
            number,
            date: now,
            status,
            items: [],
            createdAt: now,
            updatedAt: now,
            orderedAt: null,
            deliveredAt: null,
            manualCreated: options?.manualCreated === true
        });
        docs.unshift(document);
        writePurchaseRequestDocuments(docs);
        return document;
    }

    function upsertPurchaseRequestDraftFromSource(payload = {}) {
        const itemId = String(payload.itemId || '').trim();
        if (!itemId) {
            throw new Error('Не указан объект для заявки');
        }
        const quantity = Math.max(1, Number(payload.quantity || 0));
        const itemName = String(payload.itemName || itemId).trim();
        const itemCategory = String(payload.itemCategory || '').trim();
        const sourceType = String(payload.sourceType || 'manual').trim() || 'manual';
        const sourceId = payload.sourceId === undefined || payload.sourceId === null || payload.sourceId === ''
            ? null
            : Number(payload.sourceId);
        const sourceLabel = String(payload.sourceLabel || '').trim();

        const docs = readPurchaseRequestDocuments();
        let draftIndex = docs.findIndex(doc => normalizePurchaseRequestStatus(doc.status, 'draft') === 'draft');
        if (draftIndex < 0) {
            const created = createNewPurchaseRequest('draft');
            const refreshed = readPurchaseRequestDocuments();
            draftIndex = refreshed.findIndex(doc => String(doc.number || '') === String(created.number || ''));
            if (draftIndex < 0) {
                return created;
            }
            docs.splice(0, docs.length, ...refreshed);
        }

        const draft = normalizePurchaseRequestDocument(docs[draftIndex]);
        const items = Array.isArray(draft.items) ? [...draft.items] : [];
        const existingIndex = items.findIndex(item => String(item.itemId || '').trim() === itemId);
        const previousQty = existingIndex >= 0 ? Number(items[existingIndex].requiredQuantity || 0) : 0;
        const nextItem = normalizePurchaseRequestItem({
            ...(existingIndex >= 0 ? items[existingIndex] : {}),
            itemId,
            name: itemName,
            category: itemCategory,
            requiredQuantity: previousQty + quantity,
            status: 'draft',
            manualAdded: true
        });
        if (existingIndex >= 0) items[existingIndex] = nextItem;
        else items.push(nextItem);

        const linkedSources = Array.isArray(draft.linkedSources) ? [...draft.linkedSources] : [];
        const sourceKey = `${sourceType}:${sourceId ?? ''}:${itemId}`;
        const sourceExists = linkedSources.some(source => `${source?.sourceType || ''}:${source?.sourceId ?? ''}:${source?.itemId || ''}` === sourceKey);
        if (!sourceExists) {
            linkedSources.push({
                sourceType,
                sourceId: Number.isFinite(sourceId) ? sourceId : null,
                sourceLabel,
                itemId,
                quantity
            });
        }

        const updatedDraft = normalizePurchaseRequestDocument({
            ...draft,
            status: 'draft',
            items,
            linkedSources,
            updatedAt: new Date().toISOString()
        });
        docs[draftIndex] = updatedDraft;
        writePurchaseRequestDocuments(docs);
        return updatedDraft;
    }

    function normalizePurchaseActDocument(doc = {}) {
        const createdAt = doc.createdAt || doc.date || new Date().toISOString();
        const updatedAt = doc.updatedAt || createdAt;
        const rawStatus = String(doc.status || 'Черновик').trim();
        const status = ['Черновик', 'Проведен', 'Отменен'].includes(rawStatus) ? rawStatus : 'Черновик';
        const items = (Array.isArray(doc.items) ? doc.items : [])
            .map(item => ({
                itemId: restoreText(item.itemId || ''),
                name: restoreText(item.name || ''),
                category: restoreText(item.category || ''),
                quantity: Math.max(0, Number(item.quantity || 0)),
                unit: restoreText(item.unit || 'шт') || 'шт'
            }))
            .filter(item => item.itemId);

        return {
            id: restoreText(doc.id || doc.number || ''),
            number: restoreText(doc.number || ''),
            date: doc.date || createdAt,
            status: restoreText(status),
            basisType: 'purchase_request',
            basisId: restoreText(doc.basisId || ''),
            basisLabel: restoreText(doc.basisLabel || ''),
            responsible: doc.responsible || null,
            counterparty: restoreText(doc.counterparty || ''),
            endDate: doc.endDate || doc.deliveredAt || null,
            items,
            createdAt,
            updatedAt,
            history: Array.isArray(doc.history) ? doc.history : [{
                date: createdAt,
                text: `Создан (статус: ${status})`
            }]
        };
    }

    function readPurchaseActDocuments() {
        const docs = readJsonStorage(PURCHASE_ACTS_STORAGE_KEY, []);
        return (Array.isArray(docs) ? docs : [])
            .map(normalizePurchaseActDocument)
            .filter(doc => doc.number)
            .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0));
    }

    function writePurchaseActDocuments(docs) {
        const normalized = (Array.isArray(docs) ? docs : []).map(normalizePurchaseActDocument);
        writeJsonStorage(PURCHASE_ACTS_STORAGE_KEY, normalized);
    }

    function buildNextPurchaseActNumber(existing = []) {
        const maxSeq = (existing || []).reduce((max, doc) => {
            const match = String(doc.number || '').match(/ПА-(\d{6})/);
            const seq = match ? Number(match[1]) : 0;
            return Math.max(max, seq);
        }, 0);
        return `ПА-${String(maxSeq + 1).padStart(6, '0')}`;
    }

    function getPurchaseActByRequestNumber(requestNumber) {
        const key = String(requestNumber || '').trim();
        if (!key) return null;
        return readPurchaseActDocuments().find(doc => String(doc.basisId || '').trim() === key) || null;
    }

    function getPurchaseActsByRequestNumber(requestNumber) {
        const key = String(requestNumber || '').trim();
        if (!key) return [];
        return readPurchaseActDocuments().filter(doc => String(doc.basisId || '').trim() === key);
    }

    function createPurchaseActFromRequest(requestNumber) {
        const request = getPurchaseRequestByNumber(requestNumber);
        if (!request) {
            throw new Error('Заявка не найдена');
        }
        if (!['partial', 'completed', 'closed'].includes(normalizePurchaseRequestStatus(request.status))) {
            throw new Error('Акт закупки можно создать только по заявке со статусом Частично получен/Получен');
        }

        const existingAct = getPurchaseActByRequestNumber(request.number);
        if (existingAct) return existingAct;

        const acts = readPurchaseActDocuments();
        const number = buildNextPurchaseActNumber(acts);
        const now = new Date().toISOString();
        const items = (request.items || []).map(item => ({
            itemId: item.itemId,
            name: item.name,
            category: item.category,
            quantity: Math.max(0, Number(item.deliveredQuantity || 0)),
            unit: item.unit || 'шт'
        })).filter(item => item.quantity > 0);

        const act = normalizePurchaseActDocument({
            id: number,
            number,
            date: now,
            status: 'Черновик',
            basisId: request.number,
            basisLabel: `Заявка на закупку № ${request.number}`,
            responsible: request.preparedBy || request.approvedBy || null,
            counterparty: String(request.counterparty || request.supplier || request.approvedBy?.name || '').trim(),
            endDate: request.deliveredAt || request.updatedAt || now,
            items,
            createdAt: now,
            updatedAt: now
        });

        acts.unshift(act);
        writePurchaseActDocuments(acts);
        return act;
    }

    function createPurchaseActFromDelivery(requestNumber, deliveredRows = [], options = {}) {
        const request = getPurchaseRequestByNumber(requestNumber);
        if (!request) throw new Error('Заявка не найдена');

        const status = normalizePurchaseRequestStatus(request.status);
        if (!['partial', 'completed', 'closed'].includes(status)) {
            throw new Error('Акт поставки можно создать только после фиксации поставки');
        }

        const qtyMap = new Map((Array.isArray(deliveredRows) ? deliveredRows : [])
            .map(row => [String(row?.itemId || '').trim(), Math.max(0, Number(row?.quantity || 0))])
            .filter(([itemId, qty]) => itemId && qty > 0));

        const items = (request.items || []).map(item => ({
            itemId: String(item.itemId || '').trim(),
            name: item.name,
            category: item.category,
            quantity: Number(qtyMap.get(String(item.itemId || '').trim()) || 0),
            unit: item.unit || 'шт'
        })).filter(item => item.itemId && item.quantity > 0);

        if (!items.length) return null;

        const acts = readPurchaseActDocuments();
        const now = options?.date || new Date().toISOString();
        const number = buildNextPurchaseActNumber(acts);
        const act = normalizePurchaseActDocument({
            id: number,
            number,
            date: now,
            status: 'Черновик',
            basisId: request.number,
            basisLabel: `Заявка на закупку № ${request.number}`,
            responsible: request.preparedBy || request.approvedBy || null,
            counterparty: String(request.counterparty || request.supplier || request.approvedBy?.name || '').trim(),
            endDate: request.deliveredAt || request.updatedAt || now,
            items,
            createdAt: now,
            updatedAt: now,
            history: [{
                date: now,
                text: `Создан автоматически по поставке из заявки ${request.number}`
            }]
        });

        acts.unshift(act);
        writePurchaseActDocuments(acts);
        return act;
    }

    function recomputePurchaseDocumentStatus(document) {
        const doc = normalizePurchaseRequestDocument(document);
        if (doc.status === 'rejected' || doc.status === 'closed') return doc;
        if (doc.status === 'draft') {
            return {
                ...doc,
                status: 'draft'
            };
        }

        if (!doc.items.length) {
            if (doc.status === 'partial' || doc.status === 'ordered') {
                return {
                    ...doc,
                    status: 'closed',
                    deliveredAt: doc.deliveredAt || new Date().toISOString(),
                    closedAt: doc.closedAt || new Date().toISOString()
                };
            }
            return doc;
        }

        const nextStatus = calculatePurchaseRequestStatusByItems(doc.items, doc.status || 'draft');
        if (nextStatus === 'completed') {
            return {
                ...doc,
                status: 'completed',
                deliveredAt: doc.deliveredAt || new Date().toISOString()
            };
        }
        if (nextStatus === 'rejected') {
            return { ...doc, status: 'rejected' };
        }
        return { ...doc, status: nextStatus };
    }

    async function updateDraftPurchaseRequest(options = {}) {
        const forceCreate = options?.forceCreate === true;
        const alignWithCritical = options?.alignWithCritical === true;
        const thresholdPercent = getCriticalThresholdPercent(options?.thresholdPercent);
        let lowStockItems = getLowStockConsumables(thresholdPercent);

        const docs = readPurchaseRequestDocuments();
        let draftIndex = docs.findIndex(doc => doc.status === 'draft');

        // Не исключаем позиции из черновика на основании других активных заявок:
        // пользователь должен видеть и дополнять единый текущий список дефицита.

        // Если критичных позиций не осталось вообще — удаляем черновик (если есть)
        if (lowStockItems.length === 0 && !forceCreate) {
            if (draftIndex >= 0) {
                const draftCandidate = normalizePurchaseRequestDocument(docs[draftIndex]);
                const hasManualItems = (draftCandidate.items || []).some(item => item.manualAdded === true);
                if (!hasManualItems && draftCandidate.manualCreated !== true) {
                    docs.splice(draftIndex, 1);
                    writePurchaseRequestDocuments(docs);
                }
            }
            return null;
        }

        if (draftIndex < 0) {
            const created = createNewPurchaseRequest('draft');
            const nextDocs = readPurchaseRequestDocuments();
            draftIndex = nextDocs.findIndex(doc => doc.number === created.number);
            if (draftIndex < 0) return created;
            docs.splice(0, docs.length, ...nextDocs);
        }

        const draft = normalizePurchaseRequestDocument(docs[draftIndex]);
        const previousMap = new Map((draft.items || []).map(item => [String(item.itemId), item]));
        const nextItems = lowStockItems.map(item => {
            const existing = previousMap.get(item.id);
            const shortageQuantity = Math.max(item.minNorm - item.stock, 1);
            const requiredQuantity = alignWithCritical
                ? shortageQuantity
                : Math.max(calculateRecommendedQuantity(item), shortageQuantity);
            const deliveredQuantity = Math.min(Number(existing?.deliveredQuantity || 0), requiredQuantity);
            const orderedQuantity = Math.max(0, Number(existing?.orderedQuantity || 0));
            let status = 'approval';

            if (deliveredQuantity >= requiredQuantity) status = 'completed';
            else if (deliveredQuantity > 0) status = 'partial';
            else if (orderedQuantity > 0 && draft.status !== 'draft') status = 'ordered';

            return normalizePurchaseRequestItem({
                itemId: item.id,
                name: item.name,
                category: item.category,
                requiredQuantity,
                orderedQuantity,
                deliveredQuantity,
                status,
                unit: item.unit || 'шт',
                manualAdded: existing?.manualAdded === true
            });
        });

        // Важно: в режиме "Сформировать заявку" с дашборда берем только актуально критичные позиции,
        // без старых вручную добавленных строк, чтобы не было расхождений с виджетом.
        const autoItemIds = new Set(nextItems.map(item => String(item.itemId)));
        const manualItems = alignWithCritical
            ? []
            : (draft.items || [])
                .filter(item => item.manualAdded === true && !autoItemIds.has(String(item.itemId)))
                .map(item => normalizePurchaseRequestItem(item));
        const mergedItems = [...nextItems, ...manualItems];

        const nextDraft = recomputePurchaseDocumentStatus({
            ...draft,
            status: draft.status === 'draft' ? 'draft' : draft.status,
            items: mergedItems,
            updatedAt: new Date().toISOString()
        });

        docs[draftIndex] = nextDraft;
        writePurchaseRequestDocuments(docs);
        return nextDraft;
    }

    function ensurePurchaseRequestsFilterBar(container) {
        let filterBar = container.querySelector('.pr-filter-bar');
        if (filterBar) return filterBar;

        const options = [
            { value: 'all', label: 'Все' },
            { value: 'draft', label: 'Черновик' },
            { value: 'approval', label: 'На согласовании' },
            { value: 'approved', label: 'Согласована' },
            { value: 'approved_partial', label: 'Согласована частично' },
            { value: 'ordered', label: 'Заказан' },
            { value: 'partial', label: 'Частично' },
            { value: 'completed', label: 'Поставлена' },
            { value: 'closed', label: 'Закрыта' },
            { value: 'rejected', label: 'Отклонена' }
        ];

        filterBar = document.createElement('div');
        filterBar.className = 'pr-filter-bar';
        filterBar.innerHTML = `
            <span style="font-weight:600;font-size:13px;color:var(--muted-text)">Фильтр:</span>
            ${options.map(option => `<button type="button" class="pr-filter-btn${option.value === 'all' ? ' active' : ''}" data-status="${option.value}">${option.label}</button>`).join('')}
            <button type="button" id="prRefreshDraftBtn" class="btn-success" style="margin-left:auto;">🔄 Обновить список</button>
            <button type="button" id="prCreateDraftBtn" class="btn-accent">➕ Сформировать заявку</button>
        `;
        container.insertBefore(filterBar, container.querySelector('table') || container.firstChild);

        filterBar.querySelectorAll('.pr-filter-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                filterBar.querySelectorAll('.pr-filter-btn').forEach(node => node.classList.remove('active'));
                btn.classList.add('active');
                await loadPurchaseRequests();
            });
        });

        document.getElementById('prRefreshDraftBtn')?.addEventListener('click', async () => {
            await updateDraftPurchaseRequest({ thresholdPercent: getCriticalThresholdPercent() });
            await loadPurchaseRequests();
            await loadAccountingDashboard();
            showNotification('Черновик заявки обновлен', 'success');
        });

        document.getElementById('prCreateDraftBtn')?.addEventListener('click', async () => {
            await handleCreatePurchaseRequestDraftClick();
            await loadAccountingDashboard();
        });

        return filterBar;
    }

    function setActivePurchaseRequestsFilter(status = 'all') {
        const container = document.getElementById('purchaseRequests');
        if (!container) return;
        const buttons = container.querySelectorAll('.pr-filter-btn');
        if (!buttons.length) return;

        let matched = false;
        buttons.forEach(btn => {
            const isTarget = String(btn.dataset.status || '') === String(status || 'all');
            btn.classList.toggle('active', isTarget);
            if (isTarget) matched = true;
        });

        if (!matched) {
            const allBtn = container.querySelector('.pr-filter-btn[data-status="all"]');
            if (allBtn) {
                buttons.forEach(btn => btn.classList.remove('active'));
                allBtn.classList.add('active');
            }
        }
    }

    function getPurchaseRowSummary(doc) {
        const items = Array.isArray(doc?.items) ? doc.items : [];
        const required = items.reduce((sum, item) => sum + Number(item.requiredQuantity || 0), 0);
        const delivered = items.reduce((sum, item) => sum + Number(item.deliveredQuantity || 0), 0);
        const first = items[0]?.name || '';
        const comment = items.length > 1
            ? `${first} + ${items.length - 1}`
            : (first || '—');

        return {
            itemsCount: items.length,
            required,
            delivered,
            comment
        };
    }

    async function handleCreatePurchaseRequestDraftClick() {
        let draft = getDraftPurchaseRequest();
        if (!draft?.number) {
            draft = createNewPurchaseRequest('draft', { manualCreated: true });
            showNotification(`Создан новый черновик заявки ${draft.number}`, 'success');
        } else {
            draft = await updatePurchaseRequestDocument(draft.number, current => ({
                ...current,
                status: 'draft',
                manualCreated: true
            })) || draft;
            showNotification(`Открыт существующий черновик ${draft.number}`, 'info');
        }

        // Важно: открываем карточку сразу, чтобы можно было вручную заполнить любые товары.
        if (typeof showPage === 'function') showPage('purchaseRequests');
        setActivePurchaseRequestsFilter('all');
        await loadPurchaseRequests();
        openPurchaseRequestDocument(draft.number);
        return draft;
    }

    function isPurchaseRequestSelectableInventoryItem(item) {
        const category = String(item?.category || '').trim().toLowerCase();
        return category !== 'склад';
    }

    function buildPurchaseItemActions(number, docStatus, item, editable) {
        if (!editable) return '';
        const itemStatus = normalizePurchaseItemStatus(item?.status, 'draft');
        const safeNumber = html(String(number || '')).replace(/'/g, '&#39;');
        const safeItemId = html(String(item?.itemId || '')).replace(/'/g, '&#39;');
        const actions = [];

        if (['draft', 'approval', 'approved_partial'].includes(docStatus) && ['approval'].includes(itemStatus)) {
            actions.push(`<button type="button" class="inline-action-btn" onclick="setPurchaseRequestItemStatus('${safeNumber}','${safeItemId}','approved')">Соглас.</button>`);
            actions.push(`<button type="button" class="inline-action-btn confirm-no" onclick="setPurchaseRequestItemStatus('${safeNumber}','${safeItemId}','refused')">Отклон.</button>`);
        }
        if (['approved', 'approved_partial', 'ordered', 'partial'].includes(docStatus) && ['approved'].includes(itemStatus)) {
            actions.push(`<button type="button" class="inline-action-btn" onclick="setPurchaseRequestItemStatus('${safeNumber}','${safeItemId}','ordered')">Заказать</button>`);
        }
        if (['ordered', 'partial'].includes(docStatus) && itemStatus === 'ordered') {
            actions.push(`<button type="button" class="inline-action-btn confirm-no" onclick="setPurchaseRequestItemStatus('${safeNumber}','${safeItemId}','cancelled')">Отменить</button>`);
        }
        if (['draft', 'approval'].includes(docStatus) || ['refused', 'cancelled'].includes(itemStatus)) {
            actions.push(`<button type="button" class="inline-action-btn" onclick="removePurchaseRequestItem('${safeNumber}','${safeItemId}')">Удалить</button>`);
        }
        return actions.join(' ');
    }

    async function loadPurchaseRequests() {
        const container = document.getElementById('purchaseRequests');
        if (!container) return;

        ensurePurchaseRequestsFilterBar(container);
        const activeFilter = container.querySelector('.pr-filter-btn.active')?.dataset.status || 'all';
        const tbody = container.querySelector('#purchaseRequestsTableBody');
        if (!tbody) return;

        const docs = readPurchaseRequestDocuments()
            .filter(doc => activeFilter === 'all' || doc.status === activeFilter)
            .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0));

        if (!docs.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-table-message">Заявки на закупку отсутствуют</td></tr>';
            return;
        }

        tbody.innerHTML = docs.map(doc => {
            const summary = getPurchaseRowSummary(doc);
            const safeStatus = restoreText(doc.status || '');
            const isCancelled = normalizePurchaseRequestStatus(safeStatus) === 'rejected';
            const safeNumber = html(String(restoreText(doc.number || ''))).replace(/'/g, '&#39;');

            return `
                <tr class="document-row-interactive ${isCancelled ? 'document-row-cancelled' : ''}" ondblclick="openPurchaseRequestDocumentByNumber('${safeNumber}')">
                    <td><span class="${getPurchaseStatusBadgeClass(safeStatus)}">${html(getPurchaseStatusLabel(safeStatus))}</span></td>
                    <td>${html(restoreText(doc.number || '—'))}</td>
                    <td>${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</td>
                    <td>${summary.itemsCount}</td>
                    <td>${summary.required}</td>
                    <td>${summary.delivered}</td>
                    <td>${html(summary.comment)}</td>
                    <td>${html(safeStatus === 'ordered' && doc.orderedAt ? 'Ожидание поставки' : getPurchaseStatusLabel(safeStatus))}</td>
                    <td>
                        <button type="button" class="inline-action-btn" onclick="openPurchaseRequestDocumentByNumber('${safeNumber}')">Открыть</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderPurchaseRequestModalContent(doc, options = {}) {
        const editable = options.editable === true;
        const linkedActs = getPurchaseActsByRequestNumber(doc?.number);
        const linkedAct = linkedActs[0] || null;
        const preparedByDisplay = resolvePurchaseResponsibleRef(doc, 'prepared');
        const approvedByDisplay = resolvePurchaseResponsibleRef(doc, 'approved');
        const normalizePosition = value => String(value || '').trim().toLowerCase();
        const allEmployees = (typeof employees !== 'undefined' && Array.isArray(employees)) ? employees : [];
        const storekeepers = allEmployees.filter(e => normalizePosition(e.position).includes('кладов'));
        const managers = allEmployees.filter(e => normalizePosition(e.position).includes('руковод'));
        const itemCategoryFilter = String(doc?._itemCategoryFilter || '').trim();
        const itemSearchFilter = String(doc?._itemSearchFilter || '').trim().toLowerCase();
        const filteredInventory = ((typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [])
            .filter(isPurchaseRequestSelectableInventoryItem)
            .filter(i => !itemCategoryFilter || String(i.category || '') === itemCategoryFilter)
            .filter(i => !itemSearchFilter || String(i.name || '').toLowerCase().includes(itemSearchFilter));
        const uniqueCategories = [...new Set(
            (((typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [])
                .filter(isPurchaseRequestSelectableInventoryItem)
                .map(i => String(i.category || '').trim())
                .filter(Boolean))
        )].sort((a, b) => a.localeCompare(b, 'ru'));
        const allItems = Array.isArray(doc?.items) ? doc.items : [];
        const docStatus = normalizePurchaseRequestStatus(doc?.status, 'draft');
        const showCommentColumn = allItems.some(item => ['refused', 'partial'].includes(normalizePurchaseItemStatus(item.status)));
        const rows = allItems.map(item => {
            const remaining = Math.max(0, Number(item.requiredQuantity || 0) - Number(item.deliveredQuantity || 0));
            const itemStatusLabel = getPurchaseItemStatusLabel(item.status);
            const canEditQty = editable && ['draft', 'approval', 'approved', 'approved_partial'].includes(docStatus) && !['cancelled', 'completed'].includes(normalizePurchaseItemStatus(item.status));
            const canEditComment = editable && ['partial', 'ordered', 'refused', 'cancelled'].includes(normalizePurchaseItemStatus(item.status));
            return `
                <tr>
                    <td>${html(item.name || item.itemId || '—')}</td>
                    <td>${html(item.category || '—')}</td>
                    <td>
                        ${canEditQty
                            ? `<input type="number" min="1" class="purchase-request-required-input" data-item-id="${html(item.itemId)}" value="${Number(item.requiredQuantity || 0)}" style="width:90px;"> ${html(item.unit || 'шт')}`
                            : `${Number(item.requiredQuantity || 0)} ${html(item.unit || 'шт')}`}
                    </td>
                    <td>${itemStatusLabel}</td>
                    <td>${Number(item.deliveredQuantity || 0)} ${html(item.unit || 'шт')}</td>
                    <td>${remaining} ${html(item.unit || 'шт')}</td>
                    ${showCommentColumn ? `<td>${canEditComment ? `<input type="text" class="purchase-request-comment-input" data-item-id="${html(String(item.itemId || ''))}" value="${html(String(item.comment || ''))}" placeholder="Комментарий">` : html(String(item.comment || '—'))}</td>` : ''}
                    ${editable ? `<td>${buildPurchaseItemActions(doc.number, docStatus, item, editable)}</td>` : ''}
                </tr>
            `;
        }).join('');

        const safeStatus = restoreText(doc.status || '');
        return `
            <section class="dashboard-panel">
                <div class="document-card-grid">
                    <div><strong>Номер:</strong> ${html(restoreText(doc.number || '—'))}</div>
                    <div><strong>Дата:</strong> ${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</div>
                    <div><strong>Статус:</strong> <span class="${getPurchaseStatusBadgeClass(safeStatus)}">${html(getPurchaseStatusLabel(safeStatus))}</span></div>
                    <div><strong>Позиций:</strong> ${allItems.length}</div>
                    ${normalizePurchaseRequestStatus(doc.status) === 'rejected' && doc.rejectionReason
                        ? `<div><strong>Причина отклонения:</strong> ${html(doc.rejectionReason)}</div>`
                        : ''}
                    <div><strong>Акты закупки:</strong> ${linkedActs.length
                        ? linkedActs.map(act => `${html(act.number)} <button type="button" class="inline-action-btn" onclick="openDocumentCardByNumber('${html(String(act.number || '')).replace(/'/g, '&#39;')}')">Открыть</button>`).join('<br>')
                        : 'не созданы'}
                    </div>
                    <div>${['partial', 'completed', 'closed'].includes(normalizePurchaseRequestStatus(doc.status)) && !linkedAct
                        ? `<button type="button" class="inline-action-btn" onclick="createPurchaseActFromSelectedRequest()">Создать акт закупки</button>`
                        : ''}</div>
                </div>
            </section>
            ${editable ? `
            <section class="dashboard-panel">
                <h3>Ответственные лица</h3>
                <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;">
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Подготовил (кладовщик)</label>
                        <select id="purchaseRequestPreparedBy" style="min-width:180px;">
                            <option value="">— не выбран —</option>
                            ${storekeepers.map(e => `<option value="${html(String(e.id))}" ${preparedByDisplay && String(preparedByDisplay.id) === String(e.id) ? 'selected' : ''}>${html(e.name || '—')}${e.position ? ' (' + html(e.position) + ')' : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Согласовал (руководитель)</label>
                        <select id="purchaseRequestApprovedBy" style="min-width:180px;">
                            <option value="">— не выбран —</option>
                            ${managers.map(e => `<option value="${html(String(e.id))}" ${approvedByDisplay && String(approvedByDisplay.id) === String(e.id) ? 'selected' : ''}>${html(e.name || '—')}${e.position ? ' (' + html(e.position) + ')' : ''}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </section>` : `
            <section class="dashboard-panel">
                <div class="document-card-grid">
                    <div><strong>Подготовил:</strong> ${preparedByDisplay ? `${html(preparedByDisplay.name || '—')} (${html(preparedByDisplay.position || '—')})` : '— не заполнено —'}</div>
                    <div><strong>Согласовал:</strong> ${approvedByDisplay ? `${html(approvedByDisplay.name || '—')} (${html(approvedByDisplay.position || '—')})` : '— не заполнено —'}</div>
                </div>
            </section>`}
            <section class="dashboard-panel">
                <h3>Позиции</h3>
                <div class="report-table-scroll">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Объект</th>
                                <th>Категория</th>
                                <th>Требуется</th>
                                <th>Статус</th>
                                <th>Поставлено</th>
                                <th>Осталось</th>
                                ${showCommentColumn ? '<th>Комментарий</th>' : ''}
                                ${editable ? '<th>Действия</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${rows || `<tr><td colspan="${editable ? (showCommentColumn ? '8' : '7') : (showCommentColumn ? '7' : '6')}">Позиции отсутствуют</td></tr>`}</tbody>
                    </table>
                </div>
                ${editable ? '<div class="document-card-note" style="margin-top:10px;">Позиции можно обрабатывать поэтапно, не закрывая карточку заявки.</div>' : ''}
            </section>
            ${editable ? `
            <section class="dashboard-panel">
                <h3>Добавить позицию</h3>
                <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Категория</label>
                        <select id="purchaseRequestItemCategoryFilter" style="min-width:160px;" onchange="filterPurchaseRequestItemOptions()">
                            <option value="">Все категории</option>
                            ${uniqueCategories.map(cat => `<option value="${html(cat)}">${html(cat)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Поиск</label>
                        <input type="text" id="purchaseRequestItemSearchInput" placeholder="Поиск объекта..." style="min-width:220px;" oninput="filterPurchaseRequestItemOptions()">
                    </div>
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Объект</label>
                        <select id="purchaseRequestItemSelect" style="min-width:220px;">
                            <option value="">— выберите объект —</option>
                            ${filteredInventory.map(i => `<option value="${html(String(i.id))}" data-name="${html(i.name || '')}" data-category="${html(i.category || '')}" data-unit="шт">${html(i.name || '—')}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Количество</label>
                        <input type="number" id="purchaseRequestNewItemQty" min="1" value="1" style="width:80px;">
                    </div>
                    <button type="button" onclick="addItemToPurchaseRequest()" style="margin-bottom:1px;">Добавить</button>
                </div>
            </section>` : ''}
        `;
    }

    function renderPurchaseRequestPrintableContent(doc) {
        const items = Array.isArray(doc?.items) ? doc.items : [];
        const linkedActs = getPurchaseActsByRequestNumber(doc?.number);
        const preparedByDisplay = resolvePurchaseResponsibleRef(doc, 'prepared');
        const approvedByDisplay = resolvePurchaseResponsibleRef(doc, 'approved');
        const totalRequired = items.reduce((sum, item) => sum + Number(item.requiredQuantity || 0), 0);
        const totalDelivered = items.reduce((sum, item) => sum + Number(item.deliveredQuantity || 0), 0);
        const totalRemaining = Math.max(totalRequired - totalDelivered, 0);

        const safeStatus = restoreText(doc.status || '');
        return `
            <div class="purchase-request-document" id="purchaseRequestPrintableArea">
                <div class="purchase-request-header">
                    <div class="purchase-request-title-block">
                        <h3>ЗАЯВКА НА ЗАКУПКУ № ${html(restoreText(doc.number || '—'))}</h3>
                        <div class="purchase-request-subtitle">Документ на пополнение складских остатков по расходным материалам</div>
                    </div>
                    <div class="purchase-request-status-pill">${html(getPurchaseStatusLabel(safeStatus))}</div>
                </div>

                <div class="purchase-request-meta">
                    <div><strong>Дата создания:</strong> ${html(formatDateTimeSafe(doc.date || doc.createdAt, '—'))}</div>
                    <div><strong>Последнее обновление:</strong> ${html(formatDateTimeSafe(doc.updatedAt || doc.date || doc.createdAt, '—'))}</div>
                    <div><strong>Статус документа:</strong> ${html(getPurchaseStatusLabel(doc.status))}</div>
                    <div><strong>Количество позиций:</strong> ${items.length}</div>
                    ${normalizePurchaseRequestStatus(doc.status) === 'rejected' && doc.rejectionReason
                        ? `<div><strong>Причина отклонения:</strong> ${html(doc.rejectionReason)}</div>`
                        : ''}
                </div>

                <div class="purchase-request-summary">
                    <div class="purchase-request-summary-card">
                        <strong>Требуется</strong>
                        <span>${totalRequired} ед.</span>
                    </div>
                    <div class="purchase-request-summary-card">
                        <strong>Поставлено</strong>
                        <span>${totalDelivered} ед.</span>
                    </div>
                    <div class="purchase-request-summary-card">
                        <strong>Осталось к поставке</strong>
                        <span>${totalRemaining} ед.</span>
                    </div>
                </div>

                <div class="purchase-request-meta" style="margin-top:8px;">
                    <div><strong>Акты закупки:</strong> ${linkedActs.length
                        ? linkedActs.map(act => `${html(act.number)} <button type="button" class="inline-action-btn" onclick="openDocumentCardByNumber('${html(String(act.number || '')).replace(/'/g, '&#39;')}')">Открыть</button>`).join('<br>')
                        : '—'}</div>
                </div>

                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Объект</th>
                                <th>Категория</th>
                                <th>Требуется</th>
                                <th>Поставлено</th>
                                <th>Осталось</th>
                                <th>Статус позиции</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.length ? items.map(item => {
                                const required = Number(item.requiredQuantity || 0);
                                const delivered = Number(item.deliveredQuantity || 0);
                                const remaining = Math.max(required - delivered, 0);
                                const itemStatus = getPurchaseItemStatusLabel(item.status);
                                return `
                                    <tr>
                                        <td>${html(item.name || item.itemId || '—')}</td>
                                        <td>${html(item.category || '—')}</td>
                                        <td>${required} ${html(item.unit || 'шт')}</td>
                                        <td>${delivered} ${html(item.unit || 'шт')}</td>
                                        <td>${remaining} ${html(item.unit || 'шт')}</td>
                                        <td>${html(itemStatus)}</td>
                                    </tr>
                                `;
                            }).join('') : '<tr><td colspan="6">Позиции отсутствуют</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div class="purchase-request-signatures">
                    <div class="purchase-request-signature-box">
                        Подготовил документ
                        <div class="purchase-request-signature-line">${preparedByDisplay ? html(preparedByDisplay.name || '') : '___________________________'}</div>
                        <div>${preparedByDisplay ? html(preparedByDisplay.position || 'кладовщик') : 'кладовщик / ответственное лицо'}</div>
                    </div>
                    <div class="purchase-request-signature-box">
                        Согласовано
                        <div class="purchase-request-signature-line">${approvedByDisplay ? html(approvedByDisplay.name || '') : '___________________________'}</div>
                        <div>${approvedByDisplay ? html(approvedByDisplay.position || 'руководитель') : 'руководитель / дата'}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function canEditPurchaseRequest(doc) {
        return ['draft'].includes(normalizePurchaseRequestStatus(doc?.status));
    }

    function canDeletePurchaseRequest(doc) {
        const status = normalizePurchaseRequestStatus(doc?.status);
        return status === 'draft' || status === 'rejected';
    }

    function syncLinkedPurchaseActWithRequest(requestDoc) {
        if (!requestDoc?.number) return null;

        const acts = readPurchaseActDocuments();
        const relatedIndexes = acts
            .map((act, idx) => ({ act, idx }))
            .filter(entry => String(entry.act?.basisId || '').trim() === String(requestDoc.number).trim());

        if (!relatedIndexes.length) return null;

        relatedIndexes.forEach(entry => {
            const currentAct = normalizePurchaseActDocument(entry.act);
            const history = Array.isArray(currentAct.history) ? [...currentAct.history] : [];
            history.push({
                date: new Date().toISOString(),
                text: `Обновлены реквизиты из заявки ${requestDoc.number}`
            });

            acts[entry.idx] = normalizePurchaseActDocument({
                ...currentAct,
                responsible: requestDoc.preparedBy || requestDoc.approvedBy || currentAct.responsible || null,
                counterparty: String(requestDoc.counterparty || requestDoc.supplier || requestDoc.approvedBy?.name || currentAct.counterparty || '').trim(),
                endDate: requestDoc.deliveredAt || requestDoc.updatedAt || currentAct.endDate || currentAct.date,
                updatedAt: new Date().toISOString(),
                history
            });
        });

        writePurchaseActDocuments(acts);
        return acts[relatedIndexes[0].idx];
    }

    function rerenderPurchaseRequestModal(doc, editable = false) {
        const title = document.getElementById('purchaseRequestModalTitle');
        const content = document.getElementById('purchaseRequestModalContent');
        const editBtn = document.getElementById('purchaseRequestEditBtn');
        const saveBtn = document.getElementById('purchaseRequestSaveBtn');
        const editCancelBtn = document.getElementById('purchaseRequestEditCancelBtn');
        const submitBtn = document.getElementById('purchaseRequestSubmitBtn');
        const approveBtn = document.getElementById('purchaseRequestApproveBtn');
        const approvePartialBtn = document.getElementById('purchaseRequestApprovePartialBtn');
        const rejectBtn = document.getElementById('purchaseRequestRejectBtn');
        const backToDraftBtn = document.getElementById('purchaseRequestBackToDraftBtn');
        const orderBtn = document.getElementById('purchaseRequestOrderBtn');
        const cancelOrderBtn = document.getElementById('purchaseRequestCancelOrderBtn');
        const deliveryBtn = document.getElementById('purchaseRequestDeliveryBtn');
        const closeBtn = document.getElementById('purchaseRequestCloseBtn');
        const copyBtn = document.getElementById('purchaseRequestCopyBtn');
        const deleteBtn = document.getElementById('purchaseRequestDeleteBtn');
        const openActBtn = document.getElementById('purchaseRequestOpenActBtn');

        if (!title || !content) return;

        purchaseRequestEditMode = editable;
        const status = normalizePurchaseRequestStatus(doc?.status);
        title.textContent = `Заявка на закупку № ${restoreText(doc.number || '—')}`;
        content.innerHTML = editable
            ? renderPurchaseRequestModalContent(doc, { editable: true })
            : renderPurchaseRequestPrintableContent(doc);

        if (editBtn) {
            editBtn.style.display = !editable && canEditPurchaseRequest(doc) ? 'inline-flex' : 'none';
        }
        if (saveBtn) saveBtn.style.display = editable ? 'inline-flex' : 'none';
        if (editCancelBtn) editCancelBtn.style.display = editable ? 'inline-flex' : 'none';
        if (submitBtn) {
            const hasItems = (doc.items || []).some(item => Number(item?.requiredQuantity || 0) > 0);
            const hasPrepared = hasMeaningfulEmployeeRef(doc.preparedBy);
            const hasApproved = hasMeaningfulEmployeeRef(doc.approvedBy);
            submitBtn.style.display = !editable && status === 'draft' && hasItems ? 'inline-flex' : 'none';
            submitBtn.disabled = false;
            submitBtn.title = !(hasItems && hasPrepared && hasApproved)
                ? 'Заполните обязательные поля: Подготовил и Согласовал, и добавьте позиции'
                : '';
        }
        const canManagerApprove = canApprovePurchaseRequestByRole();
        if (approveBtn) approveBtn.style.display = !editable && canManagerApprove && status === 'approval' ? 'inline-flex' : 'none';
        if (approvePartialBtn) approvePartialBtn.style.display = !editable && canManagerApprove && status === 'approval' ? 'inline-flex' : 'none';
        if (rejectBtn) rejectBtn.style.display = !editable && canManagerApprove && status === 'approval' ? 'inline-flex' : 'none';
        if (backToDraftBtn) backToDraftBtn.style.display = !editable && ['approval', 'approved', 'approved_partial'].includes(status) ? 'inline-flex' : 'none';
        if (orderBtn) orderBtn.style.display = !editable && ['approved', 'approved_partial'].includes(status) ? 'inline-flex' : 'none';
        if (cancelOrderBtn) {
            const canRollback = !editable && ['ordered', 'partial'].includes(status);
            cancelOrderBtn.style.display = canRollback ? 'inline-flex' : 'none';
            cancelOrderBtn.textContent = 'Отменить заказ';
        }
        if (deliveryBtn) deliveryBtn.style.display = !editable && ['ordered', 'partial'].includes(status) ? 'inline-flex' : 'none';
        if (closeBtn) closeBtn.style.display = !editable && status === 'partial' ? 'inline-flex' : 'none';
        if (copyBtn) copyBtn.style.display = !editable && status === 'rejected' ? 'inline-flex' : 'none';
        if (deleteBtn) deleteBtn.style.display = !editable && canDeletePurchaseRequest(doc) ? 'inline-flex' : 'none';
        if (openActBtn) {
            const linkedAct = getPurchaseActByRequestNumber(doc?.number);
            openActBtn.style.display = !editable && linkedAct ? 'inline-flex' : 'none';
            openActBtn.setAttribute('data-act-number', linkedAct?.number || '');
        }
    }

    function openPurchaseRequestDocument(number) {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'view', 'Недостаточно прав для просмотра закупочных заявок')) return;
        const storedDoc = getPurchaseRequestByNumber(number);
        if (!storedDoc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }

        const doc = recomputePurchaseDocumentStatus(storedDoc);

        selectedPurchaseRequestNumber = doc.number;

        const modal = document.getElementById('purchaseRequestModal');
        if (!modal) return;

        const isDraft = normalizePurchaseRequestStatus(doc.status, 'draft') === 'draft';
        const hasItems = Array.isArray(doc.items) && doc.items.length > 0;
        // Пустой черновик сразу открываем в режиме редактирования,
        // чтобы пользователь мог сразу добавить товары.
        const openInEditMode = isDraft && !hasItems;
        rerenderPurchaseRequestModal(doc, openInEditMode);

        modal.style.display = 'block';
    }

    function closePurchaseRequestModal() {
        const modal = document.getElementById('purchaseRequestModal');
        if (modal) modal.style.display = 'none';
        purchaseRequestEditMode = false;
    }

    async function updatePurchaseRequestDocument(number, updater) {
        const docs = readPurchaseRequestDocuments();
        const idx = docs.findIndex(doc => String(doc.number || '').trim() === String(number || '').trim());
        if (idx < 0) return null;

        const current = docs[idx];
        const nextRaw = typeof updater === 'function' ? updater(current) : current;
        const next = normalizePurchaseRequestDocument({
            ...nextRaw,
            updatedAt: new Date().toISOString()
        });
        docs[idx] = next;
        writePurchaseRequestDocuments(docs);
        return next;
    }

    function emitPurchaseRequestStatusChanged(doc, previousStatus) {
        if (!doc?.number) return;
        const prev = normalizePurchaseRequestStatus(previousStatus, 'draft');
        const next = normalizePurchaseRequestStatus(doc.status, 'draft');
        if (prev === next) return;

        const detail = {
            number: doc.number,
            previousStatus: prev,
            status: next,
            label: getPurchaseStatusLabel(next),
            document: doc
        };

        try {
            window.dispatchEvent(new CustomEvent('purchase-request-status-changed', { detail }));
        } catch (_) { }

        if (typeof window.notifyPurchaseRequestStatusChanged === 'function') {
            try { window.notifyPurchaseRequestStatusChanged(detail); } catch (_) { }
        }

        if (typeof showNotification === 'function') {
            showNotification(`Статус заявки ${doc.number}: ${getPurchaseStatusLabel(prev)} → ${getPurchaseStatusLabel(next)}`, 'info');
        }
    }

    async function setPurchaseRequestStatus(number, targetStatus) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) throw new Error('Заявка не найдена');
        const target = normalizePurchaseRequestStatus(targetStatus, 'draft');
        const currentStatus = normalizePurchaseRequestStatus(doc.status, 'draft');

        if (!PURCHASE_REQUEST_STATUSES.includes(target)) {
            throw new Error('Недопустимый статус заявки');
        }

        const transitions = {
            draft: ['approval'],
            approval: ['approved', 'approved_partial', 'rejected', 'draft'],
            approved: ['ordered', 'rejected', 'draft'],
            approved_partial: ['ordered', 'rejected', 'draft'],
            rejected: [],
            ordered: ['partial', 'completed', 'rejected'],
            partial: ['partial', 'completed', 'closed', 'rejected'],
            completed: ['closed'],
            closed: []
        };
        const allowedTargets = transitions[currentStatus] || [];
        if (!allowedTargets.includes(target)) {
            throw new Error(`Переход ${getPurchaseStatusLabel(currentStatus)} → ${getPurchaseStatusLabel(target)} недоступен`);
        }

        const updated = await updatePurchaseRequestDocument(number, current => {
            const currentItems = Array.isArray(current.items) ? current.items : [];
            const next = {
                ...current,
                status: target,
                items: currentItems.map(item => normalizePurchaseRequestItem(item))
            };

            if (target === 'approval') {
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    status: ['refused', 'cancelled'].includes(normalizePurchaseItemStatus(item.status))
                        ? normalizePurchaseItemStatus(item.status)
                        : 'approval'
                }));
            }

            if (target === 'approved') {
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    status: ['refused', 'cancelled'].includes(normalizePurchaseItemStatus(item.status))
                        ? normalizePurchaseItemStatus(item.status)
                        : 'approved'
                }));
            }

            if (target === 'approved_partial') {
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    status: normalizePurchaseItemStatus(item.status) === 'approval' ? 'approved' : normalizePurchaseItemStatus(item.status)
                }));
            }

            if (target === 'ordered') {
                next.orderedAt = new Date().toISOString();
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    orderedQuantity: Math.max(Number(item.orderedQuantity || 0), Number(item.requiredQuantity || 0)),
                    status: normalizePurchaseItemStatus(item.status) === 'refused'
                        ? 'refused'
                        : (normalizePurchaseItemStatus(item.status) === 'cancelled'
                            ? 'cancelled'
                            : (Number(item.deliveredQuantity || 0) > 0 ? 'partial' : 'ordered'))
                }));
            }

            if (target === 'draft') {
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    status: 'draft',
                    orderedQuantity: 0,
                    deliveredQuantity: 0
                }));
                next.orderedAt = null;
                next.deliveredAt = null;
                next.closedAt = null;
            }

            if (target === 'rejected') {
                next.rejectionReason = String(next.rejectionReason || '').trim();
                next.items = currentItems.map(item => normalizePurchaseRequestItem({
                    ...item,
                    status: 'cancelled'
                }));
            }

            if (target === 'completed') {
                next.deliveredAt = next.deliveredAt || new Date().toISOString();
            }

            if (target === 'closed') {
                next.closedAt = next.closedAt || new Date().toISOString();
                if (!next.deliveredAt) next.deliveredAt = next.closedAt;
            }

            return normalizePurchaseRequestDocument(next);
        });

        if (!updated) throw new Error('Не удалось обновить заявку');
        emitPurchaseRequestStatusChanged(updated, currentStatus);
        return updated;
    }

    function openPurchaseDeliveryModal(number) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }
        if (!['ordered', 'partial'].includes(normalizePurchaseRequestStatus(doc.status))) {
            showNotification('Поставка доступна только для статусов Заказано/Частично поставлено', 'warning');
            return;
        }

        selectedPurchaseDeliveryNumber = doc.number;
        const modal = document.getElementById('purchaseDeliveryModal');
        const title = document.getElementById('purchaseDeliveryModalTitle');
        const content = document.getElementById('purchaseDeliveryModalContent');
        if (!modal || !title || !content) return;

        title.textContent = `Отметить поставку по заявке № ${restoreText(doc.number || '—')}`;

        const rows = (doc.items || []).map(item => {
            const itemStatus = normalizePurchaseItemStatus(item.status, 'waiting');
            const required = Math.max(0, Number(item.requiredQuantity || 0));
            const ordered = Math.max(0, Number(item.orderedQuantity || 0), ['ordered', 'partial', 'completed'].includes(itemStatus) ? required : 0);
            const delivered = Number(item.deliveredQuantity || 0);
            const remaining = Math.max(0, required - delivered);
            const isRefused = itemStatus === 'refused';
            const isCompleted = itemStatus === 'completed' || remaining <= 0;

            return `
                <tr>
                    <td>${html(item.name || item.itemId || '—')}</td>
                    <td>${ordered} ${html(item.unit || 'шт')}</td>
                    <td>${delivered} ${html(item.unit || 'шт')}</td>
                    <td>
                        <input type="number" min="0" max="${remaining}" value="0" class="purchase-delivery-input"
                               data-item-id="${html(item.itemId)}" data-max="${remaining}" style="width:90px;" ${isRefused || isCompleted ? 'disabled' : ''} />
                    </td>
                    <td>
                        <select class="purchase-delivery-status" data-item-id="${html(item.itemId)}" ${isCompleted ? 'disabled' : ''}>
                            <option value="ordered" ${itemStatus === 'ordered' ? 'selected' : ''}>Заказана</option>
                            <option value="waiting" ${itemStatus === 'waiting' ? 'selected' : ''}>Ожидает</option>
                            <option value="partial" ${itemStatus === 'partial' ? 'selected' : ''}>Частично поставлено</option>
                            <option value="refused" ${itemStatus === 'refused' ? 'selected' : ''}>Отказ</option>
                            <option value="completed" ${isCompleted ? 'selected' : ''}>Поставлено</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" class="purchase-delivery-comment" data-item-id="${html(String(item.itemId || ''))}" value="${html(String(item.comment || ''))}" placeholder="Комментарий" style="min-width:180px;">
                    </td>
                </tr>
            `;
        }).join('');

        content.innerHTML = `
            <div class="report-table-scroll">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Объект</th>
                            <th>Заказано</th>
                            <th>Поставлено</th>
                            <th>Поступает</th>
                            <th>Статус</th>
                            <th>Комментарий</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="6">Нет позиций</td></tr>'}</tbody>
                </table>
            </div>
        `;

        content.querySelectorAll('.purchase-delivery-input').forEach(input => {
            input.addEventListener('input', () => {
                const max = Math.max(0, Number(input.getAttribute('data-max') || 0));
                const value = Math.max(0, Number(input.value || 0));
                if (value > max) {
                    input.value = String(max);
                    showNotification('Нельзя поставить больше заказанного остатка', 'warning');
                }
            });
        });

        content.querySelectorAll('.purchase-delivery-status').forEach(select => {
            select.addEventListener('change', () => {
                const itemId = String(select.getAttribute('data-item-id') || '').trim();
                const input = content.querySelector(`.purchase-delivery-input[data-item-id="${itemId}"]`);
                if (!input) return;
                const selectedStatus = normalizePurchaseItemStatus(select.value, 'ordered');
                if (selectedStatus === 'refused') {
                    input.value = '0';
                    input.disabled = true;
                } else if (selectedStatus === 'completed') {
                    input.disabled = true;
                    input.value = input.getAttribute('data-max') || '0';
                } else {
                    input.disabled = false;
                }
            });
        });

        modal.style.display = 'block';
    }

    function closePurchaseDeliveryModal() {
        const modal = document.getElementById('purchaseDeliveryModal');
        if (modal) modal.style.display = 'none';
    }

    function openPurchaseCancelModal(number) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }
        const modal = document.getElementById('purchaseCancelModal');
        const content = document.getElementById('purchaseCancelModalContent');
        if (!modal || !content) return;

        const cancellableItems = (doc.items || []).filter(item => {
            const status = normalizePurchaseItemStatus(item.status);
            return !['completed', 'cancelled'].includes(status);
        });

        content.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <label style="display:flex;justify-content:flex-start;gap:10px;align-items:center;"><input type="radio" name="purchaseCancelMode" value="all" checked> Отменить всю заявку</label>
                <label style="display:flex;justify-content:flex-start;gap:10px;align-items:center;"><input type="radio" name="purchaseCancelMode" value="selected"> Отменить выбранные позиции</label>
                <div id="purchaseCancelItemsList" style="max-height:220px;overflow:auto;border:1px solid var(--card-border);border-radius:8px;padding:10px;">
                    ${cancellableItems.length
                        ? cancellableItems.map(item => `<label style="display:flex;justify-content:flex-start;gap:10px;align-items:center;margin-bottom:6px;"><input type="checkbox" class="purchase-cancel-item-checkbox" value="${html(String(item.itemId || ''))}"> ${html(item.name || item.itemId || '—')} (${Number(item.requiredQuantity || 0)} шт)</label>`).join('')
                        : '<div class="small-muted">Нет позиций для отмены</div>'}
                </div>
                <div>
                    <label style="display:block;font-size:12px;color:var(--muted-text);margin-bottom:4px;">Причина отмены</label>
                    <input id="purchaseCancelReasonInput" type="text" placeholder="Укажите причину" style="width:100%;">
                </div>
            </div>
        `;

        modal.setAttribute('data-request-number', String(doc.number || ''));
        modal.style.display = 'block';
    }

    function closePurchaseCancelModal() {
        const modal = document.getElementById('purchaseCancelModal');
        if (modal) modal.style.display = 'none';
    }

    function getCurrentPurchaseUserRef() {
        const rbacUser = (typeof RBAC !== 'undefined' && typeof RBAC.getCurrentUser === 'function')
            ? RBAC.getCurrentUser()
            : null;
        const authRole = String(localStorage.getItem('authRole') || '').trim();
        const role = typeof RBAC !== 'undefined' && typeof RBAC.normalizeRole === 'function'
            ? RBAC.normalizeRole(rbacUser?.role || authRole || '')
            : String(rbacUser?.role || authRole || '').trim().toLowerCase();

        const user = rbacUser || {
            id: localStorage.getItem('authUserId') || '',
            username: localStorage.getItem('authUsername') || localStorage.getItem('authLogin') || 'Пользователь',
            role
        };

        if (!user) return null;
        return {
            id: String(user.id || ''),
            name: String(user.fullName || user.name || user.username || 'Пользователь').trim(),
            position: role || 'сотрудник',
            role
        };
    }

    function canApprovePurchaseRequestByRole() {
        const user = getCurrentPurchaseUserRef();
        return Boolean(user && ['руководитель', 'admin'].includes(String(user.role || '').trim().toLowerCase()));
    }

    function hasMeaningfulEmployeeRef(ref) {
        if (!ref || typeof ref !== 'object') return false;
        const id = String(ref.id || '').trim();
        const name = String(ref.name || '').trim();
        if (id) return true;
        if (!name) return false;
        if (/^[-_.\s]+$/.test(name)) return false;
        if (/не\s*выбран/i.test(name)) return false;
        return true;
    }

    async function ensureRequiredPurchaseResponsibles(number, options = {}) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) return null;

        const requirePrepared = options.requirePrepared !== false;
        const requireApproved = options.requireApproved === true;
        const autoApproveByCurrentUser = options.autoApproveByCurrentUser === true;

        const preparedByEl = document.getElementById('purchaseRequestPreparedBy');
        const approvedByEl = document.getElementById('purchaseRequestApprovedBy');
        const preparedByCandidate = buildEmployeeRef(preparedByEl?.value) || doc.preparedBy || null;
        const approvedByCandidate = buildEmployeeRef(approvedByEl?.value) || doc.approvedBy || null;
        const preparedBy = hasMeaningfulEmployeeRef(preparedByCandidate) ? preparedByCandidate : null;
        let approvedBy = hasMeaningfulEmployeeRef(approvedByCandidate) ? approvedByCandidate : null;

        if (autoApproveByCurrentUser) {
            const currentUser = getCurrentPurchaseUserRef();
            if (currentUser) {
                approvedBy = {
                    id: currentUser.id,
                    name: currentUser.name,
                    position: currentUser.position || 'руководитель'
                };
            }
        }

        if (requirePrepared && !preparedBy) {
            showNotification('Поле «Подготовил (кладовщик)» обязательно', 'warning');
            return null;
        }

        if (requireApproved && !approvedBy) {
            showNotification('Поле «Согласовал (руководитель)» обязательно', 'warning');
            return null;
        }

        const updated = await updatePurchaseRequestDocument(number, current => ({
            ...current,
            preparedBy,
            approvedBy
        }));
        return updated || doc;
    }

    async function confirmPurchaseCancellation() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'order', 'Недостаточно прав для отмены заказа')) return;
        const modal = document.getElementById('purchaseCancelModal');
        const requestNumber = String(modal?.getAttribute('data-request-number') || '').trim();
        if (!requestNumber) return;

        const mode = document.querySelector('input[name="purchaseCancelMode"]:checked')?.value || 'all';
        const reason = String(document.getElementById('purchaseCancelReasonInput')?.value || '').trim();
        const selectedItemIds = [...document.querySelectorAll('.purchase-cancel-item-checkbox:checked')].map(node => String(node.value || '').trim());

        if (mode === 'selected' && !selectedItemIds.length) {
            showNotification('Выберите хотя бы одну позицию для отмены', 'warning');
            return;
        }

        const updated = await updatePurchaseRequestDocument(requestNumber, current => {
            const nextItems = (current.items || []).map(item => {
                const shouldCancel = mode === 'all' || selectedItemIds.includes(String(item.itemId || ''));
                if (!shouldCancel) return normalizePurchaseRequestItem(item);
                return normalizePurchaseRequestItem({
                    ...item,
                    status: 'cancelled',
                    cancellationReason: reason
                });
            });

            const nextStatus = mode === 'all'
                ? 'rejected'
                : calculatePurchaseRequestStatusByItems(nextItems, normalizePurchaseRequestStatus(current.status, 'draft'));

            return {
                ...current,
                status: nextStatus,
                rejectionReason: mode === 'all' ? reason : current.rejectionReason,
                items: nextItems
            };
        });

        if (!updated) {
            showNotification('Не удалось отменить заказ', 'error');
            return;
        }

        closePurchaseCancelModal();
        await loadPurchaseRequests();
        openPurchaseRequestDocument(requestNumber);
        loadDocumentsHub();
        showNotification('Отмена заказа применена', 'success');
    }

    async function confirmPurchaseDelivery() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'delivery', 'Недостаточно прав для отметки поставки')) return;
        const number = selectedPurchaseDeliveryNumber;
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }

        const modal = document.getElementById('purchaseDeliveryModal');
        const inputs = [...(modal?.querySelectorAll('.purchase-delivery-input') || [])];
        const parsedRows = inputs.map(input => ({
            itemId: String(input.getAttribute('data-item-id') || '').trim(),
            quantity: Math.max(0, Number(input.value || 0)),
            max: Math.max(0, Number(input.getAttribute('data-max') || 0))
        }));
        const statusRows = [...(modal?.querySelectorAll('.purchase-delivery-status') || [])].map(select => ({
            itemId: String(select.getAttribute('data-item-id') || '').trim(),
            status: normalizePurchaseItemStatus(select.value, 'ordered')
        }));
        const commentRows = [...(modal?.querySelectorAll('.purchase-delivery-comment') || [])].map(input => ({
            itemId: String(input.getAttribute('data-item-id') || '').trim(),
            comment: String(input.value || '').trim()
        }));
        const statusMap = new Map(statusRows.map(row => [row.itemId, row.status]));
        const commentMap = new Map(commentRows.map(row => [row.itemId, row.comment]));

        const exceeded = parsedRows.find(row => row.itemId && row.quantity > row.max);
        if (exceeded) {
            showNotification('Нельзя указать поставку больше заказанного остатка по позиции', 'error');
            return;
        }

        const quantities = parsedRows
            .filter(row => row.itemId && row.quantity > 0);
        const hasRefused = statusRows.some(row => row.itemId && row.status === 'refused');

        if (!quantities.length && !hasRefused) {
            showNotification('Укажите поставку или отметьте отказ хотя бы по одной позиции', 'warning');
            return;
        }

        // Остатки на склад поступают только при проведении акта закупки.
        // На этапе отметки поставки обновляем только саму заявку.
        const deliveryApiSynced = false;

        const qtyMap = new Map(quantities.map(row => [String(row.itemId), Number(row.quantity || 0)]));

        const updated = await updatePurchaseRequestDocument(number, current => {
            const nextItems = (current.items || []).map(item => {
                const delta = Number(qtyMap.get(String(item.itemId)) || 0);
                const orderedQuantity = Math.max(0, Number(item.orderedQuantity || 0));
                const currentDelivered = Math.max(0, Number(item.deliveredQuantity || 0));
                const requiredQuantity = Math.max(0, Number(item.requiredQuantity || 0));
                const selectedStatus = normalizePurchaseItemStatus(statusMap.get(String(item.itemId)), normalizePurchaseItemStatus(item.status));
                const allowedDelta = Math.max(0, requiredQuantity - currentDelivered);
                const deliveredQuantity = currentDelivered + Math.min(delta, allowedDelta);
                const remaining = Math.max(0, requiredQuantity - deliveredQuantity);
                let status = selectedStatus;

                if (selectedStatus !== 'refused') {
                    if (remaining === 0 && requiredQuantity > 0) status = 'completed';
                    else if (deliveredQuantity > 0) status = 'partial';
                    else if (orderedQuantity > 0) status = 'ordered';
                    else status = 'waiting';
                }

                return normalizePurchaseRequestItem({
                    ...item,
                    orderedQuantity: Math.max(orderedQuantity, requiredQuantity),
                    deliveredQuantity,
                    status,
                    comment: commentMap.get(String(item.itemId)) || item.comment || ''
                });
            });

            const nextStatus = calculatePurchaseRequestStatusByItems(nextItems, normalizePurchaseRequestStatus(current.status, 'ordered'));
            const isReceived = nextStatus === 'completed';

            return {
                ...current,
                status: nextStatus,
                items: nextItems,
                deliveredAt: isReceived ? new Date().toISOString() : current.deliveredAt,
                closedAt: isReceived ? new Date().toISOString() : current.closedAt
            };
        });

        // Автосоздание отдельного черновика акта закупки на каждую поставку.
        if (updated?.number) {
            const requestStatus = normalizePurchaseRequestStatus(updated.status);
            if (['partial', 'completed', 'closed'].includes(requestStatus) && quantities.length) {
                try {
                    createPurchaseActFromDelivery(updated.number, quantities, { date: new Date().toISOString() });
                } catch (actError) {
                    console.warn('Не удалось создать акт закупки по поставке:', actError);
                }
            }
        }

        closePurchaseDeliveryModal();
        if (deliveryApiSynced && typeof loadData === 'function') {
            await loadData({ render: true });
        } else {
            // Если API синхронизация не удалась, оставляем локальные остатки источником истины
            if (typeof loadLocalBackup === 'function') loadLocalBackup();
            if (typeof renderAll === 'function') renderAll();
        }
        // Пересчитываем черновик с обновлёнными остатками (теперь поставленные позиции не будут критичными)
        await updateDraftPurchaseRequest({ thresholdPercent: getCriticalThresholdPercent() });
        await loadPurchaseRequests();
        await loadAccountingDashboard();
        loadDocumentsHub();
        if (typeof loadPurchaseActs === 'function') loadPurchaseActs();
        if (updated?.number) {
            openPurchaseRequestDocument(updated.number);
        }
        showNotification('Поставка отражена. Остатки будут обновлены после проведения акта закупки', 'success');
    }

    async function downloadPurchaseRequestPdf(number) {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'print', 'Недостаточно прав для печати/PDF заявок')) return;
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }
        const htmlContent = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><title>Заявка на закупку</title></head><body>${renderPurchaseRequestPrintableContent(doc)}</body></html>`;
        if (typeof exportDocumentPdf === 'function') {
            await exportDocumentPdf(htmlContent, `Заявка_${doc.number || 'без_номера'}.pdf`, false);
            return;
        }

        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0.01;pointer-events:none;z-index:-1;background:#fff';
        document.body.appendChild(iframe);

        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iframeDoc) throw new Error('Не удалось открыть документ для печати');

            iframeDoc.open();
            iframeDoc.write(htmlContent);
            iframeDoc.close();

            await new Promise(resolve => setTimeout(resolve, 350));

            const iframeWindow = iframe.contentWindow;
            if (!iframeWindow) throw new Error('Не удалось подготовить окно печати');
            iframeWindow.focus();
            iframeWindow.print();
            showNotification('Открыт предпросмотр печати заявки в текущей вкладке', 'success');
        } finally {
            setTimeout(() => iframe.remove(), 1500);
        }
    }

    window.loadPurchaseRequests = loadPurchaseRequests;
    window.updateDraftPurchaseRequest = updateDraftPurchaseRequest;
    window.calculateRecommendedQuantity = calculateRecommendedQuantity;
    window.getDraftPurchaseRequest = getDraftPurchaseRequest;
    window.upsertPurchaseRequestDraftFromSource = upsertPurchaseRequestDraftFromSource;
    window.handleCreatePurchaseRequestDraftClick = handleCreatePurchaseRequestDraftClick;
    window.openPurchaseRequestDocumentByNumber = openPurchaseRequestDocument;
    window.openDraftPurchaseRequestFromWidget = function openDraftPurchaseRequestFromWidget() {
        const draft = getDraftPurchaseRequest();
        if (!draft) {
            showNotification('Черновик заявки не найден', 'warning');
            return;
        }
        if (typeof showPage === 'function') showPage('purchaseRequests');
        openPurchaseRequestDocument(draft.number);
    };
    window.closePurchaseRequestModal = closePurchaseRequestModal;
    window.enablePurchaseRequestEditing = function enablePurchaseRequestEditing() {
        if (!selectedPurchaseRequestNumber) return;
        const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        if (!doc) return;
        if (!canEditPurchaseRequest(doc)) {
            showNotification('Редактирование недоступно для текущего статуса заявки', 'warning');
            return;
        }
        rerenderPurchaseRequestModal(doc, true);
    };
    window.cancelPurchaseRequestEditing = function cancelPurchaseRequestEditing() {
        if (!selectedPurchaseRequestNumber) return;
        const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        if (!doc) return;
        rerenderPurchaseRequestModal(doc, false);
    };
    window.removePurchaseRequestItem = async function removePurchaseRequestItem(number, itemId) {
        const currentDoc = getPurchaseRequestByNumber(number);
        const docStatus = normalizePurchaseRequestStatus(currentDoc?.status, 'draft');
        const item = (currentDoc?.items || []).find(entry => String(entry.itemId || '') === String(itemId || ''));
        const itemStatus = normalizePurchaseItemStatus(item?.status, 'draft');
        const canDeleteItem = ['draft', 'approval'].includes(docStatus) || ['refused', 'cancelled'].includes(itemStatus);
        if (!canDeleteItem) {
            showNotification('Удаление доступно только в черновике/согласовании или для отклоненной/отмененной позиции', 'warning');
            return;
        }
        const updated = await updatePurchaseRequestDocument(number, current => ({
            ...current,
            items: (current.items || []).filter(item => String(item.itemId) !== String(itemId))
        }));
        if (!updated) return;
        syncLinkedPurchaseActWithRequest(updated);
        rerenderPurchaseRequestModal(updated, canEditPurchaseRequest(updated));
    };
    window.setPurchaseRequestItemStatus = async function setPurchaseRequestItemStatus(number, itemId, nextStatus) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) return;
        const docStatus = normalizePurchaseRequestStatus(doc.status, 'draft');
        const targetStatus = normalizePurchaseItemStatus(nextStatus, 'draft');
        const item = (doc.items || []).find(entry => String(entry.itemId || '') === String(itemId || ''));
        const currentItemStatus = normalizePurchaseItemStatus(item?.status, 'draft');

        const isAllowedTransition = (() => {
            if (targetStatus === 'approved') {
                return ['draft', 'approval', 'approved_partial'].includes(docStatus) && ['approval'].includes(currentItemStatus);
            }
            if (targetStatus === 'refused') {
                return ['draft', 'approval', 'approved_partial'].includes(docStatus) && ['approval', 'approved'].includes(currentItemStatus);
            }
            if (targetStatus === 'ordered') {
                return ['approved', 'approved_partial', 'ordered', 'partial'].includes(docStatus) && ['approved'].includes(currentItemStatus);
            }
            if (targetStatus === 'cancelled') {
                return ['approved', 'approved_partial', 'ordered', 'partial'].includes(docStatus) && ['ordered', 'approved'].includes(currentItemStatus);
            }
            return false;
        })();

        if (!isAllowedTransition) {
            showNotification('Это действие недоступно для текущего статуса позиции/заявки', 'warning');
            return;
        }

        const updated = await updatePurchaseRequestDocument(number, current => {
            const nextItems = (current.items || []).map(item => {
                if (String(item.itemId || '') !== String(itemId || '')) return normalizePurchaseRequestItem(item);
                return normalizePurchaseRequestItem({
                    ...item,
                    status: targetStatus,
                    orderedQuantity: targetStatus === 'ordered'
                        ? Math.max(Number(item.orderedQuantity || 0), Number(item.requiredQuantity || 0))
                        : Number(item.orderedQuantity || 0)
                });
            });
            const nextDocStatus = calculatePurchaseRequestStatusByItems(nextItems, normalizePurchaseRequestStatus(current.status, 'draft'));
            return {
                ...current,
                status: nextDocStatus,
                items: nextItems
            };
        });

        if (!updated) return;
        await loadPurchaseRequests();
        rerenderPurchaseRequestModal(updated, true);
        showNotification('Статус позиции обновлен', 'success');
    };
    window.savePurchaseRequestChanges = async function savePurchaseRequestChanges() {
        if (!selectedPurchaseRequestNumber) return;
        const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        if (!doc) {
            showNotification('Черновик не найден. Откройте заявку заново.', 'warning');
            return;
        }
        if (!canEditPurchaseRequest(doc)) {
            showNotification('Сохранение недоступно для текущего статуса заявки', 'warning');
            return;
        }
        const inputs = [...document.querySelectorAll('.purchase-request-required-input')];
        const qtyMap = new Map(inputs.map(input => [
            String(input.getAttribute('data-item-id') || '').trim(),
            Math.max(1, Number(input.value || 1))
        ]));
        const commentInputs = [...document.querySelectorAll('.purchase-request-comment-input')];
        const commentMap = new Map(commentInputs.map(input => [
            String(input.getAttribute('data-item-id') || '').trim(),
            String(input.value || '').trim()
        ]));

        const preparedByEl = document.getElementById('purchaseRequestPreparedBy');
        const approvedByEl = document.getElementById('purchaseRequestApprovedBy');
        const preparedByCandidate = buildEmployeeRef(preparedByEl?.value) || doc.preparedBy || null;
        const approvedByCandidate = buildEmployeeRef(approvedByEl?.value) || doc.approvedBy || null;
        const preparedBy = hasMeaningfulEmployeeRef(preparedByCandidate) ? preparedByCandidate : null;
        const approvedBy = hasMeaningfulEmployeeRef(approvedByCandidate) ? approvedByCandidate : null;

        if (!preparedBy || !approvedBy) {
            showNotification('Заполните обязательные поля: Подготовил и Согласовал', 'warning');
            return;
        }

        const updated = await updatePurchaseRequestDocument(selectedPurchaseRequestNumber, current => ({
            ...current,
            preparedBy,
            approvedBy,
            items: (current.items || []).map(item => {
                const newQty = qtyMap.get(String(item.itemId));
                if (newQty === undefined) return item;
                return normalizePurchaseRequestItem({
                    ...item,
                    requiredQuantity: newQty,
                    orderedQuantity: Number(item.orderedQuantity || 0),
                    comment: commentMap.get(String(item.itemId)) || item.comment || '',
                    manualAdded: item.manualAdded === true
                });
            })
        }));

        if (!updated) {
            showNotification('Не удалось сохранить изменения заявки', 'error');
            return;
        }

        syncLinkedPurchaseActWithRequest(updated);

        await loadPurchaseRequests();
        await loadAccountingDashboard();
        loadDocumentsHub();
        if (typeof loadPurchaseActs === 'function') loadPurchaseActs();
        rerenderPurchaseRequestModal(updated, false);
        showNotification('Заявка обновлена', 'success');
    };
    function buildEmployeeRef(empId) {
        if (!empId) return null;
        const list = (typeof employees !== 'undefined' && Array.isArray(employees)) ? employees : [];
        const emp = list.find(e => String(e.id) === String(empId));
        if (emp) return { id: emp.id, name: emp.name || '—', position: emp.position || '—' };

        const preparedSelect = document.getElementById('purchaseRequestPreparedBy');
        const approvedSelect = document.getElementById('purchaseRequestApprovedBy');
        const option = preparedSelect?.querySelector(`option[value="${String(empId)}"]`)
            || approvedSelect?.querySelector(`option[value="${String(empId)}"]`);
        const label = String(option?.textContent || '').replace(/—\s*не\s*выбран\s*—/gi, '').trim();

        return { id: String(empId), name: label || `Сотрудник #${empId}`, position: '—' };
    }

    window.filterPurchaseRequestItemOptions = function filterPurchaseRequestItemOptions() {
        const select = document.getElementById('purchaseRequestItemSelect');
        const categoryFilter = document.getElementById('purchaseRequestItemCategoryFilter')?.value || '';
        const searchFilter = String(document.getElementById('purchaseRequestItemSearchInput')?.value || '').trim().toLowerCase();
        if (!select) return;

        const currentValue = select.value;
        const inv = (typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [];
        const filtered = inv
            .filter(isPurchaseRequestSelectableInventoryItem)
            .filter(i => !categoryFilter || String(i.category || '') === String(categoryFilter))
            .filter(i => !searchFilter || String(i.name || '').toLowerCase().includes(searchFilter));

        select.innerHTML = `<option value="">— выберите объект —</option>${filtered.map(i =>
            `<option value="${html(String(i.id))}" data-name="${html(i.name || '')}" data-category="${html(i.category || '')}" data-unit="шт">${html(i.name || '—')}</option>`
        ).join('')}`;

        if (currentValue && filtered.some(i => String(i.id) === String(currentValue))) {
            select.value = currentValue;
        }
    };

    window.openLinkedPurchaseActFromRequest = function openLinkedPurchaseActFromRequest() {
        const btn = document.getElementById('purchaseRequestOpenActBtn');
        const actNumber = String(btn?.getAttribute('data-act-number') || '').trim();
        if (!actNumber) {
            showNotification('Связанный акт закупки не найден', 'warning');
            return;
        }
        openDocumentCardByNumber(actNumber);
    };

    window.addItemToPurchaseRequest = async function addItemToPurchaseRequest() {
        if (!selectedPurchaseRequestNumber) return;
        const currentDoc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        if (!currentDoc) {
            showNotification('Черновик не найден. Откройте заявку заново.', 'warning');
            return;
        }

        if (normalizePurchaseRequestStatus(currentDoc.status) === 'rejected') {
            const copied = await window.copyRejectedPurchaseRequest?.();
            if (!copied) return;
            return;
        }

        if (!canEditPurchaseRequest(currentDoc)) {
            showNotification('Добавление позиций доступно только для черновика', 'warning');
            return;
        }

        const select = document.getElementById('purchaseRequestItemSelect');
        const qtyInput = document.getElementById('purchaseRequestNewItemQty');
        const itemId = select?.value;
        const qty = Math.max(1, Number(qtyInput?.value || 1));
        if (!itemId) { showNotification('Выберите объект для добавления', 'warning'); return; }

        const inv = (typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [];
        const invItem = inv.find(i => String(i.id) === String(itemId));
        if (!invItem) { showNotification('Объект не найден в справочнике', 'error'); return; }

        // Сохраняем текущие изменения полей перед добавлением
        const inputs = [...document.querySelectorAll('.purchase-request-required-input')];
        const qtyMap = new Map(inputs.map(input => [
            String(input.getAttribute('data-item-id') || '').trim(),
            Math.max(1, Number(input.value || 1))
        ]));
        const preparedBy = buildEmployeeRef(document.getElementById('purchaseRequestPreparedBy')?.value);
        const approvedBy = buildEmployeeRef(document.getElementById('purchaseRequestApprovedBy')?.value);

        const updated = await updatePurchaseRequestDocument(selectedPurchaseRequestNumber, current => {
            let items = (current.items || []).map(item => {
                const newQty = qtyMap.get(String(item.itemId));
                if (newQty === undefined) return item;
                return normalizePurchaseRequestItem({ ...item, requiredQuantity: newQty });
            });
            const existingIdx = items.findIndex(i => String(i.itemId) === String(itemId));
            if (existingIdx >= 0) {
                items[existingIdx] = normalizePurchaseRequestItem({
                    ...items[existingIdx],
                    requiredQuantity: Number(items[existingIdx].requiredQuantity || 0) + qty,
                    manualAdded: true
                });
            } else {
                items.push(normalizePurchaseRequestItem({
                    itemId: String(invItem.id),
                    name: invItem.name || '—',
                    category: invItem.category || '—',
                    requiredQuantity: qty,
                    orderedQuantity: 0,
                    deliveredQuantity: 0,
                    status: 'draft',
                    unit: 'шт',
                    manualAdded: true
                }));
            }
            return {
                ...current,
                items,
                preparedBy: preparedBy || current.preparedBy || null,
                approvedBy: approvedBy || current.approvedBy || null
            };
        });

        if (!updated) return;
        syncLinkedPurchaseActWithRequest(updated);
        if (select) select.value = '';
        if (qtyInput) qtyInput.value = '1';
        rerenderPurchaseRequestModal(updated, true);
        showNotification(`${invItem.name} добавлен в заявку`, 'success');
    };

    window.deletePurchaseRequest = async function deletePurchaseRequest(number) {
        const num = number || selectedPurchaseRequestNumber;
        if (!num) return;
        const doc = getPurchaseRequestByNumber(num);
        if (!doc) return;
        if (!canDeletePurchaseRequest(doc)) {
            showNotification('Удаление доступно только для Черновика или Отклоненной заявки', 'warning');
            return;
        }
        const label = `Заявка ${doc.number} (${getPurchaseStatusLabel(doc.status)})`;
        if (!confirm(`Удалить ${label}? Это действие необратимо.`)) return;

        // При удалении заявки удаляем все связанные акты закупки
        const linkedActs = getPurchaseActsByRequestNumber(doc.number);
        if (linkedActs.length) {
            const linkedNumbers = new Set(linkedActs.map(act => String(act.number || '').trim()));
            const acts = readPurchaseActDocuments().filter(act => !linkedNumbers.has(String(act.number || '').trim()));
            writePurchaseActDocuments(acts);
        }

        const docs = readPurchaseRequestDocuments().filter(d => String(d.number) !== String(num));
        writePurchaseRequestDocuments(docs);
        closePurchaseRequestModal();
        await loadPurchaseRequests();
        await loadAccountingDashboard();
        loadDocumentsHub();
        if (typeof loadPurchaseActs === 'function') loadPurchaseActs();
        showNotification(`${label} удалена`, 'success');
    };

    window.submitPurchaseRequestForApproval = async function submitPurchaseRequestForApproval() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'approve', 'Недостаточно прав для отправки на согласование')) return;
        const submitBtn = document.getElementById('purchaseRequestSubmitBtn');
        try {
            if (!selectedPurchaseRequestNumber) return;
            if (submitBtn) submitBtn.disabled = true;

            const currentDoc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
            const hasItems = (currentDoc?.items || []).some(item => Number(item?.requiredQuantity || 0) > 0);
            if (!hasItems) {
                showNotification('Добавьте хотя бы одну позицию перед отправкой на согласование', 'warning');
                return;
            }

            const withResponsible = await ensureRequiredPurchaseResponsibles(selectedPurchaseRequestNumber, {
                requirePrepared: true,
                requireApproved: true
            });
            if (!withResponsible) return;

            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'approval');
            setActivePurchaseRequestsFilter('approval');
            await loadPurchaseRequests();
            await loadAccountingDashboard();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            loadDocumentsHub();
            showNotification('Заявка отправлена на согласование', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка отправки на согласование', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
    window.approvePurchaseRequest = window.submitPurchaseRequestForApproval;

    window.approvePurchaseRequestByManager = async function approvePurchaseRequestByManager() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'approve', 'Недостаточно прав для согласования заявки')) return;
        try {
            if (!selectedPurchaseRequestNumber) return;
            if (!canApprovePurchaseRequestByRole()) {
                showNotification('Согласование доступно только пользователю с ролью «Руководитель»', 'warning');
                return;
            }
            const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
            const status = normalizePurchaseRequestStatus(doc?.status);
            if (status !== 'approval') {
                showNotification(`Согласование доступно только из статуса «На согласовании». Текущий: ${getPurchaseStatusLabel(status)}`, 'warning');
                return;
            }
            const withResponsible = await ensureRequiredPurchaseResponsibles(selectedPurchaseRequestNumber, {
                requirePrepared: true,
                requireApproved: true
            });
            if (!withResponsible) return;
            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'approved');
            setActivePurchaseRequestsFilter('approved');
            await loadPurchaseRequests();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            loadDocumentsHub();
            showNotification('Заявка согласована', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка согласования заявки', 'error');
        }
    };

    window.approvePurchaseRequestPartially = async function approvePurchaseRequestPartially() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'approve', 'Недостаточно прав для частичного согласования')) return;
        if (!selectedPurchaseRequestNumber) return;
        if (!canApprovePurchaseRequestByRole()) {
            showNotification('Частичное согласование доступно только пользователю с ролью «Руководитель»', 'warning');
            return;
        }
        const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        const status = normalizePurchaseRequestStatus(doc?.status);
        if (status !== 'approval') {
            showNotification(`Частичное согласование доступно только из статуса «На согласовании». Текущий: ${getPurchaseStatusLabel(status)}`, 'warning');
            return;
        }
        openPurchaseApprovalSelectionModal(selectedPurchaseRequestNumber);
    };

    function openPurchaseApprovalSelectionModal(number) {
        const doc = getPurchaseRequestByNumber(number);
        if (!doc) {
            showNotification('Заявка не найдена', 'warning');
            return;
        }
        const modal = document.getElementById('purchaseApprovalSelectionModal');
        const content = document.getElementById('purchaseApprovalSelectionModalContent');
        if (!modal || !content) return;

        const rows = (doc.items || []).filter(item => {
            const s = normalizePurchaseItemStatus(item.status, 'draft');
            return ['approval', 'draft'].includes(s);
        });

        content.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;">
                ${rows.length ? rows.map(item => `
                    <label style="display:flex;justify-content:flex-start;gap:10px;align-items:center;">
                        <input type="checkbox" class="purchase-approval-item-checkbox" value="${html(String(item.itemId || ''))}" checked>
                        <span>${html(item.name || item.itemId || '—')} (${Number(item.requiredQuantity || 0)} ${html(item.unit || 'шт')})</span>
                    </label>
                `).join('') : '<div class="small-muted">Нет позиций для согласования</div>'}
            </div>
        `;

        modal.setAttribute('data-request-number', String(number || ''));
        modal.style.display = 'block';
    }

    function closePurchaseApprovalSelectionModal() {
        const modal = document.getElementById('purchaseApprovalSelectionModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmPurchaseApprovalSelection() {
        try {
            const modal = document.getElementById('purchaseApprovalSelectionModal');
            const number = String(modal?.getAttribute('data-request-number') || '').trim();
            if (!number) return;

            const withResponsible = await ensureRequiredPurchaseResponsibles(number, {
                requirePrepared: true,
                requireApproved: true
            });
            if (!withResponsible) return;

            const approvedIds = new Set(
                [...document.querySelectorAll('.purchase-approval-item-checkbox:checked')]
                    .map(node => String(node.value || '').trim())
                    .filter(Boolean)
            );

            const updated = await updatePurchaseRequestDocument(number, current => {
                const nextItems = (current.items || []).map(item => {
                    const itemId = String(item.itemId || '').trim();
                    const currentStatus = normalizePurchaseItemStatus(item.status, 'draft');
                    if (!['approval', 'draft'].includes(currentStatus)) return normalizePurchaseRequestItem(item);
                    return normalizePurchaseRequestItem({
                        ...item,
                        status: approvedIds.has(itemId) ? 'approved' : 'refused'
                    });
                });
                return {
                    ...current,
                    approvedBy: withResponsible.approvedBy || current.approvedBy || null,
                    status: 'approved_partial',
                    items: nextItems
                };
            });

            if (!updated) throw new Error('Не удалось частично согласовать заявку');
            closePurchaseApprovalSelectionModal();
            setActivePurchaseRequestsFilter('approved_partial');
            await loadPurchaseRequests();
            openPurchaseRequestDocument(number);
            loadDocumentsHub();
            showNotification('Заявка согласована частично', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка частичного согласования заявки', 'error');
        }
    }

    window.rejectPurchaseRequest = async function rejectPurchaseRequest() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'approve', 'Недостаточно прав для отклонения заявки')) return;
        try {
            if (!selectedPurchaseRequestNumber) return;
            if (!canApprovePurchaseRequestByRole()) {
                showNotification('Отклонение доступно только пользователю с ролью «Руководитель»', 'warning');
                return;
            }
            const withResponsible = await ensureRequiredPurchaseResponsibles(selectedPurchaseRequestNumber, {
                requirePrepared: true,
                requireApproved: true
            });
            if (!withResponsible) return;
            const reason = String(prompt('Укажите причину отклонения:', '') || '').trim();
            const withReason = await updatePurchaseRequestDocument(selectedPurchaseRequestNumber, current => ({
                ...current,
                approvedBy: withResponsible.approvedBy || current.approvedBy || null,
                rejectionReason: reason
            }));
            if (!withReason) throw new Error('Не удалось сохранить причину отклонения');

            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'rejected');
            setActivePurchaseRequestsFilter('rejected');
            await loadPurchaseRequests();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            loadDocumentsHub();
            showNotification('Заявка отклонена', 'warning');
        } catch (error) {
            showNotification(error.message || 'Ошибка отклонения заявки', 'error');
        }
    };

    window.orderPurchaseRequest = async function orderPurchaseRequest() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'order', 'Недостаточно прав для перевода заявки в заказ')) return;
        try {
            if (!selectedPurchaseRequestNumber) return;
            const withResponsible = await ensureRequiredPurchaseResponsibles(selectedPurchaseRequestNumber, {
                requirePrepared: true,
                requireApproved: true
            });
            if (!withResponsible) return;
            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'ordered');
            await loadPurchaseRequests();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            loadDocumentsHub();
            showNotification('Заявка переведена в статус Заказан', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка смены статуса', 'error');
        }
    };
    window.cancelPurchaseOrder = async function cancelPurchaseOrder() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'order', 'Недостаточно прав для отмены заказа')) return;
        try {
            if (!selectedPurchaseRequestNumber) return;
            const doc = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
            const status = normalizePurchaseRequestStatus(doc?.status);
            if (!doc || !['ordered', 'partial'].includes(status)) {
                showNotification('Нельзя отменить данный заказ', 'warning');
                return;
            }

            openPurchaseCancelModal(selectedPurchaseRequestNumber);
        } catch (error) {
            showNotification(error.message || 'Ошибка отмены заказа', 'error');
        }
    };
    window.returnPurchaseRequestToDraft = async function returnPurchaseRequestToDraft() {
        try {
            if (!selectedPurchaseRequestNumber) return;
            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'draft');
            await loadPurchaseRequests();
            const updated = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
            if (updated) {
                rerenderPurchaseRequestModal(updated, true);
            }
            loadDocumentsHub();
            showNotification('Заявка возвращена в черновик', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка возврата в черновик', 'error');
        }
    };
    window.closePurchaseRequest = async function closePurchaseRequest() {
        try {
            if (!selectedPurchaseRequestNumber) return;
            await setPurchaseRequestStatus(selectedPurchaseRequestNumber, 'closed');
            await loadPurchaseRequests();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            loadDocumentsHub();
            showNotification('Заявка закрыта', 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка закрытия заявки', 'error');
        }
    };

    window.copyRejectedPurchaseRequest = async function copyRejectedPurchaseRequest() {
        if (!selectedPurchaseRequestNumber) return null;
        const source = getPurchaseRequestByNumber(selectedPurchaseRequestNumber);
        if (!source || normalizePurchaseRequestStatus(source.status) !== 'rejected') {
            showNotification('Копирование доступно только для отклоненной заявки', 'warning');
            return null;
        }

        const docs = readPurchaseRequestDocuments();
        const number = buildNextPurchaseRequestNumber(docs);
        const now = new Date().toISOString();
        const copied = normalizePurchaseRequestDocument({
            id: number,
            number,
            date: now,
            status: 'draft',
            items: (source.items || []).map(item => normalizePurchaseRequestItem({
                ...item,
                orderedQuantity: 0,
                deliveredQuantity: 0,
                status: 'draft',
                rejectionReason: ''
            })),
            createdAt: now,
            updatedAt: now,
            preparedBy: source.preparedBy || null,
            approvedBy: null,
            rejectionReason: ''
        });

        docs.unshift(copied);
        writePurchaseRequestDocuments(docs);
        selectedPurchaseRequestNumber = copied.number;
        await loadPurchaseRequests();
        setActivePurchaseRequestsFilter('draft');
        openPurchaseRequestDocument(copied.number);
        rerenderPurchaseRequestModal(copied, true);
        showNotification(`Создана копия заявки: ${copied.number}`, 'success');
        return copied;
    };
    window.openDeliveryForSelectedPurchaseRequest = function openDeliveryForSelectedPurchaseRequest() {
        if (typeof requirePermission === 'function' && !requirePermission('purchaseRequests', 'delivery', 'Недостаточно прав для отметки поставки')) return;
        if (!selectedPurchaseRequestNumber) return;
        openPurchaseDeliveryModal(selectedPurchaseRequestNumber);
    };
    window.closePurchaseApprovalSelectionModal = closePurchaseApprovalSelectionModal;
    window.confirmPurchaseApprovalSelection = confirmPurchaseApprovalSelection;
    window.closePurchaseDeliveryModal = closePurchaseDeliveryModal;
    window.confirmPurchaseDelivery = confirmPurchaseDelivery;
    window.closePurchaseCancelModal = closePurchaseCancelModal;
    window.confirmPurchaseCancellation = confirmPurchaseCancellation;
    window.downloadPurchaseRequestPdfFromModal = async function downloadPurchaseRequestPdfFromModal() {
        if (!selectedPurchaseRequestNumber) return;
        await downloadPurchaseRequestPdf(selectedPurchaseRequestNumber);
    };
    window.createPurchaseActFromSelectedRequest = async function createPurchaseActFromSelectedRequest() {
        if (!selectedPurchaseRequestNumber) return;
        try {
            const act = createPurchaseActFromRequest(selectedPurchaseRequestNumber);
            await loadPurchaseRequests();
            loadPurchaseActs();
            loadDocumentsHub();
            openPurchaseRequestDocument(selectedPurchaseRequestNumber);
            showNotification(`Акт закупки создан: ${act.number}`, 'success');
        } catch (error) {
            showNotification(error.message || 'Ошибка создания акта закупки', 'error');
        }
    };
    window.downloadPurchaseRequestPdfByNumber = async function downloadPurchaseRequestPdfByNumber(number) {
        await downloadPurchaseRequestPdf(number);
    };
    window.printPurchaseRequestFromModal = function printPurchaseRequestFromModal() {
        const area = document.getElementById('purchaseRequestPrintableArea');
        if (!area) return;

        const unifiedPrintStyle = buildUnifiedPrintStyle(`
            .purchase-request-document { border: 1px solid #d9d9d9; border-radius: 6px; padding: 10px 12px; background: #fff; }
            .purchase-request-header { margin-bottom: 10px; }
            .purchase-request-title-block h3 { margin: 0; font-size: 18px; font-weight: 700; }
            .purchase-request-subtitle { margin-top: 6px; font-size: 11px; color: #666; }
            .purchase-request-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px 12px; margin-bottom: 10px; font-size: 11px; }
            .purchase-request-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; margin-bottom: 10px; }
            .purchase-request-summary-card { border: 1px solid #d9d9d9; border-radius: 6px; padding: 8px 10px; background: #fafafa; }
        `);

        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);

        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (!frameDoc) {
            frame.remove();
            return;
        }

        frameDoc.open();
        frameDoc.write(`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><title>Заявка на закупку</title><style>${unifiedPrintStyle}</style></head><body>${area.outerHTML}</body></html>`);
        frameDoc.close();

        setTimeout(() => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(() => frame.remove(), 800);
        }, 200);
    };

    updateDraftPurchaseRequest({ thresholdPercent: getCriticalThresholdPercent() }).catch(() => null);

    setInterval(() => {
        updateDraftPurchaseRequest({ thresholdPercent: getCriticalThresholdPercent() }).catch(() => null);
    }, 5 * 60 * 1000);

    // ========== DOCUMENT EDITING HANDLERS (Global Functions) ==========

    window.validateDocumentNumber = function validateDocumentNumber(docType) {
        const input = document.getElementById('documentCardNumberInput');
        const errorDiv = document.getElementById('documentCardNumberError');
        const saveBtn = document.getElementById('documentCardSaveBtn');
        if (!input || !errorDiv) return;

        const number = String(input.value || '').trim();
        const errors = [];

        if (!number) {
            input.classList.remove('error');
            errorDiv.textContent = '';
            if (saveBtn) saveBtn.disabled = false;
            return;
        }

        if (!validateNumberFormat(docType, number)) {
            errors.push(getNumberFormatError(docType));
        }

        if (!checkNumberUniqueness(docType, number, selectedDocumentCard?.number)) {
            errors.push(getNumberDuplicateError(number));
        }

        if (errors.length) {
            input.classList.add('error');
            errorDiv.textContent = errors.join('; ');
            if (saveBtn) saveBtn.disabled = true;
            return false;
        }

        input.classList.remove('error');
        errorDiv.textContent = '';
        if (saveBtn) saveBtn.disabled = false;
        return true;
    };

    window.removeDocumentPosition = function removeDocumentPosition(itemIndex) {
        if (!selectedDocumentCard || itemIndex < 0) return;

        const newDoc = removeItemFromDocument(selectedDocumentCard, itemIndex);
        if (!newDoc) {
            showNotification('Не удалось удалить позицию', 'error');
            return;
        }

        selectedDocumentCard = newDoc;
        rerenderDocumentCard(true); // Stay in edit mode
        showNotification('Позиция удалена', 'success');
    };

    window.addDocumentPosition = function addDocumentPosition() {
        if (!selectedDocumentCard) return;

        // Show a modal to select inventory item
        const modal = document.getElementById('inventorySelectModal');
        if (!modal) {
            // Create simple inventory selector
            showNotification('⚠ Функция выбора товара из справочника требует подключения модуля инвентаря', 'info');
            
            // For now, create a demo item
            const demoItem = {
                id: Date.now(),
                name: 'Новая позиция',
                category: 'Без категории',
                price: 0,
                rent_price: 0
            };

            const newDoc = addNewItemToDocument(selectedDocumentCard, demoItem);
            if (!newDoc) {
                showNotification('Не удалось добавить позицию', 'error');
                return;
            }

            selectedDocumentCard = newDoc;
            rerenderDocumentCard(true); // Stay in edit mode
            showNotification('Позиция добавлена', 'success');
            return;
        }

        // If modal exists, show it
        // modal.style.display = 'block';
        // ... handler for item selection
    };

    window.updateDocumentNumberField = function updateDocumentNumberField(newNumber) {
        if (!selectedDocumentCard) return;
        selectedDocumentCard.number = String(newNumber || '').trim();
    };

})();
