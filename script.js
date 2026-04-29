// ============================================================================
// WarehouseApp Frontend Logic (rebuilt)
// ============================================================================

let inventory = [];
let rentals = [];
let events = [];
let clients = [];
let employees = [];

let editingItem = null;
let editingRental = null;
let editingEvent = null;
let editingClient = null;
let editingEmployee = null;

const DELIVERY_ADJUSTMENTS_STORAGE_KEY = 'warehouse_delivery_adjustments_v1';
const ITEM_UNIT_COST_STORAGE_KEY = 'warehouse_item_unit_cost_v1';
let editingUser = null;
let usersList = [];
let currentItemCard = null;
let confirmCallback = null;
let currentUserRole = localStorage.getItem('authRole') || '';
let entityFormRowSequence = 1;
let stockDeficitModalState = null;
let purchaseRequestChoiceModalState = null;
let selectedImageData = null;
let loginFailedAttempts = 0;
let loginVisualEffectsInitialized = false;
let loginErrorTimeoutId = null;
let loginLockUntil = 0;
let loginLockTimerId = null;
let loginCaptcha = null;
let loginCaptchaSolved = false;
let initialDataLoadPromise = null;

const LOGIN_SECURITY_STORAGE_KEY = 'warehouse_login_security_v1';
const LOGIN_MAX_ATTEMPTS = 3;
const LOGIN_LOCK_SECONDS = 300;
const LOGIN_CAPTCHA_SETS = [
    {
        category: 'стулья',
        base: [
            { icon: '🪑', label: 'Стул' },
            { icon: '🪑', label: 'Табурет' },
            { icon: '🪑', label: 'Кресло' }
        ],
        odd: [
            { icon: '🖼️', label: 'Картина' },
            { icon: '💡', label: 'Светильник' },
            { icon: '🛋️', label: 'Диван' }
        ]
    },
    {
        category: 'светильники',
        base: [
            { icon: '💡', label: 'Бра' },
            { icon: '💡', label: 'Лампа' },
            { icon: '💡', label: 'Подсветка' }
        ],
        odd: [
            { icon: '🪑', label: 'Стул' },
            { icon: '🗄️', label: 'Стол' },
            { icon: '🖼️', label: 'Постер' }
        ]
    }
];

const ROLE_LABELS = {
    admin: 'Администратор',
    руководитель: 'Руководитель',
    менеджер: 'Менеджер по аренде',
    кладовщик: 'Кладовщик',
    гость: 'Гость / Наблюдатель'
};

const PERMISSION_LABELS = {
    stock: {
        title: 'Склад',
        actions: { view: 'Просмотр', create: 'Добавление объектов', edit: 'Редактирование объектов', delete: 'Удаление объектов', changeQty: 'Изменение количества' }
    },
    rental: {
        title: 'Аренда',
        actions: { view: 'Просмотр', create: 'Создание аренды', edit: 'Редактирование аренды', delete: 'Удаление аренды', changeStatus: 'Изменение статуса', documents: 'Формирование документов' }
    },
    events: {
        title: 'Мероприятия',
        actions: { view: 'Просмотр', create: 'Создание мероприятий', edit: 'Редактирование мероприятий', delete: 'Удаление мероприятий', changeStatus: 'Изменение статуса', documents: 'Формирование документов' }
    },
    reports: {
        title: 'Отчёты',
        actions: { view: 'Просмотр отчётов', export: 'Экспорт отчётов (PDF/Excel)' }
    },
    users: {
        title: 'Пользователи',
        actions: { view: 'Просмотр списка пользователей', create: 'Создание пользователей', edit: 'Редактирование пользователей', delete: 'Удаление пользователей', permissions: 'Настройка прав доступа' }
    },
    documents: {
        title: 'Документы',
        actions: {
            view: 'Просмотр документов',
            generate: 'Формирование документов',
            search: 'Сквозной поиск по документам',
            changeStatus: 'Проведение/отмена документов',
            print: 'Печать и PDF'
        }
    },
    calendar: {
        title: 'Календарь',
        actions: { view: 'Просмотр календаря занятости' }
    },
    purchaseRequests: {
        title: 'Закупки',
        actions: {
            view: 'Просмотр заявок и актов закупки',
            create: 'Создание закупочных заявок',
            edit: 'Редактирование заявок/актов',
            delete: 'Удаление заявок/актов',
            approve: 'Согласование заявок',
            order: 'Перевод в заказ',
            delivery: 'Отметка поставки',
            print: 'Печать и PDF'
        }
    }
};

const autoSaveEnabled = false;
let rentalsChart = null;
let eventsChart = null;
let currentNoteEditorContext = null;

const RENTAL_FILTERS_STORAGE_KEY = 'warehouse_rental_filters';
const EVENT_FILTERS_STORAGE_KEY = 'warehouse_event_filters';
const THEME_STORAGE_KEY = 'warehouse_theme';

// ============================================================================
// Utility (escapeHtml, restoreText, parseDateValue, formatDateTime — в script-utils-core.js)
// ============================================================================

function generateAcceptanceActNumber() {
    if (typeof window.generateYearlyDocumentNumber === 'function') {
        return window.generateYearlyDocumentNumber('acceptance');
    }

    const year = new Date().getFullYear();
    const counterKey = `warehouse_doc_counter_acceptance_${year}`;
    const next = Number(localStorage.getItem(counterKey) || '0') + 1;
    localStorage.setItem(counterKey, String(next));
    return `ПР-${String(next).padStart(6, '0')}`;
}

function getCurrentNormalizedRole() {
    return RBAC.normalizeRole(currentUserRole || RBAC.getCurrentUser().role || 'гость');
}

function requirePermission(moduleName, action, message = 'Недостаточно прав') {
    if (RBAC.hasPermission(moduleName, action)) {
        return true;
    }
    showNotification(message, 'error');
    return false;
}

function getEffectiveUserPermissions(user) {
    if (!user) return {};
    const customPermissions = Object.prototype.hasOwnProperty.call(user, 'permissions')
        ? user.permissions
        : RBAC.loadUserCustomPermissions(user.id);
    return RBAC.getUserPermissions(user.role, customPermissions);
}

const PAGE_ACCESS_RULES = {
    dashboard: [['stock', 'view']],
    sklad: [['stock', 'view']],
    mebel: [['stock', 'view']],
    eksponat: [['stock', 'view']],
    instrument: [['stock', 'view']],
    history: [['stock', 'view']],
    calendar: [['calendar', 'view']],
    arenda: [['rental', 'view']],
    events: [['events', 'view']],
    documentsHub: [['documents', 'view']],
    issuanceActs: [['documents', 'view']],
    transferActs: [['documents', 'view']],
    acceptanceActs: [['documents', 'view']],
    purchaseRequests: [['purchaseRequests', 'view']],
    purchaseActs: [['purchaseRequests', 'view']],
    writeoffActs: [['documents', 'view']],
    clients: [['rental', 'view'], ['events', 'view'], ['users', 'view']],
    employees: [['rental', 'view'], ['events', 'view'], ['users', 'view']],
    users: [['users', 'view']]
};

function canAccessPage(pageId) {
    if (['mebel', 'eksponat', 'instrument', 'history'].includes(pageId)) {
        return RBAC.hasPermission('stock', 'view') && hasStockManagementPermission();
    }

    const rules = PAGE_ACCESS_RULES[pageId];
    if (!rules || rules.length === 0) {
        return true;
    }

    return rules.some(([moduleName, action]) => RBAC.hasPermission(moduleName, action));
}

function canManageDirectories() {
    return RBAC.hasPermission('users', 'edit') || RBAC.hasPermission('rental', 'edit') || RBAC.hasPermission('events', 'edit');
}

function hasStockManagementPermission() {
    return RBAC.hasPermission('stock', 'create')
        || RBAC.hasPermission('stock', 'edit')
        || RBAC.hasPermission('stock', 'delete')
        || RBAC.hasPermission('stock', 'changeQty');
}

function getFirstAccessiblePage() {
    const pagePriority = ['dashboard', 'sklad', 'arenda', 'events', 'documentsHub', 'purchaseRequests', 'writeoffActs', 'calendar', 'clients', 'employees', 'users'];
    return pagePriority.find(pageId => canAccessPage(pageId)) || null;
}

function arePermissionsEqual(leftPermissions, rightPermissions) {
    return Object.entries(RBAC.PERMISSION_STRUCTURE).every(([moduleName, actions]) => {
        return actions.every(action => {
            const leftValue = leftPermissions?.[moduleName]?.[action] === true;
            const rightValue = rightPermissions?.[moduleName]?.[action] === true;
            return leftValue === rightValue;
        });
    });
}

function buildPermissionEditorHtml(user) {
    const permissions = getEffectiveUserPermissions(user);
    const scenarioGroups = {
        warehouse: { title: 'Работа со складом', modules: ['stock', 'calendar'] },
        documents: { title: 'Документы', modules: ['rental', 'events', 'documents'] },
        procurement: { title: 'Закупки', modules: ['purchaseRequests'] },
        reports: { title: 'Отчеты', modules: ['reports'] },
        admin: { title: 'Администрирование', modules: ['users'] }
    };
    const renderModule = (moduleName, meta) => {
        const actions = RBAC.PERMISSION_STRUCTURE[moduleName] || [];
        const items = actions.map(action => {
            const checked = permissions?.[moduleName]?.[action] === true ? 'checked' : '';
            const actionLabel = meta.actions[action] || action;
            return `<label class="permission-checkbox" title="${escapeHtml(actionLabel)}"><input type="checkbox" data-permission-module="${moduleName}" data-permission-action="${action}" ${checked}><span>${escapeHtml(actionLabel)}</span></label>`;
        }).join('');
        return `<section class="permission-group"><h4>${meta.title}</h4><div class="permission-grid">${items}</div></section>`;
    };
    return Object.values(scenarioGroups).map(group => {
        const modules = group.modules
            .filter(moduleName => PERMISSION_LABELS[moduleName])
            .map(moduleName => renderModule(moduleName, PERMISSION_LABELS[moduleName]))
            .join('');
        return modules ? `<section class="permission-scenario-group"><h3>${group.title}</h3>${modules}</section>` : '';
    }).join('');
}

function buildMyPermissionsHtml() {
    const user = RBAC.getCurrentUser();
    const permissions = RBAC.getUserPermissions(user.role, user.permissions);
    return Object.entries(PERMISSION_LABELS).map(([moduleName, meta]) => {
        const actions = RBAC.PERMISSION_STRUCTURE[moduleName] || [];
        const items = actions.map(action => {
            const allowed = permissions?.[moduleName]?.[action] === true;
            return `<li>${allowed ? '✅' : '❌'} ${escapeHtml(meta.actions[action] || action)}</li>`;
        }).join('');
        return `<section class="permission-group readonly"><h4>${meta.title}</h4><ul class="permission-summary-list">${items}</ul></section>`;
    }).join('');
}

function fillUserPermissionsForm(user) {
    const container = document.getElementById('userPermissionsEditor');
    const mine = document.getElementById('myPermissionsContent');
    if (container) container.innerHTML = buildPermissionEditorHtml(user);
    if (mine) mine.innerHTML = buildMyPermissionsHtml();
}

function collectPermissionsFromForm() {
    const nextPermissions = {};
    document.querySelectorAll('#userPermissionsEditor input[type="checkbox"][data-permission-module]').forEach(input => {
        const moduleName = input.dataset.permissionModule;
        const action = input.dataset.permissionAction;
        nextPermissions[moduleName] = nextPermissions[moduleName] || {};
        nextPermissions[moduleName][action] = input.checked;
    });
    return nextPermissions;
}

function getRoleSelectValue(role) {
    switch (RBAC.normalizeRole(role)) {
        case 'кладовщик': return 'Кладовщик';
        case 'менеджер': return 'Менеджер';
        case 'руководитель': return 'Руководитель';
        case 'гость': return 'Гость';
        case 'admin':
        default:
            return 'admin';
    }
}

function switchUserEditTab(tabName) {
    document.querySelectorAll('[data-user-edit-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.userEditTab === tabName);
    });
    document.querySelectorAll('[data-user-edit-panel]').forEach(panel => {
        panel.style.display = panel.dataset.userEditPanel === tabName ? 'block' : 'none';
    });
}

function openMyPermissionsModal() {
    const currentUser = RBAC.getCurrentUser();
    if (!currentUser?.id) {
        showNotification('Сначала войдите в систему', 'warning');
        return;
    }

    editingUser = {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        active: currentUser.active,
        last_login: null,
        permissions: currentUser.permissions || null
    };

    document.getElementById('userEditModalTitle').textContent = `Мои права: ${currentUser.username}`;
    document.getElementById('editUsername').value = currentUser.username || '';
    document.getElementById('editUserRole').value = getRoleSelectValue(currentUser.role);
    document.getElementById('editUserPassword').value = '';
    document.getElementById('editUserPasswordConfirm').value = '';
    document.getElementById('editUserActive').checked = currentUser.active !== false;
    document.getElementById('editUserLastLogin').value = 'Только для просмотра';
    fillUserPermissionsForm(editingUser);

    document.querySelector('[data-user-edit-tab="profile"]')?.style.setProperty('display', 'none');
    document.querySelector('[data-user-edit-tab="permissions"]')?.style.setProperty('display', 'none');
    document.querySelectorAll('#userEditForm .form-actions button').forEach(button => {
        button.style.display = 'none';
    });
    document.querySelectorAll('#userEditForm input, #userEditForm select').forEach(field => {
        field.disabled = true;
    });

    switchUserEditTab('mine');
    document.getElementById('userEditModal').style.display = 'block';
}

function updateUIByPermissions() {
    const usersTab = document.getElementById('usersTab');
    if (usersTab) {
        usersTab.style.display = RBAC.hasPermission('users', 'view') ? 'inline-block' : 'none';
    }

    document.querySelectorAll('nav button[data-page]').forEach(button => {
        const pageId = button.getAttribute('data-page');
        const allowed = canAccessPage(pageId);
        button.style.display = allowed ? 'inline-block' : 'none';
        button.disabled = !allowed;
    });

    document.querySelectorAll('[data-permission]').forEach(element => {
        const permission = String(element.getAttribute('data-permission') || '').trim();
        const [moduleName, action] = permission.split('.');
        if (!moduleName || !action) return;
        if (RBAC.hasPermission(moduleName, action)) {
            element.style.display = '';
            element.disabled = false;
        } else {
            element.style.display = 'none';
            element.disabled = true;
        }
    });

    document.querySelectorAll('.edit-item-btn').forEach(button => {
        button.style.display = RBAC.hasPermission('stock', 'edit') ? '' : 'none';
    });

    const canManageStock = hasStockManagementPermission();
    const selectAllInventory = document.getElementById('selectAllInventory');
    if (selectAllInventory && selectAllInventory.closest('th')) {
        selectAllInventory.disabled = !canManageStock;
        selectAllInventory.closest('th').style.display = canManageStock ? '' : 'none';
    }

    const inventoryBulkPanel = document.getElementById('inventoryBulkActions');
    if (inventoryBulkPanel) {
        inventoryBulkPanel.style.display = canManageStock ? '' : 'none';
    }

    const inventoryHistoryButton = document.getElementById('inventoryHistoryBtn');
    if (inventoryHistoryButton) {
        inventoryHistoryButton.style.display = canManageStock ? '' : 'none';
    }

    const inventoryCalendarButton = document.getElementById('inventoryCalendarBtn');
    if (inventoryCalendarButton) {
        inventoryCalendarButton.style.display = canManageStock ? '' : 'none';
    }

    const canEditDirectories = canManageDirectories();
    const addClientButton = document.getElementById('addClient');
    if (addClientButton) {
        addClientButton.style.display = canEditDirectories && canAccessPage('clients') ? '' : 'none';
    }

    const addEmployeeButton = document.getElementById('addEmployee');
    if (addEmployeeButton) {
        addEmployeeButton.style.display = canEditDirectories && canAccessPage('employees') ? '' : 'none';
    }

    const activePage = document.querySelector('nav button[data-page].active')?.getAttribute('data-page');
    if (activePage && !canAccessPage(activePage)) {
        const fallbackPage = getFirstAccessiblePage();
        if (fallbackPage) {
            showPage(fallbackPage);
        }
    }

    const permissionsTab = document.querySelector('[data-user-edit-tab="permissions"]');
    if (permissionsTab) {
        permissionsTab.style.display = RBAC.hasPermission('users', 'permissions') ? '' : 'none';
    }
}

function getDefaultDateTimeRange(hoursAhead = 1) {
    const start = new Date(Date.now() + 1000);
    const end = new Date(start.getTime() + (hoursAhead * 60 * 60 * 1000));
    return {
        start: toDateTimeLocalValue(start),
        end: toDateTimeLocalValue(end)
    };
}

function isValidDateRange(startValue, endValue) {
    const start = parseDateValue(startValue);
    const end = parseDateValue(endValue);

    if (!start || !end) return true;
    return start.getTime() <= end.getTime();
}

function readStoredFilters(storageKey) {
    try {
        return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
        return {};
    }
}

function writeStoredFilters(storageKey, value) {
    localStorage.setItem(storageKey, JSON.stringify(value || {}));
}

function setFormLoadingState(elementId, isLoading, message = 'Загрузка...') {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = message;
    element.style.display = isLoading ? 'flex' : 'none';
}

function updateNoteButtonState(button, noteValue = '') {
    if (!button) return;

    const hasNote = Boolean(String(noteValue || '').trim());
    const label = button.querySelector('.note-button-text');

    button.classList.toggle('has-note', hasNote);
    const noteLabel = String(button.dataset.noteLabel || 'Комментарий').trim();
    button.title = hasNote
        ? `Изменить комментарий: ${noteLabel}`
        : `Добавить комментарий: ${noteLabel}`;
    button.setAttribute('aria-label', button.title);

    if (label) {
        label.textContent = hasNote ? `${noteLabel}: Есть` : `${noteLabel}: Добавить`;
    }
}

function parseDocumentComments(rawValue = '', fallbackValue = '') {
    const fallback = String(fallbackValue || '').trim();
    const raw = String(rawValue || '').trim();

    if (!raw) {
        return {
            issueComment: fallback,
            acceptanceComment: fallback,
            writeoffComment: ''
        };
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            const issueComment = String(parsed.issueComment || parsed.issue || fallback || '').trim();
            const acceptanceComment = String(parsed.acceptanceComment || parsed.acceptance || fallback || '').trim();
            const writeoffComment = String(parsed.writeoffComment || parsed.writeoff || '').trim();
            return { issueComment, acceptanceComment, writeoffComment };
        }
    } catch {
        // Legacy plain-text comments are reused for issuance and acceptance.
    }

    return {
        issueComment: raw,
        acceptanceComment: raw,
        writeoffComment: ''
    };
}

function buildPackedDocumentComments(comments = {}) {
    const issueComment = String(comments.issueComment || '').trim();
    const acceptanceComment = String(comments.acceptanceComment || '').trim();
    const writeoffComment = String(comments.writeoffComment || '').trim();

    if (!issueComment && !acceptanceComment && !writeoffComment) return '';

    return JSON.stringify({ issueComment, acceptanceComment, writeoffComment });
}

function refreshRowDocumentCommentButtons(row) {
    if (!row) return;

    row.querySelectorAll('.doc-note-button').forEach(button => {
        const targetSelector = String(button.dataset.noteTarget || '').trim();
        const targetInput = targetSelector ? row.querySelector(targetSelector) : null;
        updateNoteButtonState(button, targetInput?.value || '');
    });
}

function openNoteEditor(button) {
    const row = button.closest('tr');
    const targetSelector = String(button?.dataset?.noteTarget || '').trim();
    const noteInput = targetSelector
        ? row?.querySelector(targetSelector)
        : row?.querySelector('.item-note-input, .event-note-input');
    const textarea = document.getElementById('noteEditorText');
    const modal = document.getElementById('noteEditorModal');

    if (!noteInput || !textarea || !modal) return;

    currentNoteEditorContext = { button, noteInput };
    const noteLabel = String(button?.dataset?.noteLabel || 'Комментарий').trim();
    const title = document.querySelector('#noteEditorModal h2');
    const subtitleLabel = document.querySelector('#noteEditorModal label[for="noteEditorText"]');
    if (title) title.textContent = `${noteLabel} к документу`;
    if (subtitleLabel) subtitleLabel.textContent = noteLabel;
    textarea.value = noteInput.value || '';
    modal.style.display = 'block';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function closeNoteEditor() {
    const modal = document.getElementById('noteEditorModal');
    const textarea = document.getElementById('noteEditorText');

    if (modal) modal.style.display = 'none';
    if (textarea) textarea.value = '';
    currentNoteEditorContext = null;
}

function saveNoteEditor() {
    const textarea = document.getElementById('noteEditorText');
    if (!textarea || !currentNoteEditorContext) {
        closeNoteEditor();
        return;
    }

    const value = textarea.value.trim();
    currentNoteEditorContext.noteInput.value = value;
    updateNoteButtonState(currentNoteEditorContext.button, value);
    refreshRowDocumentCommentButtons(currentNoteEditorContext.button?.closest('tr'));
    closeNoteEditor();
}

function showNotification(message, type = 'success', options = {}) {
    const result = pushAppNotification(message, type, options);
    if (result?.created !== true) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.zIndex = '12000';

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('removing');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function applyThemeMode(mode, { persist = false } = {}) {
    const normalizedMode = mode === 'light' ? 'light' : 'dark';
    const isDark = normalizedMode === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    document.body.dataset.theme = normalizedMode;
    if (persist) {
        localStorage.setItem(THEME_STORAGE_KEY, normalizedMode);
    }
}

function setThemePreference(mode) {
    applyThemeMode(mode, { persist: true });
}

function toggleThemePreference() {
    const current = document.body.dataset.theme === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    return next;
}

function initializeThemeRuntime() {
    let savedTheme = null;
    try {
        savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
        savedTheme = null;
    }

    const hasSystemPreference = Boolean(window.matchMedia);
    const prefersDark = hasSystemPreference && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolvedTheme = savedTheme === 'light' || savedTheme === 'dark'
        ? savedTheme
        : (prefersDark ? 'dark' : 'dark');

    applyThemeMode(resolvedTheme, { persist: false });

    if (hasSystemPreference) {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onSystemThemeChange = (event) => {
            const forcedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            if (forcedTheme === 'light' || forcedTheme === 'dark') return;
            applyThemeMode(event.matches ? 'dark' : 'light', { persist: false });
        };
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', onSystemThemeChange);
        } else if (typeof media.addListener === 'function') {
            media.addListener(onSystemThemeChange);
        }
    }
}

function showLoginError(message) {
    const errorElement = document.getElementById('loginError');
    if (!errorElement) return;

    if (loginErrorTimeoutId) {
        clearTimeout(loginErrorTimeoutId);
        loginErrorTimeoutId = null;
    }

    errorElement.textContent = message;
    errorElement.style.display = 'block';

    loginErrorTimeoutId = setTimeout(() => {
        clearLoginError();
    }, 3000);
}

function clearLoginError() {
    const errorElement = document.getElementById('loginError');
    if (!errorElement) return;

    if (loginErrorTimeoutId) {
        clearTimeout(loginErrorTimeoutId);
        loginErrorTimeoutId = null;
    }

    errorElement.textContent = '';
    errorElement.style.display = 'none';
}

function saveLoginSecurityState() {
    localStorage.setItem(LOGIN_SECURITY_STORAGE_KEY, JSON.stringify({
        failedAttempts: loginFailedAttempts,
        lockUntil: loginLockUntil || 0
    }));
}

function loadLoginSecurityState() {
    try {
        const raw = localStorage.getItem(LOGIN_SECURITY_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        loginFailedAttempts = Number(parsed.failedAttempts || 0);
        loginLockUntil = Number(parsed.lockUntil || 0);

        if (loginLockUntil && Date.now() >= loginLockUntil) {
            loginFailedAttempts = 0;
            loginLockUntil = 0;
            localStorage.removeItem(LOGIN_SECURITY_STORAGE_KEY);
        }
    } catch {
        loginFailedAttempts = 0;
        loginLockUntil = 0;
        localStorage.removeItem(LOGIN_SECURITY_STORAGE_KEY);
    }
}

function shuffleList(values) {
    const clone = [...values];
    for (let index = clone.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [clone[index], clone[randomIndex]] = [clone[randomIndex], clone[index]];
    }
    return clone;
}

function generateLoginCaptcha() {
    const set = LOGIN_CAPTCHA_SETS[Math.floor(Math.random() * LOGIN_CAPTCHA_SETS.length)];
    const odd = set.odd[Math.floor(Math.random() * set.odd.length)];

    const cards = shuffleList([
        ...set.base.map(item => ({ ...item, isOdd: false })),
        { ...odd, isOdd: true }
    ]);

    loginCaptcha = {
        title: `Найдите лишний предмет (не из категории «${set.category}»)`,
        cards
    };
    loginCaptchaSolved = false;
}

function renderLoginCaptcha() {
    const block = document.getElementById('loginCaptchaBlock');
    const title = document.getElementById('loginCaptchaTitle');
    const grid = document.getElementById('loginCaptchaGrid');
    const feedback = document.getElementById('loginCaptchaFeedback');
    if (!block || !title || !grid || !feedback) return;

    const shouldShow = loginFailedAttempts >= 2 && !isLoginLocked();
    block.style.display = shouldShow ? 'block' : 'none';

    if (!shouldShow) {
        feedback.style.display = 'none';
        feedback.textContent = '';
        feedback.className = 'login-captcha-feedback';
        return;
    }

    if (!loginCaptcha) {
        generateLoginCaptcha();
    }

    title.textContent = loginCaptcha.title;
    grid.innerHTML = '';

    loginCaptcha.cards.forEach(card => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `captcha-item ${loginCaptchaSolved ? 'captcha-solved' : ''}`;
        button.innerHTML = `<span class="captcha-item-icon">${card.icon}</span><span>${escapeHtml(card.label)}</span>`;
        button.disabled = loginCaptchaSolved || isLoginLocked();
        button.addEventListener('click', () => {
            if (card.isOdd) {
                loginCaptchaSolved = true;
                feedback.textContent = 'Отлично! Проверка пройдена.';
                feedback.className = 'login-captcha-feedback captcha-feedback-success';
                feedback.style.display = 'block';
                updateLoginSubmitAvailability();
            } else {
                loginCaptchaSolved = false;
                feedback.textContent = 'Это не лишний предмет. Попробуйте снова.';
                feedback.className = 'login-captcha-feedback captcha-feedback-error';
                feedback.style.display = 'block';
                generateLoginCaptcha();
                renderLoginCaptcha();
            }
        });
        grid.appendChild(button);
    });
}

function updateLoginAttemptsIndicator() {
    const indicator = document.getElementById('loginAttemptsIndicator');
    if (!indicator) return;

    const remaining = Math.max(0, LOGIN_MAX_ATTEMPTS - loginFailedAttempts);
    indicator.textContent = `Осталось попыток: ${remaining}`;
    indicator.className = 'login-attempts-indicator';

    if (remaining <= 1) {
        indicator.classList.add('attempts-danger');
    } else if (remaining === 2) {
        indicator.classList.add('attempts-warning');
    } else {
        indicator.classList.add('attempts-ok');
    }
}

function formatSecondsToClock(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isLoginLocked() {
    return Boolean(loginLockUntil && Date.now() < loginLockUntil);
}

function updateLoginLockUi() {
    const lockMessage = document.getElementById('loginLockMessage');
    const loginButton = document.querySelector('#loginForm .login-btn');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');

    const locked = isLoginLocked();

    if (loginUsername) loginUsername.disabled = locked;
    if (loginPassword) loginPassword.disabled = locked;

    if (lockMessage) {
        if (locked) {
            const secondsLeft = Math.max(0, Math.ceil((loginLockUntil - Date.now()) / 1000));
            lockMessage.textContent = `Слишком много неудачных попыток. Попробуйте через ${formatSecondsToClock(secondsLeft)}.`;
            lockMessage.style.display = 'block';
        } else {
            lockMessage.style.display = 'none';
            lockMessage.textContent = '';
        }
    }

    if (locked) {
        if (!loginLockTimerId) {
            loginLockTimerId = setInterval(() => {
                if (isLoginLocked()) {
                    updateLoginLockUi();
                } else {
                    clearInterval(loginLockTimerId);
                    loginLockTimerId = null;
                    resetLoginProtectionState();
                    renderLoginCaptcha();
                    updateLoginAttemptsIndicator();
                    updateLoginSubmitAvailability();
                }
            }, 1000);
        }
    } else if (loginLockTimerId) {
        clearInterval(loginLockTimerId);
        loginLockTimerId = null;
    }

    if (loginButton) {
        updateLoginSubmitAvailability();
    }
}

function updateLoginSubmitAvailability() {
    const loginButton = document.querySelector('#loginForm .login-btn');
    if (!loginButton) return;

    const captchaRequired = loginFailedAttempts >= 2;
    loginButton.disabled = isLoginLocked() || (captchaRequired && !loginCaptchaSolved);
}

function initLoginVisualEffects() {
    if (loginVisualEffectsInitialized) return;
    loginVisualEffectsInitialized = true;

    const canvas = document.getElementById('loginFxCanvas');
    const loginModule = document.getElementById('loginModule');
    const loginHeroText = document.getElementById('loginHeroText');
    const loginButton = document.querySelector('#loginForm .login-btn');

    if (canvas && loginModule) {
        const context = canvas.getContext('2d');
        let width = 0;
        let height = 0;
        let animationFrameId = 0;
        const mouse = { x: -9999, y: -9999 };
        let particles = [];

        const resizeCanvas = () => {
            const rect = loginModule.getBoundingClientRect();
            width = Math.max(1, Math.floor(rect.width));
            height = Math.max(1, Math.floor(rect.height));
            canvas.width = width;
            canvas.height = height;

            const particlesCount = Math.min(60, Math.max(26, Math.floor((width * height) / 38000)));
            particles = Array.from({ length: particlesCount }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.35,
                vy: (Math.random() - 0.5) * 0.35,
                radius: Math.random() * 1.8 + 0.7
            }));
        };

        const onMouseMove = (event) => {
            const rect = canvas.getBoundingClientRect();
            mouse.x = event.clientX - rect.left;
            mouse.y = event.clientY - rect.top;
        };

        const onMouseLeave = () => {
            mouse.x = -9999;
            mouse.y = -9999;
        };

        const render = () => {
            context.clearRect(0, 0, width, height);

            particles.forEach((particle) => {
                const dx = mouse.x - particle.x;
                const dy = mouse.y - particle.y;
                const distanceSquared = dx * dx + dy * dy;
                const influenceRadius = 130;

                if (distanceSquared < influenceRadius * influenceRadius) {
                    const distance = Math.max(12, Math.sqrt(distanceSquared));
                    const pull = (influenceRadius - distance) / influenceRadius;
                    particle.vx -= (dx / distance) * pull * 0.025;
                    particle.vy -= (dy / distance) * pull * 0.025;
                }

                particle.x += particle.vx;
                particle.y += particle.vy;

                particle.vx *= 0.993;
                particle.vy *= 0.993;

                if (particle.x < -10) particle.x = width + 10;
                if (particle.x > width + 10) particle.x = -10;
                if (particle.y < -10) particle.y = height + 10;
                if (particle.y > height + 10) particle.y = -10;

                context.beginPath();
                context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                context.fillStyle = 'rgba(255, 255, 255, 0.52)';
                context.fill();
            });

            for (let index = 0; index < particles.length; index += 1) {
                for (let siblingIndex = index + 1; siblingIndex < particles.length; siblingIndex += 1) {
                    const first = particles[index];
                    const second = particles[siblingIndex];
                    const dx = first.x - second.x;
                    const dy = first.y - second.y;
                    const distanceSquared = dx * dx + dy * dy;
                    const maxDistance = 92;

                    if (distanceSquared < maxDistance * maxDistance) {
                        const alpha = 1 - Math.sqrt(distanceSquared) / maxDistance;
                        context.beginPath();
                        context.moveTo(first.x, first.y);
                        context.lineTo(second.x, second.y);
                        context.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.11})`;
                        context.lineWidth = 1;
                        context.stroke();
                    }
                }
            }

            animationFrameId = requestAnimationFrame(render);
        };

        resizeCanvas();
        render();

        window.addEventListener('resize', resizeCanvas);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseleave', onMouseLeave);

        window.addEventListener('beforeunload', () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', resizeCanvas);
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('mouseleave', onMouseLeave);
        });
    }

    if (loginHeroText) {
        const phrases = [
            'Складской учет в одном месте',
            'Дизайн-проекты под контролем в одном месте',
            'Точно. Быстро. Эстетично.'
        ];
        let phraseIndex = 0;
        let charIndex = 0;
        let deleting = false;

        const typeWriterTick = () => {
            const phrase = phrases[phraseIndex];

            if (!deleting) {
                charIndex += 1;
                loginHeroText.textContent = phrase.slice(0, charIndex);
                if (charIndex >= phrase.length) {
                    deleting = true;
                    setTimeout(typeWriterTick, 1100);
                    return;
                }
            } else {
                charIndex -= 1;
                loginHeroText.textContent = phrase.slice(0, Math.max(0, charIndex));
                if (charIndex <= 0) {
                    deleting = false;
                    phraseIndex = (phraseIndex + 1) % phrases.length;
                }
            }

            setTimeout(typeWriterTick, deleting ? 30 : 55);
        };

        setTimeout(typeWriterTick, 450);
    }

    if (loginButton) {
        loginButton.addEventListener('click', (event) => {
            const rect = loginButton.getBoundingClientRect();
            const ripple = document.createElement('span');
            const size = Math.max(rect.width, rect.height);

            ripple.className = 'login-btn-ripple';
            ripple.style.width = `${size}px`;
            ripple.style.height = `${size}px`;
            ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

            loginButton.appendChild(ripple);
            setTimeout(() => ripple.remove(), 650);
        });
    }
}

function registerLoginFailure() {
    loginFailedAttempts += 1;
    if (loginFailedAttempts >= LOGIN_MAX_ATTEMPTS) {
        loginLockUntil = Date.now() + LOGIN_LOCK_SECONDS * 1000;
    }

    saveLoginSecurityState();
    updateLoginAttemptsIndicator();
    renderLoginCaptcha();
    updateLoginLockUi();
    updateLoginSubmitAvailability();
}

function resetLoginProtectionState() {
    loginFailedAttempts = 0;
    loginLockUntil = 0;
    loginCaptcha = null;
    loginCaptchaSolved = false;
    localStorage.removeItem(LOGIN_SECURITY_STORAGE_KEY);

    const feedback = document.getElementById('loginCaptchaFeedback');
    if (feedback) {
        feedback.style.display = 'none';
        feedback.textContent = '';
        feedback.className = 'login-captcha-feedback';
    }

    updateLoginAttemptsIndicator();
    renderLoginCaptcha();
    updateLoginLockUi();
    updateLoginSubmitAvailability();
}

function setAuthStatus(message, isSuccess) {
    const status = document.getElementById('authStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('auth-status-success', Boolean(isSuccess));
    status.classList.toggle('auth-status-error', !isSuccess);
}

function updateActiveButton(pageId) {
    const documentPages = ['documentsHub', 'issuanceActs', 'transferActs', 'acceptanceActs', 'writeoffActs', 'purchaseActs'];
    const normalizedPageId = documentPages.includes(pageId) ? 'documentsHub' : pageId;

    document.querySelectorAll('nav button[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-page') === normalizedPageId);
    });
}

const DEFAULT_API_PORT = '3002';
const API_FETCH_TIMEOUT_MS = 15000;
const API_FAST_TIMEOUT_MS = 8000;

function buildApiUrl(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;

    const normalizedPath = url.startsWith('/') ? url : `/${url}`;
    const isFileProtocol = window.location.protocol === 'file:';
    const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    const currentHost = window.location.hostname || 'localhost';
    const currentProtocol = ['http:', 'https:'].includes(window.location.protocol) ? window.location.protocol : 'http:';
    const shouldUseExplicitBackend = isFileProtocol || currentPort !== DEFAULT_API_PORT;

    return shouldUseExplicitBackend
        ? `${currentProtocol}//${currentHost}:${DEFAULT_API_PORT}${normalizedPath}`
        : normalizedPath;
}

function getAuthHeader() {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
    const {
        timeoutMs = API_FETCH_TIMEOUT_MS,
        retryOnTimeout = false,
        _retry = false,
        ...fetchOptions
    } = options;

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const headers = {
        ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...getAuthHeader(),
        ...(fetchOptions.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(buildApiUrl(url), {
            ...fetchOptions,
            headers,
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            if (retryOnTimeout && !_retry && method === 'GET') {
                return apiFetch(url, {
                    ...fetchOptions,
                    timeoutMs,
                    retryOnTimeout,
                    _retry: true
                });
            }
            throw new Error(`Превышено время ожидания запроса ${url} (${Math.round(timeoutMs / 1000)} сек)`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    const text = await response.text();

    let data = null;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = text;
    }

    if (!response.ok) {
        const errorMessage = (data && data.error) || (data && data.message) || `Ошибка запроса (${response.status})`;
        throw new Error(errorMessage);
    }

    return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error(`Превышено время ожидания запроса (${Math.round(timeoutMs / 1000)} сек)`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function saveLocalBackup() {
    localStorage.setItem('warehouse_inventory', JSON.stringify(inventory));
    localStorage.setItem('warehouse_rentals', JSON.stringify(rentals));
    localStorage.setItem('warehouse_events', JSON.stringify(events));
}

function normalizeDeliveryNameKey(value) {
    return String(value || '').trim().toLowerCase();
}

function readDeliveryAdjustments() {
    try {
        const raw = JSON.parse(localStorage.getItem(DELIVERY_ADJUSTMENTS_STORAGE_KEY) || '{}');
        return {
            byId: raw && typeof raw.byId === 'object' ? raw.byId : {},
            byName: raw && typeof raw.byName === 'object' ? raw.byName : {}
        };
    } catch {
        return { byId: {}, byName: {} };
    }
}

function writeDeliveryAdjustments(payload) {
    const next = payload || { byId: {}, byName: {} };
    localStorage.setItem(DELIVERY_ADJUSTMENTS_STORAGE_KEY, JSON.stringify(next));
}

function readItemUnitCostMap() {
    try {
        const raw = JSON.parse(localStorage.getItem(ITEM_UNIT_COST_STORAGE_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeItemUnitCostMap(map) {
    localStorage.setItem(ITEM_UNIT_COST_STORAGE_KEY, JSON.stringify(map || {}));
}

function getItemUnitCostByIdOrName(item = {}) {
    const map = readItemUnitCostMap();
    const idKey = String(item?.id || '').trim();
    const nameKey = String(item?.name || '').trim().toLowerCase();

    if (idKey && map[idKey] !== undefined) return Number(map[idKey] || 0);
    if (nameKey && map[nameKey] !== undefined) return Number(map[nameKey] || 0);
    return Number(item?.unitCost ?? item?.unit_cost ?? item?.cost ?? 0);
}

function setItemUnitCost(item = {}, value = 0) {
    const map = readItemUnitCostMap();
    const normalized = Math.max(0, Number(value || 0));
    const idKey = String(item?.id || '').trim();
    const nameKey = String(item?.name || '').trim().toLowerCase();

    if (idKey) map[idKey] = normalized;
    if (nameKey) map[nameKey] = normalized;
    writeItemUnitCostMap(map);
}

window.getItemUnitCost = function getItemUnitCost(item) {
    return getItemUnitCostByIdOrName(item || {});
};

window.getInventoryEstimatedValue = function getInventoryEstimatedValue() {
    return (Array.isArray(inventory) ? inventory : []).reduce((sum, item) => {
        const qty = Math.max(0, Number(item?.quantity ?? item?.stock ?? 0));
        const cost = Math.max(0, Number(getItemUnitCostByIdOrName(item) || 0));
        return sum + qty * cost;
    }, 0);
};

function applyPendingDeliveryAdjustmentsToInventory(items) {
    const adjustments = readDeliveryAdjustments();
    const byId = adjustments.byId || {};
    const byName = adjustments.byName || {};
    return (Array.isArray(items) ? items : []).map(item => {
        const idKey = String(item?.id || '');
        const nameKey = normalizeDeliveryNameKey(item?.name);
        const byIdDelta = Number(byId[idKey] || 0);
        const byNameDelta = Number(byName[nameKey] || 0);
        const delta = byIdDelta > 0 ? byIdDelta : byNameDelta;
        if (!delta) return item;
        const nextQty = Number(item?.quantity ?? item?.stock ?? 0) + delta;
        return {
            ...item,
            quantity: nextQty,
            stock: nextQty
        };
    });
}

function mutatePendingDeliveryAdjustments(entries = [], requestItems = [], mode = 'add') {
    const adjustments = readDeliveryAdjustments();
    const byId = { ...(adjustments.byId || {}) };
    const byName = { ...(adjustments.byName || {}) };
    const itemNameById = new Map((Array.isArray(requestItems) ? requestItems : []).map(item => [String(item?.itemId || ''), normalizeDeliveryNameKey(item?.name)]));

    (Array.isArray(entries) ? entries : []).forEach(row => {
        const itemId = String(row?.itemId || '').trim();
        const qty = Math.max(0, Number(row?.quantity || 0));
        if (!itemId || !qty) return;

        const idCurrent = Number(byId[itemId] || 0);
        const idNext = mode === 'remove' ? Math.max(0, idCurrent - qty) : (idCurrent + qty);
        if (idNext > 0) byId[itemId] = idNext;
        else delete byId[itemId];

        const nameKey = itemNameById.get(itemId);
        if (nameKey) {
            const nameCurrent = Number(byName[nameKey] || 0);
            const nameNext = mode === 'remove' ? Math.max(0, nameCurrent - qty) : (nameCurrent + qty);
            if (nameNext > 0) byName[nameKey] = nameNext;
            else delete byName[nameKey];
        }
    });

    writeDeliveryAdjustments({ byId, byName });
}

window.recordPendingDeliveryAdjustments = function recordPendingDeliveryAdjustments(entries, requestItems) {
    mutatePendingDeliveryAdjustments(entries, requestItems, 'add');
};

window.clearPendingDeliveryAdjustments = function clearPendingDeliveryAdjustments(entries, requestItems) {
    mutatePendingDeliveryAdjustments(entries, requestItems, 'remove');
};

window.clearPendingDeliveryAdjustmentsForItem = function clearPendingDeliveryAdjustmentsForItem(itemRef = {}) {
    const adjustments = readDeliveryAdjustments();
    const byId = { ...(adjustments.byId || {}) };
    const byName = { ...(adjustments.byName || {}) };

    const idKey = String(itemRef?.id || '').trim();
    const nameKey = normalizeDeliveryNameKey(itemRef?.name);

    if (idKey) delete byId[idKey];
    if (nameKey) delete byName[nameKey];

    writeDeliveryAdjustments({ byId, byName });
};

function loadLocalBackup() {
    try {
        const inv = JSON.parse(localStorage.getItem('warehouse_inventory') || '[]');
        const ren = JSON.parse(localStorage.getItem('warehouse_rentals') || '[]');
        const ev = JSON.parse(localStorage.getItem('warehouse_events') || '[]');

        inventory = inv.map(normalizeInventoryItem);
        rentals = ren.map(normalizeRental);
        events = ev.map(normalizeEvent);
    } catch (error) {
        console.error('Ошибка загрузки локального кэша:', error);
    }
}

function saveData() {
    saveLocalBackup();
}

function clearAllData() {
    if (!confirm('Вы уверены, что хотите удалить все локально сохранённые данные?')) return;
    localStorage.removeItem('warehouse_inventory');
    localStorage.removeItem('warehouse_rentals');
    localStorage.removeItem('warehouse_events');
    showNotification('Локальный кэш очищен', 'success');
}

function bindLoginSubmitFallback() {
    document.addEventListener('submit', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLFormElement)) return;
        if (target.id !== 'loginForm') return;

        event.preventDefault();
        event.stopPropagation();
        handleLoginSubmit(event);
    }, true);
}

// ============================================================================
// Authentication
// ============================================================================

async function handleLoginSubmit(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    clearLoginError();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showLoginError('Введите логин и пароль');
        return;
    }

    if (isLoginLocked()) {
        updateLoginLockUi();
        return;
    }

    if (loginFailedAttempts >= 2 && !loginCaptchaSolved) {
        showLoginError('Сначала пройдите проверку капчи.');
        return;
    }

    try {
        const response = await fetchWithTimeout(buildApiUrl('/api/users/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        }, API_FAST_TIMEOUT_MS);

        const data = await response.json();
        if (!response.ok || !data.token) {
            const isInvalidCredentials = response.status === 401 || data.error === 'Invalid credentials';
            if (isInvalidCredentials) {
                registerLoginFailure();
                document.getElementById('loginPassword').value = '';
                showLoginError('Неверный логин или пароль. Попробуйте снова.');
                return;
            }
            throw new Error(data.error === 'Invalid credentials' ? 'Неправильный логин или пароль' : (data.error || 'Ошибка авторизации'));
        }

        resetLoginProtectionState();

        localStorage.setItem('authToken', data.token);
        currentUserRole = data.role || 'Кладовщик';
        localStorage.setItem('authRole', currentUserRole);
        localStorage.setItem('authUsername', username);

        // Инициализировать RBAC с данными текущего пользователя
        RBAC.initializeUser({
            id: data.user_id || data.id,
            username: username,
            role: data.role || 'Кладовщик',
            active: data.active !== false,
            permissions: data.permissions || null
        });
        
        console.log('RBAC initialized for user:', RBAC.getCurrentUser());
        await completeLogin();
        showNotification('🔑 Вход выполнен успешно!', 'success');
    } catch (error) {
        console.error('Ошибка входа:', error);
        showLoginError(error.message || 'Ошибка подключения к серверу');
        showNotification(error.message || 'Ошибка подключения к серверу', 'error');
    }
}

window.handleLoginSubmit = handleLoginSubmit;
bindLoginSubmitFallback();

async function verifyExistingSession() {
    const token = localStorage.getItem('authToken');
    if (!token) return false;

    try {
        const verifyResponse = await apiFetch('/api/users/verify', { timeoutMs: Math.max(API_FAST_TIMEOUT_MS, 12000) });
        currentUserRole = verifyResponse?.user?.role || localStorage.getItem('authRole') || 'Кладовщик';
        localStorage.setItem('authRole', currentUserRole);
        if (verifyResponse?.user) {
            localStorage.setItem('authUsername', verifyResponse.user.username || '');
            RBAC.initializeUser({
                id: verifyResponse.user.id,
                username: verifyResponse.user.username,
                role: verifyResponse.user.role,
                active: verifyResponse.user.active !== false,
                permissions: verifyResponse.user.permissions || null
            });
        }
        await completeLogin(false);
        return true;
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const isTransientNetworkError = message.includes('timeout')
            || message.includes('failed to fetch')
            || message.includes('network')
            || message.includes('ecconn')
            || message.includes('fetch');
        if (isTransientNetworkError) {
            // Keep local session on short network failures after page refresh.
            currentUserRole = localStorage.getItem('authRole') || 'Кладовщик';
            RBAC.initializeUser({
                id: null,
                username: localStorage.getItem('authUsername') || 'Пользователь',
                role: currentUserRole,
                active: true,
                permissions: null
            });
            await completeLogin(false);
            showNotification('Сессия восстановлена локально. Проверка сервера будет повторена автоматически.', 'warning');
            return true;
        }

        console.warn('Сессия истекла:', error.message);
        localStorage.removeItem('authToken');
        localStorage.removeItem('authRole');
        localStorage.removeItem('authUsername');
        resetLoginProtectionState();
        return false;
    }
}

async function completeLogin(showWelcome = true) {
    document.getElementById('loginModule').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';

    setAuthStatus(`Вы вошли как: ${currentUserRole}`, true);
    updateUIByPermissions();

    const firstAccessiblePage = getFirstAccessiblePage();
    if (firstAccessiblePage) {
        showPage(firstAccessiblePage);
    } else {
        document.querySelectorAll('.page').forEach(page => {
            page.style.display = 'none';
        });
        showNotification('Для этой учетной записи не назначено ни одного доступного раздела', 'warning');
    }

    if (showWelcome) {
        showNotification('🏢 Добро пожаловать в управление складом!', 'success');
    }
    showOnboardingIfNeeded();

    if (!initialDataLoadPromise) {
        initialDataLoadPromise = refreshAllData()
            .catch((error) => {
                console.error('Ошибка фоновой загрузки данных после входа:', error);
            })
            .finally(() => {
                initialDataLoadPromise = null;
            });
    }
}

function logoutUser() {
    resetLoginProtectionState();
    localStorage.removeItem('authToken');
    localStorage.removeItem('authRole');
    localStorage.removeItem('authUsername');
    currentUserRole = '';
    // Очистить RBAC
    RBAC.setCurrentUser({
        id: null,
        username: '',
        role: 'гость',
        active: false
    });
    

    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginModule').style.display = 'flex';

    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.reset();
    clearLoginError();

    setAuthStatus('Вы вышли из системы', false);
    showNotification('👋 Вы вышли из системы', 'success');
}

// ============================================================================
// Data loading
// ============================================================================

function normalizeInventoryItem(item) {
    const totalQuantity = Number(item.totalQuantity ?? item.total_quantity ?? item.quantity ?? item.stock ?? 0);
    const inRental = Number(item.inRental ?? item.in_rental ?? 0);
    const inEvent = Number(item.inEvent ?? item.in_event ?? 0);
    const availableQuantity = Number(item.availableQuantity ?? item.available_quantity ?? item.quantity ?? item.stock ?? 0);
    const pendingWriteoff = Math.max(0, Number(item.pendingWriteoff ?? item.pending_writeoff ?? 0));
    const rawStatus = String(item.status || item.availability_status || 'В наличии').trim().toLowerCase().replace(/ё/g, 'е');
    const isToWriteoff = rawStatus.includes('к спис') || rawStatus.includes('подготовка к списанию');
    const baseBalanceDate = normalizeDateInputValue(item.balanceDate || item.balance_date || '');
    const baseLifespan = item.lifespan === null || item.lifespan === undefined || item.lifespan === '' ? null : Number(item.lifespan);
    const isExpiredAsset = isAssetExpiredByDate(baseBalanceDate, baseLifespan) && String(item.type || item.accountingType || '').toLowerCase() !== 'consumable';
    const shouldBePendingWriteoff = isToWriteoff || isExpiredAsset;
    const normalizedAvailableQuantity = shouldBePendingWriteoff ? 0 : availableQuantity;
    const normalizedPendingWriteoff = shouldBePendingWriteoff ? Math.max(0, totalQuantity) : pendingWriteoff;
    const normalizedStatus = isExpiredAsset && !isToWriteoff ? 'К списанию' : (item.status || item.availability_status || 'В наличии');

    const rawType = String(item.type || item.accountingType || '').trim().toLowerCase();
    const normalizedType = rawType === 'consumable' || rawType === 'рм' || rawType.includes('расход')
        ? 'consumable'
        : 'asset';

    return {
        id: item.id,
        name: item.name || 'Без названия',
        category: item.category || 'Склад',
        totalQuantity,
        totalStock: totalQuantity,
        inRental,
        inEvent,
        availableQuantity: normalizedAvailableQuantity,
        pendingWriteoff: normalizedPendingWriteoff,
        pending_writeoff: normalizedPendingWriteoff,
        isWriteoffMarker: item.isWriteoffMarker === true || item.is_writeoff_marker === true,
        sourceItemId: item.sourceItemId || item.source_item_id || null,
        type: normalizedType,
        requiresPurchase: item.requiresPurchase === true || item.requires_purchase === true,
        lifespan: baseLifespan,
        balanceDate: baseBalanceDate,
        quantity: normalizedAvailableQuantity,
        stock: normalizedAvailableQuantity,
        rentalStatus: item.rentalStatus || item.rentalstatus || 'На складе',
        status: normalizedStatus,
        statusReason: item.statusReason || item.status_reason || '',
        plannedReturnDate: item.plannedReturnDate || item.planned_return_date || null,
        writeoffReason: (item.writeoffReason || item.writeoff_reason || (isExpiredAsset ? 'Истек срок эксплуатации' : '')),
        writeoffDate: item.writeoffDate || item.writeoff_date || null,
        writeoffActNumber: item.writeoffActNumber || item.writeoff_act_number || '',
        location: item.location || '',
        minStock: Number(item.minStock ?? item.minstock ?? 0),
        minstock: Number(item.minStock ?? item.minstock ?? 0),
        description: item.description || '',
        info: item.info || '',
        image: item.image || ''
    };
}

function isAssetExpiredByDate(balanceDate, lifespanMonths) {
    const months = Number(lifespanMonths || 0);
    if (!balanceDate || !Number.isFinite(months) || months <= 0) return false;
    const start = new Date(`${balanceDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) return false;
    const endDate = new Date(start.getTime());
    endDate.setMonth(endDate.getMonth() + months);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return endDate.getTime() <= today.getTime();
}

function normalizeDateInputValue(value) {
    if (!value) return '';
    const raw = String(value).trim();

    // Already in HTML date format or ISO date-time.
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.slice(0, 10);
    }

    // Handle dd.mm.yyyy values.
    const ruMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (ruMatch) {
        return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
    }

    // Fallback for parseable date strings.
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeRental(rental) {
    return {
        ...rental,
        status: rental.status || 'Черновик',
        issuance_act_id: rental.issuance_act_id || null,
        issuance_act_number: rental.issuance_act_number || '',
        client_name: rental.client_name || rental.renter || 'Не указан',
        employee_name: rental.employee_name || rental.responsible || 'Не указан',
        items: Array.isArray(rental.items) ? rental.items : []
    };
}

function normalizeEvent(event) {
    return {
        ...event,
        status: event.status || 'Черновик',
        issuance_act_id: event.issuance_act_id || null,
        issuance_act_number: event.issuance_act_number || '',
        name: event.name || event.event_name || 'Без названия',
        event_name: event.event_name || event.name || 'Без названия',
        event_date: event.event_date || event.start_date || '',
        employee_name: event.employee_name || 'Не указан',
        items: Array.isArray(event.items) ? event.items : []
    };
}

function buildEntityBasisLabel(entityType, entity) {
    const id = entity?.id || '—';
    return entityType === 'rental' ? `Аренда №${id}` : `Мероприятие №${id}`;
}

function normalizeIssuanceNumberByEntityType(entityType, number) {
    const raw = String(number || '').trim();
    if (!raw) return '';
    if (/^АК-\d{6}$/i.test(raw)) {
        const suffix = raw.slice(3);
        return entityType === 'rental' ? `АКП-${suffix}` : `АКВ-${suffix}`;
    }
    return raw;
}

function getDocumentNumbersByBasisFromRegistry(docType, basisLabel) {
    if (typeof window.getDocumentNumbersByBasis !== 'function') return [];
    return window.getDocumentNumbersByBasis(docType, basisLabel);
}

function getDocumentRecordsByBasisFromRegistry(docType, basisLabel) {
    const type = normalizeDocumentTypeForLinks(docType);
    const basis = String(basisLabel || '').trim();
    if (!basis) return [];

    return readDocumentsRegistrySnapshot()
        .filter(doc => (
            normalizeDocumentTypeForLinks(doc?.docType) === type
            && String(doc?.basisLabel || '').trim() === basis
        ))
        .sort((left, right) => new Date(right.updatedAt || right.date || right.createdAt || 0) - new Date(left.updatedAt || left.date || left.createdAt || 0));
}

function getEntityDocumentBadges(entityType, entity) {
    const basisLabel = buildEntityBasisLabel(entityType, entity);
    const badges = [];

    const registryDocType = entityType === 'rental' ? 'transfer' : 'issuance';
    const issuanceRecord = getDocumentRecordsByBasisFromRegistry(registryDocType, basisLabel)[0] || null;
    const issuanceFromEntity = normalizeIssuanceNumberByEntityType(entityType, entity?.issuance_act_number);
    const issuanceNumber = issuanceRecord?.number || issuanceFromEntity;
    const issuanceCancelled = String(issuanceRecord?.status || '').trim() === 'Отменен';
    if (issuanceNumber) {
        const issuanceLabel = entityType === 'rental' ? 'Акт передачи' : 'Акт выдачи';
        badges.push(`<span class="doc-link-inline ${issuanceCancelled ? 'doc-link-inline-cancelled' : ''}"><span class="doc-link-inline-label">${issuanceLabel}${issuanceCancelled ? ' (отменен)' : ''}</span><span class="doc-link-inline-number">${escapeHtml(issuanceNumber)}</span></span>`);
    }

    const acceptanceRecord = getDocumentRecordsByBasisFromRegistry('acceptance', basisLabel)[0] || null;
    if (acceptanceRecord?.number) {
        const acceptanceCancelled = String(acceptanceRecord.status || '').trim() === 'Отменен';
        badges.push(`<span class="doc-link-inline doc-link-inline-acceptance ${acceptanceCancelled ? 'doc-link-inline-cancelled' : ''}"><span class="doc-link-inline-label">Акт приемки${acceptanceCancelled ? ' (отменен)' : ''}</span><span class="doc-link-inline-number">${escapeHtml(acceptanceRecord.number)}</span></span>`);
    }

    return badges.join(' ');
}

function hasAcceptanceDocumentForEntity(entityType, entity) {
    const basisLabel = buildEntityBasisLabel(entityType, entity);
    if (typeof window.hasDocumentRecord !== 'function') return false;
    return window.hasDocumentRecord('acceptance', basisLabel);
}

function getIssuanceDocTypeByEntityType(entityType) {
    return entityType === 'rental' ? 'transfer' : 'issuance';
}

function hasIssuanceDocumentForEntity(entityType, entity) {
    const basisLabel = buildEntityBasisLabel(entityType, entity);
    const docType = getIssuanceDocTypeByEntityType(entityType);
    if (typeof window.hasDocumentRecord === 'function' && window.hasDocumentRecord(docType, basisLabel)) {
        return true;
    }
    return Boolean(normalizeIssuanceNumberByEntityType(entityType, entity?.issuance_act_number));
}

function ensureIssuanceDocumentRecord(entityType, entity) {
    if (!entity || typeof window.registerDocumentRecordSilent !== 'function') return '';

    const basisType = entityType;
    const basisLabel = buildEntityBasisLabel(entityType, entity);
    const docType = getIssuanceDocTypeByEntityType(entityType);

    const existing = getDocumentNumbersByBasisFromRegistry(docType, basisLabel)[0] || '';
    if (existing) return existing;

    let number = normalizeIssuanceNumberByEntityType(entityType, entity?.issuance_act_number);
    if (!number && typeof window.generateYearlyDocumentNumber === 'function') {
        number = window.generateYearlyDocumentNumber(docType);
    }
    if (!number) return '';

    const nextEntity = {
        ...entity,
        issuance_act_number: number
    };

    window.registerDocumentRecordSilent({
        docType,
        number,
        date: new Date().toISOString(),
        basisType,
        basisLabel,
        counterparty: entityType === 'rental'
            ? (entity.client_name || entity.renter || 'Не указан')
            : (entity.location || entity.name || entity.event_name || 'Не указан'),
        amount: Number((entity.items || []).reduce((sum, item) => sum + Number(item.rent_price || item.rentPrice || 0), 0)),
        items: Array.isArray(entity.items) ? entity.items : [],
        entity: nextEntity
    });

    return number;
}

function ensureAcceptanceDocumentRecord(entityType, entity) {
    if (!entity || typeof window.registerDocumentRecordSilent !== 'function') return '';

    const basisType = entityType;
    const basisLabel = buildEntityBasisLabel(entityType, entity);
    if (typeof window.hasDocumentRecord === 'function' && window.hasDocumentRecord('acceptance', basisLabel)) {
        return String(entity.acceptance_act_number || entity.acceptanceActNumber || '').trim();
    }

    const number = String(entity.acceptance_act_number || entity.acceptanceActNumber || '').trim() || generateAcceptanceActNumber();
    const nextEntity = {
        ...entity,
        acceptance_act_number: number,
        acceptanceActNumber: number
    };

    window.registerDocumentRecordSilent({
        docType: 'acceptance',
        number,
        date: new Date().toISOString(),
        basisType,
        basisLabel,
        counterparty: entityType === 'rental'
            ? (entity.client_name || entity.renter || 'Не указан')
            : (entity.location || entity.name || entity.event_name || 'Не указан'),
        items: Array.isArray(entity.items) ? entity.items : [],
        entity: nextEntity
    });

    return number;
}

function syncIssuanceDocumentsFromEntities(entityType, entities = []) {
    if (typeof window.registerDocumentRecordSilent !== 'function') return;
    const basisType = entityType;
    // Акты аренды регистрируются как «Акты передачи», акты мероприятий — как «Акты выдачи»
    const docType = entityType === 'rental' ? 'transfer' : 'issuance';

    // Очистить устаревшие записи с неверным типом
    if (entityType === 'rental' && typeof window.removeDocumentsByTypeAndBasis === 'function') {
        window.removeDocumentsByTypeAndBasis('issuance', 'rental');
    }

    entities.forEach(entity => {
        const number = normalizeIssuanceNumberByEntityType(entityType, entity?.issuance_act_number);
        if (!number) return;

        const basisLabel = buildEntityBasisLabel(entityType, entity);
        window.registerDocumentRecordSilent({
            docType,
            number,
            date: entity?.start_date || new Date().toISOString(),
            basisType,
            basisLabel,
            counterparty: entityType === 'rental'
                ? (entity.client_name || entity.renter || 'Не указан')
                : (entity.location || entity.name || entity.event_name || 'Не указан'),
            items: Array.isArray(entity?.items) ? entity.items : [],
            entity
        });
    });
}

function hasActiveDocumentInRegistry(entityType, docType, basisLabel) {
    const type = normalizeDocumentTypeForLinks(docType);
    const basis = String(basisLabel || '').trim();
    if (!basis) return false;

    return readDocumentsRegistrySnapshot().some(doc => (
        String(doc?.basisType || '').trim() === entityType
        && normalizeDocumentTypeForLinks(doc?.docType) === type
        && String(doc?.basisLabel || '').trim() === basis
        && String(doc?.status || '').trim() !== 'Отменен'
    ));
}

function synchronizeEntityStatusesByDocuments() {
    rentals = rentals.map(rental => {
        const status = String(rental?.status || '').trim();
        const basisLabel = buildEntityBasisLabel('rental', rental);
        const hasIssuance = Boolean(normalizeIssuanceNumberByEntityType('rental', rental?.issuance_act_number))
            || hasActiveDocumentInRegistry('rental', 'transfer', basisLabel);
        const hasAcceptance = Boolean(String(rental?.acceptance_act_number || rental?.acceptanceActNumber || '').trim())
            || hasActiveDocumentInRegistry('rental', 'acceptance', basisLabel);

        if (hasAcceptance && status !== 'Завершена') {
            return { ...rental, status: 'Завершена' };
        }

        if (hasIssuance && !hasAcceptance && (isDraftStatus(status) || isPlannedStatus(status) || status === 'Проведен')) {
            return { ...rental, status: 'Активна' };
        }

        return rental;
    });

    events = events.map(event => {
        const status = String(event?.status || '').trim();
        const basisLabel = buildEntityBasisLabel('event', event);
        const hasIssuance = Boolean(normalizeIssuanceNumberByEntityType('event', event?.issuance_act_number))
            || hasActiveDocumentInRegistry('event', 'issuance', basisLabel);
        const hasAcceptance = Boolean(String(event?.acceptance_act_number || event?.acceptanceActNumber || '').trim())
            || hasActiveDocumentInRegistry('event', 'acceptance', basisLabel);

        if (hasAcceptance && status !== 'Завершено') {
            return { ...event, status: 'Завершено' };
        }

        if (hasIssuance && !hasAcceptance && (isDraftStatus(status) || isPlannedStatus(status) || status === 'Проведен')) {
            return { ...event, status: 'Активно' };
        }

        return event;
    });
}

function buildIssuedQuantityMaps() {
    const byId = new Map();
    const byName = new Map();

    const addItemQuantity = (item, quantity) => {
        const qty = Math.max(0, Number(quantity || 0));
        if (!qty) return;

        const idKey = String(item?.item_id || item?.itemId || '').trim();
        if (idKey) {
            byId.set(idKey, Number(byId.get(idKey) || 0) + qty);
        }

        const nameKey = String(item?.item_name || item?.name || '').trim().toLowerCase();
        if (nameKey) {
            byName.set(nameKey, Number(byName.get(nameKey) || 0) + qty);
        }
    };

    const normalizeNameKey = value => String(value || '').trim().toLowerCase();

    const resolveInventoryItemForFlowItem = flowItem => {
        const flowId = String(flowItem?.item_id || flowItem?.itemId || '').trim();
        const flowName = normalizeNameKey(flowItem?.item_name || flowItem?.name || '');

        if (flowId) {
            const byIdItem = (Array.isArray(inventory) ? inventory : []).find(entry => String(entry?.id || '').trim() === flowId);
            if (byIdItem) return byIdItem;
        }

        if (flowName) {
            return (Array.isArray(inventory) ? inventory : []).find(entry => normalizeNameKey(entry?.name) === flowName) || null;
        }

        return null;
    };

    const isConsumableFlowItem = flowItem => {
        const invItem = resolveInventoryItemForFlowItem(flowItem);
        const type = String(invItem?.type || invItem?.accountingType || '').trim().toLowerCase();
        return type === 'consumable' || type.includes('расход');
    };

    const isIssuedRental = rental => {
        const status = String(rental?.status || '').trim();
        const basisLabel = buildEntityBasisLabel('rental', rental);
        const hasIssuance = Boolean(String(rental?.issuance_act_number || '').trim())
            || hasActiveDocumentInRegistry('rental', 'transfer', basisLabel);
        return hasIssuance || isRentalActiveStatus(status) || status === 'Просрочена' || status === 'Проведен' || isRentalCompletedStatus(status);
    };

    const isRentalReturned = rental => {
        const basisLabel = buildEntityBasisLabel('rental', rental);
        return Boolean(String(rental?.acceptance_act_number || rental?.acceptanceActNumber || '').trim())
            || hasActiveDocumentInRegistry('rental', 'acceptance', basisLabel);
    };

    const isIssuedEvent = event => {
        const status = String(event?.status || '').trim();
        const basisLabel = buildEntityBasisLabel('event', event);
        const hasIssuance = Boolean(String(event?.issuance_act_number || '').trim())
            || hasActiveDocumentInRegistry('event', 'issuance', basisLabel);
        return hasIssuance || isEventActiveStatus(status) || status === 'Просрочена' || status === 'Проведен' || isEventCompletedStatus(status);
    };

    const isEventReturned = event => {
        const basisLabel = buildEntityBasisLabel('event', event);
        return Boolean(String(event?.acceptance_act_number || event?.acceptanceActNumber || '').trim())
            || hasActiveDocumentInRegistry('event', 'acceptance', basisLabel);
    };

    rentals.filter(isIssuedRental).forEach(rental => {
        const returned = isRentalReturned(rental);
        (Array.isArray(rental?.items) ? rental.items : []).forEach(item => {
            if (isConsumableFlowItem(item)) {
                // Расходники не возвращаются: после выдачи остаются списанными.
                addItemQuantity(item, item?.quantity);
                return;
            }
            // ОС возвращаются только после акта приемки.
            if (!returned) addItemQuantity(item, item?.quantity);
        });
    });

    events.filter(isIssuedEvent).forEach(event => {
        const returned = isEventReturned(event);
        (Array.isArray(event?.items) ? event.items : []).forEach(item => {
            if (isConsumableFlowItem(item)) {
                addItemQuantity(item, item?.quantity);
                return;
            }
            if (!returned) addItemQuantity(item, item?.quantity);
        });
    });

    return { byId, byName };
}

function applyIssuedAdjustmentsToInventoryView() {
    const issued = buildIssuedQuantityMaps();
    inventory = (Array.isArray(inventory) ? inventory : []).map(item => {
        if (item?.availableQuantity !== undefined && item?.availableQuantity !== null) {
            const available = Math.max(0, Number(item.availableQuantity || 0));
            return {
                ...item,
                quantity: available,
                stock: available
            };
        }

        const idKey = String(item?.id || '').trim();
        const nameKey = String(item?.name || '').trim().toLowerCase();
        const issuedById = Number(issued.byId.get(idKey) || 0);
        const issuedByName = Number(issued.byName.get(nameKey) || 0);
        const issuedQty = issuedById > 0 ? issuedById : issuedByName;
        const baseQty = Math.max(0, Number(item?.quantity ?? item?.stock ?? 0));
        const nextQty = Math.max(0, baseQty - issuedQty);

        return {
            ...item,
            quantity: nextQty,
            stock: nextQty
        };
    });
}

function expandWriteoffMarkerRows(source = inventory) {
    const rows = Array.isArray(source) ? source : [];
    return rows.filter(item => !(item?.isWriteoffMarker === true || item?.is_writeoff_marker === true));
}

async function loadData({ render = true } = {}) {
    const token = localStorage.getItem('authToken');
    if (!token) {
        loadLocalBackup();
        synchronizeEntityStatusesByDocuments();
        applyIssuedAdjustmentsToInventoryView();
        inventory = expandWriteoffMarkerRows(inventory);
        if (render) renderAll();
        return;
    }

    try {
        const [inventoryData, rentalsData, eventsData] = await Promise.all([
            apiFetch('/api/inventory', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false }),
            apiFetch('/api/rentals', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false }),
            apiFetch('/api/events', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false })
        ]);

        inventory = inventoryData.map(normalizeInventoryItem);
        inventory = applyPendingDeliveryAdjustmentsToInventory(inventory);
        rentals = rentalsData.map(normalizeRental);
        events = eventsData.map(normalizeEvent);

        // Синхронизируем реестр документов с уже проведенными записями из БД.
        syncIssuanceDocumentsFromEntities('rental', rentals);
        syncIssuanceDocumentsFromEntities('event', events);

        // Авто-выравнивание статусов старых/несогласованных записей по фактически проведенным документам.
        synchronizeEntityStatusesByDocuments();

        // Сохраняем в backup базовые данные (без выданных корректировок),
        // чтобы не накапливать вычитания при последующих загрузках.
        saveLocalBackup();

        // Для UI показываем доступный остаток (минус выданное в активные аренды/мероприятия).
        applyIssuedAdjustmentsToInventoryView();
        inventory = expandWriteoffMarkerRows(inventory);
        if (render) renderAll();
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        loadLocalBackup();
        synchronizeEntityStatusesByDocuments();
        applyIssuedAdjustmentsToInventoryView();
        inventory = expandWriteoffMarkerRows(inventory);
        if (render) renderAll();
        showNotification('⚠ Сервер недоступен, загружен локальный кэш', 'warning');
    }
}

async function refreshAllData() {
    await Promise.all([
        loadData({ render: false }),
        fetchClients(false),
        fetchEmployees(false)
    ]);

    populateRentalFilterOptions();
    populateEventFilterOptions();
    const activePage = document.querySelector('nav button[data-page].active')?.getAttribute('data-page');
    renderPageContent(activePage || 'dashboard');

    if (RBAC.hasPermission('users', 'view')) {
        await loadUsers();
    }

    updateUIByPermissions();
}

// ============================================================================
// Navigation / rendering
// ============================================================================

function showPage(pageId) {
    if (!canAccessPage(pageId)) {
        showNotification('Недостаточно прав для просмотра этого раздела', 'error');
        return;
    }

    document.querySelectorAll('.page').forEach(page => {
        page.style.display = 'none';
    });

    const page = document.getElementById(pageId);
    if (page) page.style.display = 'block';
    updateActiveButton(pageId);
    renderPageContent(pageId);

    if (pageId === 'clients') renderClientsTable();
    if (pageId === 'employees') renderEmployeesTable();
    if (pageId === 'users' && RBAC.hasPermission('users', 'view')) loadUsers();
    updateUIByPermissions();
}

function renderPageContent(pageId) {
    const safePage = String(pageId || '');
    if (safePage === 'sklad') {
        renderAllTable(getVisibleStockItems());
        return;
    }
    if (safePage === 'mebel') {
        renderSpecificTable('Мебель', 'tableMebel');
        return;
    }
    if (safePage === 'eksponat') {
        renderSpecificTable('Экспонат', 'tableEksponat');
        return;
    }
    if (safePage === 'instrument') {
        renderSpecificTable('Инструмент', 'tableInstrument');
        return;
    }
    if (safePage === 'arenda') {
        renderRentalsTable();
        return;
    }
    if (safePage === 'events') {
        renderEventsTable();
    }
}

function renderAll() {
    const activePage = document.querySelector('nav button[data-page].active')?.getAttribute('data-page');
    renderPageContent(activePage || 'dashboard');
}

function isPendingWriteoffStatus(item) {
    const status = normalizeInventoryLifecycleStatus(item?.status || 'В наличии');
    const pendingWriteoffQty = Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0);
    return status === 'К списанию'
        || pendingWriteoffQty > 0
        || item?.isWriteoffMarker === true
        || item?.is_writeoff_marker === true;
}

function getVisibleStockItems(source = inventory) {
    const rows = Array.isArray(source) ? source : [];
    return rows.filter(item => {
        const totalQty = Math.max(0, Number(item?.totalQuantity ?? item?.totalStock ?? item?.quantity ?? item?.stock ?? 0));
        const availableQty = Math.max(0, Number(item?.availableQuantity ?? item?.quantity ?? item?.stock ?? 0));
        const inRentalQty = Number(item?.inRental || 0);
        const inEventQty = Number(item?.inEvent || 0);
        const pendingQty = Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
        const status = normalizeInventoryLifecycleStatus(item?.status || 'В наличии');

        if (status === 'Списано' || status === 'На реставрации') {
            return false;
        }

        if (totalQty <= 0) return false;

        return availableQty > 0 || inRentalQty > 0 || inEventQty > 0 || pendingQty > 0 || isPendingWriteoffStatus(item);
    });
}

function getStockRowClassByStatus(itemOrStatus) {
    if (itemOrStatus && typeof itemOrStatus === 'object') {
        const totalQty = Math.max(0, Number(itemOrStatus?.totalQuantity ?? itemOrStatus?.totalStock ?? itemOrStatus?.quantity ?? 0));
        const pendingQty = Math.max(0, Number(itemOrStatus?.pendingWriteoff ?? itemOrStatus?.pending_writeoff ?? 0));
        const inRentalQty = Math.max(0, Number(itemOrStatus?.inRental || 0));
        const inEventQty = Math.max(0, Number(itemOrStatus?.inEvent || 0));
        const availableQty = Math.max(0, Number(itemOrStatus?.availableQuantity ?? itemOrStatus?.quantity ?? 0));
        const lifecycleStatus = getInventoryDisplayStatus(itemOrStatus);

        if (lifecycleStatus === 'Списано' || totalQty === 0) return 'stock-row-writtenoff';
        if (lifecycleStatus === 'На реставрации') return 'stock-row-restoration';
        if (lifecycleStatus === 'К списанию') return 'stock-row-pending-writeoff';
        if (pendingQty > 0) return 'stock-row-pending-writeoff';
        if (inRentalQty > 0) return 'stock-row-rental';
        if (inEventQty > 0) return 'stock-row-event';
        if (availableQty > 0) return 'stock-row-available';
        return 'stock-row-out';
    }

    const status = String(itemOrStatus || '').trim();
    if (status === 'В аренде' || status === 'Используется аренда') return 'stock-row-rental';
    if (status === 'На мероприятии' || status === 'Используется мероприятие') return 'stock-row-event';
    if (status === 'Используется аренда/мероприятие') return 'stock-row-event';
    if (status === 'Частично в списании' || status === 'К списанию') return 'stock-row-pending-writeoff';
    if (status === 'На реставрации') return 'stock-row-restoration';
    if (status === 'Списано') return 'stock-row-writtenoff';
    return 'stock-row-available';
}

function getInventoryAvailabilityMeta(quantityValue) {
    const quantity = Number(quantityValue || 0);

    if (quantity > 10) {
        return { key: 'available', icon: '✅', label: 'Достаточно', rowClass: 'stock-row-available', badgeClass: 'available' };
    }

    if (quantity > 0) {
        return { key: 'low', icon: '⚠️', label: 'Ограничено', rowClass: 'stock-row-low', badgeClass: 'low' };
    }

    return { key: 'out', icon: '❌', label: 'Отсутствует', rowClass: 'stock-row-out', badgeClass: 'out' };
}

function getWriteoffEligibleQuantity(item = {}) {
    const totalQty = Math.max(0, Number(item?.totalQuantity ?? item?.totalStock ?? 0));
    const pendingQty = Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
    const inRentalQty = Math.max(0, Number(item?.inRental || 0));
    const inEventQty = Math.max(0, Number(item?.inEvent || 0));
    const availableQty = Math.max(0, Number(item?.availableQuantity ?? item?.quantity ?? item?.stock ?? 0));

    if (totalQty > 0) {
        const computedByTotals = Math.max(0, totalQty - pendingQty - inRentalQty - inEventQty);
        return Math.max(0, Math.min(availableQty, computedByTotals));
    }

    return availableQty;
}

function openInventoryItemEditor(itemId) {
    const item = inventory.find(entry => String(entry.id) === String(itemId));
    if (!item) {
        showNotification('Объект не найден', 'error');
        return;
    }
    openEditModal(item);
}

function renderAllTable(data = inventory) {
    const tableBody = document.getElementById('tableSklad');
    if (!tableBody) return;

    const canEditStock = RBAC.hasPermission('stock', 'edit');
    tableBody.innerHTML = '';
    data.forEach((item, index) => {
        const totalQty = Number(item.totalQuantity ?? item.totalStock ?? item.quantity ?? 0);
        const lifecycleStatus = getInventoryDisplayStatus(item);
        const pendingWriteoffQty = Math.max(0, Number(item.pendingWriteoff ?? item.pending_writeoff ?? 0));
        const inRentalQty = Number(item.inRental || 0);
        const inEventQty = Number(item.inEvent || 0);
        const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
        const isMarker = item.isWriteoffMarker === true || item.is_writeoff_marker === true;
        const canSendToWriteoff = lifecycleStatus !== 'Списано' && !isMarker;
        const writeoffEligibleQty = getWriteoffEligibleQuantity(item);
        const canSplitDefect = !isMarker && writeoffEligibleQty > 0;
        const quantityMeta = getInventoryAvailabilityMeta(availableQty);
        const statusBadgeClass = lifecycleStatus === 'К списанию' || lifecycleStatus === 'Частично в списании'
            ? 'out'
            : lifecycleStatus === 'Списано' || lifecycleStatus === 'Нет в наличии'
                ? 'out'
                : lifecycleStatus === 'На реставрации'
                    || lifecycleStatus === 'В аренде'
                    || lifecycleStatus === 'На мероприятии'
                    || lifecycleStatus === 'Частично в аренде'
                    || lifecycleStatus === 'Частично на мероприятии'
                    || lifecycleStatus === 'Частично в аренде/мероприятии'
                    || lifecycleStatus === 'Используется аренда'
                    || lifecycleStatus === 'Используется мероприятие'
                    || lifecycleStatus === 'Используется аренда/мероприятие'
                    ? 'low'
                    : 'available';
        const writeoffCellHtml = isMarker
            ? `<span class="stock-badge low">📄 В акте ${escapeHtml(item.writeoffActNumber || '')}</span>`
            : canSplitDefect
                ? '<button type="button" class="inline-action-btn split-defect-btn">Списать</button>'
                : '';
        const actionsHtml = [
            '<button type="button" class="inline-action-btn open-item-btn">Открыть</button>',
            canEditStock && !isMarker ? '<button type="button" class="inline-action-btn edit-item-btn">Редактировать</button>' : '',
            writeoffCellHtml
        ].filter(Boolean).join('');
        const row = document.createElement('tr');
        row.className = [getStockRowClassByStatus(item), isMarker ? 'stock-row-writeoff' : ''].filter(Boolean).join(' ');
        row.innerHTML = `
            <td><span class="stock-row-number">${index + 1}</span></td>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td><span class="stock-badge ${totalQty === 0 ? 'out' : 'available'}">${totalQty}</span></td>
            <td><span class="stock-badge ${inRentalQty === 0 ? 'available' : 'low'}">${inRentalQty}</span></td>
            <td><span class="stock-badge ${inEventQty === 0 ? 'available' : 'low'}">${inEventQty}</span></td>
            <td><span class="stock-badge ${quantityMeta.badgeClass}">${availableQty}</span></td>
            <td><span class="stock-badge ${pendingWriteoffQty > 0 ? 'out' : 'available'}">${pendingWriteoffQty}</span></td>
            <td>${escapeHtml(String(item.type || '').toLowerCase() === 'consumable' ? 'Расходник' : 'ОС')}</td>
            <td><span class="stock-badge ${statusBadgeClass}" title="${escapeHtml(getInventoryStatusHint(item))}">${escapeHtml(getInventoryStatusBadgeLabel(item))}</span></td>
            <td><div class="stock-actions-cell">${actionsHtml}</div></td>
        `;
        row.addEventListener('dblclick', () => openItemCard(item));
        row.querySelector('.open-item-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openItemCard(item);
        });
        row.querySelector('.edit-item-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openEditModal(item);
        });
        row.querySelector('.split-defect-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openSplitDefectModal(item);
        });
        tableBody.appendChild(row);
    });
}

function renderSpecificTable(category, tableId) {
    const tableBody = document.getElementById(tableId);
    if (!tableBody) return;
    const canEditStock = RBAC.hasPermission('stock', 'edit');

    tableBody.innerHTML = '';
    inventory.filter(item => item.category === category).forEach(item => {
        const totalQty = Number(item.totalQuantity ?? item.totalStock ?? item.quantity ?? 0);
        const lifecycleStatus = getInventoryDisplayStatus(item);
        const pendingWriteoffQty = Math.max(0, Number(item.pendingWriteoff ?? item.pending_writeoff ?? 0));
        const inRentalQty = Number(item.inRental || 0);
        const inEventQty = Number(item.inEvent || 0);
        const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
        const isMarker = item.isWriteoffMarker === true || item.is_writeoff_marker === true;
        const writeoffEligibleQty = getWriteoffEligibleQuantity(item);
        const canSplitDefect = !isMarker && writeoffEligibleQty > 0;
        const meta = getInventoryAvailabilityMeta(availableQty);
        const actionsHtml = [
            '<button type="button" class="inline-action-btn open-item-btn">Открыть</button>',
            canEditStock && !isMarker ? '<button type="button" class="inline-action-btn edit-item-btn">Редактировать</button>' : '',
            canSplitDefect ? '<button type="button" class="inline-action-btn split-defect-btn">Списать</button>' : ''
        ].filter(Boolean).join('');
        const row = document.createElement('tr');
        row.className = getStockRowClassByStatus(item);
        row.innerHTML = `
            <td><input type="checkbox" class="inventory-checkbox" data-id="${escapeHtml(item.id)}" data-category="${escapeHtml(category)}"></td>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td><span class="stock-badge ${meta.badgeClass}" title="${escapeHtml(getInventoryStatusHint(item))} | Всего: ${totalQty} | В аренде: ${inRentalQty} | На мероприятии: ${inEventQty} | Ожидает списания: ${pendingWriteoffQty}">${meta.icon} Доступно ${availableQty} / Всего ${totalQty}</span></td>
            <td><div class="stock-actions-cell">${actionsHtml}</div></td>
        `;
        row.addEventListener('dblclick', () => openItemCard(item));
        row.querySelector('.open-item-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openItemCard(item);
        });
        row.querySelector('.edit-item-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openEditModal(item);
        });
        row.querySelector('.split-defect-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openSplitDefectModal(item);
        });
        tableBody.appendChild(row);
    });
}

function searchData() {
    const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const category = document.getElementById('categoryFilter')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    const inventoryState = document.getElementById('inventoryStateFilter')?.value || '';
    const accountingType = document.getElementById('accountingTypeFilter')?.value || '';

    const hasStrictFilter = Boolean(query || category || status || inventoryState || accountingType);
    const stockSource = hasStrictFilter ? (Array.isArray(inventory) ? inventory : []) : getVisibleStockItems(inventory);

    const filtered = stockSource.filter(item => {
        const matchesText = !query || item.name.toLowerCase().includes(query);
        const matchesCategory = !category || item.category === category;

        let matchesStatus = true;
        const qty = Number(item.quantity || 0);
        const lifecycleStatus = getInventoryDisplayStatus(item);
        const itemType = String(item.type || '').toLowerCase() === 'consumable' ? 'consumable' : 'asset';

        if (status === 'available') matchesStatus = qty > 10;
        if (status === 'low') matchesStatus = qty > 0 && qty <= 10;
        if (status === 'out') matchesStatus = qty === 0;

        const matchesLifecycle = !inventoryState || lifecycleStatus === inventoryState;
        const matchesAccountingType = !accountingType || accountingType === itemType;

        return matchesText && matchesCategory && matchesStatus && matchesLifecycle && matchesAccountingType;
    });

    renderAllTable(filtered);
}

function openDashboardDeficitAction() {
    showPage('sklad');
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const inventoryStateFilter = document.getElementById('inventoryStateFilter');
    const accountingTypeFilter = document.getElementById('accountingTypeFilter');
    const searchInput = document.getElementById('searchInput');
    if (categoryFilter) categoryFilter.value = '';
    if (statusFilter) statusFilter.value = 'low';
    if (inventoryStateFilter) inventoryStateFilter.value = '';
    if (accountingTypeFilter) accountingTypeFilter.value = '';
    if (searchInput) searchInput.value = '';
    searchData();
}

function openDashboardDocumentsAction() {
    showPage('documentsHub');
}

function openDashboardRequestsAction() {
    showPage('purchaseRequests');
}

function openDashboardWriteoffAction() {
    showPage('writeoffActs');
    if (typeof openDraftWriteoffAct === 'function') {
        openDraftWriteoffAct();
    }
}

function inferWriteoffReasonCategoryClient(reason = '', type = 'asset') {
    const normalizedReason = String(reason || '').trim().toLowerCase().replace(/ё/g, 'е');
    const normalizedType = String(type || '').trim().toLowerCase();
    if (normalizedType === 'consumable' || normalizedReason.includes('использован') || normalizedReason.includes('израсход')) return 'consumable';
    if (normalizedReason.includes('истек') || normalizedReason.includes('износ') || normalizedReason.includes('ресурс')) return 'expiry';
    if (normalizedReason.includes('утрач') || normalizedReason.includes('потер') || normalizedReason.includes('краж') || normalizedReason.includes('невозврат')) return 'loss';
    if (normalizedReason.includes('повреж') || normalizedReason.includes('полом') || normalizedReason.includes('дефект') || normalizedReason.includes('брак')) return 'damage';
    return 'other';
}

async function addItemToWriteoffDraft(item, options = {}) {
    if (!item?.id) {
        showNotification('Не удалось определить объект для списания', 'error');
        return;
    }

    try {
        const payload = {
            itemId: String(item.id),
            quantity: Math.max(1, Number(options.quantity || 1)),
            reason: String(options.reason || 'Ручное списание').trim(),
            reasonCategory: String(options.reasonCategory || inferWriteoffReasonCategoryClient(options.reason || 'Ручное списание', item.type || 'asset')).trim(),
            comment: String(options.comment || '').trim(),
            basisType: String(options.basisType || 'item').trim(),
            basisId: options.basisId ?? item.id,
            basisLabel: String(options.basisLabel || 'Карточка объекта').trim(),
            basisName: String(options.basisName || item.name || item.id).trim(),
            basisActNumber: String(options.basisActNumber || '').trim()
        };
        await apiFetch('/api/inventory/writeoff-acts/draft/add-item', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showNotification(`Позиция «${item.name || item.id}» добавлена в черновик акта списания`, 'success');
        if (typeof loadData === 'function') {
            await loadData();
        }
        if (typeof loadAccountingDashboard === 'function') {
            await loadAccountingDashboard();
        }
    } catch (error) {
        showNotification(error.message || 'Ошибка добавления в акт списания', 'error');
    }
}

function openSplitDefectModal(item) {
    const modal = document.getElementById('splitDefectModal');
    if (!modal || !item) return;

    const isMarker = item.isWriteoffMarker === true || item.is_writeoff_marker === true;
    if (isMarker) {
        showNotification('Списывать дефектные можно только из исходного объекта', 'warning');
        return;
    }

    const availableQty = getWriteoffEligibleQuantity(item);
    if (availableQty <= 0) {
        showNotification('Списывать можно только доступный остаток на складе (доступно 0).', 'warning');
        return;
    }
    modal.dataset.itemId = String(item.id || '');
    modal.dataset.maxQty = String(Math.max(1, availableQty));

    const label = document.getElementById('splitDefectItemLabel');
    if (label) {
        label.textContent = `Исходный объект: ${item.name || item.id} • Доступно для отправки в списание: ${Math.max(1, availableQty)} ед.`;
    }

    const qtyInput = document.getElementById('splitDefectQuantity');
    if (qtyInput) {
        qtyInput.min = '1';
        qtyInput.max = String(Math.max(1, availableQty));
        qtyInput.value = '1';
    }

    const commentInput = document.getElementById('splitDefectComment');
    if (commentInput) commentInput.value = '';

    modal.style.display = 'block';
}

function closeSplitDefectModal() {
    const modal = document.getElementById('splitDefectModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.dataset.itemId = '';
    modal.dataset.maxQty = '';
}

function openSplitDefectFromCurrentCard() {
    if (!currentItemCard) {
        showNotification('Карточка объекта не выбрана', 'error');
        return;
    }
    openSplitDefectModal(currentItemCard);
}

window.openSplitDefectFromCurrentCard = openSplitDefectFromCurrentCard;

async function submitSplitDefect() {
    const modal = document.getElementById('splitDefectModal');
    if (!modal) return;

    const itemId = String(modal.dataset.itemId || '').trim();
    const maxQty = Math.max(1, Number(modal.dataset.maxQty || 1));
    const quantity = Math.max(1, Math.min(maxQty, Number(document.getElementById('splitDefectQuantity')?.value || 1)));
    const reason = String(document.getElementById('splitDefectReason')?.value || 'Брак').trim();
    const comment = String(document.getElementById('splitDefectComment')?.value || '').trim();

    if (!itemId) {
        showNotification('Объект для выделения брака не выбран', 'error');
        return;
    }

    try {
        await apiFetch(`/api/inventory/${encodeURIComponent(itemId)}/split-defect`, {
            method: 'POST',
            body: JSON.stringify({ quantity, reason, comment, reasonCategory: 'damage' })
        });
        showNotification('Дефектные единицы добавлены в черновик акта списания', 'success');
        closeSplitDefectModal();
        if (typeof loadData === 'function') {
            await loadData();
        }
        if (typeof loadAccountingDashboard === 'function') {
            await loadAccountingDashboard();
        }
    } catch (error) {
        showNotification(error.message || 'Ошибка при выделении частичного брака', 'error');
    }
}

function populateRentalFilterOptions() {
    const clientSelect = document.getElementById('rentalClientFilter');
    const employeeSelect = document.getElementById('rentalEmployeeFilter');

    if (clientSelect) {
        const currentValue = clientSelect.value || readStoredFilters(RENTAL_FILTERS_STORAGE_KEY).clientId || '';
        clientSelect.innerHTML = '<option value="">Все арендаторы</option>';
        clients.forEach(client => {
            const option = document.createElement('option');
            option.value = String(client.id);
            option.textContent = client.name;
            clientSelect.appendChild(option);
        });
        clientSelect.value = currentValue;
    }

    if (employeeSelect) {
        const currentValue = employeeSelect.value || readStoredFilters(RENTAL_FILTERS_STORAGE_KEY).employeeId || '';
        employeeSelect.innerHTML = '<option value="">Все ответственные</option>';
        employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = String(employee.id);
            option.textContent = employee.name;
            employeeSelect.appendChild(option);
        });
        employeeSelect.value = currentValue;
    }
}

function populateEventFilterOptions() {
    const employeeSelect = document.getElementById('eventEmployeeFilter');
    if (!employeeSelect) return;

    const currentValue = employeeSelect.value || readStoredFilters(EVENT_FILTERS_STORAGE_KEY).employeeId || '';
    employeeSelect.innerHTML = '<option value="">Все ответственные</option>';

    employees.forEach(employee => {
        const option = document.createElement('option');
        option.value = String(employee.id);
        option.textContent = employee.name;
        employeeSelect.appendChild(option);
    });

    employeeSelect.value = currentValue;
}

function getRentalsFilters() {
    return {
        search: document.getElementById('rentalSearchFilter')?.value.trim() || '',
        status: document.getElementById('rentalStatusFilter')?.value || '',
        dateFrom: document.getElementById('rentalDateFromFilter')?.value || '',
        dateTo: document.getElementById('rentalDateToFilter')?.value || '',
        clientId: document.getElementById('rentalClientFilter')?.value || '',
        employeeId: document.getElementById('rentalEmployeeFilter')?.value || ''
    };
}

function getEventsFilters() {
    return {
        search: document.getElementById('eventSearchFilter')?.value.trim() || '',
        status: document.getElementById('eventStatusFilter')?.value || '',
        dateFrom: document.getElementById('eventDateFromFilter')?.value || '',
        dateTo: document.getElementById('eventDateToFilter')?.value || '',
        location: document.getElementById('eventLocationFilter')?.value.trim() || '',
        employeeId: document.getElementById('eventEmployeeFilter')?.value || ''
    };
}

function applyRentalsFilters() {
    writeStoredFilters(RENTAL_FILTERS_STORAGE_KEY, getRentalsFilters());
    renderRentalsTable();
}

function applyEventsFilters() {
    writeStoredFilters(EVENT_FILTERS_STORAGE_KEY, getEventsFilters());
    renderEventsTable();
}

function resetRentalsFilters() {
    ['rentalSearchFilter', 'rentalStatusFilter', 'rentalDateFromFilter', 'rentalDateToFilter', 'rentalClientFilter', 'rentalEmployeeFilter']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

    applyRentalsFilters();
}

function resetEventsFilters() {
    ['eventSearchFilter', 'eventStatusFilter', 'eventDateFromFilter', 'eventDateToFilter', 'eventLocationFilter', 'eventEmployeeFilter']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

    applyEventsFilters();
}

function restoreSavedDirectoryFilters() {
    const rentalFilters = readStoredFilters(RENTAL_FILTERS_STORAGE_KEY);
    const eventFilters = readStoredFilters(EVENT_FILTERS_STORAGE_KEY);

    const rentalMap = {
        rentalSearchFilter: rentalFilters.search || '',
        rentalStatusFilter: rentalFilters.status || '',
        rentalDateFromFilter: rentalFilters.dateFrom || '',
        rentalDateToFilter: rentalFilters.dateTo || '',
        rentalClientFilter: rentalFilters.clientId || '',
        rentalEmployeeFilter: rentalFilters.employeeId || ''
    };

    const eventMap = {
        eventSearchFilter: eventFilters.search || '',
        eventStatusFilter: eventFilters.status || '',
        eventDateFromFilter: eventFilters.dateFrom || '',
        eventDateToFilter: eventFilters.dateTo || '',
        eventLocationFilter: eventFilters.location || '',
        eventEmployeeFilter: eventFilters.employeeId || ''
    };

    Object.entries({ ...rentalMap, ...eventMap }).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
        }
    });
}

// ============================================================================
// Inventory item modal and card
// ============================================================================

function generateItemId(category) {
    const prefixMap = {
        'Мебель': 'FUR',
        'Экспонат': 'EXH',
        'Инструмент': 'TOL'
    };
    return `${prefixMap[category] || 'INV'}${Date.now().toString().slice(-6)}`;
}

function openAddModal(category) {
    if (!requirePermission('stock', 'create', 'Недостаточно прав для добавления объектов')) return;
    editingItem = null;
    selectedImageData = null;

    document.getElementById('modalTitle').textContent = `Добавить объект (${category})`;
    document.getElementById('itemForm').reset();
    document.getElementById('itemForm').dataset.category = category;
    document.getElementById('itemCategoryDisplay').value = category;
    document.getElementById('itemAccountingTypeAsset').checked = true;
    document.getElementById('itemAccountingTypeConsumable').checked = false;
    document.getElementById('itemMinStock').value = '';
    document.getElementById('itemUnitCost').value = '';
    document.getElementById('itemRequiresPurchase').checked = false;
    document.getElementById('itemLifespan').value = '';
    document.getElementById('itemLifespanPreset').value = '';
    document.getElementById('itemBalanceDate').value = '';
    document.getElementById('itemAssetEndDate').value = '';
    toggleAccountingTypeFields();
    renderEntityProgress('itemFormProgress', 'черновик', ['Черновик', 'Готово к сохранению', 'Сохранено']);
    document.getElementById('itemImageUrl').value = '';
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('modal').style.display = 'block';
}

function openEditModal(item) {
    if (!requirePermission('stock', 'edit', 'Недостаточно прав для редактирования объектов')) return;
    editingItem = item;
    selectedImageData = null;

    document.getElementById('modalTitle').textContent = 'Редактировать объект';
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemCategoryDisplay').value = item.category || 'Склад';
    const accountingType = item.type === 'consumable' ? 'consumable' : 'asset';
    document.getElementById('itemAccountingTypeAsset').checked = accountingType === 'asset';
    document.getElementById('itemAccountingTypeConsumable').checked = accountingType === 'consumable';
    document.getElementById('itemMinStock').value = Number(item.minStock ?? item.minstock ?? 0) || 0;
    document.getElementById('itemRequiresPurchase').checked = item.requiresPurchase === true || item.requires_purchase === true;
    document.getElementById('itemLifespan').value = item.lifespan || '';
    document.getElementById('itemLifespanPreset').value = item.lifespan && [12, 24, 36, 48, 60].includes(Number(item.lifespan)) ? String(item.lifespan) : 'custom';
    document.getElementById('itemBalanceDate').value = normalizeDateInputValue(item.balanceDate || item.balance_date || '');
    toggleAccountingTypeFields();
    updateAssetEndDatePreview();
    document.getElementById('itemStock').value = Number(item.totalQuantity ?? item.totalStock ?? item.quantity ?? 0) || 0;
    document.getElementById('itemUnitCost').value = Number(getItemUnitCostByIdOrName(item) || 0) || 0;
    document.getElementById('itemDescription').value = item.description || '';
    document.getElementById('itemInfo').value = item.info || '';
    document.getElementById('itemImageUrl').value = item.image && /^https?:/i.test(item.image) ? item.image : '';
    document.getElementById('itemForm').dataset.category = item.category || 'Склад';
    document.getElementById('deleteBtn').style.display = 'inline-block';
    document.getElementById('modal').style.display = 'block';
    renderEntityProgress('itemFormProgress', String(item.status || 'черновик'), ['Черновик', 'Проведено', 'Закрыто']);
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
    document.getElementById('itemForm').reset();
    document.getElementById('itemCategoryDisplay').value = '';
    document.getElementById('itemImageUrl').value = '';
    document.getElementById('itemMinStock').value = '';
    document.getElementById('itemUnitCost').value = '';
    editingItem = null;
    selectedImageData = null;
}

function toggleAccountingTypeFields() {
    const selectedType = document.querySelector('input[name="itemAccountingType"]:checked')?.value || 'asset';
    const consumableFields = document.getElementById('consumableAccountingFields');
    const assetFields = document.getElementById('assetAccountingFields');
    const itemMinStock = document.getElementById('itemMinStock');

    if (consumableFields) {
        consumableFields.style.display = selectedType === 'consumable' ? 'block' : 'none';
    }

    if (assetFields) {
        assetFields.style.display = selectedType === 'asset' ? 'block' : 'none';
    }

    const itemLifespan = document.getElementById('itemLifespan');
    const itemBalanceDate = document.getElementById('itemBalanceDate');
    if (itemLifespan) itemLifespan.required = selectedType === 'asset';
    if (itemBalanceDate) itemBalanceDate.required = selectedType === 'asset';
    if (itemMinStock) itemMinStock.required = selectedType === 'consumable';

    updateAssetEndDatePreview();
}

function applyLifespanPreset(value) {
    const input = document.getElementById('itemLifespan');
    if (!input) return;

    if (value && value !== 'custom') {
        input.value = String(Number(value));
    }

    updateAssetEndDatePreview();
}

function updateAssetEndDatePreview() {
    const selectedType = document.querySelector('input[name="itemAccountingType"]:checked')?.value || 'asset';
    const balanceDateValue = document.getElementById('itemBalanceDate')?.value;
    const lifespanValue = Number(document.getElementById('itemLifespan')?.value || 0);
    const endDateInput = document.getElementById('itemAssetEndDate');
    if (!endDateInput) return;

    if (selectedType !== 'asset' || !balanceDateValue || !lifespanValue) {
        endDateInput.value = '';
        return;
    }

    const date = new Date(`${balanceDateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        endDateInput.value = '';
        return;
    }

    date.setMonth(date.getMonth() + lifespanValue);
    endDateInput.value = date.toISOString().slice(0, 10);
}

// formatDateOnly / formatDateTimeSafe вынесены в script-utils-core.js

async function loadItemAssetHistory(itemId) {
    const content = document.getElementById('itemCardAssetHistoryContent');
    if (!content) return;
    content.textContent = 'Загрузка...';

    try {
        const payload = await apiFetch(`/api/inventory/${encodeURIComponent(itemId)}/asset-history`);
        const lifecycle = Array.isArray(payload?.lifecycle) ? payload.lifecycle : [];
        const writeoffActs = Array.isArray(payload?.writeoffActs) ? payload.writeoffActs : [];

        const lifecycleHtml = lifecycle.length
            ? `<ul class="asset-history-list">${lifecycle.map(row => `<li>
                    ${formatDateTimeSafe(row.created_at, '—')}: ${escapeHtml(row.change_type || 'изменение')} —
                    срок ${Number(row.before_lifespan || 0)} → ${Number(row.after_lifespan || 0)} мес,
                    дата окончания ${formatDateOnly(row.before_end_date)} → ${formatDateOnly(row.after_end_date)}
                    ${row.reason ? `<br><em>Причина:</em> ${escapeHtml(row.reason)}` : ''}
                </li>`).join('')}</ul>`
            : '<p>История изменений срока эксплуатации отсутствует.</p>';

        const writeoffHtml = writeoffActs.length
            ? `<ul class="asset-history-list">${writeoffActs.map(row => `<li>
                    Акт ${escapeHtml(row.act_number || '—')} от ${formatDateOnly(row.act_date)} — ${escapeHtml(row.reason || 'Без причины')} (${Number(row.quantity || 0)} шт)
                    ${row.act_number ? `<button type="button" class="inline-action-btn" onclick="event.stopPropagation(); if (typeof openWriteoffActDetailsByNumber === 'function') openWriteoffActDetailsByNumber('${escapeHtml(String(row.act_number)).replace(/'/g, '&#39;')}')">Открыть</button>` : ''}
                </li>`).join('')}</ul>`
            : '<p>Акты списания по объекту отсутствуют.</p>';

        content.innerHTML = `
            <h4>Изменения срока эксплуатации</h4>
            ${lifecycleHtml}
            <h4>Списания</h4>
            ${writeoffHtml}
        `;
    } catch (error) {
        content.innerHTML = `<p>Ошибка загрузки истории: ${escapeHtml(error.message || 'неизвестная ошибка')}</p>`;
    }
}

function openExtendLifespanModal() {
    if (!currentItemCard) return;
    const modal = document.getElementById('extendLifespanModal');
    if (!modal) return;

    document.getElementById('extendMonths').value = '12';
    document.getElementById('extendReason').value = '';
    modal.style.display = 'block';
}

function closeExtendLifespanModal() {
    const modal = document.getElementById('extendLifespanModal');
    if (modal) modal.style.display = 'none';
}

async function submitExtendLifespan() {
    if (!currentItemCard) return;

    const additionalMonths = Number(document.getElementById('extendMonths')?.value || 12);
    const reason = document.getElementById('extendReason')?.value.trim() || '';

    if (!reason) {
        showNotification('Укажите причину продления срока эксплуатации', 'error');
        return;
    }

    try {
        await apiFetch(`/api/inventory/${encodeURIComponent(currentItemCard.id)}/extend-lifespan`, {
            method: 'POST',
            body: JSON.stringify({ additionalMonths, reason })
        });
        showNotification('Срок эксплуатации продлён', 'success');
        closeExtendLifespanModal();
        await loadData();
        const refreshed = findInventoryItem(currentItemCard.id);
        if (refreshed) {
            openItemCard(refreshed);
        }
    } catch (error) {
        showNotification(error.message || 'Ошибка продления срока эксплуатации', 'error');
    }
}

function openItemCard(item) {
    currentItemCard = item;
    const lifecycleStatus = normalizeInventoryLifecycleStatus(item.status || 'В наличии');
    const totalQty = Number(item.totalQuantity ?? item.totalStock ?? item.quantity ?? 0);
    const inRentalQty = Number(item.inRental || 0);
    const inEventQty = Number(item.inEvent || 0);
    const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
    const writeoffEligibleQty = getWriteoffEligibleQuantity(item);
    document.getElementById('itemCardTitle').textContent = item.name || 'Без названия';
    document.getElementById('itemCardCategory').textContent = item.category || 'Склад';
    document.getElementById('itemCardAccountingType').textContent = item.type === 'consumable' ? '⚡ Расходный материал' : '🏗️ Основное средство';
    const totalNode = document.getElementById('itemCardTotalQty');
    const inRentalNode = document.getElementById('itemCardInRental');
    const inEventNode = document.getElementById('itemCardInEvent');
    const availableNode = document.getElementById('itemCardAvailable');
    if (totalNode) totalNode.textContent = String(totalQty);
    if (inRentalNode) inRentalNode.textContent = String(inRentalQty);
    if (inEventNode) inEventNode.textContent = String(inEventQty);
    if (availableNode) availableNode.textContent = String(availableQty);
    const statusNode = document.getElementById('itemCardStatus');
    if (statusNode) statusNode.textContent = lifecycleStatus;
    document.getElementById('itemCardUnitCost').textContent = `${Number(getItemUnitCostByIdOrName(item) || 0).toLocaleString('ru-RU')} ₽`;
    document.getElementById('itemCardDescription').textContent = item.description || 'Описание отсутствует';
    document.getElementById('itemCardInfo').textContent = item.info || '';

    const assetDetails = document.getElementById('itemCardAssetDetails');
    const assetHistory = document.getElementById('itemCardAssetHistory');
    const consumableDetails = document.getElementById('itemCardConsumableDetails');
    const isAsset = String(item.type || '') !== 'consumable';
    const splitBtn = document.getElementById('itemCardSplitDefectBtn');

    if (assetDetails) assetDetails.style.display = isAsset ? 'block' : 'none';
    if (assetHistory) assetHistory.style.display = isAsset ? 'block' : 'none';
    if (consumableDetails) consumableDetails.style.display = isAsset ? 'none' : 'block';
    const isMarker = item.isWriteoffMarker === true || item.is_writeoff_marker === true;
    if (splitBtn) {
        splitBtn.style.display = !isMarker && writeoffEligibleQty > 0 ? 'inline-flex' : 'none';
        splitBtn.textContent = 'Списать';
        splitBtn.onclick = (event) => {
            event.stopPropagation();
            openSplitDefectModal(item);
        };
    }

    if (isAsset) {
        const balanceDateRaw = item.balanceDate || item.balance_date || null;
        const balanceDate = normalizeDateInputValue(balanceDateRaw);
        const lifespan = Number(item.lifespan || 0) || null;
        let endDate = '—';
        if (balanceDate && lifespan) {
            const dt = new Date(`${balanceDate}T00:00:00`);
            if (!Number.isNaN(dt.getTime())) {
                dt.setMonth(dt.getMonth() + lifespan);
                endDate = formatDateOnly(dt);
            }
        }

        document.getElementById('itemCardBalanceDate').textContent = formatDateOnly(balanceDate);
        document.getElementById('itemCardLifespan').textContent = lifespan ? `${lifespan} мес.` : '—';
        document.getElementById('itemCardEndDate').textContent = endDate;
        loadItemAssetHistory(item.id);

        const writeoffInfo = document.getElementById('itemCardWriteoffInfo');
        const writeoffReason = document.getElementById('itemCardWriteoffReason');
        const writeoffDate = document.getElementById('itemCardWriteoffDate');
        const writeoffAct = document.getElementById('itemCardWriteoffAct');
        const actNumber = item.writeoffActNumber || item.writeoff_act_number || '';

        if (writeoffInfo) writeoffInfo.style.display = lifecycleStatus === 'Списано' ? 'block' : 'none';
        if (writeoffReason) writeoffReason.textContent = item.writeoffReason || item.writeoff_reason || '—';
        if (writeoffDate) writeoffDate.textContent = formatDateOnly(item.writeoffDate || item.writeoff_date);
        if (writeoffAct) {
            writeoffAct.innerHTML = actNumber
                ? `${escapeHtml(actNumber)} <button type="button" class="inline-action-btn" onclick="if(typeof openWriteoffActDetailsByNumber==='function'){openWriteoffActDetailsByNumber('${escapeHtml(String(actNumber)).replace(/'/g, '&#39;')}')}\">Открыть</button>`
                : '—';
        }
    } else {
        document.getElementById('itemCardMinStock').textContent = String(Number(item.minStock ?? item.minstock ?? 0) || 0);
        document.getElementById('itemCardRequiresPurchase').textContent = item.requiresPurchase === true || item.requires_purchase === true ? 'Да' : 'Нет';
    }

    const img = document.getElementById('itemImage');
    img.src = item.image || 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
            <rect width="100%" height="100%" fill="#f2f2f2"/>
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#666" font-size="18">Нет изображения</text>
        </svg>`);

    document.getElementById('itemCard').style.display = 'block';
}

function closeItemCard() {
    document.getElementById('itemCard').style.display = 'none';
    currentItemCard = null;
}

function openEditModalFromCard() {
    if (!currentItemCard) return;
    const itemToEdit = { ...currentItemCard }; // Сохраняем данные перед закрытием
    closeItemCard();
    openEditModal(itemToEdit);
}

async function syncInventoryToServer(showSuccess = false) {
    saveLocalBackup();
    await apiFetch('/api/inventory', {
        method: 'PUT',
        body: JSON.stringify(inventory)
    });

    if (showSuccess) {
        showNotification('Данные инвентаря сохранены', 'success');
    }

    await loadData();
}

async function handleItemFormSubmit(event) {
    event.preventDefault();

    if (!requirePermission('stock', editingItem ? 'edit' : 'create', editingItem ? 'Недостаточно прав для редактирования объектов' : 'Недостаточно прав для добавления объектов')) return;

    const category = document.getElementById('itemForm').dataset.category || 'Склад';
    const imageUrl = document.getElementById('itemImageUrl').value.trim();
    const accountingType = document.querySelector('input[name="itemAccountingType"]:checked')?.value || 'asset';
    const requiresPurchase = document.getElementById('itemRequiresPurchase').checked;
    const minStock = Math.max(0, Number(document.getElementById('itemMinStock').value || 0));
    const lifespanRaw = document.getElementById('itemLifespan').value;
    const balanceDate = document.getElementById('itemBalanceDate').value;
    const unitCost = Math.max(0, Number(document.getElementById('itemUnitCost').value || 0));

    const item = {
        id: editingItem ? editingItem.id : generateItemId(category),
        name: document.getElementById('itemName').value.trim(),
        category,
        type: accountingType,
        requires_purchase: accountingType === 'consumable' ? requiresPurchase : false,
        minStock: accountingType === 'consumable' ? minStock : 0,
        minstock: accountingType === 'consumable' ? minStock : 0,
        lifespan: accountingType === 'asset' && lifespanRaw ? Number(lifespanRaw) : null,
        balance_date: accountingType === 'asset' ? (balanceDate || null) : null,
        quantity: Number(document.getElementById('itemStock').value || 0),
        stock: Number(document.getElementById('itemStock').value || 0),
        description: document.getElementById('itemDescription').value.trim(),
        info: document.getElementById('itemInfo').value.trim(),
        image: selectedImageData || imageUrl || (editingItem ? editingItem.image : ''),
        rentalStatus: 'На складе',
        location: editingItem?.location || ''
    };

    if (!item.name) {
        showNotification('Введите название объекта', 'error');
        return;
    }

    if (accountingType === 'asset') {
        if (!balanceDate) {
            showNotification('Для ОС укажите дату постановки на баланс', 'error');
            return;
        }
        if (!lifespanRaw || Number(lifespanRaw) <= 0) {
            showNotification('Для ОС укажите срок эксплуатации (в месяцах)', 'error');
            return;
        }
    } else if (minStock <= 0) {
        showNotification('Для расходника укажите минимальную норму больше нуля', 'error');
        return;
    }

    try {
        if (editingItem) {
            await apiFetch(`/api/inventory/${editingItem.id}`, {
                method: 'PUT',
                body: JSON.stringify(item)
            });
            setItemUnitCost({ id: item.id, name: item.name }, unitCost);
            if (typeof window.clearPendingDeliveryAdjustmentsForItem === 'function') {
                window.clearPendingDeliveryAdjustmentsForItem({ id: item.id, name: item.name });
            }
            showNotification('Данные обновлены во всех связанных документах', 'success');
        } else {
            await apiFetch('/api/inventory', {
                method: 'POST',
                body: JSON.stringify(item)
            });
            setItemUnitCost({ id: item.id, name: item.name }, unitCost);
            if (typeof window.clearPendingDeliveryAdjustmentsForItem === 'function') {
                window.clearPendingDeliveryAdjustmentsForItem({ id: item.id, name: item.name });
            }
            showNotification('Объект добавлен успешно', 'success');
        }

        closeModal();
        await loadData();
    } catch (error) {
        console.error('Ошибка сохранения объекта:', error);
        showNotification(`Ошибка сохранения объекта: ${error.message}`, 'error');
    }
}

function deleteItem() {
    if (!requirePermission('stock', 'delete', 'Недостаточно прав для удаления объектов')) return;
    if (!editingItem) {
        showNotification('Нет выбранного объекта для удаления', 'warning');
        return;
    }

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить "${editingItem.name}"?`,
        async () => {
            try {
                await apiFetch(`/api/inventory/${editingItem.id}`, { method: 'DELETE' });
                closeModal();
                await loadData();
                showNotification('Объект удалён', 'success');
            } catch (error) {
                console.error('Ошибка удаления объекта:', error);
                showNotification(`Ошибка удаления: ${error.message}`, 'error');
            }
        }
    );
}

function deleteItemFromCard() {
    if (!currentItemCard) return;
    closeItemCard();
    editingItem = currentItemCard;
    deleteItem();
}

function selectAll(category) {
    const checkboxMap = {
        'Мебель': 'selectAllMebel',
        'Экспонат': 'selectAllEksponat',
        'Инструмент': 'selectAllInstrument'
    };

    const master = document.getElementById(checkboxMap[category]);
    if (!master) return;

    document.querySelectorAll(`.inventory-checkbox[data-category="${category}"]`).forEach(cb => {
        cb.checked = master.checked;
    });
}

function deleteSelected(category) {
    if (!requirePermission('stock', 'delete', 'Недостаточно прав для удаления объектов')) return;
    const selected = Array.from(document.querySelectorAll(`.inventory-checkbox[data-category="${category}"]:checked`));

    if (selected.length === 0) {
        showNotification('⚠ Выберите объекты для удаления', 'warning');
        return;
    }

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить ${selected.length} выбранных объектов?`,
        async () => {
            try {
                for (const checkbox of selected) {
                    await apiFetch(`/api/inventory/${checkbox.dataset.id}`, { method: 'DELETE' });
                }
                await loadData();
                showNotification('Выбранные объекты удалены', 'success');
            } catch (error) {
                console.error('Ошибка удаления объектов:', error);
                showNotification(`Ошибка удаления: ${error.message}`, 'error');
            }
        }
    );
}

// ============================================================================
// Confirm modal
// ============================================================================

function showConfirmModal(title, message, callback) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    confirmCallback = callback;
    document.getElementById('confirmModal').style.display = 'block';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    confirmCallback = null;
}

function confirmAction() {
    if (typeof confirmCallback === 'function') {
        const callback = confirmCallback;
        closeConfirmModal();
        callback();
    }
}

// ============================================================================
// Clients
// ============================================================================

async function fetchClients(render = true) {
    try {
        const data = await apiFetch('/api/clients', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false });
        clients = Array.isArray(data) ? data : [];
        if (render) renderClientsTable();
        return clients;
    } catch (error) {
        console.error('Ошибка загрузки клиентов:', error);
        if (render) showNotification('Ошибка при загрузке клиентов', 'error');
        return [];
    }
}

function renderClientsTable(data = clients) {
    const tableBody = document.querySelector('#clientsTable tbody');
    if (!tableBody) return;

    const canEditDirectories = canManageDirectories();
    tableBody.innerHTML = '';
    data.forEach(client => {
        const innValue = String(client.inn || '').trim();
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${client.id}</td>
            <td>${escapeHtml(client.name)}</td>
            <td>${escapeHtml(client.phone || '')}</td>
            <td>${escapeHtml(client.email || '')}</td>
            <td>${escapeHtml(client.address || '')}</td>
            <td>${escapeHtml(innValue || '—')}</td>
            <td>${escapeHtml(client.type || '')}</td>
            <td>
                ${canEditDirectories ? `<button type="button" class="inline-action-btn clients-edit-btn">Редактировать</button>
                <button type="button" class="inline-action-btn clients-delete-btn">Удалить</button>` : ''}
            </td>
        `;

        if (canEditDirectories) {
            row.classList.add('directory-editable-row');
            row.addEventListener('dblclick', () => openEditClientModal(client.id));
            row.querySelector('.clients-edit-btn')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openEditClientModal(client.id);
            });
            row.querySelector('.clients-delete-btn')?.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteClient(client.id);
            });
        }

        tableBody.appendChild(row);
    });
}

function searchClients() {
    const query = (document.getElementById('clientSearch')?.value || '').toLowerCase();
    if (!query) {
        renderClientsTable(clients);
        return;
    }

    const filtered = clients.filter(client =>
        String(client.name || '').toLowerCase().includes(query) ||
        String(client.phone || '').toLowerCase().includes(query) ||
        String(client.email || '').toLowerCase().includes(query)
    );

    renderClientsTable(filtered);
}

function searchEmployees() {
    const query = (document.getElementById('employeeSearch')?.value || '').toLowerCase();
    if (!query) {
        renderEmployeesTable(employees);
        return;
    }

    const filtered = employees.filter(employee =>
        String(employee.name || '').toLowerCase().includes(query) ||
        String(employee.position || '').toLowerCase().includes(query) ||
        String(employee.phone || '').toLowerCase().includes(query) ||
        String(employee.email || '').toLowerCase().includes(query)
    );

    renderEmployeesTable(filtered);
}

function openAddClientModal() {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для добавления клиентов', 'error');
        return;
    }

    editingClient = null;
    document.getElementById('clientModalTitle').textContent = 'Добавить клиента';
    document.getElementById('clientForm').reset();
    document.getElementById('clientModal').style.display = 'block';
}

function openEditClientModal(clientId) {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для редактирования клиентов', 'error');
        return;
    }

    const client = clients.find(c => String(c.id) === String(clientId));
    if (!client) return;

    editingClient = client;
    document.getElementById('clientModalTitle').textContent = 'Редактировать клиента';
    document.getElementById('clientName').value = client.name || '';
    document.getElementById('clientPhone').value = client.phone || '';
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientAddress').value = client.address || '';
    document.getElementById('clientInn').value = client.inn || '';
    document.getElementById('clientType').value = client.type || '';
    document.getElementById('clientModal').style.display = 'block';
}

function closeClientModal() {
    document.getElementById('clientModal').style.display = 'none';
    document.getElementById('clientForm').reset();
    editingClient = null;
}

async function handleClientFormSubmit(event) {
    event.preventDefault();

    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для сохранения клиентов', 'error');
        return;
    }

    const payload = {
        name: document.getElementById('clientName').value.trim(),
        phone: document.getElementById('clientPhone').value.trim(),
        email: document.getElementById('clientEmail').value.trim(),
        address: document.getElementById('clientAddress').value.trim(),
        inn: document.getElementById('clientInn').value.trim(),
        type: document.getElementById('clientType').value
    };

    try {
        if (editingClient) {
            await apiFetch(`/api/clients/${editingClient.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showNotification('Клиент обновлён', 'success');
        } else {
            await apiFetch('/api/clients', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showNotification('Клиент добавлен', 'success');
        }

        closeClientModal();
        await fetchClients();
    } catch (error) {
        console.error('Ошибка сохранения клиента:', error);
        showNotification(error.message || 'Ошибка при сохранении клиента', 'error');
    }
}

function deleteClient(clientId) {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для удаления клиентов', 'error');
        return;
    }

    const client = clients.find(c => String(c.id) === String(clientId));
    if (!client) return;

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить клиента "${client.name}"?`,
        async () => {
            try {
                await apiFetch(`/api/clients/${clientId}`, { method: 'DELETE' });
                showNotification('Клиент удалён', 'success');
                await fetchClients();
            } catch (error) {
                console.error('Ошибка удаления клиента:', error);
                showNotification(error.message || 'Ошибка при удалении клиента', 'error');
            }
        }
    );
}

// ============================================================================
// Employees
// ============================================================================

async function fetchEmployees(render = true) {
    try {
        const data = await apiFetch('/api/employees', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false });
        employees = Array.isArray(data) ? data : [];
        if (render) renderEmployeesTable();
        return employees;
    } catch (error) {
        console.error('Ошибка загрузки сотрудников:', error);
        if (render) showNotification('Ошибка при загрузке сотрудников', 'error');
        return [];
    }
}

function renderEmployeesTable(data = employees) {
    const tableBody = document.querySelector('#employeesTable tbody');
    if (!tableBody) return;

    const canEditDirectories = canManageDirectories();
    tableBody.innerHTML = '';
    data.forEach(employee => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${employee.id}</td>
            <td>${escapeHtml(employee.name)}</td>
            <td>${escapeHtml(employee.position || '')}</td>
            <td>${escapeHtml(employee.phone || '')}</td>
            <td>${escapeHtml(employee.email || '')}</td>
            <td>${formatDateOnly(employee.hire_date)}</td>
            <td>${employee.active ? 'Да' : 'Нет'}</td>
            <td>
                ${canEditDirectories ? `<button type="button" class="inline-action-btn employees-edit-btn">Редактировать</button>
                <button type="button" class="inline-action-btn employees-delete-btn">Удалить</button>` : ''}
            </td>
        `;

        if (canEditDirectories) {
            row.classList.add('directory-editable-row');
            row.addEventListener('dblclick', () => openEditEmployeeModal(employee.id));
            row.querySelector('.employees-edit-btn')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openEditEmployeeModal(employee.id);
            });
            row.querySelector('.employees-delete-btn')?.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteEmployee(employee.id);
            });
        }

        tableBody.appendChild(row);
    });
}

function openAddEmployeeModal() {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для добавления сотрудников', 'error');
        return;
    }

    editingEmployee = null;
    document.getElementById('employeeModalTitle').textContent = 'Добавить сотрудника';
    document.getElementById('employeeForm').reset();
    document.getElementById('employeeActive').checked = true;
    document.getElementById('employeeModal').style.display = 'block';
}

function openEditEmployeeModal(employeeId) {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для редактирования сотрудников', 'error');
        return;
    }

    const employee = employees.find(emp => String(emp.id) === String(employeeId));
    if (!employee) return;

    editingEmployee = employee;
    document.getElementById('employeeModalTitle').textContent = 'Редактировать сотрудника';
    document.getElementById('employeeName').value = employee.name || '';
    document.getElementById('employeePosition').value = employee.position || '';
    document.getElementById('employeePhone').value = employee.phone || '';
    document.getElementById('employeeEmail').value = employee.email || '';
    document.getElementById('employeeHireDate').value = employee.hire_date || '';
    document.getElementById('employeeActive').checked = !!employee.active;
    document.getElementById('employeeModal').style.display = 'block';
}

function closeEmployeeModal() {
    document.getElementById('employeeModal').style.display = 'none';
    document.getElementById('employeeForm').reset();
    editingEmployee = null;
}

async function handleEmployeeFormSubmit(event) {
    event.preventDefault();

    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для сохранения сотрудников', 'error');
        return;
    }

    const payload = {
        name: document.getElementById('employeeName').value.trim(),
        position: document.getElementById('employeePosition').value.trim(),
        phone: document.getElementById('employeePhone').value.trim(),
        email: document.getElementById('employeeEmail').value.trim(),
        hire_date: document.getElementById('employeeHireDate').value,
        active: document.getElementById('employeeActive').checked
    };

    try {
        if (editingEmployee) {
            await apiFetch(`/api/employees/${editingEmployee.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showNotification('Сотрудник обновлён', 'success');
        } else {
            await apiFetch('/api/employees', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showNotification('Сотрудник добавлен', 'success');
        }

        closeEmployeeModal();
        await fetchEmployees();
    } catch (error) {
        console.error('Ошибка сохранения сотрудника:', error);
        showNotification(error.message || 'Ошибка при сохранении сотрудника', 'error');
    }
}

function deleteEmployee(employeeId) {
    if (!canManageDirectories()) {
        showNotification('Недостаточно прав для удаления сотрудников', 'error');
        return;
    }

    const employee = employees.find(emp => String(emp.id) === String(employeeId));
    if (!employee) return;

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить сотрудника "${employee.name}"?`,
        async () => {
            try {
                await apiFetch(`/api/employees/${employeeId}`, { method: 'DELETE' });
                showNotification('Сотрудник удалён', 'success');
                await fetchEmployees();
            } catch (error) {
                console.error('Ошибка удаления сотрудника:', error);
                showNotification(error.message || 'Ошибка при удалении сотрудника', 'error');
            }
        }
    );
}

// ============================================================================
// Users (admin)
// ============================================================================

async function loadUsers() {
    if (!RBAC.hasPermission('users', 'view')) return;

    try {
        usersList = await apiFetch('/api/users', { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false });
        searchUsers();
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        showNotification(error.message || 'Ошибка загрузки пользователей', 'error');
    }
}

function renderUsersTable(data = usersList) {
    const tbody = document.getElementById('tableUsers');
    if (!tbody) return;

    tbody.innerHTML = '';
    data.forEach(user => {
        const row = document.createElement('tr');
        row.classList.add('directory-editable-row');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(ROLE_LABELS[RBAC.normalizeRole(user.role)] || user.role)}</td>
            <td>
                <label class="checkbox-row">
                    <input type="checkbox" class="user-active-toggle" data-user-id="${user.id}" ${user.active ? 'checked' : ''} ${String(user.id) === String(RBAC.getCurrentUser().id) ? 'disabled' : ''}>
                    <span class="${user.active ? 'user-active-pill' : 'user-inactive-pill'}">${user.active ? 'Да' : 'Нет'}</span>
                </label>
            </td>
            <td>${escapeHtml(formatDateTime(user.last_login, '—'))}</td>
            <td class="user-actions-inline">
                <button type="button" class="inline-action-btn user-edit-btn" title="Редактировать">Редактировать</button>
                <button type="button" class="inline-action-btn user-delete-btn" title="Удалить">Удалить</button>
            </td>
        `;

        row.addEventListener('dblclick', () => openEditUserModal(user.id));
        row.querySelector('.user-edit-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            openEditUserModal(user.id);
        });
        row.querySelector('.user-delete-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteUser(user.id);
        });
        row.querySelector('.user-active-toggle')?.addEventListener('change', (event) => {
            event.stopPropagation();
            updateUserActiveState(user.id, event.target.checked);
        });
        tbody.appendChild(row);
    });
}

function searchUsers() {
    const query = (document.getElementById('usersSearch')?.value || '').toLowerCase();
    if (!query) {
        renderUsersTable(usersList);
        return;
    }

    const filtered = usersList.filter(user => {
        const roleLabel = ROLE_LABELS[RBAC.normalizeRole(user.role)] || user.role || '';
        return String(user.username || '').toLowerCase().includes(query)
            || String(roleLabel).toLowerCase().includes(query)
            || String(user.id || '').toLowerCase().includes(query);
    });

    renderUsersTable(filtered);
}

async function handleUserFormSubmit(event) {
    event.preventDefault();

    if (!requirePermission('users', 'create', 'Недостаточно прав для создания пользователей')) return;

    const username = document.getElementById('newUsername').value.trim();
    if (!confirm(`Уверены, что хотите создать нового пользователя "${username}"?`)) return;

    const payload = {
        username,
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value,
        active: document.getElementById('newUserActive').checked
    };

    try {
        await apiFetch('/api/users/create', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showNotification('Пользователь создан', 'success');
        closeAddUserModal();
        await loadUsers();
    } catch (error) {
        console.error('Ошибка создания пользователя:', error);
        showNotification(error.message || 'Ошибка при создании пользователя', 'error');
    }
}

function openAddUserModal() {
    if (!requirePermission('users', 'create', 'Недостаточно прав для создания пользователей')) return;
    document.getElementById('addUserModal').style.display = 'block';
    document.getElementById('userForm').reset();
    document.getElementById('newUserActive').checked = true;
}

function closeAddUserModal() {
    document.getElementById('addUserModal').style.display = 'none';
}

function openEditUserModal(userId) {
    if (!requirePermission('users', 'edit', 'Недостаточно прав для редактирования пользователей')) return;
    const user = usersList.find(entry => String(entry.id) === String(userId));
    if (!user) {
        showNotification('Пользователь не найден', 'error');
        return;
    }

    editingUser = user;
    document.getElementById('userEditModalTitle').textContent = `Редактировать пользователя #${user.id}`;
    document.getElementById('editUsername').value = user.username || '';
    document.getElementById('editUserRole').value = getRoleSelectValue(user.role || 'Кладовщик');
    document.getElementById('editUserPassword').value = '';
    document.getElementById('editUserPasswordConfirm').value = '';
    document.getElementById('editUserActive').checked = user.active !== false;
    document.getElementById('editUserLastLogin').value = formatDateTime(user.last_login, 'Нет данных');
    document.getElementById('editUserRole').onchange = (event) => {
        const nextRole = event.target.value;
        editingUser = { ...editingUser, role: nextRole };
        fillUserPermissionsForm(editingUser);
    };
    fillUserPermissionsForm(user);
    switchUserEditTab('profile');
    document.getElementById('userEditModal').style.display = 'block';
}

function closeUserEditModal() {
    document.getElementById('userEditModal').style.display = 'none';
    document.getElementById('userEditForm').reset();
    document.querySelector('[data-user-edit-tab="profile"]')?.style.setProperty('display', '');
    document.querySelector('[data-user-edit-tab="permissions"]')?.style.setProperty('display', RBAC.hasPermission('users', 'permissions') ? '' : 'none');
    document.querySelectorAll('#userEditForm .form-actions button').forEach(button => {
        button.style.display = '';
    });
    document.querySelectorAll('#userEditForm input, #userEditForm select').forEach(field => {
        field.disabled = false;
    });
    editingUser = null;
}

async function updateUserActiveState(userId, active) {
    if (!requirePermission('users', 'edit', 'Недостаточно прав для изменения статуса пользователя')) return;
    const user = usersList.find(entry => String(entry.id) === String(userId));
    if (!user) return;

    try {
        await apiFetch(`/api/users/${user.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                username: user.username,
                role: user.role,
                active
            })
        });
        await loadUsers();
        showNotification(`Статус пользователя «${user.username}» обновлён`, 'success');
    } catch (error) {
        console.error('Ошибка изменения статуса пользователя:', error);
        showNotification(error.message || 'Ошибка изменения статуса пользователя', 'error');
        await loadUsers();
    }
}

function resetEditedUserPermissions() {
    if (!editingUser) {
        showNotification('Пользователь не выбран', 'warning');
        return;
    }
    if (!requirePermission('users', 'permissions', 'Недостаточно прав для настройки прав доступа')) return;

    RBAC.resetUserCustomPermissions(editingUser.id);
    editingUser = { ...editingUser, permissions: null };
    fillUserPermissionsForm(editingUser);
    showNotification('Кастомные права сброшены до прав роли', 'success');
}

async function handleUserEditFormSubmit(event) {
    event.preventDefault();

    if (!requirePermission('users', 'edit', 'Недостаточно прав для редактирования пользователей')) return;

    if (!editingUser) {
        showNotification('Не выбран пользователь для редактирования', 'warning');
        return;
    }

    const username = document.getElementById('editUsername').value.trim();
    const role = document.getElementById('editUserRole').value;
    const password = document.getElementById('editUserPassword').value;
    const confirmPassword = document.getElementById('editUserPasswordConfirm').value;
    const active = document.getElementById('editUserActive').checked;

    if (!username) {
        showNotification('Введите имя пользователя', 'error');
        return;
    }

    if (password && password !== confirmPassword) {
        showNotification('Пароль и подтверждение не совпадают', 'error');
        return;
    }

    try {
        const canEditUserPermissions = RBAC.hasPermission('users', 'permissions');
        const collectedPermissions = canEditUserPermissions ? collectPermissionsFromForm() : null;
        const defaultPermissions = RBAC.getDefaultPermissionsForRole(role);
        const nextPermissions = canEditUserPermissions
            ? (arePermissionsEqual(collectedPermissions, defaultPermissions) ? null : collectedPermissions)
            : undefined;

        await apiFetch(`/api/users/${editingUser.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                username,
                role,
                active,
                ...(canEditUserPermissions ? { permissions: nextPermissions } : {}),
                ...(password ? { password } : {})
            })
        });

        if (canEditUserPermissions) {
            RBAC.setUserCustomPermissions(editingUser.id, nextPermissions);
        }

        if (String(editingUser.id) === String(RBAC.getCurrentUser().id)) {
            currentUserRole = role;
            localStorage.setItem('authRole', currentUserRole);
            RBAC.initializeUser({
                id: editingUser.id,
                username,
                role,
                active,
                permissions: canEditUserPermissions ? nextPermissions : RBAC.getCurrentUser().permissions
            });
            updateUIByPermissions();
        }

        closeUserEditModal();
        await loadUsers();
        showNotification('Пользователь обновлён', 'success');
    } catch (error) {
        console.error('Ошибка обновления пользователя:', error);
        showNotification(error.message || 'Ошибка при обновлении пользователя', 'error');
    }
}

function deleteUser(userId) {
    if (!requirePermission('users', 'delete', 'Недостаточно прав для удаления пользователей')) return;
    const user = usersList.find(entry => String(entry.id) === String(userId));
    if (!user) return;

    showConfirmModal(
        'Удаление пользователя',
        `Удалить пользователя "${user.username}"?`,
        async () => {
            try {
                await apiFetch(`/api/users/${user.id}`, { method: 'DELETE' });
                if (editingUser && String(editingUser.id) === String(user.id)) {
                    closeUserEditModal();
                }
                await loadUsers();
                showNotification('Пользователь удалён', 'success');
            } catch (error) {
                console.error('Ошибка удаления пользователя:', error);
                showNotification(error.message || 'Ошибка при удалении пользователя', 'error');
            }
        }
    );
}

function deleteSelectedUser() {
    if (!editingUser) return;
    deleteUser(editingUser.id);
}

function resetSelectedUserPassword() {
    if (!editingUser) {
        showNotification('Пользователь не выбран', 'warning');
        return;
    }

    showConfirmModal(
        'Сброс пароля',
        `Сбросить пароль для пользователя "${editingUser.username}"?`,
        async () => {
            try {
                const result = await apiFetch(`/api/users/${editingUser.id}/reset-password`, {
                    method: 'POST',
                    body: JSON.stringify({})
                });
                showNotification(`Новый временный пароль: ${result.temporaryPassword}`, 'success');
            } catch (error) {
                console.error('Ошибка сброса пароля:', error);
                showNotification(error.message || 'Ошибка при сбросе пароля', 'error');
            }
        }
    );
}

// ============================================================================
// Rentals
// ============================================================================

function getRentalStatusOptions(currentStatus) {
    const statusList = ['Черновик', 'Проведен', 'Активна', 'Завершена', 'Просрочена'];
    return statusList.map(status => `
        <option value="${status}" ${status === currentStatus ? 'selected' : ''}>${status}</option>
    `).join('');
}

function getStatusMeta(status) {
    if (window.WarehouseStatuses?.getStatusMeta) {
        return window.WarehouseStatuses.getStatusMeta(status);
    }
    const value = String(status || '').trim();
    switch (value) {
        case 'Черновик':
            return { icon: '📝', label: 'Черновик', badgeClass: 'status-pill status-pill-draft', rowClass: 'status-draft-row' };
        case 'Проведен':
            return { icon: '✅', label: 'Проведен', badgeClass: 'status-pill status-pill-posted', rowClass: 'status-active' };
        case 'Активна':
        case 'Активно':
            return { icon: '▶️', label: value, badgeClass: 'status-pill status-pill-active', rowClass: 'status-active' };
        case 'Завершена':
        case 'Завершено':
            return { icon: '✔️', label: value, badgeClass: 'status-pill status-pill-completed', rowClass: 'status-completed' };
        case 'Просрочена':
        case 'Просрочено':
            return { icon: '⏰', label: value, badgeClass: 'status-pill status-pill-overdue', rowClass: 'status-overdue' };
        default:
            return { icon: '📝', label: value || 'Черновик', badgeClass: 'status-pill status-pill-draft', rowClass: 'status-default' };
    }
}

function renderStatusBadge(status) {
    if (window.WarehouseStatuses?.renderStatusBadge) {
        return window.WarehouseStatuses.renderStatusBadge(status);
    }
    const meta = getStatusMeta(status);
    return `<span class="${meta.badgeClass}"><span>${meta.icon}</span><span>${escapeHtml(meta.label)}</span></span>`;
}

function getRentalStatusClass(status) {
    if (window.WarehouseStatuses?.getRentalStatusClass) {
        return window.WarehouseStatuses.getRentalStatusClass(status);
    }
    return getStatusMeta(status).rowClass;
}

function readDocumentsRegistrySnapshot() {
    try {
        const raw = localStorage.getItem('warehouse_documents_registry_v1');
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('Не удалось прочитать реестр документов:', error);
        return [];
    }
}

function normalizeDocumentTypeForLinks(type) {
    const value = String(type || '').trim().toLowerCase();
    if (value === 'transfer') return 'transfer';
    if (value === 'acceptance') return 'acceptance';
    if (value === 'writeoff') return 'writeoff';
    return 'issuance';
}

function getDocumentTypeLabelForLinks(type) {
    switch (normalizeDocumentTypeForLinks(type)) {
        case 'transfer': return 'Акт передачи';
        case 'acceptance': return 'Акт приемки';
        case 'writeoff': return 'Акт списания';
        default: return 'Акт выдачи';
    }
}

function buildRelatedDocumentsTableHtml(rows, emptyMessage) {
    if (!rows.length) {
        return `<div class="related-documents-empty">${escapeHtml(emptyMessage)}</div>`;
    }

    return `
        <div class="report-table-wrapper">
            <table class="report-table related-documents-table">
                <thead>
                    <tr>
                        <th>Тип</th>
                        <th>Номер</th>
                        <th>Дата</th>
                        <th>Статус</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr class="${String(row.status || '').trim() === 'Отменен' ? 'related-documents-row-cancelled' : ''}">
                            <td>${escapeHtml(getDocumentTypeLabelForLinks(row.docType))}</td>
                            <td>${escapeHtml(row.number || '—')}</td>
                            <td>${escapeHtml(formatDateTime(row.date || row.createdAt || '', '—'))}</td>
                            <td>${escapeHtml(row.status || 'Проведен')}</td>
                            <td>
                                <button type="button" class="inline-action-btn related-doc-open-btn" data-number="${escapeHtml(String(row.number || '')).replace(/'/g, '&#39;')}">📄 Открыть</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function openRelatedDocumentByNumber(number) {
    if (!number) return;

    const normalizedNumber = String(number || '').trim();
    if (/^(АС-|AC-)/i.test(normalizedNumber) && typeof window.openWriteoffActDetailsByNumber === 'function') {
        await window.openWriteoffActDetailsByNumber(normalizedNumber);
        return;
    }

    if (typeof window.openDocumentCardByNumber === 'function') {
        await window.openDocumentCardByNumber(normalizedNumber);
        return;
    }

    showNotification('Модуль документов пока недоступен', 'warning');
    if (typeof showPage === 'function') {
        showPage('documentsHub');
    }
}

async function getWriteoffDocumentsByBasis(entityType, entity) {
    const entityId = Number(entity?.id || 0);
    const acceptanceNumber = String(entity?.acceptance_act_number || entity?.acceptanceActNumber || '').trim().toUpperCase();
    if (!entityId && !acceptanceNumber) return [];

    try {
        const rows = await apiFetch(`/api/inventory/writeoff-acts?basisType=${encodeURIComponent(entityType)}`);
        return (Array.isArray(rows) ? rows : [])
            .filter(row => {
                const headerType = String(row?.basis?.type || '').trim().toLowerCase();
                const headerId = Number(row?.basis?.id || 0);
                const headerAct = String(row?.basis?.actNumber || '').trim().toUpperCase();
                const matchesHeader = (headerType === entityType && entityId > 0 && headerId === entityId)
                    || (acceptanceNumber && headerAct === acceptanceNumber);
                const matchesItems = Array.isArray(row?.items) && row.items.some(item => (
                    ((String(item?.basisType || item?.basis_type || '').trim() === entityType
                        && entityId > 0
                        && Number(item?.basisId || item?.basis_id || 0) === entityId)
                    || (acceptanceNumber
                        && String(item?.basisActNumber || item?.basis_act_number || '').trim().toUpperCase() === acceptanceNumber))
                ));
                return matchesHeader || matchesItems;
            })
            .map(row => ({
                docType: 'writeoff',
                number: row.number || row.act_number || '',
                date: row.date || row.createdAt || row.act_date || '',
                status: String(row.status || 'Проведен').trim() || 'Проведен'
            }))
            .filter(row => row.number);
    } catch (error) {
        console.warn('Не удалось загрузить акты списания:', error);
        return [];
    }
}

async function loadRelatedDocumentsForEntity(entityType, entity, sectionId, listId) {
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);
    if (!section || !list) return;

    if (!entity?.id) {
        section.style.display = 'block';
        list.innerHTML = '<div class="related-documents-empty">Нет связанных документов. Для создания документа используйте кнопку "Провести".</div>';
        return;
    }

    section.style.display = 'block';
    list.textContent = 'Загрузка...';

    const registry = readDocumentsRegistrySnapshot();
    const registryDocs = registry
        .filter(doc => String(doc?.basisType || '').trim() === entityType && Number(doc?.basisId || doc?.entity?.id || 0) === Number(entity.id))
        .map(doc => ({
            docType: normalizeDocumentTypeForLinks(doc.docType),
            number: String(doc.number || '').trim(),
            date: doc.date || doc.createdAt || '',
            status: String(doc.status || '').trim() || 'Проведен'
        }))
        .filter(doc => doc.number);

    const writeoffDocs = await getWriteoffDocumentsByBasis(entityType, entity);
    const docs = [...registryDocs, ...writeoffDocs]
        .filter((doc, index, arr) => arr.findIndex(item => item.number === doc.number && item.docType === doc.docType) === index)
        .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));

    list.innerHTML = buildRelatedDocumentsTableHtml(docs, 'Нет связанных документов. Для создания документа используйте кнопку "Провести".');

    list.querySelectorAll('.related-doc-open-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const number = String(button.dataset.number || '').trim();
            await openRelatedDocumentByNumber(number);
        });
    });
}

async function refreshOpenEntityRelatedDocuments() {
    try {
        const rentalModalVisible = document.getElementById('rentalModal')?.style.display === 'block';
        const eventModalVisible = document.getElementById('eventModal')?.style.display === 'block';

        if (rentalModalVisible && editingRental?.id) {
            await loadRelatedDocumentsForEntity('rental', editingRental, 'rentalRelatedDocumentsSection', 'rentalRelatedDocumentsList');
        }

        if (eventModalVisible && editingEvent?.id) {
            await loadRelatedDocumentsForEntity('event', editingEvent, 'eventRelatedDocumentsSection', 'eventRelatedDocumentsList');
        }
    } catch (error) {
        console.warn('Не удалось обновить связанные документы в открытой карточке:', error);
    }
}

window.refreshOpenEntityRelatedDocuments = refreshOpenEntityRelatedDocuments;

function renderRentalsTable() {
    const tableBody = document.getElementById('tableRentals');
    if (!tableBody) return;

    populateRentalFilterOptions();

    const filters = getRentalsFilters();
    const searchValue = String(filters.search || '').toLowerCase();
    const dateFrom = parseDateValue(filters.dateFrom);
    const dateTo = parseDateValue(filters.dateTo);

    const filteredRentals = rentals
        .map((rental, index) => ({ rental, index }))
        .filter(({ rental }) => {
            const itemsText = (rental.items || [])
                .map(item => `${item.item_name || item.name || 'Объект'} (${item.quantity || 0})`)
                .join(', ');

            const startDate = parseDateValue(rental.start_date);
            const matchesSearch = !searchValue || itemsText.toLowerCase().includes(searchValue);
            const matchesStatus = !filters.status || rental.status === filters.status;
            const matchesClient = !filters.clientId || String(rental.client_id || '') === String(filters.clientId);
            const matchesEmployee = !filters.employeeId || String(rental.employee_id || '') === String(filters.employeeId);
            const matchesDateFrom = !dateFrom || (startDate && startDate.getTime() >= dateFrom.getTime());
            const matchesDateTo = !dateTo || (startDate && startDate.getTime() <= dateTo.getTime());

            return matchesSearch && matchesStatus && matchesClient && matchesEmployee && matchesDateFrom && matchesDateTo;
        });

    tableBody.innerHTML = '';

    if (filteredRentals.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="empty-table-message">По заданным фильтрам аренда не найдена. Что сделать: сбросьте фильтры или нажмите «Добавить аренду».</td></tr>';
        return;
    }

    filteredRentals.forEach(({ rental, index }) => {
        const row = document.createElement('tr');
        row.className = getRentalStatusClass(rental.status);

        const itemsText = (rental.items || [])
            .map(item => `${item.item_name || item.name || 'Объект'} (${item.quantity || 0})`)
            .join(', ') || 'Нет позиций';

        const canConductRental = RBAC.hasPermission('rental', 'changeStatus')
            && (
                isDraftStatus(rental.status)
                || isRentalCompletedStatus(rental.status)
                || isRentalActiveStatus(rental.status)
                || isPlannedStatus(rental.status)
            );

        const conductBlockReason = canConductRental ? '' : getConductBlockReason('rental', rental);
        row.innerHTML = `
            <td><input type="checkbox" class="rental-checkbox" data-index="${index}"></td>
            <td>${escapeHtml(itemsText)}</td>
            <td>${escapeHtml(rental.client_name || '')}</td>
            <td class="datetime-display">${escapeHtml(formatDateTime(rental.start_date, '—'))}</td>
            <td class="datetime-display">${escapeHtml(formatDateTime(rental.end_date, '—'))}</td>
            <td>${escapeHtml(rental.employee_name || '')}</td>
            <td title="${escapeHtml(getEntityStatusTooltip('rental', rental))}">${renderStatusBadge(rental.status)} ${getEntityDocumentBadges('rental', rental)}</td>
            <td>
                ${RBAC.hasPermission('rental', 'edit') ? '<button type="button" class="inline-action-btn rental-edit-btn">Открыть</button>' : ''}
                ${canConductRental
                    ? '<button type="button" class="inline-action-btn rental-conduct-btn">Провести</button>'
                    : `<button type="button" class="inline-action-btn" disabled title="${escapeHtml(conductBlockReason || 'Недоступно для текущего статуса')}">Провести</button>`}
            </td>
        `;

        row.addEventListener('dblclick', () => openEditRentalModal(rental));
        tableBody.appendChild(row);

        row.querySelector('.rental-edit-btn')?.addEventListener('click', async (event) => {
            event.stopPropagation();
            await openEditRentalModal(rental);
        });

        row.querySelector('.rental-conduct-btn')?.addEventListener('click', async (event) => {
            event.stopPropagation();

            const status = String(rental.status || '').trim();
            const isActive = isRentalActiveStatus(status);
            const isPlannedOrDraft = isDraftStatus(status) || isPlannedStatus(status);

            if (isRentalCompletedStatus(rental.status)) {
                const issuanceBefore = hasIssuanceDocumentForEntity('rental', rental);
                const acceptanceBefore = hasAcceptanceDocumentForEntity('rental', rental);
                const issuanceNumber = issuanceBefore ? '' : ensureIssuanceDocumentRecord('rental', rental);
                const acceptanceNumber = acceptanceBefore ? '' : ensureAcceptanceDocumentRecord('rental', rental);
                rental.issuance_act_number = issuanceNumber || rental.issuance_act_number;
                rental.acceptance_act_number = acceptanceNumber || rental.acceptance_act_number;
                renderRentalsTable();

                if (issuanceBefore && acceptanceBefore) {
                    showNotification('Для завершенной аренды оба документа уже проведены.', 'info');
                } else {
                    showNotification('Для завершенной аренды проведены недостающие документы (акт передачи/выдачи и акт приемки).', 'success');
                }
                return;
            }

            if (isActive) {
                const acceptanceNumber = String(rental.acceptance_act_number || rental.acceptanceActNumber || '').trim()
                    || (typeof generateAcceptanceActNumber === 'function' ? generateAcceptanceActNumber() : '');

                await apiFetch(`/api/rentals/${rental.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: 'Завершена',
                        items: Array.isArray(rental.items) ? rental.items : [],
                        acceptance_act_number: acceptanceNumber
                    })
                });

                if (!hasAcceptanceDocumentForEntity('rental', rental)) {
                    const number = ensureAcceptanceDocumentRecord('rental', {
                        ...rental,
                        acceptance_act_number: acceptanceNumber
                    });
                    rental.acceptance_act_number = number || acceptanceNumber || rental.acceptance_act_number;
                }

                await loadData();
                showNotification('Статус аренды изменён на «Завершена», акт приемки создан/актуализирован.', 'success');
                return;
            }

            if (isPlannedOrDraft) {
                await updateRentalStatus(rental.id, 'Активна', rental);
                await loadData();
                return;
            }

            await updateRentalStatus(rental.id, 'Активна', rental);
        });
    });
}

async function updateRentalStatus(rentalId, status, rental) {
    if (status === 'Завершена') {
        const selectElement = document.querySelector(`.rental-status-select[data-id="${rentalId}"]`);
        if (selectElement) {
            selectElement.value = rental.status || 'Черновик';
        }
        await openEditRentalModal({ ...rental, status }, { forceCompletion: true });
        showNotification('Заполните состояние объектов и сохраните аренду, чтобы завершить её корректно.', 'warning');
        return;
    }

    try {
        if ((status === 'Активна' || status === 'Проведен' || status === 'Просрочена') && rental?.issuance_act_id) {
            showNotification('Документ уже проведен. Изменения можно внести только через корректировку.', 'warning');
            return;
        }

        await apiFetch(`/api/rentals/${rentalId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status }),
            timeoutMs: API_FAST_TIMEOUT_MS
        });

        rental.status = status;
        renderRentalsTable();
        saveLocalBackup();
        showNotification('Статус аренды обновлён', 'success');
    } catch (error) {
        console.error('Ошибка обновления статуса аренды:', error);
        showNotification(error.message || 'Ошибка при обновлении статуса', 'error');
        await loadData();
    }
}

async function populateClientsSelect() {
    if (clients.length === 0) await fetchClients(false);

    const select = document.getElementById('rentalClient');
    select.innerHTML = '<option value="">Выберите клиента</option>';

    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        select.appendChild(option);
    });
}

async function populateEmployeesSelect() {
    if (employees.length === 0) await fetchEmployees(false);

    const select = document.getElementById('rentalEmployee');
    select.innerHTML = '<option value="">Выберите сотрудника</option>';

    employees.forEach(employee => {
        const option = document.createElement('option');
        option.value = employee.id;
        option.textContent = employee.name;
        select.appendChild(option);
    });
}

const ITEM_CONDITION_OPTIONS = ['Хорошее', 'Повреждено', 'Утрачено'];
const ASSET_WRITEOFF_REASONS = [
    'Поломка',
    'Износ',
    'Утеря',
    'Истек срок эксплуатации',
    'Кража',
    'Невозврат',
    'Деформация',
    'Загрязнение',
    'Технологическая авария',
    'Истек срок годности',
    'Непригодно после эксплуатации'
];

function isDraftStatus(status) {
    return String(status || '').trim() === 'Черновик';
}

function isRentalCompletedStatus(status) {
    return String(status || '').trim() === 'Завершена';
}

function isEventCompletedStatus(status) {
    return String(status || '').trim() === 'Завершено';
}

function isPlannedStatus(status) {
    return String(status || '').trim() === 'Планируется';
}

function isRentalActiveStatus(status) {
    const normalized = String(status || '').trim();
    return normalized === 'Активна' || normalized === 'Активно';
}

function isEventActiveStatus(status) {
    const normalized = String(status || '').trim();
    return normalized === 'Активно' || normalized === 'Активна';
}

function isRentalConductedStatus(status) {
    return ['Проведен', 'Активна', 'Просрочена', 'Завершена'].includes(String(status || '').trim());
}

function isEventConductedStatus(status) {
    return ['Проведен', 'Активно', 'Просрочена', 'Завершено'].includes(String(status || '').trim());
}

function getConductBlockReason(entityType, entity) {
    const items = Array.isArray(entity?.items) ? entity.items : [];
    if (!items.length) return 'Добавьте хотя бы одну позицию.';
    const hasInvalidRows = items.some(item => !String(item?.item_id || item?.itemId || '').trim() || Number(item?.quantity || 0) <= 0);
    if (hasInvalidRows) return 'Заполните корректные позиции и количество.';
    if (entityType === 'rental' && !String(entity?.client_id || '').trim()) return 'Укажите клиента.';
    if (!String(entity?.employee_id || '').trim()) return 'Укажите ответственного сотрудника.';
    return '';
}

function getEntityStatusTooltip(entityType, entity) {
    const status = String(entity?.status || '').trim();
    const reason = getConductBlockReason(entityType, entity);
    if (reason) return `Проведение недоступно: ${reason}`;
    if (!status || status === 'Черновик') return 'Черновик: можно редактировать и проводить после проверки.';
    if (status === 'Проведен') return 'Документ проведен и готов к дальнейшему жизненному циклу.';
    if (status === 'Активна' || status === 'Активно') return 'Документ активен: следующий шаг — приемка и завершение.';
    if (status === 'Завершена' || status === 'Завершено') return 'Документ завершен.';
    if (status === 'Просрочена') return 'Срок операции просрочен. Проверьте возврат и обновите статус.';
    return `Текущий статус: ${status}`;
}

function requiresIssueConditionCapture(entityType, status) {
    const normalized = String(status || '').trim();
    if (entityType === 'rental') {
        return isRentalActiveStatus(normalized) || isRentalCompletedStatus(normalized);
    }
    return isEventActiveStatus(normalized) || isEventCompletedStatus(normalized);
}

function getEntityCommentStage(entityType, status) {
    const normalized = String(status || '').trim();
    if (entityType === 'rental') {
        if (isRentalCompletedStatus(normalized)) return 'acceptance';
        if (isRentalConductedStatus(normalized)) return 'writeoff';
        return 'issue';
    }

    if (isEventCompletedStatus(normalized)) return 'acceptance';
    if (isEventConductedStatus(normalized)) return 'writeoff';
    return 'issue';
}

function applyRowCommentStage(row, entityType) {
    if (!row) return;

    const statusId = entityType === 'event' ? 'eventStatus' : 'rentalStatus';
    const status = document.getElementById(statusId)?.value || 'Черновик';
    const stage = getEntityCommentStage(entityType, status);

    const issueButton = row.querySelector('.doc-note-button[data-note-role="issue"]');
    const writeoffButton = row.querySelector('.doc-note-button[data-note-role="writeoff"]');
    const acceptanceButton = row.querySelector('.doc-note-button[data-note-role="acceptance"]');

    const issueInput = row.querySelector('.issue-comment-input');
    const writeoffInput = row.querySelector('.writeoff-comment-input');
    const acceptanceInput = row.querySelector('.acceptance-comment-input');

    const itemSelect = row.querySelector(entityType === 'event' ? '.event-item-select' : '.item-select');
    const selectedItem = findInventoryItem(itemSelect?.value);
    const isAsset = String(selectedItem?.type || '').toLowerCase() === 'asset';
    const issueCondition = String(
        row.querySelector(entityType === 'event' ? '.event-issue-condition-input' : '.item-issue-condition-input')?.value || 'Хорошее'
    ).trim();
    const actualCondition = String(
        row.querySelector(entityType === 'event' ? '.event-condition-select' : '.item-condition-select')?.value || issueCondition || 'Хорошее'
    ).trim();
    const isGoodToGoodAsset = isAsset && issueCondition === 'Хорошее' && actualCondition === 'Хорошее';

    const showIssue = stage === 'issue' || stage === 'writeoff' || stage === 'acceptance';
    const showWriteoff = (stage === 'writeoff' || stage === 'acceptance') && !isGoodToGoodAsset;
    const showAcceptance = stage === 'acceptance';

    if (issueButton) issueButton.style.display = showIssue ? '' : 'none';
    if (writeoffButton) writeoffButton.style.display = showWriteoff ? '' : 'none';
    if (acceptanceButton) acceptanceButton.style.display = showAcceptance ? '' : 'none';

    if (issueInput) issueInput.disabled = !showIssue;
    if (writeoffInput) writeoffInput.disabled = !showWriteoff;
    if (acceptanceInput) acceptanceInput.disabled = !showAcceptance;
}

function setEntityCardEditMode(entityType, editable) {
    const isRental = entityType === 'rental';
    const formId = isRental ? 'rentalForm' : 'eventForm';
    const form = document.getElementById(formId);
    if (!form) return;

    const editBtn = document.getElementById(isRental ? 'rentalEditModeBtn' : 'eventEditModeBtn');
    const saveBtn = document.getElementById(isRental ? 'rentalSaveBtn' : 'eventSaveBtn');
    const postBtn = document.getElementById(isRental ? 'rentalPostBtn' : 'eventPostBtn');
    const unpostBtn = document.getElementById(isRental ? 'rentalUnpostBtn' : 'eventUnpostBtn');
    const addItemBtn = document.getElementById(isRental ? 'rentalAddItemBtn' : 'eventAddItemBtn');
    const currentStatus = document.getElementById(isRental ? 'rentalStatus' : 'eventStatus')?.value || 'Черновик';
    const originalStatus = isRental ? editingRental?.status : editingEvent?.status;
    const canPostDraftFromReadonly = isDraftStatus(currentStatus) && isDraftStatus(originalStatus);
    
    // Фильтры и поиск
    const categoryFilter = document.getElementById(isRental ? 'itemCategoryFilter' : 'eventItemCategoryFilter');
    const searchInput = document.getElementById(isRental ? 'itemSearchInput' : 'eventItemSearchInput');
    
    // Контейнер с фильтрами
    const filterContainer = isRental 
        ? document.querySelector('[id*="itemCategoryFilter"]')?.parentElement?.parentElement
        : document.querySelector('[id*="eventItemCategoryFilter"]')?.parentElement?.parentElement;

    form.dataset.readonlyMode = editable ? '0' : '1';

    if (editable) {
        form.querySelectorAll('[data-readonly-lock="1"]').forEach(element => {
            element.disabled = false;
            element.removeAttribute('data-readonly-lock');
        });

        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = '';

        const statusValue = document.getElementById(isRental ? 'rentalStatus' : 'eventStatus')?.value || 'Черновик';
        if (isRental) updateRentalStatusInfoBlock(statusValue);
        else updateEventStatusInfoBlock(statusValue);

        if (addItemBtn) addItemBtn.style.display = '';
        if (categoryFilter) categoryFilter.style.display = '';
        if (searchInput) searchInput.style.display = '';
        
        // Показываем кнопки удаления в каждой строке
        const bodyId = isRental ? 'rentalItemsBody' : 'eventItemsBody';
        document.getElementById(bodyId)?.querySelectorAll('button[onclick*="removeRentalItem"], button[onclick*="removeEventItem"]').forEach(btn => {
            btn.style.display = '';
        });
        
        return;
    }

    const keepEnabled = (element) => {
        if (!element) return false;
        if (element.id === (isRental ? 'rentalEditModeBtn' : 'eventEditModeBtn')) return true;
        if (element.id === (isRental ? 'rentalCloseBtn' : 'eventCloseBtn')) return true;
        if (canPostDraftFromReadonly && element.id === (isRental ? 'rentalPostBtn' : 'eventPostBtn')) return true;
        if (element.classList.contains('related-doc-open-btn')) return true;
        return false;
    };

    form.querySelectorAll('input, select, textarea, button').forEach(element => {
        if (keepEnabled(element)) return;
        if (element.disabled) return;
        element.dataset.readonlyLock = '1';
        element.disabled = true;
    });

    if (editBtn) editBtn.style.display = '';
    if (saveBtn) saveBtn.style.display = 'none';
    if (postBtn) {
        postBtn.style.display = canPostDraftFromReadonly ? '' : 'none';
        postBtn.disabled = !canPostDraftFromReadonly;
    }
    if (unpostBtn) unpostBtn.style.display = 'none';
    if (addItemBtn) addItemBtn.style.display = 'none';
    if (categoryFilter) categoryFilter.style.display = 'none';
    if (searchInput) searchInput.style.display = 'none';
    
    // Скрываем кнопки удаления в каждой строке
    const bodyId = isRental ? 'rentalItemsBody' : 'eventItemsBody';
    document.getElementById(bodyId)?.querySelectorAll('button[onclick*="removeRentalItem"], button[onclick*="removeEventItem"]').forEach(btn => {
        btn.style.display = 'none';
    });
}

function enableRentalEditMode() {
    const title = document.getElementById('rentalModalTitle');
    if (title) title.textContent = 'Редактировать аренду';
    setEntityCardEditMode('rental', true);
    showNotification('Режим редактирования аренды включен', 'info');
}

function enableEventEditMode() {
    const title = document.getElementById('eventModalTitle');
    if (title) title.textContent = 'Редактировать мероприятие';
    setEntityCardEditMode('event', true);
    showNotification('Режим редактирования мероприятия включен', 'info');
}

function buildStatusInfoHtml(entityType, status, context = {}) {
    const safeDocNumber = escapeHtml(context.docNumber || 'будет сформирован при проведении');
    if (isDraftStatus(status)) {
        return {
            className: 'draft',
            html: `
                <div class="record-status-title">📝 ВНИМАНИЕ: Это черновик.</div>
                <div>Документы еще не созданы. Остатки на складе не изменены.</div>
                <div>Нажмите «Провести», чтобы создать документы.</div>
            `
        };
    }

    if (String(status || '').trim() === 'Проведен') {
        return {
            className: 'posted',
            html: `
                <div class="record-status-title">✅ Документ проведен.</div>
                <div>Документ № ${safeDocNumber} создан.</div>
                <div>Остатки на складе уменьшены.</div>
            `
        };
    }

    if ((entityType === 'rental' && String(status || '').trim() === 'Активна') || (entityType === 'event' && String(status || '').trim() === 'Активно')) {
        return {
            className: 'active',
            html: `
                <div class="record-status-title">▶️ Документ активен.</div>
                <div>Выдача оформлена. Возврат фиксируется через завершение записи.</div>
                <div>Кнопка «Завершить» доступна через смену статуса на завершенный.</div>
            `
        };
    }

    return {
        className: 'posted',
        html: `
            <div class="record-status-title">✔️ Статус: ${escapeHtml(String(status || '—'))}</div>
            <div>Запись оформлена и доступна для просмотра/редактирования.</div>
        `
    };
}

function updateRentalStatusInfoBlock(status, context = {}) {
    const block = document.getElementById('rentalStatusInfoBlock');
    const postBtn = document.getElementById('rentalPostBtn');
    const unpostBtn = document.getElementById('rentalUnpostBtn');
    if (!block) return;

    const info = buildStatusInfoHtml('rental', status, context);
    block.style.display = 'block';
    block.className = `record-status-info ${info.className}`;
    const showIssueWriteoffPreview = String(status || '').trim() === 'Проведен' || String(status || '').trim() === 'Активна';
    block.innerHTML = `${info.html}${showIssueWriteoffPreview ? buildPendingWriteoffPreviewHtml('rental') : ''}`;

    if (postBtn) {
        // Показываем «Провести» только если запись новая или оригинальный статус черновик
        const originalIsDraft = !editingRental?.id || isDraftStatus(editingRental?.status);
        postBtn.disabled = !originalIsDraft;
        postBtn.style.display = originalIsDraft ? '' : 'none';
    }

    if (unpostBtn) {
        const canUnpost = Boolean(editingRental?.id && editingRental?.issuance_act_id);
        unpostBtn.style.display = canUnpost ? '' : 'none';
        unpostBtn.disabled = !canUnpost;
    }
}

function updateEventStatusInfoBlock(status, context = {}) {
    const block = document.getElementById('eventStatusInfoBlock');
    const postBtn = document.getElementById('eventPostBtn');
    const unpostBtn = document.getElementById('eventUnpostBtn');
    if (!block) return;

    const info = buildStatusInfoHtml('event', status, context);
    block.style.display = 'block';
    block.className = `record-status-info ${info.className}`;
    const showIssueWriteoffPreview = String(status || '').trim() === 'Проведен' || String(status || '').trim() === 'Активно';
    block.innerHTML = `${info.html}${showIssueWriteoffPreview ? buildPendingWriteoffPreviewHtml('event') : ''}`;

    if (postBtn) {
        // Показываем «Провести» только если запись новая или оригинальный статус черновик
        const originalIsDraft = !editingEvent?.id || isDraftStatus(editingEvent?.status);
        postBtn.disabled = !originalIsDraft;
        postBtn.style.display = originalIsDraft ? '' : 'none';
    }

    if (unpostBtn) {
        const canUnpost = Boolean(editingEvent?.id && editingEvent?.issuance_act_id);
        unpostBtn.style.display = canUnpost ? '' : 'none';
        unpostBtn.disabled = !canUnpost;
    }
}

function buildPendingWriteoffPreviewHtml(entityType) {
    const selector = entityType === 'event' ? '#eventItemsBody tr' : '#rentalItemsBody tr';
    const rows = Array.from(document.querySelectorAll(selector));
    if (!rows.length) return '';

    const lines = [];
    for (const row of rows) {
        const select = row.querySelector(entityType === 'event' ? '.event-item-select' : '.item-select');
        const qtyInput = row.querySelector(entityType === 'event' ? '.event-quantity-input' : '.quantity-input');
        const conditionSelect = row.querySelector(entityType === 'event' ? '.event-condition-select' : '.item-condition-select');
        const reasonSelect = row.querySelector('.writeoff-reason-select');
        const item = findInventoryItem(select?.value || '');
        if (!item) continue;

        const qty = Math.max(0, Number(qtyInput?.value || 0));
        if (qty <= 0) continue;

        const type = String(item.type || '').toLowerCase() === 'consumable' ? 'расходник' : 'ОС';
        const writeoffReason = String(reasonSelect?.value || '').trim();

        const autoWriteoffConsumable = type === 'расходник';
        if (!autoWriteoffConsumable) continue;

        const reasonLabel = writeoffReason || 'Использован';

        lines.push(`• ${escapeHtml(item.name || item.id)} (${type}) — ${qty} шт. (${escapeHtml(reasonLabel)})`);
    }

    if (!lines.length) return '';

    return `
        <div class="pending-writeoff-preview">
            <div class="pending-writeoff-preview-title">📋 Автосписание расходников</div>
            <div>При выдаче будут автоматически списаны:</div>
            <div class="pending-writeoff-preview-lines">${lines.join('<br>')}</div>
        </div>
    `;
}

function getFilteredInventory(categoryFilterId, searchInputId) {
    const categoryValue = document.getElementById(categoryFilterId)?.value || '';
    const searchValue = (document.getElementById(searchInputId)?.value || '').toLowerCase();

    return inventory.filter(item => {
        if (item.isWriteoffMarker === true) return false;
        const matchesCategory = !categoryValue || item.category === categoryValue;
        const matchesText = !searchValue || item.name.toLowerCase().includes(searchValue);
        return matchesCategory && matchesText;
    });
}

function findInventoryItem(itemId) {
    const rawId = String(itemId || '').trim();
    if (!rawId) return null;

    const markerMatch = rawId.match(/^WO-\d+-(.+)$/i);
    const markerSourceId = markerMatch?.[1] ? String(markerMatch[1]).trim() : '';
    const normalizedName = rawId.replace(/\s*\[к\s*списанию\]\s*$/i, '').trim().toLowerCase();
    const candidateIds = [rawId, markerSourceId]
        .map(value => String(value || '').trim())
        .filter(Boolean);

    return inventory.find(item => {
        const id = String(item?.id || '').trim();
        const sourceId = String(item?.sourceItemId || item?.source_item_id || '').trim();
        const name = String(item?.name || '').trim().toLowerCase();
        const baseName = name.replace(/\s*\[к\s*списанию\]\s*$/i, '').trim();

        if (candidateIds.includes(id)) return true;
        if (sourceId && candidateIds.includes(sourceId)) return true;
        if (normalizedName && (name === normalizedName || baseName === normalizedName)) return true;
        return false;
    }) || null;
}

function findRentalById(rentalId) {
    return rentals.find(item => String(item?.id || '') === String(rentalId || '')) || null;
}

function findEventById(eventId) {
    return events.find(item => String(item?.id || '') === String(eventId || '')) || null;
}

window.findInventoryItem = findInventoryItem;
window.findRentalById = findRentalById;
window.findEventById = findEventById;

function buildInventoryOptions(selectedId, categoryFilterId, searchInputId) {
    const filteredItems = getFilteredInventory(categoryFilterId, searchInputId);
    const selectedItem = findInventoryItem(selectedId);
    const itemsForOptions = [...filteredItems];

    if (selectedItem && !itemsForOptions.some(item => String(item.id) === String(selectedItem.id))) {
        itemsForOptions.unshift(selectedItem);
    }

    const seenIds = new Set();
    return ['<option value="">Выберите объект</option>']
        .concat(itemsForOptions.filter(item => {
            if (seenIds.has(String(item.id))) return false;
            seenIds.add(String(item.id));
            return true;
        }).map(item => {
            const isSelected = String(item.id) === String(selectedId);
            const suffix = isSelected && selectedItem && !filteredItems.some(entry => String(entry.id) === String(item.id))
                ? ' • уже выбран'
                : '';
            const available = Math.max(0, Number(item.availableQuantity ?? item.quantity ?? item.stock ?? 0));
            return `
                <option value="${item.id}" ${isSelected ? 'selected' : ''}>
                    ${escapeHtml(item.name)} (${available} шт.)${suffix}
                </option>
            `;
        }))
        .join('');
}

function getConditionOptionsHtml(selectedValue = 'Хорошее') {
    const hasSelected = ITEM_CONDITION_OPTIONS.includes(String(selectedValue || '').trim());
    const placeholderOption = `<option value="" ${hasSelected ? '' : 'selected'}>Выбрать</option>`;
    return `${placeholderOption}${ITEM_CONDITION_OPTIONS.map(option => `
        <option value="${option}" ${option === selectedValue ? 'selected' : ''}>${option}</option>
    `).join('')}`;
}

function normalizeWriteoffDecision(value, fallback = 'writeoff') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'keep' || normalized === 'не списывать') return 'keep';
    if (normalized === 'writeoff' || normalized === 'списывать') return 'writeoff';
    return fallback;
}

function getWriteoffDecisionOptionsHtml(selectedValue = 'writeoff') {
    const normalized = normalizeWriteoffDecision(selectedValue, 'writeoff');
    return `
        <option value="writeoff" ${normalized === 'writeoff' ? 'selected' : ''}>Списывать</option>
        <option value="keep" ${normalized === 'keep' ? 'selected' : ''}>Не списывать</option>
    `;
}

function getEntityCompletionValidation(entityType) {
    const isEvent = entityType === 'event';
    const bodySelector = isEvent ? '#eventItemsBody' : '#rentalItemsBody';
    const selectSelector = isEvent ? '.event-item-select' : '.item-select';
    const qtySelector = isEvent ? '.event-quantity-input' : '.quantity-input';
    const conditionSelector = isEvent ? '.event-condition-select' : '.item-condition-select';

    for (const row of Array.from(document.querySelectorAll(`${bodySelector} tr`))) {
        const itemId = String(row.querySelector(selectSelector)?.value || '').trim();
        if (!itemId) continue;

        const item = findInventoryItem(itemId);
        if (!item) continue;

        const isAsset = String(item.type || '').toLowerCase() === 'asset';
        if (!isAsset) continue;

        const qty = Math.max(0, Number(row.querySelector(qtySelector)?.value || 0));
        if (qty <= 0) continue;

        const actualCondition = String(row.querySelector(conditionSelector)?.value || '').trim();
        if (!actualCondition) {
            return { ready: false, message: `Заполните поле «Состояние ПОСЛЕ» для «${item.name || item.id}».` };
        }

        if (actualCondition !== 'Хорошее') {
            const decision = normalizeWriteoffDecision(row.querySelector('.writeoff-decision-select')?.value || 'writeoff');
            if (decision === 'writeoff') {
                const defectiveQuantity = Math.max(0, Number(row.querySelector('.defect-quantity-input')?.value || 0));
                if (defectiveQuantity <= 0 || defectiveQuantity > qty) {
                    return { ready: false, message: `Для «${item.name || item.id}» укажите корректное «Кол-во к списанию» (1..${qty}).` };
                }
            }
        }
    }

    return { ready: true, message: '' };
}

function refreshEntityFinalizeButtonState(entityType) {
    const isEvent = entityType === 'event';
    const status = document.getElementById(isEvent ? 'eventStatus' : 'rentalStatus')?.value || 'Черновик';
    const postBtn = document.getElementById(isEvent ? 'eventPostBtn' : 'rentalPostBtn');
    const warningNode = document.getElementById(isEvent ? 'eventPostWarning' : 'rentalPostWarning');
    if (!postBtn) return;

    const isCompletionStage = isEvent ? isEventActiveStatus(status) : isRentalActiveStatus(status);
    const isPostingStage = isDraftStatus(status);
    if (!isCompletionStage && !isPostingStage) {
        postBtn.disabled = false;
        postBtn.title = '';
        if (warningNode) {
            warningNode.style.display = 'none';
            warningNode.textContent = '';
        }
        return;
    }

    const issues = collectEntityStockIssues(entityType, true);
    if (issues.length > 0) {
        const awaitingAct = issues.find(issue => issue.kind === 'awaiting_purchase_act' && issue.requestNumber);
        const awaiting = issues.find(issue => issue.kind === 'awaiting_purchase' && issue.requestNumber);
        postBtn.disabled = true;
        const warningText = awaitingAct
            ? `Поставка по заявке № ${awaitingAct.requestNumber} зафиксирована, но акт закупки еще не проведен. Проведение документа временно недоступно.`
            : awaiting
                ? `Ожидается поставка по заявке № ${awaiting.requestNumber}. Проведение документа временно недоступно.`
                : 'Исправьте проблемы с остатками перед завершением.';
        postBtn.title = warningText;
        if (warningNode) {
            warningNode.style.display = 'block';
            warningNode.textContent = warningText;
        }
        return;
    }

    const validation = getEntityCompletionValidation(entityType);
    if (isCompletionStage) {
        postBtn.disabled = !validation.ready;
        postBtn.title = validation.ready ? '' : validation.message;
        if (warningNode) {
            warningNode.style.display = validation.ready ? 'none' : 'block';
            warningNode.textContent = validation.ready ? '' : validation.message;
        }
        return;
    }

    postBtn.disabled = false;
    postBtn.title = '';
    if (warningNode) {
        warningNode.style.display = 'none';
        warningNode.textContent = '';
    }
}

function getLinkedPurchaseRequestRows(contextType) {
    const config = getEntityContextConfig(contextType);
    const rows = Array.from(document.querySelectorAll(`${config.bodySelector} tr`));
    const map = new Map();

    rows.forEach(row => {
        const requestNumber = getIssuePurchaseRequestNumber(row);
        if (!requestNumber) return;
        const select = row.querySelector(config.selectSelector);
        const quantityInput = row.querySelector(config.quantitySelector);
        const item = findInventoryItem(select?.value);
        const key = String(requestNumber || '').trim();
        if (!key) return;
        map.set(key, {
            number: key,
            status: getIssuePurchaseRequestStatus(row) || 'draft',
            itemName: item?.name || select?.value || 'Объект',
            quantity: Math.max(0, Number(quantityInput?.value || row.dataset.autoPurchaseShortage || 0))
        });
    });

    return Array.from(map.values());
}

function renderLinkedPurchaseRequests(contextType) {
    const listId = contextType === 'event'
        ? 'eventLinkedPurchaseRequestsList'
        : 'rentalLinkedPurchaseRequestsList';
    const listNode = document.getElementById(listId);
    if (!listNode) return;

    const linked = getLinkedPurchaseRequestRows(contextType);
    if (!linked.length) {
        listNode.textContent = 'Связанные заявки отсутствуют.';
        return;
    }

    listNode.innerHTML = linked.map(entry => {
        const statusLabel = entry.status ? ` • статус: ${entry.status}` : '';
        const qtyText = entry.quantity > 0 ? ` • ${entry.quantity} шт.` : '';
        const safeNumber = escapeHtml(String(entry.number || ''));
        const safeOpenNumber = String(entry.number || '').replace(/'/g, '\\\'');
        return `
            <div class="entity-issues-banner-row">
                <div>
                    <strong>№ ${safeNumber}</strong>${escapeHtml(statusLabel)}<br>
                    <span class="small-muted">${escapeHtml(entry.itemName || 'Объект')}${escapeHtml(qtyText)}</span>
                </div>
                <button type="button" class="inline-action-btn" onclick="openPurchaseRequestDocumentByNumber('${safeOpenNumber}')">Открыть</button>
            </div>
        `;
    }).join('');
}

function getWriteoffReasonOptionsHtml(selectedValue = 'Поломка') {
    return ASSET_WRITEOFF_REASONS.map(option => `
        <option value="${option}" ${option === selectedValue ? 'selected' : ''}>${option}</option>
    `).join('');
}

function getDefaultWriteoffReasonByCondition(condition) {
    const normalized = String(condition || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (normalized.includes('утрач')) return 'Невозврат';
    if (normalized.includes('повреж')) return 'Поломка';
    if (normalized.includes('ремонт')) return 'Требует ремонта';
    return 'Списание по решению руководства';
}

function getReturnStatusFromCondition(condition) {
    switch (condition) {
        case 'Утрачено':
            return 'Не возвращено';
        case 'Повреждено':
        case 'Требует ремонта':
            return 'Возвращено с замечаниями';
        default:
            return 'Возвращено';
    }
}

function getReservedQuantityForItem(bodySelector, selectSelector, quantitySelector, itemId, excludeRow = null) {
    return Array.from(document.querySelectorAll(`${bodySelector} tr`)).reduce((sum, row) => {
        if (row === excludeRow) return sum;
        const select = row.querySelector(selectSelector);
        if (!select || String(select.value) !== String(itemId)) return sum;
        return sum + Math.max(0, Number(row.querySelector(quantitySelector)?.value || 0));
    }, 0);
}

function getRowAvailableStock(itemId, row, bodySelector, selectSelector, quantitySelector) {
    const selectedItem = findInventoryItem(itemId);
    if (!selectedItem) return 0;

    const originalQuantity = Math.max(0, Number(row.dataset.originalQuantity || 0));
    const reservedInOtherRows = getReservedQuantityForItem(bodySelector, selectSelector, quantitySelector, itemId, row);
    const baseAvailable = Math.max(0, Number(selectedItem.availableQuantity ?? selectedItem.quantity ?? selectedItem.stock ?? 0));
    return Math.max(0, baseAvailable + originalQuantity - reservedInOtherRows);
}

function isConsumableWithAutoPurchase(item) {
    if (!item) return false;
    const accountingType = String(item.type || '').toLowerCase();
    return accountingType === 'consumable' && (item.requiresPurchase === true || item.requires_purchase === true);
}

async function createLinkedPurchaseRequest({
    item,
    quantity,
    contextType,
    sourceId = null,
    mergeExistingDraft = true,
    notes = ''
}) {
    const normalizedQty = Math.max(1, Number(quantity || 0));
    const sourceType = contextType === 'event' ? 'event_precheck' : 'rental_precheck';
    const sourcePayload = {
        type: sourceType,
        id: sourceId,
        object: item?.name || item?.id || '',
        quantity: normalizedQty
    };

    let localNumber = '';
    if (typeof window.upsertPurchaseRequestDraftFromSource === 'function') {
        const draftDoc = window.upsertPurchaseRequestDraftFromSource({
            itemId: item?.id,
            itemName: item?.name,
            itemCategory: item?.category,
            quantity: normalizedQty,
            sourceType,
            sourceId,
            sourceLabel: contextType === 'event' ? 'Мероприятие' : 'Аренда'
        });
        localNumber = String(draftDoc?.number || '').trim();
    }

    try {
        const response = await apiFetch('/api/inventory/purchase-requests', {
            method: 'POST',
            body: JSON.stringify({
                itemId: item?.id,
                quantity: normalizedQty,
                notes,
                sourceType,
                sourceId,
                source: sourcePayload,
                mergeExistingDraft
            })
        });
        const number = String(response?.request_number || response?.requestNumber || localNumber).trim();
        if (number) setPurchaseRequestStatusCache(number, 'draft');
        return number;
    } catch (error) {
        if (localNumber) {
            setPurchaseRequestStatusCache(localNumber, 'draft');
            return localNumber;
        }
        throw error;
    }
}

async function createAutoPurchaseRequestBeforeSave(row, item, shortage, contextType) {
    if (!row || !item) return;
    if (!isConsumableWithAutoPurchase(item)) return;
    if (shortage <= 0) return;
    if (row.dataset.externalSource === '1') return;
    if (row.dataset.autoPurchasePending === '1') return;

    const previousShortage = Number(row.dataset.autoPurchaseShortage || 0);
    if (Number(row.dataset.autoPurchaseCreated || 0) === 1 && shortage <= previousShortage) {
        return;
    }

    row.dataset.autoPurchasePending = '1';
    try {
        const sourceId = contextType === 'event'
            ? (editingEvent?.id || null)
            : (editingRental?.id || null);
        const requestNumber = await createLinkedPurchaseRequest({
            item,
            quantity: shortage,
            contextType,
            sourceId,
            mergeExistingDraft: true,
            notes: `Автозаявка на этапе заполнения формы (${contextType === 'event' ? 'мероприятие' : 'аренда'})`
        });

        row.dataset.autoPurchaseCreated = '1';
        row.dataset.procurementMode = 'purchase_request';
        row.dataset.autoPurchaseShortage = String(shortage);
        row.dataset.autoPurchaseRequestNumber = String(requestNumber || '');
        row.dataset.autoPurchaseRequestStatus = 'draft';
        setPurchaseRequestStatusCache(row.dataset.autoPurchaseRequestNumber, 'draft');

        const stockInput = row.querySelector(contextType === 'event' ? '.event-stock-info-input' : '.stock-info-input');
        if (stockInput) {
            const number = row.dataset.autoPurchaseRequestNumber;
            stockInput.value = number
                ? `Недостача ${shortage} шт. • заявка ${number}`
                : `Недостача ${shortage} шт. • заявка создана`;
        }

        showNotification(`Создана автозаявка на закупку: ${item.name} (${shortage} шт.)`, 'info');
    } catch (error) {
        console.error('Автозаявка до сохранения не создана:', error);
        showNotification(error.message || 'Не удалось создать автозаявку на закупку', 'warning');
    } finally {
        row.dataset.autoPurchasePending = '0';
    }
}

function normalizeInventoryLifecycleStatus(status) {
    const raw = String(restoreText(status || '')).trim().toLowerCase().replace(/ё/g, 'е');
    if (raw.includes('нет в наличии') && raw.includes('использ')) return 'Нет в наличии (в использовании)';
    if (raw.includes('нет в наличии')) return 'Нет в наличии';
    if (raw.includes('частично') && raw.includes('спис')) return 'Частично в списании';
    if (raw.includes('к спис') || raw.includes('подготовка к списанию')) return 'К списанию';
    if (raw.includes('рестав') || raw.includes('ремонт')) return 'На реставрации';
    if (raw.includes('спис')) return 'Списано';
    return 'В наличии';
}

function getInventoryDisplayStatus(item) {
    const baseStatus = normalizeInventoryLifecycleStatus(item?.status || 'В наличии');
    if (baseStatus === 'На реставрации' || baseStatus === 'Списано' || baseStatus === 'К списанию') {
        return baseStatus;
    }

    const total = Math.max(0, Number(item?.totalQuantity ?? item?.totalStock ?? item?.quantity ?? 0));
    const rawPending = Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
    const pendingWriteoff = Math.min(total, rawPending);
    const inRental = Math.max(0, Number(item?.inRental || 0));
    const inEvent = Math.max(0, Number(item?.inEvent || 0));
    const available = Math.max(0, Number(item?.availableQuantity ?? (total - pendingWriteoff - inRental - inEvent)));

    if (total <= 0) return 'Списано';
    if (pendingWriteoff >= total && total > 0) return 'К списанию';
    if (pendingWriteoff > 0) return 'Частично в списании';

    if (inRental > 0 && inEvent > 0) return available > 0 ? 'Частично в аренде/мероприятии' : 'Используется аренда/мероприятие';
    if (inRental > 0) return available > 0 ? 'Частично в аренде' : 'Используется аренда';
    if (inEvent > 0) return available > 0 ? 'Частично на мероприятии' : 'Используется мероприятие';
    if (available > 0) return 'В наличии';

    return 'Нет в наличии';
}

function getInventoryStatusBadgeLabel(item) {
    const status = getInventoryDisplayStatus(item);
    const plannedReturn = item?.plannedReturnDate || item?.planned_return_date || '';
    const dateSuffix = plannedReturn ? ` до ${formatDateOnly(plannedReturn)}` : '';

    if (status === 'Используется аренда') return `🔵 Используется: аренда${dateSuffix}`;
    if (status === 'Используется мероприятие') return `🟠 Используется: мероприятие${dateSuffix}`;
    if (status === 'Используется аренда/мероприятие') return `🟣 Используется: аренда/мероприятие${dateSuffix}`;
    if (status === 'Частично в аренде/мероприятии') return `🟣 Частично: аренда/мероприятие${dateSuffix}`;
    if (status === 'Частично в аренде') return `🔵 Частично: аренда${dateSuffix}`;
    if (status === 'Частично на мероприятии') return `🟠 Частично: мероприятие${dateSuffix}`;
    if (status === 'В аренде') return `🔵 В аренде${dateSuffix}`;
    if (status === 'На мероприятии') return `🟠 На мероприятии${dateSuffix}`;
    if (status === 'Частично в списании') return '🟡 Частично в списании';
    if (status === 'К списанию') return '🔴 К списанию';
    if (status === 'Списано') return '⚫ Списано';
    if (status === 'Нет в наличии') return '🔴 Нет в наличии';
    if (status === 'На реставрации') return '⚪ На реставрации';
    return '🟢 В наличии';
}

function getInventoryStatusHint(item) {
    const status = getInventoryDisplayStatus(item);
    const total = Math.max(0, Number(item?.totalQuantity ?? item?.totalStock ?? item?.quantity ?? 0));
    const pendingWriteoff = Math.max(0, Number(item?.pendingWriteoff ?? item?.pending_writeoff ?? 0));
    const inRental = Math.max(0, Number(item?.inRental || 0));
    const inEvent = Math.max(0, Number(item?.inEvent || 0));
    const available = Math.max(0, Number(item?.availableQuantity ?? (total - pendingWriteoff - inRental - inEvent)));

    if (status === 'Частично в списании') return 'Часть количества уже помечена к списанию. Доступна только оставшаяся часть.';
    if (status === 'К списанию') return 'Объект ожидает полного списания. Проведите акт списания.';
    if (status === 'Используется аренда') return 'Все единицы сейчас задействованы в аренде.';
    if (status === 'Используется мероприятие') return 'Все единицы сейчас задействованы в мероприятиях.';
    if (status === 'Используется аренда/мероприятие') return 'Все единицы задействованы: часть в аренде, часть в мероприятиях.';
    if (status === 'Частично в аренде') return `Часть в аренде, доступно ${available} из ${total}.`;
    if (status === 'Частично на мероприятии') return `Часть на мероприятии, доступно ${available} из ${total}.`;
    if (status === 'Частично в аренде/мероприятии') return `Часть в использовании, доступно ${available} из ${total}.`;
    if (status === 'На реставрации') return 'Объект временно недоступен до завершения реставрации.';
    if (status === 'Списано') return 'Объект списан и не участвует в активных остатках.';
    if (status === 'Нет в наличии') return 'Свободного остатка нет.';
    return 'Объект доступен к выдаче и операциям.';
}

function getUnavailableAssetReason(item) {
    const status = getInventoryDisplayStatus(item);
    if (status === 'Используется аренда/мероприятие') {
        return `Используется: аренда ${Number(item?.inRental || 0)} шт., мероприятие ${Number(item?.inEvent || 0)} шт.`;
    }
    if (status === 'Используется аренда') {
        return `Используется в аренде: ${Number(item?.inRental || 0)} шт.`;
    }
    if (status === 'Используется мероприятие') {
        return `Используется на мероприятии: ${Number(item?.inEvent || 0)} шт.`;
    }
    if (status === 'В аренде') {
        return `В аренде: ${Number(item?.inRental || 0)} шт.`;
    }
    if (status === 'На мероприятии') {
        return `На мероприятии: ${Number(item?.inEvent || 0)} шт.`;
    }
    if (status === 'Нет в наличии (в использовании)') {
        const inRental = Number(item?.inRental || 0);
        const inEvent = Number(item?.inEvent || 0);
        if (inRental > 0 && inEvent > 0) return `В использовании: аренда ${inRental} шт., мероприятие ${inEvent} шт.`;
        if (inRental > 0) return `В использовании в аренде: ${inRental} шт.`;
        if (inEvent > 0) return `В использовании на мероприятии: ${inEvent} шт.`;
        return 'Сейчас используется в активных документах';
    }
    if (status === 'Нет в наличии') return 'Отсутствует на складе';
    if (status === 'К списанию') return 'Объект помечен к списанию и ожидает проведения акта';
    if (status === 'На реставрации') return 'Находится на реставрации';
    if (status === 'Списано') return 'Объект списан и недоступен для выдачи';
    if (Number(item?.availableQuantity ?? item?.quantity ?? 0) <= 0) return 'Отсутствует на складе';
    return 'Временно недоступен';
}

function nextEntityFormRowId() {
    entityFormRowSequence += 1;
    return `row-${Date.now()}-${entityFormRowSequence}`;
}

const purchaseRequestStatusCache = new Map();

function setPurchaseRequestStatusCache(requestNumber, status) {
    const key = String(requestNumber || '').trim();
    if (!key) return;
    const normalized = normalizePurchaseRequestStatusString(status || '');
    if (!normalized) return;
    purchaseRequestStatusCache.set(key, normalized);
}

function getCachedPurchaseRequestStatus(requestNumber) {
    const key = String(requestNumber || '').trim();
    if (!key) return '';
    return purchaseRequestStatusCache.get(key) || '';
}

function getEntityContextConfig(contextType) {
    if (contextType === 'event') {
        return {
            bodySelector: '#eventItemsBody',
            selectSelector: '.event-item-select',
            quantitySelector: '.event-quantity-input',
            stockSelector: '.event-stock-info-input',
            statusSelector: '.event-item-status',
            fixButtonSelector: '.event-fix-issue-btn',
            bannerId: 'eventIssuesBanner'
        };
    }

    return {
        bodySelector: '#rentalItemsBody',
        selectSelector: '.item-select',
        quantitySelector: '.quantity-input',
        stockSelector: '.stock-info-input',
        statusSelector: '.item-stock-status',
        fixButtonSelector: '.item-fix-issue-btn',
        bannerId: 'rentalIssuesBanner'
    };
}

function getItemAccountingTypeLabel(item) {
    return String(item?.type || '').toLowerCase() === 'consumable' ? 'Расходный материал' : 'Основное средство';
}

function getIssuePurchaseRequestNumber(row) {
    return String(row?.dataset.autoPurchaseRequestNumber || '').trim();
}

function normalizePurchaseRequestStatusString(status) {
    if (window.WarehouseStatuses?.normalizePurchaseRequestStatusString) {
        return window.WarehouseStatuses.normalizePurchaseRequestStatusString(status);
    }
    const raw = String(restoreText(status || '')).trim().toLowerCase().replace(/ё/g, 'е');
    if (!raw) return '';
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
        'частично согласована': 'approved_partial',
        заказана: 'ordered',
        поставлена: 'ordered',
        поставлен: 'ordered',
        'частично поставлено': 'partial',
        'частично получен': 'partial',
        'частично получено': 'partial',
        частично: 'partial',
        получен: 'completed',
        получено: 'completed',
        проведен: 'completed',
        проведена: 'completed',
        отменена: 'rejected',
        отменен: 'rejected',
        закрыта: 'closed'
    };
    return aliases[raw] || raw;
}

function getPurchaseRequestStatusByNumber(requestNumber) {
    const key = String(requestNumber || '').trim();
    if (!key) return '';
    const cached = getCachedPurchaseRequestStatus(key);
    if (!cached) {
        refreshPurchaseRequestStatusFromApi(key).catch(error => {
            console.warn('Не удалось обновить статус заявки из API:', error);
        });
    }
    return cached;
}

function getIssuePurchaseRequestStatus(row) {
    const status = String(row?.dataset.autoPurchaseRequestStatus || '').trim();
    if (status) return normalizePurchaseRequestStatusString(status);
    return getPurchaseRequestStatusByNumber(getIssuePurchaseRequestNumber(row));
}

function isActivePurchaseRequestStatus(status) {
    const normalized = normalizePurchaseRequestStatusString(status);
    if (!normalized) return false;
    const activeStatuses = ['draft', 'approval', 'approved', 'approved_partial', 'ordered', 'partial'];
    return activeStatuses.includes(normalized);
}

function isReceivedPurchaseRequestStatus(status) {
    const normalized = normalizePurchaseRequestStatusString(status);
    return normalized === 'completed' || normalized === 'closed';
}

async function refreshPurchaseRequestStatusFromApi(requestNumber) {
    const key = String(requestNumber || '').trim();
    if (!key) return '';
    const rows = await apiFetch(`/api/inventory/purchase-requests?requestNumber=${encodeURIComponent(key)}`);
    const row = (Array.isArray(rows) ? rows : []).find(entry => String(entry?.request_number || entry?.requestNumber || '').trim() === key);
    const normalized = normalizePurchaseRequestStatusString(row?.status || '');
    if (normalized) {
        setPurchaseRequestStatusCache(key, normalized);
    }
    return normalized;
}

async function refreshPurchaseRequestDependentRows(contextType) {
    const config = getEntityContextConfig(contextType);
    const rows = Array.from(document.querySelectorAll(`${config.bodySelector} tr`));
    await Promise.all(rows.map(async row => {
        const requestNumber = getIssuePurchaseRequestNumber(row);
        if (!requestNumber) return null;
        let latestStatus = getCachedPurchaseRequestStatus(requestNumber);
        if (!latestStatus) {
            latestStatus = await refreshPurchaseRequestStatusFromApi(requestNumber);
        }
        if (latestStatus) {
            row.dataset.autoPurchaseRequestStatus = latestStatus;
        }
        if (contextType === 'event') {
            syncEventRowState(row, false);
        } else {
            syncRentalRowState(row, false);
        }
        return null;
    }));
    updateEntityIssuesBanner(contextType);
    refreshEntityFinalizeButtonState(contextType);
    renderLinkedPurchaseRequests(contextType);
}

window.notifyPurchaseRequestStatusChanged = async function notifyPurchaseRequestStatusChanged(detail = {}) {
    const requestNumber = String(detail?.number || '').trim();
    const status = normalizePurchaseRequestStatusString(detail?.status || '');
    if (requestNumber && status) {
        setPurchaseRequestStatusCache(requestNumber, status);
    }
    await Promise.all([
        refreshPurchaseRequestDependentRows('rental'),
        refreshPurchaseRequestDependentRows('event')
    ]);
};

function shouldValidateEntityStockIssues(contextType) {
    if (contextType === 'event') {
        const status = document.getElementById('eventStatus')?.value || 'Черновик';
        return isDraftStatus(status);
    }
    const status = document.getElementById('rentalStatus')?.value || 'Черновик';
    return isDraftStatus(status);
}

function collectRowStockIssue(row, contextType, forceValidation = false) {
    if (!row) return null;
    if (!forceValidation && !shouldValidateEntityStockIssues(contextType)) return null;
    const config = getEntityContextConfig(contextType);
    const select = row.querySelector(config.selectSelector);
    const quantityInput = row.querySelector(config.quantitySelector);
    const item = findInventoryItem(select?.value);
    if (!item) return null;

    const quantity = Math.max(0, Number(quantityInput?.value || 0));
    const available = Math.max(0, getRowAvailableStock(item.id, row, config.bodySelector, config.selectSelector, config.quantitySelector));
    const shortage = Math.max(0, quantity - available);
    const requestNumber = getIssuePurchaseRequestNumber(row);
    const requestStatus = getIssuePurchaseRequestStatus(row);
    const isExternal = row.dataset.externalSource === '1';
    const procurementMode = row.dataset.procurementMode || 'warehouse';
    const isConsumable = String(item.type || '').toLowerCase() === 'consumable';
    const currentStatus = getInventoryDisplayStatus(item);
    const baseLifecycleStatus = normalizeInventoryLifecycleStatus(item?.status || 'В наличии');

    if (isExternal) return null;

    if (quantity > 0 && (baseLifecycleStatus === 'К списанию' || baseLifecycleStatus === 'На реставрации' || baseLifecycleStatus === 'Списано')) {
        return {
            kind: 'unavailable_status',
            contextType,
            row,
            item,
            quantity,
            available,
            shortage: Math.max(0, quantity - available),
            requestNumber,
            currentStatus,
            reason: getUnavailableAssetReason(item),
            isConsumable,
            canExternal: !isConsumable
        };
    }

    if (procurementMode === 'zero_quantity' && quantity === 0) {
        const requestedBeforeReduce = Math.max(1, Number(row.dataset.pendingRequestedQuantity || 1));
        return {
            kind: 'zero_quantity',
            contextType,
            row,
            item,
            quantity: requestedBeforeReduce,
            available,
            shortage: Math.max(0, requestedBeforeReduce - available),
            requestNumber,
            isConsumable,
            canExternal: !isConsumable
        };
    }

    if (procurementMode === 'purchase_request' && shortage > 0) {
        const issueKind = isReceivedPurchaseRequestStatus(requestStatus) ? 'awaiting_purchase_act' : 'awaiting_purchase';
        return {
            kind: issueKind,
            contextType,
            row,
            item,
            quantity,
            available,
            shortage: Math.max(shortage, quantity > 0 ? quantity - available : 0),
            requestNumber,
            isConsumable,
            canExternal: !isConsumable
        };
    }

    if (procurementMode === 'purchase_request' && requestNumber && isActivePurchaseRequestStatus(requestStatus)) {
        return {
            kind: 'awaiting_purchase',
            contextType,
            row,
            item,
            quantity,
            available,
            shortage,
            requestNumber,
            isConsumable,
            canExternal: !isConsumable
        };
    }

    if (shortage > 0) {
        return {
            kind: 'deficit',
            contextType,
            row,
            item,
            quantity,
            available,
            shortage,
            requestNumber,
            isConsumable,
            canExternal: !isConsumable
        };
    }

    return null;
}

function collectEntityStockIssues(contextType, forceValidation = false) {
    const config = getEntityContextConfig(contextType);
    return Array.from(document.querySelectorAll(`${config.bodySelector} tr`))
        .map(row => collectRowStockIssue(row, contextType, forceValidation))
        .filter(Boolean);
}

function getIssueStatusLabel(issue) {
    if (!issue) return '✅ Доступно';
    if (issue.kind === 'awaiting_purchase') {
        return issue.requestNumber ? `⏳ Ожидается закупка (${issue.requestNumber})` : '⏳ Ожидается закупка';
    }
    if (issue.kind === 'awaiting_purchase_act') {
        return issue.requestNumber
            ? `🧾 Поставка есть, нужен акт закупки (${issue.requestNumber})`
            : '🧾 Поставка есть, нужен акт закупки';
    }
    if (issue.kind === 'unavailable_status') {
        return `🚫 Нельзя выдать (${issue.currentStatus || 'Недоступно'})`;
    }
    if (issue.kind === 'zero_quantity') {
        return '⚠️ Количество = 0';
    }
    return `⚠️ Недостаточно (${issue.available} из ${issue.quantity})`;
}

function updateRowStockIssueUi(row, contextType) {
    const config = getEntityContextConfig(contextType);
    const issue = collectRowStockIssue(row, contextType);
    const statusNode = row.querySelector(config.statusSelector);
    const fixButton = row.querySelector(config.fixButtonSelector);

    row.classList.toggle('entity-item-row-issue', Boolean(issue) && !['awaiting_purchase', 'awaiting_purchase_act'].includes(issue.kind));
    row.classList.toggle('entity-item-row-waiting', Boolean(issue) && ['awaiting_purchase', 'awaiting_purchase_act'].includes(issue.kind));

    if (statusNode) {
        statusNode.textContent = getIssueStatusLabel(issue);
        statusNode.className = `row-issue-badge ${issue ? ((issue.kind === 'awaiting_purchase' || issue.kind === 'awaiting_purchase_act') ? 'waiting' : 'problem') : 'ok'} ${config.statusSelector.replace('.', '')}`;
    }

    if (fixButton) {
        fixButton.style.display = issue ? 'inline-flex' : 'none';
        fixButton.disabled = !issue;
    }

    return issue;
}

function updateEntityIssuesBanner(contextType) {
    const config = getEntityContextConfig(contextType);
    const banner = document.getElementById(config.bannerId);
    if (!banner) return;

    if (!shouldValidateEntityStockIssues(contextType)) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    const issues = collectEntityStockIssues(contextType);
    if (!issues.length) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    banner.style.display = 'block';
    banner.innerHTML = `
        <div class="entity-issues-banner-title">⚠️ Внимание: есть проблемы, которые мешают проведению документа</div>
        <div class="entity-issues-banner-list">
            ${issues.map(issue => `
                <div class="entity-issues-banner-row">
                    <div>
                        <strong>${escapeHtml(issue.item.name || issue.item.id)}</strong> — ${escapeHtml(getIssueStatusLabel(issue))}
                        ${issue.kind === 'deficit' || issue.kind === 'unavailable_status'
                            ? `<div class="small-muted">Требуется: ${issue.quantity} шт., доступно: ${issue.available} шт. ${issue.reason ? `• ${escapeHtml(issue.reason)}` : ''}</div>`
                            : ''}
                    </div>
                    <button type="button" class="inline-action-btn" onclick="openStockDeficitResolutionByRowId('${contextType}', '${String(issue.row.dataset.rowUid || '').replace(/'/g, '&#39;')}')">Исправить</button>
                </div>
            `).join('')}
        </div>
    `;
}

function closeStockDeficitModal(triggerCancel = true) {
    const modal = document.getElementById('stockDeficitModal');
    if (modal) modal.style.display = 'none';
    if (triggerCancel && typeof stockDeficitModalState?.onCancel === 'function') {
        stockDeficitModalState.onCancel();
    }
    stockDeficitModalState = null;
}

async function fetchPurchaseRequestDraftsForItem(itemId) {
    if (window.PurchaseRequestsApi?.fetchPurchaseRequestDraftsForItem) {
        return window.PurchaseRequestsApi.fetchPurchaseRequestDraftsForItem(itemId);
    }
    if (!itemId) return [];
    try {
        const drafts = await apiFetch(`/api/inventory/purchase-requests?status=${encodeURIComponent('Черновик')}&itemId=${encodeURIComponent(String(itemId || '').trim())}`);
        return Array.isArray(drafts) ? drafts : [];
    } catch (error) {
        console.error('Не удалось получить черновики заявок:', error);
        return [];
    }
}

async function openPurchaseRequestChoiceModal(issue) {
    const modal = document.getElementById('purchaseRequestChoiceModal');
    if (!modal || !issue?.item) return;

    purchaseRequestChoiceModalState = { issue, existingDrafts: [] };
    const item = issue.item;
    const shortage = Math.max(1, Number(issue.shortage || issue.quantity || 0));
    const drafts = await fetchPurchaseRequestDraftsForItem(item.id);
    purchaseRequestChoiceModalState.existingDrafts = drafts;

    const lines = [];
    lines.push(`<p>Объект: <strong>${escapeHtml(item.name || item.id || '')}</strong></p>`);
    lines.push(`<p>Недостача: <strong>${shortage} шт.</strong></p>`);

    if (drafts.length > 0) {
        lines.push(`<p>Найдено ${drafts.length} черновик(ов) заявки для этого объекта:</p>`);
        lines.push('<ul>');
        for (const draft of drafts.slice(0, 5)) {
            const draftNumber = String(draft.request_number || draft.requestNumber || '').trim();
            const draftQuantity = Number(draft.quantity || 0);
            const draftNotes = String(draft.notes || '').trim();
            lines.push(`<li>№${escapeHtml(draftNumber || '—')} — ${draftQuantity} шт.${draftNotes ? ` • ${escapeHtml(draftNotes)}` : ''}</li>`);
        }
        if (drafts.length > 5) {
            lines.push(`<li>...еще ${drafts.length - 5} черновиков</li>`);
        }
        lines.push('</ul>');
        lines.push('<p>Если у вас появилось новое количество, недостающие позиции будут добавлены к выбранному черновику.</p>');
        lines.push('<p>Выберите «Сформировать текущую заявку», чтобы добавить недостающие позиции в существующий черновик.</p>');
    } else {
        lines.push('<p>Для этого объекта черновиков пока нет. Будет создана новая заявка.</p>');
    }

    const contentNode = document.getElementById('purchaseRequestChoiceModalContent');
    if (contentNode) contentNode.innerHTML = lines.join('');

    const createButton = document.getElementById('purchaseRequestChoiceCreateNewBtn');
    const useDraftButton = document.getElementById('purchaseRequestChoiceUseDraftBtn');
    if (createButton) createButton.style.display = '';
    if (useDraftButton) useDraftButton.style.display = drafts.length > 0 ? '' : 'none';

    modal.style.display = 'block';
}

function closePurchaseRequestChoiceModal() {
    const modal = document.getElementById('purchaseRequestChoiceModal');
    if (modal) modal.style.display = 'none';
    purchaseRequestChoiceModalState = null;
}

async function applyPurchaseRequestChoice(useExistingDraft = false) {
    const state = purchaseRequestChoiceModalState;
    if (!state?.issue || !state.issue.item) return;

    const issue = state.issue;
    const item = issue.item;
    const shortage = Math.max(1, Number(issue.shortage || issue.quantity || 0));
    try {
        const sourceId = issue.contextType === 'event'
            ? (editingEvent?.id || null)
            : (editingRental?.id || null);
        let number = await createLinkedPurchaseRequest({
            item,
            quantity: shortage,
            contextType: issue.contextType,
            sourceId,
            mergeExistingDraft: useExistingDraft,
            notes: `Заявка создана из ${issue.contextType === 'event' ? 'мероприятия' : 'аренды'}`
        });
        if (!number && Array.isArray(state.existingDrafts) && state.existingDrafts.length > 0) {
            number = String(state.existingDrafts[0].request_number || state.existingDrafts[0].requestNumber || '').trim();
        }
        if (issue.row) {
            issue.row.dataset.autoPurchaseCreated = '1';
            issue.row.dataset.autoPurchaseShortage = String(shortage);
            issue.row.dataset.autoPurchaseRequestNumber = number;
            issue.row.dataset.autoPurchaseRequestStatus = 'draft';
            setPurchaseRequestStatusCache(number, 'draft');
            issue.row.dataset.procurementMode = 'purchase_request';
            const config = getEntityContextConfig(issue.contextType);
            const stockInput = issue.row.querySelector(config.stockSelector);
            if (stockInput) {
                stockInput.value = number
                    ? `Недостача ${shortage} шт. • заявка ${number}`
                    : `Недостача ${shortage} шт. • заявка создана`;
            }
        }

        showNotification(number ? `Заявка на закупку ${number} сформирована` : 'Заявка на закупку сформирована', 'success');
        if (number && typeof window.openPurchaseRequestDocumentByNumber === 'function') {
            window.openPurchaseRequestDocumentByNumber(number);
        }
    } catch (error) {
        showNotification(error.message || 'Не удалось сформировать заявку на закупку', 'error');
    } finally {
        closePurchaseRequestChoiceModal();
        if (issue.row && document.body.contains(issue.row)) {
            if (issue.contextType === 'event') {
                syncEventRowState(issue.row, false);
            } else {
                syncRentalRowState(issue.row, false);
            }
        }
        updateEntityIssuesBanner(issue.contextType);
        refreshEntityFinalizeButtonState(issue.contextType);
    }
}

function purchaseRequestChoiceCreateNew() {
    return applyPurchaseRequestChoice(false);
}

function purchaseRequestChoiceUseDraft() {
    return applyPurchaseRequestChoice(true);
}

window.purchaseRequestChoiceCreateNew = purchaseRequestChoiceCreateNew;
window.purchaseRequestChoiceUseDraft = purchaseRequestChoiceUseDraft;
window.closePurchaseRequestChoiceModal = closePurchaseRequestChoiceModal;

async function ensurePurchaseRequestForIssue(issue) {
    const row = issue?.row;
    const item = issue?.item;
    if (!row || !item) return '';

    const existingNumber = getIssuePurchaseRequestNumber(row);
    if (existingNumber) return existingNumber;

    const sourceId = issue.contextType === 'event' ? (editingEvent?.id || null) : (editingRental?.id || null);
    const requestNumber = await createLinkedPurchaseRequest({
        item,
        quantity: Math.max(1, Number(issue.shortage || 0)),
        contextType: issue.contextType,
        sourceId,
        mergeExistingDraft: true,
        notes: `Заявка создана из ${issue.contextType === 'event' ? 'мероприятия' : 'аренды'} по причине дефицита`
    });
    row.dataset.autoPurchaseCreated = '1';
    row.dataset.autoPurchaseShortage = String(issue.shortage || 0);
    row.dataset.autoPurchaseRequestNumber = requestNumber;
    row.dataset.autoPurchaseRequestStatus = 'draft';
    setPurchaseRequestStatusCache(requestNumber, 'draft');
    row.dataset.procurementMode = 'purchase_request';
    return requestNumber;
}

async function applyStockDeficitResolution() {
    const state = stockDeficitModalState;
    if (!state?.issue?.row) return;

    const action = document.querySelector('input[name="stockDeficitAction"]:checked')?.value || 'purchase';
    const issue = state.issue;
    const row = issue.row;
    const config = getEntityContextConfig(issue.contextType);
    const quantityInput = row.querySelector(config.quantitySelector);
    const stockInput = row.querySelector(config.stockSelector);

    try {
        if (action === 'purchase') {
            closeStockDeficitModal(false);
            await openPurchaseRequestChoiceModal(issue);
            return;
        } else if (action === 'external') {
            row.dataset.externalSource = '1';
            row.dataset.procurementMode = 'external_rental';
            if (stockInput) stockInput.value = 'Внешняя аренда';
            showNotification(`Позиция «${issue.item.name}» помечена как арендованная у сторонней организации`, 'info');
        } else if (action === 'reduce') {
            if (quantityInput) {
                quantityInput.min = '0';
                quantityInput.value = String(Math.max(0, issue.available));
            }
            row.dataset.externalSource = '0';
            row.dataset.procurementMode = issue.available === 0 ? 'zero_quantity' : 'warehouse';
            row.dataset.pendingRequestedQuantity = String(issue.quantity || 1);
            row.dataset.autoPurchaseCreated = '0';
            row.dataset.autoPurchaseShortage = '0';
            row.dataset.autoPurchaseRequestNumber = '';
            showNotification(`Количество для «${issue.item.name}» изменено на ${issue.available} шт.`, 'info');
        } else if (action === 'remove') {
            row.remove();
            showNotification(`Позиция «${issue.item.name}» удалена из заявки`, 'info');
        }
    } catch (error) {
        showNotification(error.message || 'Не удалось применить выбранное действие', 'error');
        return;
    }

    closeStockDeficitModal(false);

    if (document.body.contains(row)) {
        if (issue.contextType === 'event') {
            syncEventRowState(row, false);
        } else {
            syncRentalRowState(row, false);
        }
    }
    updateEntityIssuesBanner(issue.contextType);
    refreshEntityFinalizeButtonState(issue.contextType);

    if (typeof state.onResolved === 'function') {
        state.onResolved(action);
    }
}

function openStockDeficitModal(issue, options = {}) {
    const modal = document.getElementById('stockDeficitModal');
    if (!modal || !issue?.item) return;

    stockDeficitModalState = {
        issue,
        onResolved: typeof options.onResolved === 'function' ? options.onResolved : null,
        onCancel: typeof options.onCancel === 'function' ? options.onCancel : null
    };

    const item = issue.item;
    const purchaseOption = document.getElementById('stockDeficitPurchaseOption');
    const purchaseText = document.getElementById('stockDeficitPurchaseText');
    const reduceOption = document.getElementById('stockDeficitReduceOption');
    const reduceText = document.getElementById('stockDeficitReduceText');
    const externalOption = document.getElementById('stockDeficitExternalOption');

    document.getElementById('stockDeficitTitle').textContent = issue.isConsumable ? 'Недостаточно расходника на складе' : 'Недостаточно объектов на складе';
    document.getElementById('stockDeficitItemName').textContent = item.name || item.id || '—';
    document.getElementById('stockDeficitCategory').textContent = item.category || '—';
    document.getElementById('stockDeficitType').textContent = getItemAccountingTypeLabel(item);
    document.getElementById('stockDeficitAvailable').textContent = `${issue.available} шт.`;
    document.getElementById('stockDeficitRequired').textContent = `${issue.quantity} шт.`;
    document.getElementById('stockDeficitShortage').textContent = `${Math.max(0, issue.shortage)} шт.`;
    document.getElementById('stockDeficitReason').textContent = issue.kind === 'awaiting_purchase'
        ? (issue.requestNumber ? `Для позиции уже создана заявка на закупку ${issue.requestNumber}. Проведение станет доступно после поступления.` : 'Для позиции ожидается поступление по заявке на закупку.')
        : issue.kind === 'awaiting_purchase_act'
            ? (issue.requestNumber
                ? `Поставка по заявке ${issue.requestNumber} уже зафиксирована, но акт закупки не проведен. Пока акт не проведен, остатки на складе не увеличиваются.`
                : 'Поставка зафиксирована, но акт закупки не проведен. Пока акт не проведен, остатки на складе не увеличиваются.')
            : issue.kind === 'zero_quantity'
                ? 'Количество в строке уменьшено до нуля. Для проведения нужно оформить закупку, взять объект у другой организации или удалить позицию.'
                : (issue.reason || getUnavailableAssetReason(item));

    if (purchaseOption) {
        purchaseOption.style.display = 'flex';
    }
    if (purchaseText) {
        purchaseText.textContent = issue.kind === 'unavailable_status'
            ? 'Оформить закупку дополнительных единиц, чтобы не ждать освобождения текущих'
            : issue.requestNumber
                ? `Уже создана заявка ${issue.requestNumber} на недостающие ${Math.max(1, issue.shortage || issue.quantity || 1)} шт.`
                : `Купить недостающие ${Math.max(1, issue.shortage || issue.quantity || 1)} шт.`;
    }
    if (reduceOption) {
        reduceOption.style.display = issue.kind === 'unavailable_status' ? 'none' : 'flex';
    }
    if (reduceText) {
        reduceText.textContent = `Изменить количество на доступное (${issue.available} шт.)`;
    }
    if (externalOption) {
        externalOption.style.display = issue.canExternal ? 'flex' : 'none';
    }

    const purchaseRadio = document.querySelector('input[name="stockDeficitAction"][value="purchase"]');
    const externalRadio = document.querySelector('input[name="stockDeficitAction"][value="external"]');
    const removeRadio = document.querySelector('input[name="stockDeficitAction"][value="remove"]');
    if (issue.kind === 'unavailable_status') {
        if (issue.canExternal && externalRadio) {
            externalRadio.checked = true;
        } else if (purchaseOption && purchaseOption.style.display !== 'none' && purchaseRadio) {
            purchaseRadio.checked = true;
        } else if (removeRadio) {
            removeRadio.checked = true;
        }
    } else if (purchaseOption && purchaseOption.style.display !== 'none' && purchaseRadio) {
        purchaseRadio.checked = true;
    } else if (externalRadio && issue.canExternal) {
        externalRadio.checked = true;
    } else if (removeRadio) {
        removeRadio.checked = true;
    }

    modal.style.display = 'block';
}

function openStockDeficitResolutionByRowId(contextType, rowId) {
    const config = getEntityContextConfig(contextType);
    const row = Array.from(document.querySelectorAll(`${config.bodySelector} tr`)).find(entry => String(entry.dataset.rowUid || '') === String(rowId || ''));
    const issue = collectRowStockIssue(row, contextType);
    if (issue) {
        openStockDeficitModal(issue);
    }
}

window.openStockDeficitResolutionByRowId = openStockDeficitResolutionByRowId;
window.applyStockDeficitResolution = applyStockDeficitResolution;
window.closeStockDeficitModal = closeStockDeficitModal;

function openAssetUnavailableChoiceModal(item, onSelect) {
    const tempRow = document.createElement('tr');
    tempRow.dataset.rowUid = nextEntityFormRowId();
    tempRow.dataset.externalSource = '0';
    tempRow.dataset.procurementMode = 'warehouse';
    tempRow.innerHTML = '<td><input class="quantity-input" value="1"></td>';
    const issue = {
        kind: 'deficit',
        contextType: 'rental',
        row: tempRow,
        item,
        quantity: 1,
        available: Math.max(0, Number(item?.availableQuantity ?? item?.quantity ?? 0)),
        shortage: Math.max(0, 1 - Math.max(0, Number(item?.availableQuantity ?? item?.quantity ?? 0))),
        requestNumber: '',
        isConsumable: String(item?.type || '').toLowerCase() === 'consumable',
        canExternal: String(item?.type || '').toLowerCase() !== 'consumable'
    };

    openStockDeficitModal(issue, {
        onResolved: (action) => {
            if (typeof onSelect === 'function') onSelect(action);
        },
        onCancel: () => {
            if (typeof onSelect === 'function') onSelect('remove');
        }
    });
}

function syncRentalRowState(row, showWarnings = false) {
    const select = row.querySelector('.item-select');
    const categoryInput = row.querySelector('.category-input');
    const stockInput = row.querySelector('.stock-info-input');
    const quantityInput = row.querySelector('.quantity-input');
    const issueConditionInput = row.querySelector('.item-issue-condition-input');
    const conditionSelect = row.querySelector('.item-condition-select');
    const noteInput = row.querySelector('.issue-comment-input') || row.querySelector('.item-note-input');
    const writeoffDecisionWrap = row.querySelector('.writeoff-decision-wrap');
    const writeoffDecisionSelect = row.querySelector('.writeoff-decision-select');
    const defectQuantityWrap = row.querySelector('.defect-quantity-wrap');
    const defectQuantityInput = row.querySelector('.defect-quantity-input');
    const writeoffReasonWrap = row.querySelector('.writeoff-reason-wrap');
    const writeoffReasonSelect = row.querySelector('.writeoff-reason-select');
    const writeoffCommentInput = row.querySelector('.writeoff-comment-input');
    const selected = findInventoryItem(select?.value);

    if (issueConditionInput && !String(issueConditionInput.value || '').trim()) {
        issueConditionInput.value = 'Хорошее';
    }

    categoryInput.value = selected ? selected.category : (categoryInput.value || '');

    if (selected) {
        if (Number(quantityInput.value || 0) > 0 && row.dataset.procurementMode === 'zero_quantity') {
            row.dataset.procurementMode = 'warehouse';
            row.dataset.pendingRequestedQuantity = '';
        }
        const available = getRowAvailableStock(selected.id, row, '#rentalItemsBody', '.item-select', '.quantity-input');
        const baseAvailable = Math.max(0, Number(selected.availableQuantity ?? selected.quantity ?? selected.stock ?? 0));
        if (row.dataset.externalSource === '1') {
            stockInput.value = 'Внешняя аренда';
            quantityInput.removeAttribute('max');
        } else if (row.dataset.procurementMode === 'purchase_request' && Number(quantityInput.value || 0) > available) {
            const requestNumber = getIssuePurchaseRequestNumber(row);
            stockInput.value = requestNumber ? `Недостача ${Math.max(0, Number(quantityInput.value || 0) - available)} шт. • заявка ${requestNumber}` : `Недостача ${Math.max(0, Number(quantityInput.value || 0) - available)} шт. • заявка создана`;
            quantityInput.removeAttribute('max');
        } else {
            stockInput.value = `${baseAvailable} шт.`;
            quantityInput.max = String(Math.max(0, available));
        }
    } else {
        stockInput.value = '';
        quantityInput.removeAttribute('max');
        row.dataset.externalSource = '0';
        row.dataset.procurementMode = 'warehouse';
        row.dataset.autoPurchaseCreated = '0';
        row.dataset.autoPurchaseShortage = '0';
        row.dataset.autoPurchaseRequestNumber = '';
    }

    const isAsset = selected && String(selected.type || '') === 'asset';
    const requiresCondition = requiresIssueConditionCapture('rental', document.getElementById('rentalStatus')?.value);
    const shouldCaptureAcceptanceState = Boolean(requiresCondition && isAsset);
    if (conditionSelect) {
        conditionSelect.disabled = !shouldCaptureAcceptanceState;
        if (!shouldCaptureAcceptanceState) {
            conditionSelect.value = 'Хорошее';
        } else if (!conditionSelect.value) {
            conditionSelect.value = 'Хорошее';
        }
    }

    const shouldShowWriteoffControls = shouldCaptureAcceptanceState && conditionSelect?.value && conditionSelect.value !== 'Хорошее';
    if (writeoffDecisionWrap) {
        writeoffDecisionWrap.style.display = shouldShowWriteoffControls ? 'block' : 'none';
    }
    if (writeoffDecisionSelect) {
        writeoffDecisionSelect.disabled = !shouldShowWriteoffControls;
        if (!shouldShowWriteoffControls) {
            writeoffDecisionSelect.value = 'writeoff';
        } else if (!writeoffDecisionSelect.value) {
            writeoffDecisionSelect.value = 'writeoff';
        }
    }
    const shouldWriteoff = shouldShowWriteoffControls && normalizeWriteoffDecision(writeoffDecisionSelect?.value || 'writeoff') === 'writeoff';
    if (defectQuantityWrap) {
        defectQuantityWrap.style.display = shouldWriteoff ? 'block' : 'none';
    }
    if (defectQuantityInput) {
        const maxQty = Math.max(0, Number(quantityInput?.value || 0));
        defectQuantityInput.disabled = !shouldWriteoff;
        defectQuantityInput.max = String(maxQty);
        defectQuantityInput.min = '1';
        if (!shouldWriteoff) {
            defectQuantityInput.value = '';
        } else if (!defectQuantityInput.value) {
            defectQuantityInput.value = String(maxQty > 0 ? maxQty : 1);
        }
    }
    if (writeoffReasonWrap) {
        writeoffReasonWrap.style.display = shouldWriteoff ? 'block' : 'none';
    }
    if (writeoffReasonSelect) {
        writeoffReasonSelect.disabled = !shouldWriteoff;
        writeoffReasonSelect.required = false;
        writeoffReasonSelect.placeholder = conditionSelect?.value === 'Утрачено' ? 'Укажите причину утраты' : 'Укажите причину повреждения';
        if (!shouldWriteoff) {
            writeoffReasonSelect.value = '';
        } else if (!String(writeoffReasonSelect.value || '').trim()) {
            writeoffReasonSelect.value = getDefaultWriteoffReasonByCondition(conditionSelect?.value);
        }
    }
    if (writeoffCommentInput) {
        writeoffCommentInput.disabled = !shouldWriteoff;
        writeoffCommentInput.placeholder = 'Комментарий для акта списания';
        if (!shouldWriteoff) {
            writeoffCommentInput.value = '';
        }
    }

    if (conditionSelect && !conditionSelect.dataset.reasonBound) {
        conditionSelect.dataset.reasonBound = '1';
        conditionSelect.addEventListener('change', () => syncRentalRowState(row));
    }
    if (writeoffDecisionSelect && !writeoffDecisionSelect.dataset.reasonBound) {
        writeoffDecisionSelect.dataset.reasonBound = '1';
        writeoffDecisionSelect.addEventListener('change', () => syncRentalRowState(row));
    }

    applyRowCommentStage(row, 'rental');
    refreshRowDocumentCommentButtons(row);

    const issue = updateRowStockIssueUi(row, 'rental');
    updateEntityIssuesBanner('rental');
    refreshEntityFinalizeButtonState('rental');
    if (showWarnings && issue) {
        openStockDeficitModal(issue);
    }
}

function syncEventRowState(row, showWarnings = false) {
    const select = row.querySelector('.event-item-select');
    const categoryInput = row.querySelector('.event-category-input');
    const stockInput = row.querySelector('.event-stock-info-input');
    const quantityInput = row.querySelector('.event-quantity-input');
    const issueConditionInput = row.querySelector('.event-issue-condition-input');
    const conditionSelect = row.querySelector('.event-condition-select');
    const noteInput = row.querySelector('.issue-comment-input') || row.querySelector('.event-note-input');
    const writeoffDecisionWrap = row.querySelector('.writeoff-decision-wrap');
    const writeoffDecisionSelect = row.querySelector('.writeoff-decision-select');
    const defectQuantityWrap = row.querySelector('.defect-quantity-wrap');
    const defectQuantityInput = row.querySelector('.defect-quantity-input');
    const writeoffReasonWrap = row.querySelector('.writeoff-reason-wrap');
    const writeoffReasonSelect = row.querySelector('.writeoff-reason-select');
    const writeoffCommentInput = row.querySelector('.writeoff-comment-input');
    const selected = findInventoryItem(select?.value);

    if (issueConditionInput && !String(issueConditionInput.value || '').trim()) {
        issueConditionInput.value = 'Хорошее';
    }

    categoryInput.value = selected ? selected.category : (categoryInput.value || '');

    if (selected) {
        if (Number(quantityInput.value || 0) > 0 && row.dataset.procurementMode === 'zero_quantity') {
            row.dataset.procurementMode = 'warehouse';
            row.dataset.pendingRequestedQuantity = '';
        }
        const available = getRowAvailableStock(selected.id, row, '#eventItemsBody', '.event-item-select', '.event-quantity-input');
        const baseAvailable = Math.max(0, Number(selected.availableQuantity ?? selected.quantity ?? selected.stock ?? 0));
        if (row.dataset.externalSource === '1') {
            stockInput.value = 'Внешняя аренда';
            quantityInput.removeAttribute('max');
        } else if (row.dataset.procurementMode === 'purchase_request' && Number(quantityInput.value || 0) > available) {
            const requestNumber = getIssuePurchaseRequestNumber(row);
            stockInput.value = requestNumber ? `Недостача ${Math.max(0, Number(quantityInput.value || 0) - available)} шт. • заявка ${requestNumber}` : `Недостача ${Math.max(0, Number(quantityInput.value || 0) - available)} шт. • заявка создана`;
            quantityInput.removeAttribute('max');
        } else {
            stockInput.value = `${baseAvailable} шт.`;
            quantityInput.max = String(Math.max(0, available));
        }
    } else {
        stockInput.value = '';
        quantityInput.removeAttribute('max');
        row.dataset.externalSource = '0';
        row.dataset.procurementMode = 'warehouse';
        row.dataset.autoPurchaseCreated = '0';
        row.dataset.autoPurchaseShortage = '0';
        row.dataset.autoPurchaseRequestNumber = '';
    }

    const isAsset = selected && String(selected.type || '') === 'asset';
    const requiresCondition = requiresIssueConditionCapture('event', document.getElementById('eventStatus')?.value);
    const shouldCaptureAcceptanceState = Boolean(requiresCondition && isAsset);
    if (conditionSelect) {
        conditionSelect.disabled = !shouldCaptureAcceptanceState;
        if (!shouldCaptureAcceptanceState) {
            conditionSelect.value = 'Хорошее';
        } else if (!conditionSelect.value) {
            conditionSelect.value = 'Хорошее';
        }
    }

    const shouldShowWriteoffControls = shouldCaptureAcceptanceState && conditionSelect?.value && conditionSelect.value !== 'Хорошее';
    if (writeoffDecisionWrap) {
        writeoffDecisionWrap.style.display = shouldShowWriteoffControls ? 'block' : 'none';
    }
    if (writeoffDecisionSelect) {
        writeoffDecisionSelect.disabled = !shouldShowWriteoffControls;
        if (!shouldShowWriteoffControls) {
            writeoffDecisionSelect.value = 'writeoff';
        } else if (!writeoffDecisionSelect.value) {
            writeoffDecisionSelect.value = 'writeoff';
        }
    }
    const shouldWriteoff = shouldShowWriteoffControls && normalizeWriteoffDecision(writeoffDecisionSelect?.value || 'writeoff') === 'writeoff';
    if (defectQuantityWrap) {
        defectQuantityWrap.style.display = shouldWriteoff ? 'block' : 'none';
    }
    if (defectQuantityInput) {
        const maxQty = Math.max(0, Number(quantityInput?.value || 0));
        defectQuantityInput.disabled = !shouldWriteoff;
        defectQuantityInput.max = String(maxQty);
        defectQuantityInput.min = '1';
        if (!shouldWriteoff) {
            defectQuantityInput.value = '';
        } else if (!defectQuantityInput.value) {
            defectQuantityInput.value = String(maxQty > 0 ? maxQty : 1);
        }
    }
    if (writeoffReasonWrap) {
        writeoffReasonWrap.style.display = shouldWriteoff ? 'block' : 'none';
    }
    if (writeoffReasonSelect) {
        writeoffReasonSelect.disabled = !shouldWriteoff;
        writeoffReasonSelect.required = false;
        writeoffReasonSelect.placeholder = conditionSelect?.value === 'Утрачено' ? 'Укажите причину утраты' : 'Укажите причину повреждения';
        if (!shouldWriteoff) {
            writeoffReasonSelect.value = '';
        } else if (!String(writeoffReasonSelect.value || '').trim()) {
            writeoffReasonSelect.value = getDefaultWriteoffReasonByCondition(conditionSelect?.value);
        }
    }
    if (writeoffCommentInput) {
        writeoffCommentInput.disabled = !shouldWriteoff;
        writeoffCommentInput.placeholder = 'Комментарий для акта списания';
        if (!shouldWriteoff) {
            writeoffCommentInput.value = '';
        }
    }

    if (conditionSelect && !conditionSelect.dataset.reasonBound) {
        conditionSelect.dataset.reasonBound = '1';
        conditionSelect.addEventListener('change', () => syncEventRowState(row));
    }
    if (writeoffDecisionSelect && !writeoffDecisionSelect.dataset.reasonBound) {
        writeoffDecisionSelect.dataset.reasonBound = '1';
        writeoffDecisionSelect.addEventListener('change', () => syncEventRowState(row));
    }

    applyRowCommentStage(row, 'event');
    refreshRowDocumentCommentButtons(row);

    const issue = updateRowStockIssueUi(row, 'event');
    updateEntityIssuesBanner('event');
    refreshEntityFinalizeButtonState('event');
    if (showWarnings && issue) {
        openStockDeficitModal(issue);
    }
}

function toggleRentalConditionFields() {
    const status = document.getElementById('rentalStatus')?.value || 'Черновик';
    const requiresCondition = requiresIssueConditionCapture('rental', status);
    const postBtn = document.getElementById('rentalPostBtn');
    const saveBtn = document.getElementById('rentalSaveBtn');
    if (postBtn) {
        postBtn.textContent = isRentalActiveStatus(status) ? 'Завершить' : 'Провести';
    }
    if (saveBtn) {
        saveBtn.style.display = isRentalCompletedStatus(status) ? 'none' : '';
        saveBtn.textContent = isRentalActiveStatus(status) ? 'Сохранить изменения' : 'Сохранить';
    }
    const hint = document.getElementById('rentalConditionHint');
    if (hint) {
        hint.textContent = requiresCondition
            ? 'В акте приемки укажите состояние ОС. Для Повреждено или Утрачено можно указать причину и комментарий.'
            : 'Сохранение в черновик не изменяет остатки. Проведение создает документы и выполняет движение по складу.';
    }

    updateRentalStatusInfoBlock(status);
    renderEntityProgress('rentalProgressLine', status);
    document.querySelectorAll('#rentalItemsBody tr').forEach(row => syncRentalRowState(row));
    updateEntityIssuesBanner('rental');

    refreshEntityFinalizeButtonState('rental');
}

function toggleEventConditionFields() {
    const status = document.getElementById('eventStatus')?.value || 'Черновик';
    const requiresCondition = requiresIssueConditionCapture('event', status);
    const postBtn = document.getElementById('eventPostBtn');
    const saveBtn = document.getElementById('eventSaveBtn');
    if (postBtn) {
        postBtn.textContent = isEventActiveStatus(status) ? 'Завершить' : 'Провести';
    }
    if (saveBtn) {
        saveBtn.style.display = isEventCompletedStatus(status) ? 'none' : '';
        saveBtn.textContent = isEventActiveStatus(status) ? 'Сохранить изменения' : 'Сохранить';
    }
    const hint = document.getElementById('eventConditionHint');
    if (hint) {
        hint.textContent = requiresCondition
            ? 'В акте приемки укажите состояние ОС. Для Повреждено или Утрачено можно указать причину и комментарий.'
            : 'Сохранение в черновик не изменяет остатки. Проведение создает документы и выполняет движение по складу.';
    }

    updateEventStatusInfoBlock(status);
    renderEntityProgress('eventProgressLine', status);
    document.querySelectorAll('#eventItemsBody tr').forEach(row => syncEventRowState(row));
    updateEntityIssuesBanner('event');

    refreshEntityFinalizeButtonState('event');
}

function addRentalItem() {
    addRentalItemWithData({});
}

function addRentalItemWithData(itemData = {}) {
    const tbody = document.getElementById('rentalItemsBody');
    const row = document.createElement('tr');
    row.dataset.rowUid = itemData.row_uid || itemData.rowUid || nextEntityFormRowId();
    row.dataset.originalQuantity = String(Number(itemData.quantity || 0));
    row.dataset.externalSource = itemData.external_source === true || itemData.externalSource === true ? '1' : '0';
    row.dataset.procurementMode = String(itemData.procurement_mode || itemData.procurementMode || 'warehouse');
    row.dataset.autoPurchaseCreated = itemData.procurement_mode === 'purchase_request' || itemData.procurementMode === 'purchase_request' ? '1' : '0';
    row.dataset.autoPurchaseRequestNumber = String(itemData.purchase_request_number || itemData.purchaseRequestNumber || '');
    row.dataset.autoPurchaseShortage = '0';

    const initialRentalDecision = normalizeWriteoffDecision(
        itemData.writeoff_decision || itemData.writeoffDecision || (Number(itemData.defective_quantity || itemData.defectiveQuantity || 0) > 0 ? 'writeoff' : 'keep'),
        'writeoff'
    );
    const parsedComments = parseDocumentComments(itemData.comment, itemData.notes || '');
    const issueComment = String(itemData.issue_comment || itemData.issueComment || parsedComments.issueComment || '').trim();
    const acceptanceComment = String(itemData.acceptance_comment || itemData.acceptanceComment || parsedComments.acceptanceComment || '').trim();
    const writeoffComment = String(itemData.writeoff_comment || itemData.writeoffComment || parsedComments.writeoffComment || '').trim();

    row.innerHTML = `
        <td>
            <select class="item-select">
                ${buildInventoryOptions(itemData.item_id || itemData.itemId, 'itemCategoryFilter', 'itemSearchInput')}
            </select>
        </td>
        <td>
            <input type="text" class="category-input" value="${escapeHtml(itemData.category || '')}" readonly>
        </td>
        <td>
            <input type="text" class="stock-info-input" readonly placeholder="Остаток">
        </td>
        <td>
            <input type="number" class="quantity-input" min="0" value="${Number(itemData.quantity || 1)}">
        </td>
        <td>
            <input type="number" class="price-input" min="0" step="0.01" value="${itemData.rent_price || itemData.rentPrice || ''}">
        </td>
        <td>
            <input type="text" class="item-issue-condition-input" value="${escapeHtml(itemData.issue_condition || itemData.issueCondition || 'Хорошее')}" readonly>
        </td>
        <td>
            <select class="item-condition-select">
                ${getConditionOptionsHtml(itemData.actual_condition || itemData.actualCondition || itemData.issue_condition || itemData.issueCondition || 'Хорошее')}
            </select>
        </td>
        <td>
            <div class="writeoff-decision-wrap" style="display:none; margin-top:6px;">
                <select class="writeoff-decision-select">
                    ${getWriteoffDecisionOptionsHtml(initialRentalDecision)}
                </select>
            </div>
            <div class="defect-quantity-wrap" style="display:none; margin-top:6px;">
                <input type="number" class="defect-quantity-input" min="1" value="${Math.max(1, Number(itemData.defective_quantity || itemData.defectiveQuantity || 1))}">
            </div>
        </td>
        <td>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button type="button" class="note-editor-button doc-note-button" data-note-role="issue" data-note-label="Акт выдачи/передачи" data-note-target=".issue-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Выдача</span>
                </button>
                <button type="button" class="note-editor-button doc-note-button" data-note-role="acceptance" data-note-label="Акт приемки" data-note-target=".acceptance-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Приемка</span>
                </button>
                <button type="button" class="note-editor-button doc-note-button" data-note-role="writeoff" data-note-label="Акт списания" data-note-target=".writeoff-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Списание</span>
                </button>
            </div>
            <textarea class="item-note-input issue-comment-input note-storage-field">${escapeHtml(issueComment)}</textarea>
            <textarea class="acceptance-comment-input note-storage-field">${escapeHtml(acceptanceComment)}</textarea>
            <div class="writeoff-reason-wrap" style="display:none;">
                <input type="text" class="writeoff-reason-select" value="${escapeHtml(itemData.writeoff_reason || itemData.writeoffReason || '')}" placeholder="Причина повреждения или утраты">
                <input type="text" class="writeoff-comment-input" value="${escapeHtml(writeoffComment)}" placeholder="Комментарий для акта списания" style="margin-top:6px;">
            </div>
        </td>
        <td>
            <span class="row-issue-badge ok item-stock-status">✅ Доступно</span>
        </td>
        <td>
            <div class="entity-item-actions">
                <button type="button" class="inline-action-btn item-fix-issue-btn" style="display:none;">Исправить</button>
                <button type="button" onclick="removeRentalItem(this)">Удалить</button>
            </div>
        </td>
    `;

    tbody.appendChild(row);

    const select = row.querySelector('.item-select');
    const quantityInput = row.querySelector('.quantity-input');
    const noteButton = row.querySelector('.note-editor-button');
    const fixButton = row.querySelector('.item-fix-issue-btn');

    select.addEventListener('change', () => syncRentalRowState(row, true));
    quantityInput.addEventListener('input', () => syncRentalRowState(row, false));
    quantityInput.addEventListener('change', () => syncRentalRowState(row, true));
    fixButton?.addEventListener('click', () => openStockDeficitResolutionByRowId('rental', row.dataset.rowUid));
    if (noteButton) refreshRowDocumentCommentButtons(row);

    syncRentalRowState(row);
}

function removeRentalItem(button) {
    button.closest('tr')?.remove();
    document.querySelectorAll('#rentalItemsBody tr').forEach(row => syncRentalRowState(row));
    updateEntityIssuesBanner('rental');
}

function filterItems() {
    document.querySelectorAll('#rentalItemsBody .item-select').forEach(select => {
        const currentValue = select.value;
        select.innerHTML = buildInventoryOptions(currentValue, 'itemCategoryFilter', 'itemSearchInput');
        if (currentValue) select.value = currentValue;
        const row = select.closest('tr');
        if (row) syncRentalRowState(row);
    });
}

async function openAddRentalModal() {
    if (!requirePermission('rental', 'create', 'Недостаточно прав для создания аренды')) return;
    editingRental = null;
    document.getElementById('rentalModalTitle').textContent = 'Добавить аренду';
    document.getElementById('rentalForm').reset();
    document.getElementById('rentalItemsBody').innerHTML = '';
    document.getElementById('rentalModal').style.display = 'block';
    setFormLoadingState('rentalFormLoading', true, 'Подготавливаю форму аренды...');

    try {
        await populateClientsSelect();
        await populateEmployeesSelect();

        const defaultRange = getDefaultDateTimeRange(24);
        document.getElementById('itemCategoryFilter').value = '';
        document.getElementById('itemSearchInput').value = '';
        document.getElementById('rentalStatus').value = 'Черновик';
        document.getElementById('rentalStartDate').value = defaultRange.start;
        document.getElementById('rentalEndDate').value = defaultRange.end;
        addRentalItem();

        document.getElementById('itemCategoryFilter').onchange = filterItems;
        document.getElementById('itemSearchInput').oninput = filterItems;

        toggleRentalConditionFields();
        renderEntityProgress('rentalProgressLine', 'черновик');
        await loadRelatedDocumentsForEntity('rental', null, 'rentalRelatedDocumentsSection', 'rentalRelatedDocumentsList');
        renderLinkedPurchaseRequests('rental');
        setEntityCardEditMode('rental', true);
    } finally {
        setFormLoadingState('rentalFormLoading', false);
    }
}

async function openEditRentalModal(rental, options = {}) {
    if (!requirePermission('rental', 'edit', 'Недостаточно прав для редактирования аренды')) return;
    editingRental = rental;
    document.getElementById('rentalModalTitle').textContent = 'Карточка аренды';
    document.getElementById('rentalForm').reset();
    document.getElementById('rentalItemsBody').innerHTML = '';
    document.getElementById('rentalModal').style.display = 'block';
    setFormLoadingState('rentalFormLoading', true, 'Загрузка данных аренды...');

    try {
        await populateClientsSelect();
        await populateEmployeesSelect();

        document.getElementById('itemCategoryFilter').value = '';
        document.getElementById('itemSearchInput').value = '';
        document.getElementById('rentalClient').value = rental.client_id || '';
        document.getElementById('rentalEmployee').value = rental.employee_id || '';
        document.getElementById('rentalStartDate').value = toDateTimeLocalValue(rental.start_date);
        document.getElementById('rentalEndDate').value = toDateTimeLocalValue(rental.end_date);
        document.getElementById('rentalStatus').value = options.forceCompletion ? 'Завершена' : (rental.status || 'Черновик');

        if (rental.items && rental.items.length > 0) {
            rental.items.forEach(item => addRentalItemWithData(item));
        } else {
            addRentalItem();
        }

        document.getElementById('itemCategoryFilter').onchange = filterItems;
        document.getElementById('itemSearchInput').oninput = filterItems;

        toggleRentalConditionFields();
        renderEntityProgress('rentalProgressLine', String(options.forceCompletion ? 'завершена' : (rental.status || 'черновик')));
        await loadRelatedDocumentsForEntity('rental', rental, 'rentalRelatedDocumentsSection', 'rentalRelatedDocumentsList');
        renderLinkedPurchaseRequests('rental');
        setEntityCardEditMode('rental', options.forceCompletion === true);
    } finally {
        setFormLoadingState('rentalFormLoading', false);
    }
}

function hasRentalDraftCandidateData() {
    const clientId = String(document.getElementById('rentalClient')?.value || '').trim();
    const employeeId = String(document.getElementById('rentalEmployee')?.value || '').trim();
    const startDate = String(document.getElementById('rentalStartDate')?.value || '').trim();
    const endDate = String(document.getElementById('rentalEndDate')?.value || '').trim();

    if (clientId || employeeId || startDate || endDate) return true;

    return Array.from(document.querySelectorAll('#rentalItemsBody tr')).some(row => {
        const itemId = String(row.querySelector('.item-select')?.value || '').trim();
        const quantity = String(row.querySelector('.quantity-input')?.value || '').trim();
        return Boolean(itemId || quantity);
    });
}

function isRentalDraftAutoSaveReady() {
    const clientId = String(document.getElementById('rentalClient')?.value || '').trim();
    const employeeId = String(document.getElementById('rentalEmployee')?.value || '').trim();
    const startDate = String(document.getElementById('rentalStartDate')?.value || '').trim();
    const endDate = String(document.getElementById('rentalEndDate')?.value || '').trim();

    if (!clientId || !employeeId || !startDate || !endDate) return false;

    const rows = Array.from(document.querySelectorAll('#rentalItemsBody tr'));
    let hasCompleteRow = false;

    for (const row of rows) {
        const itemId = String(row.querySelector('.item-select')?.value || '').trim();
        const quantity = String(row.querySelector('.quantity-input')?.value || '').trim();
        if (!itemId && !quantity) continue;
        if (!itemId || !quantity) return false;
        hasCompleteRow = true;
    }

    return hasCompleteRow;
}

async function tryAutoSaveRentalDraftOnClose() {
    const modal = document.getElementById('rentalModal');
    if (!modal || modal.style.display !== 'block') return false;
    if (editingRental?.id) return false;
    if (!hasRentalDraftCandidateData()) return false;
    if (!isRentalDraftAutoSaveReady()) return false;

    await handleRentalFormSubmit({
        preventDefault() {},
        submitter: { dataset: { submitMode: 'draft' } }
    });

    return modal.style.display !== 'block';
}

async function closeRentalModal(options = {}) {
    if (!options.skipAutoSave) {
        const saved = await tryAutoSaveRentalDraftOnClose();
        if (saved) return;
    }

    document.getElementById('rentalModal').style.display = 'none';
    document.getElementById('rentalForm').reset();
    document.getElementById('rentalItemsBody').innerHTML = '';
    const relatedList = document.getElementById('rentalRelatedDocumentsList');
    if (relatedList) relatedList.innerHTML = '';
    setFormLoadingState('rentalFormLoading', false);
    editingRental = null;
}

async function handleRentalFormSubmit(event) {
    event.preventDefault();

    if (!requirePermission('rental', editingRental?.id ? 'edit' : 'create', editingRental?.id ? 'Недостаточно прав для редактирования аренды' : 'Недостаточно прав для создания аренды')) return;

    const form = document.getElementById('rentalForm');
    const submitMode = event.submitter?.dataset.submitMode || form?.dataset.submitMode || 'draft';
    const allowReadonlyPost = submitMode === 'post' && isDraftStatus(editingRental?.status);
    if (editingRental?.id && form?.dataset.readonlyMode === '1' && !allowReadonlyPost) {
        showNotification('Сначала нажмите "Изменить", чтобы перейти в режим редактирования.', 'warning');
        return;
    }
    const clientId = document.getElementById('rentalClient').value;
    const employeeId = document.getElementById('rentalEmployee').value;
    const startDate = document.getElementById('rentalStartDate').value;
    const endDate = document.getElementById('rentalEndDate').value;
    const selectedStatus = document.getElementById('rentalStatus').value || 'Черновик';
    const isEditingNonDraftRental = editingRental?.id && !isDraftStatus(editingRental?.status);
    const status = submitMode === 'post'
        ? (isDraftStatus(selectedStatus) || selectedStatus === 'Проведен'
            ? 'Активна'
            : (isRentalActiveStatus(selectedStatus) ? 'Завершена' : selectedStatus))
        : (isEditingNonDraftRental ? selectedStatus : 'Черновик');
    const isFinalization = submitMode === 'post' && isRentalActiveStatus(selectedStatus);
    const isCompleted = isRentalCompletedStatus(status);
    const requiresCondition = requiresIssueConditionCapture('rental', status);
    const isDraft = isDraftStatus(status);

    if (!clientId) {
        showNotification('Выберите клиента.', 'error');
        return;
    }
    if (!employeeId) {
        showNotification('Выберите сотрудника.', 'error');
        return;
    }
    if (!startDate || !endDate) {
        showNotification('Укажите дату и время начала и окончания аренды.', 'error');
        return;
    }
    if (!isValidDateRange(startDate, endDate)) {
        showNotification('Дата начала аренды не может быть позже даты окончания.', 'error');
        return;
    }

    const items = [];
    const rows = document.querySelectorAll('#rentalItemsBody tr');

    document.querySelectorAll('#rentalItemsBody tr').forEach(row => syncRentalRowState(row));
    for (const row of rows) {
        const itemSelect = row.querySelector('.item-select');
        const quantityInput = row.querySelector('.quantity-input');
        const item = findInventoryItem(itemSelect?.value);
        if (!item) continue;
        const quantity = Number(quantityInput?.value || 0);
        const available = getRowAvailableStock(item.id, row, '#rentalItemsBody', '.item-select', '.quantity-input');
        const shortage = Math.max(0, quantity - available);
        if (shortage > 0 && row.dataset.externalSource !== '1' && row.dataset.procurementMode !== 'purchase_request' && isConsumableWithAutoPurchase(item)) {
            await createAutoPurchaseRequestBeforeSave(row, item, shortage, 'rental');
            syncRentalRowState(row, false);
        }
    }

    if (submitMode === 'post') {
        const issues = collectEntityStockIssues('rental', true);
        if (issues.length > 0) {
            updateEntityIssuesBanner('rental');
            openStockDeficitModal(issues[0]);
            showNotification('Исправьте проблемы с остатками перед проведением аренды', 'warning');
            return;
        }
    }

    for (const row of rows) {
        const itemSelect = row.querySelector('.item-select');
        const categoryInput = row.querySelector('.category-input');
        const quantityInput = row.querySelector('.quantity-input');
        const priceInput = row.querySelector('.price-input');
        const conditionSelect = row.querySelector('.item-condition-select');
        const issueConditionInput = row.querySelector('.item-issue-condition-input');
        const issueCommentInput = row.querySelector('.issue-comment-input') || row.querySelector('.item-note-input');
        const acceptanceCommentInput = row.querySelector('.acceptance-comment-input');

        if (!itemSelect.value || !quantityInput.value) {
            showNotification('Заполните все поля позиций.', 'error');
            return;
        }

        const itemId = itemSelect.value;
        const quantity = Number(quantityInput.value);
        const isExternalSource = row.dataset.externalSource === '1';
        const procurementMode = row.dataset.procurementMode || (isExternalSource ? 'external_rental' : 'warehouse');
        const rentPrice = priceInput.value ? Number(priceInput.value) : null;
        const selectedItem = findInventoryItem(itemId);

        if (!selectedItem) {
            showNotification(`Предмет с ID ${itemId} не найден в инвентаре.`, 'error');
            return;
        }

        const available = getRowAvailableStock(itemId, row, '#rentalItemsBody', '.item-select', '.quantity-input');
        if (Number.isNaN(quantity) || quantity < 0 || (!isDraft && quantity <= 0)) {
            showNotification(isDraft ? 'Количество не может быть отрицательным.' : 'Количество должно быть положительным числом.', 'error');
            return;
        }
        if (!isDraft && !isExternalSource && quantity > available && procurementMode !== 'purchase_request' && !isConsumableWithAutoPurchase(selectedItem)) {
            showNotification(`Нельзя выдать больше, чем есть на складе для «${selectedItem.name}». Доступно: ${available} шт.`, 'error');
            return;
        }

        const writeoffReasonSelect = row.querySelector('.writeoff-reason-select');
        const writeoffCommentInput = row.querySelector('.writeoff-comment-input');
        const writeoffDecisionSelect = row.querySelector('.writeoff-decision-select');
        const defectQuantityInput = row.querySelector('.defect-quantity-input');
        const isAsset = String(selectedItem.type || '').toLowerCase() === 'asset';
        const issueCondition = String(issueConditionInput?.value || 'Хорошее').trim() || 'Хорошее';
        const actualCondition = requiresCondition && isAsset ? (conditionSelect.value || issueCondition || 'Хорошее') : issueCondition;
        const needsWriteoffDecision = requiresCondition && isAsset && actualCondition !== 'Хорошее';
        const writeoffDecision = needsWriteoffDecision
            ? normalizeWriteoffDecision(writeoffDecisionSelect?.value || 'writeoff', 'writeoff')
            : 'writeoff';
        const shouldWriteoff = needsWriteoffDecision && writeoffDecision === 'writeoff';
        const writeoffReason = shouldWriteoff
            ? (String(writeoffReasonSelect?.value || '').trim() || getDefaultWriteoffReasonByCondition(actualCondition))
            : '';
        const issueComment = String(issueCommentInput?.value || '').trim();
        const acceptanceComment = String(acceptanceCommentInput?.value || issueComment || '').trim();
        const writeoffComment = shouldWriteoff
            ? String(writeoffCommentInput?.value || acceptanceComment || issueComment || '').trim()
            : String(writeoffCommentInput?.value || '').trim();
        const packedComment = buildPackedDocumentComments({ issueComment, acceptanceComment, writeoffComment });
        const defectiveQuantityRaw = shouldWriteoff
            ? Number(defectQuantityInput?.value || 0)
            : 0;
        const defectiveQuantity = Math.min(quantity, Math.max(0, Number.isFinite(defectiveQuantityRaw) ? defectiveQuantityRaw : 0));
        if (shouldWriteoff && defectiveQuantity <= 0) {
            showNotification(`Для «${selectedItem.name}» укажите количество дефектных единиц больше 0.`, 'error');
            return;
        }

        items.push({
            item_id: itemId,
            category: categoryInput.value || selectedItem.category,
            quantity,
            rent_price: rentPrice,
            issue_condition: issueCondition,
            actual_condition: actualCondition,
            return_status: getReturnStatusFromCondition(actualCondition),
            defective_quantity: defectiveQuantity,
            writeoff_decision: writeoffDecision,
            external_source: isExternalSource,
            procurement_mode: procurementMode,
            writeoff_reason: writeoffReason,
            writeoff_comment: writeoffComment,
            issue_comment: issueComment,
            acceptance_comment: acceptanceComment,
            comment: packedComment
        });
    }

    if (items.length === 0) {
        showNotification('Добавьте хотя бы одну позицию.', 'error');
        return;
    }

    const payload = {
        client_id: clientId,
        employee_id: employeeId,
        start_date: startDate,
        end_date: endDate,
        status,
        items
    };

    if (isCompleted) {
        const completionValidation = getEntityCompletionValidation('rental');
        if (!completionValidation.ready) {
            showNotification(completionValidation.message || 'Заполните данные приемки перед завершением.', 'error');
            return;
        }
        payload.acceptance_act_number = generateAcceptanceActNumber();
    }

    try {
        if (submitMode === 'post' && editingRental?.id && editingRental?.issuance_act_id) {
            throw new Error('Документ уже создан. Для изменений используйте корректировку.');
        }

        let savedRentalId = Number(editingRental?.id || 0);
        if (editingRental?.id) {
            await apiFetch(`/api/rentals/${editingRental.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showNotification(isDraft ? 'Черновик аренды обновлен.' : 'Аренда проведена успешно.', 'success');
        } else {
            const createResult = await apiFetch('/api/rentals/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            savedRentalId = Number(createResult?.rental_id || 0);
            showNotification(isDraft ? 'Черновик аренды создан.' : 'Аренда проведена успешно.', 'success');
        }

        const shouldOfferAcceptance = status === 'Завершена' && typeof generateAcceptanceAct === 'function';
        const completedRental = { ...(editingRental || {}), ...payload, client_name: clients.find(client => String(client.id) === String(clientId))?.name || '', employee_name: employees.find(employee => String(employee.id) === String(employeeId))?.name || '' };
        if (status === 'Завершена') {
            completedRental.acceptance_act_number = ensureAcceptanceDocumentRecord('rental', completedRental) || completedRental.acceptance_act_number;
        }

        await loadData();

        if (submitMode === 'post' && !isFinalization && status === 'Активна') {
            const nextId = savedRentalId || Number(editingRental?.id || 0);
            const reloadedRental = findRentalById(nextId) || completedRental;
            editingRental = { ...reloadedRental };
            document.getElementById('rentalStatus').value = 'Активна';
            setEntityCardEditMode('rental', true);
            document.querySelectorAll('#rentalItemsBody .item-condition-select').forEach(select => {
                if (!String(select.value || '').trim()) return;
                select.value = '';
            });
            document.querySelectorAll('#rentalItemsBody .defect-quantity-input').forEach(input => {
                input.value = '';
            });
            toggleRentalConditionFields();
            showNotification('1-е проведение выполнено. Заполните «Состояние ПОСЛЕ» и нажмите «Завершить».', 'info');
            return;
        }

        closeRentalModal({ skipAutoSave: true });

        if (shouldOfferAcceptance) {
            generateAcceptanceAct(completedRental);
        }
    } catch (error) {
        console.error('Ошибка сохранения аренды:', error);
        showNotification(error.message || 'Ошибка при записи аренды', 'error');
    }
}

function selectAllRentals() {
    const isChecked = document.getElementById('selectAllRentals').checked;
    document.querySelectorAll('.rental-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
}

function deleteSelectedRentals() {
    if (!requirePermission('rental', 'delete', 'Недостаточно прав для удаления аренды')) return;
    const checkboxes = document.querySelectorAll('.rental-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification('⚠ Выберите аренды для удаления', 'warning');
        return;
    }

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить ${checkboxes.length} выбранных аренд?`,
        async () => {
            const selectedIds = Array.from(checkboxes).map(cb => {
                const rental = rentals[Number(cb.dataset.index)];
                return rental?.id;
            }).filter(Boolean);

            try {
                await Promise.all(selectedIds.map(id => apiFetch(`/api/rentals/${id}`, { method: 'DELETE' })));
                showNotification(`✓ ${selectedIds.length} аренд удалено`, 'success');
                await loadData();
            } catch (error) {
                console.error('Ошибка удаления аренды:', error);
                showNotification(error.message || 'Ошибка при удалении аренды', 'error');
            }
        }
    );
}

async function conductSelectedRentals() {
    if (!requirePermission('rental', 'changeStatus', 'Недостаточно прав для проведения аренды')) return;

    const selected = Array.from(document.querySelectorAll('.rental-checkbox:checked'))
        .map(cb => rentals[Number(cb.dataset.index)])
        .filter(entry => {
            if (!entry) return false;
            const normalizedStatus = String(entry.status || '').trim();
            const isDraftOrPlanned = isDraftStatus(normalizedStatus) || isPlannedStatus(normalizedStatus);
            const isActiveWithoutAcceptance = isRentalActiveStatus(normalizedStatus) && !hasAcceptanceDocumentForEntity('rental', entry);
            const isCompletedMissingDocs = isRentalCompletedStatus(normalizedStatus)
                && (!hasIssuanceDocumentForEntity('rental', entry) || !hasAcceptanceDocumentForEntity('rental', entry));
            return isDraftOrPlanned || isActiveWithoutAcceptance || isCompletedMissingDocs;
        });

    if (!selected.length) {
        showNotification('Выберите записи со статусами Черновик/Планируется/Активна/Завершена, где есть недостающие документы.', 'warning');
        return;
    }

    try {
        let issuanceCreated = 0;
        let acceptanceCreated = 0;
        let statusUpdated = 0;
        let completedUpdated = 0;
        for (const entry of selected) {
            const normalizedStatus = String(entry.status || '').trim();
            const isCompleted = isRentalCompletedStatus(normalizedStatus);
            const isActive = isRentalActiveStatus(normalizedStatus);
            const isPlannedOrDraft = isDraftStatus(normalizedStatus) || isPlannedStatus(normalizedStatus);

            if (isCompleted) {
                if (!hasIssuanceDocumentForEntity('rental', entry) && ensureIssuanceDocumentRecord('rental', entry)) {
                    issuanceCreated += 1;
                }
                if (!hasAcceptanceDocumentForEntity('rental', entry) && ensureAcceptanceDocumentRecord('rental', entry)) {
                    acceptanceCreated += 1;
                }
                continue;
            }

            if (isActive) {
                const acceptanceNumber = String(entry.acceptance_act_number || entry.acceptanceActNumber || '').trim()
                    || (typeof generateAcceptanceActNumber === 'function' ? generateAcceptanceActNumber() : '');
                await apiFetch(`/api/rentals/${entry.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: 'Завершена',
                        items: Array.isArray(entry.items) ? entry.items : [],
                        acceptance_act_number: acceptanceNumber
                    })
                });
                completedUpdated += 1;
                if (!hasAcceptanceDocumentForEntity('rental', entry)
                    && ensureAcceptanceDocumentRecord('rental', { ...entry, acceptance_act_number: acceptanceNumber })) {
                    acceptanceCreated += 1;
                }
                continue;
            }

            if (isPlannedOrDraft) {
                await apiFetch(`/api/rentals/${entry.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: 'Активна' })
                });
                statusUpdated += 1;
                if (!hasIssuanceDocumentForEntity('rental', entry) && ensureIssuanceDocumentRecord('rental', entry)) {
                    issuanceCreated += 1;
                }
            }
        }
        await loadData();
        showNotification(`Переведено в Активна: ${statusUpdated}. Переведено в Завершена: ${completedUpdated}. Добавлено актов передачи/выдачи: ${issuanceCreated}. Добавлено актов приемки: ${acceptanceCreated}.`, 'success');
    } catch (error) {
        console.error('Ошибка массового проведения аренды:', error);
        showNotification(error.message || 'Ошибка массового проведения аренды', 'error');
    }
}

function deleteAllRentalDrafts() {
    if (!requirePermission('rental', 'delete', 'Недостаточно прав для удаления аренды')) return;

    const drafts = rentals.filter(entry => isDraftStatus(entry.status));
    if (!drafts.length) {
        showNotification('Черновики аренды не найдены.', 'warning');
        return;
    }

    showConfirmModal(
        'Удаление черновиков аренды',
        `Удалить все черновики аренды (${drafts.length})?`,
        async () => {
            try {
                for (const draft of drafts) {
                    await apiFetch(`/api/rentals/${draft.id}`, { method: 'DELETE' });
                }
                await loadData();
                showNotification(`Удалено черновиков аренды: ${drafts.length}`, 'success');
            } catch (error) {
                console.error('Ошибка удаления черновиков аренды:', error);
                showNotification(error.message || 'Ошибка удаления черновиков аренды', 'error');
            }
        }
    );
}

// ============================================================================
// Events
// ============================================================================

function getEventStatusOptions(currentStatus) {
    const statusList = ['Черновик', 'Проведен', 'Активно', 'Завершено', 'Просрочена'];
    return statusList.map(status => `
        <option value="${status}" ${status === currentStatus ? 'selected' : ''}>${status}</option>
    `).join('');
}

function getEventStatusClass(status) {
    return getStatusMeta(status).rowClass;
}

function renderEventsTable() {
    const tableBody = document.getElementById('tableEvents');
    if (!tableBody) return;

    populateEventFilterOptions();

    const filters = getEventsFilters();
    const searchValue = String(filters.search || '').toLowerCase();
    const locationValue = String(filters.location || '').toLowerCase();
    const dateFrom = parseDateValue(filters.dateFrom);
    const dateTo = parseDateValue(filters.dateTo);

    const filteredEvents = events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => {
            const startDate = parseDateValue(event.start_date);
            const matchesSearch = !searchValue || String(event.name || '').toLowerCase().includes(searchValue);
            const matchesStatus = !filters.status || event.status === filters.status;
            const matchesLocation = !locationValue || String(event.location || '').toLowerCase().includes(locationValue);
            const matchesEmployee = !filters.employeeId || String(event.employee_id || '') === String(filters.employeeId);
            const matchesDateFrom = !dateFrom || (startDate && startDate.getTime() >= dateFrom.getTime());
            const matchesDateTo = !dateTo || (startDate && startDate.getTime() <= dateTo.getTime());

            return matchesSearch && matchesStatus && matchesLocation && matchesEmployee && matchesDateFrom && matchesDateTo;
        });

    tableBody.innerHTML = '';

    if (filteredEvents.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="empty-table-message">По заданным фильтрам мероприятия не найдены. Что сделать: сбросьте фильтры или нажмите «Добавить мероприятие».</td></tr>';
        return;
    }

    filteredEvents.forEach(({ event, index }) => {
        const row = document.createElement('tr');
        row.className = getEventStatusClass(event.status);

        const canConductEvent = RBAC.hasPermission('events', 'changeStatus')
            && (
                isDraftStatus(event.status)
                || isEventCompletedStatus(event.status)
                || isEventActiveStatus(event.status)
                || isPlannedStatus(event.status)
            );

        const conductBlockReason = canConductEvent ? '' : getConductBlockReason('event', event);
        row.innerHTML = `
            <td><input type="checkbox" class="event-checkbox" data-index="${index}"></td>
            <td>${escapeHtml(event.name)}</td>
            <td class="datetime-display">${escapeHtml(formatDateTime(event.start_date, '—'))}</td>
            <td class="datetime-display">${escapeHtml(formatDateTime(event.end_date, '—'))}</td>
            <td>${escapeHtml(event.location || '')}</td>
            <td>${escapeHtml(event.employee_name || '')}</td>
            <td title="${escapeHtml(getEntityStatusTooltip('event', event))}">${renderStatusBadge(event.status)} ${getEntityDocumentBadges('event', event)}</td>
            <td>
                ${RBAC.hasPermission('events', 'edit') ? '<button type="button" class="inline-action-btn event-edit-btn">Открыть</button>' : ''}
                ${canConductEvent
                    ? '<button type="button" class="inline-action-btn event-conduct-btn">Провести</button>'
                    : `<button type="button" class="inline-action-btn" disabled title="${escapeHtml(conductBlockReason || 'Недоступно для текущего статуса')}">Провести</button>`}
            </td>
        `;

        row.addEventListener('dblclick', () => openEditEventModal(event));
        tableBody.appendChild(row);

        row.querySelector('.event-edit-btn')?.addEventListener('click', async (eventClick) => {
            eventClick.stopPropagation();
            await openEditEventModal(event);
        });

        row.querySelector('.event-conduct-btn')?.addEventListener('click', async (eventClick) => {
            eventClick.stopPropagation();

            const status = String(event.status || '').trim();
            const isActive = isEventActiveStatus(status);
            const isPlannedOrDraft = isDraftStatus(status) || isPlannedStatus(status);

            if (isEventCompletedStatus(event.status)) {
                const issuanceBefore = hasIssuanceDocumentForEntity('event', event);
                const acceptanceBefore = hasAcceptanceDocumentForEntity('event', event);
                const issuanceNumber = issuanceBefore ? '' : ensureIssuanceDocumentRecord('event', event);
                const acceptanceNumber = acceptanceBefore ? '' : ensureAcceptanceDocumentRecord('event', event);
                event.issuance_act_number = issuanceNumber || event.issuance_act_number;
                event.acceptance_act_number = acceptanceNumber || event.acceptance_act_number;
                renderEventsTable();

                if (issuanceBefore && acceptanceBefore) {
                    showNotification('Для завершенного мероприятия оба документа уже проведены.', 'info');
                } else {
                    showNotification('Для завершенного мероприятия проведены недостающие документы (акт передачи/выдачи и акт приемки).', 'success');
                }
                return;
            }

            if (isActive) {
                const acceptanceNumber = String(event.acceptance_act_number || event.acceptanceActNumber || '').trim()
                    || (typeof generateAcceptanceActNumber === 'function' ? generateAcceptanceActNumber() : '');

                await apiFetch(`/api/events/${event.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: 'Завершено',
                        items: Array.isArray(event.items) ? event.items : [],
                        acceptance_act_number: acceptanceNumber
                    })
                });

                if (!hasAcceptanceDocumentForEntity('event', event)) {
                    const number = ensureAcceptanceDocumentRecord('event', {
                        ...event,
                        acceptance_act_number: acceptanceNumber
                    });
                    event.acceptance_act_number = number || acceptanceNumber || event.acceptance_act_number;
                }

                await loadData();
                showNotification('Статус мероприятия изменён на «Завершено», акт приемки создан/актуализирован.', 'success');
                return;
            }

            if (isPlannedOrDraft) {
                await updateEventStatus(event.id, 'Активно', event);
                await loadData();
                return;
            }

            await updateEventStatus(event.id, 'Активно', event);
        });
    });
}

async function updateEventStatus(eventId, status, eventObj) {
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
        if ((status === 'Активно' || status === 'Проведен' || status === 'Просрочена') && eventObj?.issuance_act_id && isEventConductedStatus(eventObj?.status)) {
            showNotification('Документ уже проведен. Изменения можно внести только через корректировку.', 'warning');
            return;
        }

        await apiFetch(`/api/events/${eventId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status }),
            timeoutMs: API_FAST_TIMEOUT_MS
        });

        eventObj.status = status;
        renderEventsTable();
        saveLocalBackup();

        if (status === 'Активно' && typeof generateIssuanceActForEvent === 'function') {
            const ok = confirm('Мероприятие активно. Сформировать акт выдачи?');
            if (ok) generateIssuanceActForEvent(eventObj);
        }

        showNotification('Статус мероприятия обновлён', 'success');
    } catch (error) {
        console.error('Ошибка обновления статуса мероприятия:', error);
        showNotification(error.message || 'Ошибка при обновлении статуса', 'error');
        await loadData();
    }
}

async function populateEmployeesSelectForEvent() {
    if (employees.length === 0) await fetchEmployees(false);

    const select = document.getElementById('eventEmployee');
    select.innerHTML = '<option value="">Выберите сотрудника</option>';

    employees.forEach(employee => {
        const option = document.createElement('option');
        option.value = employee.id;
        option.textContent = employee.name;
        select.appendChild(option);
    });
}

function addEventItem() {
    addEventItemWithData({});
}

function addEventItemWithData(itemData = {}) {
    const tbody = document.getElementById('eventItemsBody');
    const row = document.createElement('tr');
    row.dataset.rowUid = itemData.row_uid || itemData.rowUid || nextEntityFormRowId();
    row.dataset.originalQuantity = String(Number(itemData.quantity || 0));
    row.dataset.externalSource = itemData.external_source === true || itemData.externalSource === true ? '1' : '0';
    row.dataset.procurementMode = String(itemData.procurement_mode || itemData.procurementMode || 'warehouse');
    row.dataset.autoPurchaseCreated = itemData.procurement_mode === 'purchase_request' || itemData.procurementMode === 'purchase_request' ? '1' : '0';
    row.dataset.autoPurchaseRequestNumber = String(itemData.purchase_request_number || itemData.purchaseRequestNumber || '');
    row.dataset.autoPurchaseShortage = '0';

    const defaultTransferDate = toDateTimeLocalValue(
        itemData.transfer_date || itemData.transferDate,
        parseDateValue(document.getElementById('eventStartDate')?.value)
    );
    const defaultReturnDate = toDateTimeLocalValue(
        itemData.return_date || itemData.returnDate,
        parseDateValue(document.getElementById('eventEndDate')?.value)
    );

    const initialEventDecision = normalizeWriteoffDecision(
        itemData.writeoff_decision || itemData.writeoffDecision || (Number(itemData.defective_quantity || itemData.defectiveQuantity || 0) > 0 ? 'writeoff' : 'keep'),
        'writeoff'
    );
    const parsedComments = parseDocumentComments(itemData.comment, itemData.notes || '');
    const issueComment = String(itemData.issue_comment || itemData.issueComment || parsedComments.issueComment || '').trim();
    const acceptanceComment = String(itemData.acceptance_comment || itemData.acceptanceComment || parsedComments.acceptanceComment || '').trim();
    const writeoffComment = String(itemData.writeoff_comment || itemData.writeoffComment || parsedComments.writeoffComment || '').trim();

    row.innerHTML = `
        <td>
            <select class="event-item-select">
                ${buildInventoryOptions(itemData.item_id || itemData.itemId, 'eventItemCategoryFilter', 'eventItemSearchInput')}
            </select>
        </td>
        <td>
            <input type="text" class="event-category-input" value="${escapeHtml(itemData.category || '')}" readonly>
        </td>
        <td>
            <input type="text" class="event-stock-info-input" readonly placeholder="Остаток">
        </td>
        <td>
            <input type="number" class="event-quantity-input" min="0" value="${Number(itemData.quantity || 1)}">
        </td>
        <td>
            <input type="datetime-local" class="event-transfer-date-input" step="60" value="${escapeHtml(defaultTransferDate)}">
        </td>
        <td>
            <input type="datetime-local" class="event-return-date-input" step="60" value="${escapeHtml(defaultReturnDate)}">
        </td>
        <td>
            <input type="text" class="event-issue-condition-input" value="${escapeHtml(itemData.issue_condition || itemData.issueCondition || 'Хорошее')}" readonly>
        </td>
        <td>
            <select class="event-condition-select">
                ${getConditionOptionsHtml(itemData.actual_condition || itemData.actualCondition || itemData.issue_condition || itemData.issueCondition || 'Хорошее')}
            </select>
        </td>
        <td>
            <div class="writeoff-decision-wrap" style="display:none; margin-top:6px;">
                <select class="writeoff-decision-select">
                    ${getWriteoffDecisionOptionsHtml(initialEventDecision)}
                </select>
            </div>
            <div class="defect-quantity-wrap" style="display:none; margin-top:6px;">
                <input type="number" class="defect-quantity-input" min="1" value="${Math.max(1, Number(itemData.defective_quantity || itemData.defectiveQuantity || 1))}">
            </div>
        </td>
        <td>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button type="button" class="note-editor-button doc-note-button" data-note-role="issue" data-note-label="Акт выдачи" data-note-target=".issue-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Выдача</span>
                </button>
                <button type="button" class="note-editor-button doc-note-button" data-note-role="acceptance" data-note-label="Акт приемки" data-note-target=".acceptance-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Приемка</span>
                </button>
                <button type="button" class="note-editor-button doc-note-button" data-note-role="writeoff" data-note-label="Акт списания" data-note-target=".writeoff-comment-input" onclick="openNoteEditor(this)">
                    <span>📝</span>
                    <span class="note-button-text">Списание</span>
                </button>
            </div>
            <textarea class="event-note-input issue-comment-input note-storage-field">${escapeHtml(issueComment)}</textarea>
            <textarea class="acceptance-comment-input note-storage-field">${escapeHtml(acceptanceComment)}</textarea>
            <div class="writeoff-reason-wrap" style="display:none;">
                <input type="text" class="writeoff-reason-select" value="${escapeHtml(itemData.writeoff_reason || itemData.writeoffReason || '')}" placeholder="Причина повреждения или утраты">
                <input type="text" class="writeoff-comment-input" value="${escapeHtml(writeoffComment)}" placeholder="Комментарий для акта списания" style="margin-top:6px;">
            </div>
        </td>
        <td>
            <span class="row-issue-badge ok event-item-status">✅ Доступно</span>
        </td>
        <td>
            <div class="entity-item-actions">
                <button type="button" class="inline-action-btn event-fix-issue-btn" style="display:none;">Исправить</button>
                <button type="button" onclick="removeEventItem(this)">Удалить</button>
            </div>
        </td>
    `;

    tbody.appendChild(row);

    const select = row.querySelector('.event-item-select');
    const quantityInput = row.querySelector('.event-quantity-input');
    const noteButton = row.querySelector('.note-editor-button');
    const fixButton = row.querySelector('.event-fix-issue-btn');

    select.addEventListener('change', () => syncEventRowState(row, true));
    quantityInput.addEventListener('input', () => syncEventRowState(row, false));
    quantityInput.addEventListener('change', () => syncEventRowState(row, true));
    fixButton?.addEventListener('click', () => openStockDeficitResolutionByRowId('event', row.dataset.rowUid));
    if (noteButton) refreshRowDocumentCommentButtons(row);

    syncEventRowState(row);
}

function removeEventItem(button) {
    button.closest('tr')?.remove();
    document.querySelectorAll('#eventItemsBody tr').forEach(row => syncEventRowState(row));
    updateEntityIssuesBanner('event');
}

function filterEventItems() {
    document.querySelectorAll('#eventItemsBody .event-item-select').forEach(select => {
        const currentValue = select.value;
        select.innerHTML = buildInventoryOptions(currentValue, 'eventItemCategoryFilter', 'eventItemSearchInput');
        if (currentValue) select.value = currentValue;
        const row = select.closest('tr');
        if (row) syncEventRowState(row);
    });
}

async function openAddEventModal() {
    if (!requirePermission('events', 'create', 'Недостаточно прав для создания мероприятий')) return;
    editingEvent = null;
    document.getElementById('eventModalTitle').textContent = 'Добавить мероприятие';
    document.getElementById('eventForm').reset();
    document.getElementById('eventItemsBody').innerHTML = '';
    document.getElementById('eventModal').style.display = 'block';
    setFormLoadingState('eventFormLoading', true, 'Подготавливаю форму мероприятия...');

    try {
        await populateEmployeesSelectForEvent();
        const defaultRange = getDefaultDateTimeRange(3);
        document.getElementById('eventItemCategoryFilter').value = '';
        document.getElementById('eventItemSearchInput').value = '';
        document.getElementById('eventStatus').value = 'Черновик';
        document.getElementById('eventStartDate').value = defaultRange.start;
        document.getElementById('eventEndDate').value = defaultRange.end;
        addEventItem();

        document.getElementById('eventItemCategoryFilter').onchange = filterEventItems;
        document.getElementById('eventItemSearchInput').oninput = filterEventItems;

        toggleEventConditionFields();
        renderEntityProgress('eventProgressLine', 'черновик');
        await loadRelatedDocumentsForEntity('event', null, 'eventRelatedDocumentsSection', 'eventRelatedDocumentsList');
        renderLinkedPurchaseRequests('event');
        setEntityCardEditMode('event', true);
    } finally {
        setFormLoadingState('eventFormLoading', false);
    }
}

async function openEditEventModal(event, options = {}) {
    if (!requirePermission('events', 'edit', 'Недостаточно прав для редактирования мероприятий')) return;
    editingEvent = event;
    document.getElementById('eventModalTitle').textContent = 'Карточка мероприятия';
    document.getElementById('eventForm').reset();
    document.getElementById('eventItemsBody').innerHTML = '';
    document.getElementById('eventModal').style.display = 'block';
    setFormLoadingState('eventFormLoading', true, 'Загрузка данных мероприятия...');

    try {
        await populateEmployeesSelectForEvent();

        document.getElementById('eventItemCategoryFilter').value = '';
        document.getElementById('eventItemSearchInput').value = '';
        document.getElementById('eventName').value = event.name || '';
        document.getElementById('eventStartDate').value = toDateTimeLocalValue(event.start_date);
        document.getElementById('eventEndDate').value = toDateTimeLocalValue(event.end_date);
        document.getElementById('eventLocation').value = event.location || '';
        document.getElementById('eventEmployee').value = event.employee_id || '';
        document.getElementById('eventStatus').value = options.forceCompletion ? 'Завершено' : (event.status || 'Черновик');

        if (event.items && event.items.length > 0) {
            event.items.forEach(item => addEventItemWithData(item));
        } else {
            addEventItem();
        }

        document.getElementById('eventItemCategoryFilter').onchange = filterEventItems;
        document.getElementById('eventItemSearchInput').oninput = filterEventItems;

        toggleEventConditionFields();
        renderEntityProgress('eventProgressLine', String(options.forceCompletion ? 'завершено' : (event.status || 'черновик')));
        await loadRelatedDocumentsForEntity('event', event, 'eventRelatedDocumentsSection', 'eventRelatedDocumentsList');
        renderLinkedPurchaseRequests('event');
        setEntityCardEditMode('event', options.forceCompletion === true);
    } finally {
        setFormLoadingState('eventFormLoading', false);
    }
}

function hasEventDraftCandidateData() {
    const name = String(document.getElementById('eventName')?.value || '').trim();
    const startDate = String(document.getElementById('eventStartDate')?.value || '').trim();
    const endDate = String(document.getElementById('eventEndDate')?.value || '').trim();
    const location = String(document.getElementById('eventLocation')?.value || '').trim();
    const employeeId = String(document.getElementById('eventEmployee')?.value || '').trim();

    if (name || startDate || endDate || location || employeeId) return true;

    return Array.from(document.querySelectorAll('#eventItemsBody tr')).some(row => {
        const itemId = String(row.querySelector('.event-item-select')?.value || '').trim();
        const quantity = String(row.querySelector('.event-quantity-input')?.value || '').trim();
        return Boolean(itemId || quantity);
    });
}

function isEventDraftAutoSaveReady() {
    const startDate = String(document.getElementById('eventStartDate')?.value || '').trim();
    const endDate = String(document.getElementById('eventEndDate')?.value || '').trim();
    const employeeId = String(document.getElementById('eventEmployee')?.value || '').trim();

    if (!employeeId || !startDate || !endDate) return false;

    const rows = Array.from(document.querySelectorAll('#eventItemsBody tr'));
    let hasCompleteRow = false;

    for (const row of rows) {
        const itemId = String(row.querySelector('.event-item-select')?.value || '').trim();
        const quantity = String(row.querySelector('.event-quantity-input')?.value || '').trim();
        if (!itemId && !quantity) continue;
        if (!itemId || !quantity) return false;
        hasCompleteRow = true;
    }

    return hasCompleteRow;
}

async function tryAutoSaveEventDraftOnClose() {
    const modal = document.getElementById('eventModal');
    if (!modal || modal.style.display !== 'block') return false;
    if (editingEvent?.id) return false;
    if (!hasEventDraftCandidateData()) return false;
    if (!isEventDraftAutoSaveReady()) return false;

    await handleEventFormSubmit({
        preventDefault() {},
        submitter: { dataset: { submitMode: 'draft' } }
    });

    return modal.style.display !== 'block';
}

async function closeEventModal(options = {}) {
    if (!options.skipAutoSave) {
        const saved = await tryAutoSaveEventDraftOnClose();
        if (saved) return;
    }

    document.getElementById('eventModal').style.display = 'none';
    document.getElementById('eventForm').reset();
    document.getElementById('eventItemsBody').innerHTML = '';
    const relatedList = document.getElementById('eventRelatedDocumentsList');
    if (relatedList) relatedList.innerHTML = '';
    setFormLoadingState('eventFormLoading', false);
    editingEvent = null;
}

async function handleEventFormSubmit(event) {
    event.preventDefault();

    if (!requirePermission('events', editingEvent?.id ? 'edit' : 'create', editingEvent?.id ? 'Недостаточно прав для редактирования мероприятий' : 'Недостаточно прав для создания мероприятий')) return;

    const form = document.getElementById('eventForm');
    const submitMode = event.submitter?.dataset.submitMode || form?.dataset.submitMode || 'draft';
    const allowReadonlyPost = submitMode === 'post' && isDraftStatus(editingEvent?.status);
    if (editingEvent?.id && form?.dataset.readonlyMode === '1' && !allowReadonlyPost) {
        showNotification('Сначала нажмите "Изменить", чтобы перейти в режим редактирования.', 'warning');
        return;
    }
    const name = document.getElementById('eventName').value.trim();
    const startDate = document.getElementById('eventStartDate').value;
    const endDate = document.getElementById('eventEndDate').value;
    const location = document.getElementById('eventLocation').value.trim();
    const employeeId = document.getElementById('eventEmployee').value;
    const selectedStatus = document.getElementById('eventStatus').value || 'Черновик';
    const isEditingNonDraftEvent = editingEvent?.id && !isDraftStatus(editingEvent?.status);
    const status = submitMode === 'post'
        ? (isDraftStatus(selectedStatus) || selectedStatus === 'Проведен'
            ? 'Активно'
            : (isEventActiveStatus(selectedStatus) ? 'Завершено' : selectedStatus))
        : (isEditingNonDraftEvent ? selectedStatus : 'Черновик');
    const isFinalization = submitMode === 'post' && isEventActiveStatus(selectedStatus);
    const isCompleted = isEventCompletedStatus(status);
    const requiresCondition = requiresIssueConditionCapture('event', status);
    const isDraft = isDraftStatus(status);

    if (!employeeId) {
        showNotification('Выберите сотрудника.', 'error');
        return;
    }
    if (!startDate || !endDate) {
        showNotification('Укажите дату и время начала и окончания мероприятия.', 'error');
        return;
    }
    if (!isValidDateRange(startDate, endDate)) {
        showNotification('Дата начала мероприятия не может быть позже даты окончания.', 'error');
        return;
    }

    const items = [];
    const rows = document.querySelectorAll('#eventItemsBody tr');

    document.querySelectorAll('#eventItemsBody tr').forEach(row => syncEventRowState(row));
    for (const row of rows) {
        const itemSelect = row.querySelector('.event-item-select');
        const quantityInput = row.querySelector('.event-quantity-input');
        const item = findInventoryItem(itemSelect?.value);
        if (!item) continue;
        const quantity = Number(quantityInput?.value || 0);
        const available = getRowAvailableStock(item.id, row, '#eventItemsBody', '.event-item-select', '.event-quantity-input');
        const shortage = Math.max(0, quantity - available);
        if (shortage > 0 && row.dataset.externalSource !== '1' && row.dataset.procurementMode !== 'purchase_request' && isConsumableWithAutoPurchase(item)) {
            await createAutoPurchaseRequestBeforeSave(row, item, shortage, 'event');
            syncEventRowState(row, false);
        }
    }

    if (submitMode === 'post') {
        const issues = collectEntityStockIssues('event', true);
        if (issues.length > 0) {
            updateEntityIssuesBanner('event');
            openStockDeficitModal(issues[0]);
            showNotification('Исправьте проблемы с остатками перед проведением мероприятия', 'warning');
            return;
        }
    }

    for (const row of rows) {
        const itemSelect = row.querySelector('.event-item-select');
        const categoryInput = row.querySelector('.event-category-input');
        const quantityInput = row.querySelector('.event-quantity-input');
        const transferDateInput = row.querySelector('.event-transfer-date-input');
        const returnDateInput = row.querySelector('.event-return-date-input');
        const conditionSelect = row.querySelector('.event-condition-select');
        const issueConditionInput = row.querySelector('.event-issue-condition-input');
        const issueCommentInput = row.querySelector('.issue-comment-input') || row.querySelector('.event-note-input');
        const acceptanceCommentInput = row.querySelector('.acceptance-comment-input');

        if (!itemSelect.value || !quantityInput.value) {
            showNotification('Заполните все поля позиций.', 'error');
            return;
        }

        const itemId = itemSelect.value;
        const quantity = Number(quantityInput.value);
        const isExternalSource = row.dataset.externalSource === '1';
        const procurementMode = row.dataset.procurementMode || (isExternalSource ? 'external_rental' : 'warehouse');
        const selectedItem = findInventoryItem(itemId);

        if (!selectedItem) {
            showNotification(`Предмет с ID ${itemId} не найден в инвентаре.`, 'error');
            return;
        }

        const available = getRowAvailableStock(itemId, row, '#eventItemsBody', '.event-item-select', '.event-quantity-input');
        if (Number.isNaN(quantity) || quantity < 0 || (!isDraft && quantity <= 0)) {
            showNotification(isDraft ? 'Количество не может быть отрицательным.' : 'Количество должно быть положительным числом.', 'error');
            return;
        }
        if (!isDraft && !isExternalSource && quantity > available && procurementMode !== 'purchase_request' && !isConsumableWithAutoPurchase(selectedItem)) {
            showNotification(`Нельзя зарезервировать больше, чем есть на складе для «${selectedItem.name}». Доступно: ${available} шт.`, 'error');
            return;
        }

        const writeoffReasonSelect = row.querySelector('.writeoff-reason-select');
        const writeoffCommentInput = row.querySelector('.writeoff-comment-input');
        const writeoffDecisionSelect = row.querySelector('.writeoff-decision-select');
        const defectQuantityInput = row.querySelector('.defect-quantity-input');
        const isAsset = String(selectedItem.type || '').toLowerCase() === 'asset';
        const issueCondition = String(issueConditionInput?.value || 'Хорошее').trim() || 'Хорошее';
        const actualCondition = requiresCondition && isAsset ? (conditionSelect.value || issueCondition || 'Хорошее') : issueCondition;
        const needsWriteoffDecision = requiresCondition && isAsset && actualCondition !== 'Хорошее';
        const writeoffDecision = needsWriteoffDecision
            ? normalizeWriteoffDecision(writeoffDecisionSelect?.value || 'writeoff', 'writeoff')
            : 'writeoff';
        const shouldWriteoff = needsWriteoffDecision && writeoffDecision === 'writeoff';
        const writeoffReason = shouldWriteoff
            ? (String(writeoffReasonSelect?.value || '').trim() || getDefaultWriteoffReasonByCondition(actualCondition))
            : '';
        const issueComment = String(issueCommentInput?.value || '').trim();
        const acceptanceComment = String(acceptanceCommentInput?.value || issueComment || '').trim();
        const writeoffComment = shouldWriteoff
            ? String(writeoffCommentInput?.value || acceptanceComment || issueComment || '').trim()
            : String(writeoffCommentInput?.value || '').trim();
        const packedComment = buildPackedDocumentComments({ issueComment, acceptanceComment, writeoffComment });
        const defectiveQuantityRaw = shouldWriteoff
            ? Number(defectQuantityInput?.value || 0)
            : 0;
        const defectiveQuantity = Math.min(quantity, Math.max(0, Number.isFinite(defectiveQuantityRaw) ? defectiveQuantityRaw : 0));
        if (shouldWriteoff && defectiveQuantity <= 0) {
            showNotification(`Для «${selectedItem.name}» укажите количество дефектных единиц больше 0.`, 'error');
            return;
        }

        items.push({
            item_id: itemId,
            category: categoryInput.value || selectedItem.category,
            quantity,
            transfer_date: transferDateInput.value,
            return_date: returnDateInput.value,
            issue_condition: issueCondition,
            actual_condition: actualCondition,
            return_status: getReturnStatusFromCondition(actualCondition),
            defective_quantity: defectiveQuantity,
            writeoff_decision: writeoffDecision,
            external_source: isExternalSource,
            procurement_mode: procurementMode,
            writeoff_reason: writeoffReason,
            writeoff_comment: writeoffComment,
            issue_comment: issueComment,
            acceptance_comment: acceptanceComment,
            comment: packedComment
        });
    }

    if (items.length === 0) {
        showNotification('Добавьте хотя бы один объект.', 'error');
        return;
    }

    const payload = {
        name,
        start_date: startDate,
        end_date: endDate,
        location,
        employee_id: employeeId,
        status,
        items
    };

    if (isCompleted) {
        const completionValidation = getEntityCompletionValidation('event');
        if (!completionValidation.ready) {
            showNotification(completionValidation.message || 'Заполните данные приемки перед завершением.', 'error');
            return;
        }
        payload.acceptance_act_number = generateAcceptanceActNumber();
    }

    try {
        if (submitMode === 'post' && editingEvent?.id && editingEvent?.issuance_act_id) {
            throw new Error('Документ уже создан. Для изменений используйте корректировку.');
        }

        let savedEventId = Number(editingEvent?.id || 0);
        if (editingEvent?.id) {
            await apiFetch(`/api/events/${editingEvent.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showNotification(isDraft ? 'Черновик мероприятия обновлен.' : 'Мероприятие проведено успешно.', 'success');
        } else {
            const createResult = await apiFetch('/api/events/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            savedEventId = Number(createResult?.event_id || 0);
            showNotification(isDraft ? 'Черновик мероприятия создан.' : 'Мероприятие проведено успешно.', 'success');
        }

        const shouldOfferAcceptance = status === 'Завершено' && typeof generateAcceptanceActForEvent === 'function';
        const completedEvent = { ...(editingEvent || {}), ...payload, employee_name: employees.find(employee => String(employee.id) === String(employeeId))?.name || '' };
        if (status === 'Завершено') {
            completedEvent.acceptance_act_number = ensureAcceptanceDocumentRecord('event', completedEvent) || completedEvent.acceptance_act_number;
        }

        await loadData();

        if (submitMode === 'post' && !isFinalization && status === 'Активно') {
            const nextId = savedEventId || Number(editingEvent?.id || 0);
            const reloadedEvent = findEventById(nextId) || completedEvent;
            editingEvent = { ...reloadedEvent };
            document.getElementById('eventStatus').value = 'Активно';
            setEntityCardEditMode('event', true);
            document.querySelectorAll('#eventItemsBody .event-condition-select').forEach(select => {
                if (!String(select.value || '').trim()) return;
                select.value = '';
            });
            document.querySelectorAll('#eventItemsBody .defect-quantity-input').forEach(input => {
                input.value = '';
            });
            toggleEventConditionFields();
            showNotification('1-е проведение выполнено. Заполните «Состояние ПОСЛЕ» и нажмите «Завершить».', 'info');
            return;
        }

        closeEventModal({ skipAutoSave: true });

        if (shouldOfferAcceptance) {
            generateAcceptanceActForEvent(completedEvent);
        }
    } catch (error) {
        console.error('Ошибка сохранения мероприятия:', error);
        showNotification(error.message || 'Ошибка при записи мероприятия', 'error');
    }
}

async function unpostCurrentRental() {
    if (!editingRental?.id) return;

    showConfirmModal(
        'Отмена проведения аренды',
        'Отменить проведение? Документ будет помечен как отмененный, остатки восстановлены, статус станет "Черновик".',
        async () => {
            try {
                await apiFetch(`/api/rentals/${editingRental.id}/unpost`, { method: 'POST' });
                showNotification('Проведение аренды отменено', 'success');
                closeRentalModal();
                await loadData();
            } catch (error) {
                console.error('Ошибка отмены проведения аренды:', error);
                showNotification(error.message || 'Ошибка отмены проведения аренды', 'error');
            }
        }
    );
}

async function unpostCurrentEvent() {
    if (!editingEvent?.id) return;

    showConfirmModal(
        'Отмена проведения мероприятия',
        'Отменить проведение? Документ будет помечен как отмененный, остатки восстановлены, статус станет "Черновик".',
        async () => {
            try {
                await apiFetch(`/api/events/${editingEvent.id}/unpost`, { method: 'POST' });
                showNotification('Проведение мероприятия отменено', 'success');
                closeEventModal();
                await loadData();
            } catch (error) {
                console.error('Ошибка отмены проведения мероприятия:', error);
                showNotification(error.message || 'Ошибка отмены проведения мероприятия', 'error');
            }
        }
    );
}

function selectAllEvents() {
    const isChecked = document.getElementById('selectAllEvents').checked;
    document.querySelectorAll('.event-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
}

function deleteSelectedEvents() {
    if (!requirePermission('events', 'delete', 'Недостаточно прав для удаления мероприятий')) return;
    const checkboxes = document.querySelectorAll('.event-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification('Выберите мероприятия для удаления.', 'warning');
        return;
    }

    showConfirmModal(
        'Подтверждение удаления',
        `Вы уверены, что хотите удалить ${checkboxes.length} выбранных мероприятий?`,
        async () => {
            const selectedIds = Array.from(checkboxes).map(cb => {
                const event = events[Number(cb.dataset.index)];
                return event?.id;
            }).filter(Boolean);

            try {
                await Promise.all(selectedIds.map(id => apiFetch(`/api/events/${id}`, { method: 'DELETE' })));
                showNotification(`✓ ${selectedIds.length} мероприятий удалено`, 'success');
                await loadData();
            } catch (error) {
                console.error('Ошибка удаления мероприятий:', error);
                showNotification(error.message || 'Ошибка при удалении мероприятий', 'error');
            }
        }
    );
}

async function conductSelectedEvents() {
    if (!requirePermission('events', 'changeStatus', 'Недостаточно прав для проведения мероприятий')) return;

    const selected = Array.from(document.querySelectorAll('.event-checkbox:checked'))
        .map(cb => events[Number(cb.dataset.index)])
        .filter(entry => {
            if (!entry) return false;
            const normalizedStatus = String(entry.status || '').trim();
            const isDraftOrPlanned = isDraftStatus(normalizedStatus) || isPlannedStatus(normalizedStatus);
            const isActiveWithoutAcceptance = isEventActiveStatus(normalizedStatus) && !hasAcceptanceDocumentForEntity('event', entry);
            const isCompletedMissingDocs = isEventCompletedStatus(normalizedStatus)
                && (!hasIssuanceDocumentForEntity('event', entry) || !hasAcceptanceDocumentForEntity('event', entry));
            return isDraftOrPlanned || isActiveWithoutAcceptance || isCompletedMissingDocs;
        });

    if (!selected.length) {
        showNotification('Выберите записи со статусами Черновик/Планируется/Активно/Завершено, где есть недостающие документы.', 'warning');
        return;
    }

    try {
        let issuanceCreated = 0;
        let acceptanceCreated = 0;
        let statusUpdated = 0;
        let completedUpdated = 0;
        for (const entry of selected) {
            const normalizedStatus = String(entry.status || '').trim();
            const isCompleted = isEventCompletedStatus(normalizedStatus);
            const isActive = isEventActiveStatus(normalizedStatus);
            const isPlannedOrDraft = isDraftStatus(normalizedStatus) || isPlannedStatus(normalizedStatus);

            if (isCompleted) {
                if (!hasIssuanceDocumentForEntity('event', entry) && ensureIssuanceDocumentRecord('event', entry)) {
                    issuanceCreated += 1;
                }
                if (!hasAcceptanceDocumentForEntity('event', entry) && ensureAcceptanceDocumentRecord('event', entry)) {
                    acceptanceCreated += 1;
                }
                continue;
            }

            if (isActive) {
                const acceptanceNumber = String(entry.acceptance_act_number || entry.acceptanceActNumber || '').trim()
                    || (typeof generateAcceptanceActNumber === 'function' ? generateAcceptanceActNumber() : '');
                await apiFetch(`/api/events/${entry.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: 'Завершено',
                        items: Array.isArray(entry.items) ? entry.items : [],
                        acceptance_act_number: acceptanceNumber
                    })
                });
                completedUpdated += 1;
                if (!hasAcceptanceDocumentForEntity('event', entry)
                    && ensureAcceptanceDocumentRecord('event', { ...entry, acceptance_act_number: acceptanceNumber })) {
                    acceptanceCreated += 1;
                }
                continue;
            }

            if (isPlannedOrDraft) {
                await apiFetch(`/api/events/${entry.id}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: 'Активно' })
                });
                statusUpdated += 1;
                if (!hasIssuanceDocumentForEntity('event', entry) && ensureIssuanceDocumentRecord('event', entry)) {
                    issuanceCreated += 1;
                }
            }
        }
        await loadData();
        showNotification(`Переведено в Активно: ${statusUpdated}. Переведено в Завершено: ${completedUpdated}. Добавлено актов передачи/выдачи: ${issuanceCreated}. Добавлено актов приемки: ${acceptanceCreated}.`, 'success');
    } catch (error) {
        console.error('Ошибка массового проведения мероприятий:', error);
        showNotification(error.message || 'Ошибка массового проведения мероприятий', 'error');
    }
}

function deleteAllEventDrafts() {
    if (!requirePermission('events', 'delete', 'Недостаточно прав для удаления мероприятий')) return;

    const drafts = events.filter(entry => isDraftStatus(entry.status));
    if (!drafts.length) {
        showNotification('Черновики мероприятий не найдены.', 'warning');
        return;
    }

    showConfirmModal(
        'Удаление черновиков мероприятий',
        `Удалить все черновики мероприятий (${drafts.length})?`,
        async () => {
            try {
                for (const draft of drafts) {
                    await apiFetch(`/api/events/${draft.id}`, { method: 'DELETE' });
                }
                await loadData();
                showNotification(`Удалено черновиков мероприятий: ${drafts.length}`, 'success');
            } catch (error) {
                console.error('Ошибка удаления черновиков мероприятий:', error);
                showNotification(error.message || 'Ошибка удаления черновиков мероприятий', 'error');
            }
        }
    );
}

// ============================================================================
// Reports
// ============================================================================

function openRentalsReportModal() {
    if (!requirePermission('reports', 'view', 'Недостаточно прав для просмотра отчётов')) return;
    document.getElementById('rentalsReportModal').style.display = 'block';
    handleRentalsReportTypeChange();
}

function closeRentalsReportModal() {
    document.getElementById('rentalsReportModal').style.display = 'none';
    if (rentalsChart) {
        rentalsChart.destroy();
        rentalsChart = null;
    }
}

function openEventsReportModal() {
    if (!requirePermission('reports', 'view', 'Недостаточно прав для просмотра отчётов')) return;
    document.getElementById('eventsReportModal').style.display = 'block';
    handleEventsReportTypeChange();
}

function closeEventsReportModal() {
    document.getElementById('eventsReportModal').style.display = 'none';
    if (eventsChart) {
        eventsChart.destroy();
        eventsChart = null;
    }
}

function getRentalsChartTitle(type) {
    switch (type) {
        case 'monthly': return 'Аренды по месяцам';
        case 'status': return 'Аренды по статусам';
        case 'items': return 'Топ-5 арендуемых объектов';
        case 'clients': return 'Популярные арендаторы';
        default: return 'Отчёт по арендам';
    }
}

function getEventsChartTitle(type) {
    switch (type) {
        case 'monthly': return 'Мероприятия по месяцам';
        case 'venues': return 'Мероприятия по местам';
        case 'items': return 'Использование инвентаря';
        case 'status': return 'Статусы мероприятий';
        case 'duration': return 'Длительность мероприятий';
        case 'responsibles': return 'Загруженность ответственных';
        default: return 'Отчёт по мероприятиям';
    }
}

function getReportColorPalette() {
    const rootStyles = getComputedStyle(document.documentElement);
    const raw = rootStyles.getPropertyValue('--chart-palette').trim();
    if (raw) {
        const parsed = raw.split(',').map(token => token.trim()).filter(Boolean);
        if (parsed.length) return parsed;
    }

    return ['rgba(37, 99, 235, 0.72)', 'rgba(59, 130, 246, 0.72)', 'rgba(6, 182, 212, 0.72)', 'rgba(16, 185, 129, 0.72)', 'rgba(245, 158, 11, 0.72)', 'rgba(239, 68, 68, 0.72)'];
}

function buildChartConfig(chartType, title, payload) {
    const normalizedChartType = chartType === 'horizontalBar' ? 'bar' : chartType;
    const isHorizontal = chartType === 'horizontalBar';
    const colors = getReportColorPalette();
    const datasets = (payload.datasets || [{ label: title, data: payload.values || [] }]).map((dataset, index) => ({
        label: dataset.label || `${title} ${index + 1}`,
        data: dataset.data || [],
        borderColor: colors[index % colors.length].replace('0.72', '1'),
        backgroundColor: normalizedChartType === 'line'
            ? colors[index % colors.length]
            : (payload.labels || []).map((_, itemIndex) => colors[itemIndex % colors.length]),
        tension: 0.25,
        fill: normalizedChartType === 'line',
        borderWidth: 2
    }));

    return {
        type: normalizedChartType,
        data: {
            labels: payload.labels || [],
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: isHorizontal ? 'y' : 'x',
            plugins: {
                legend: { position: 'top' },
                title: { display: true, text: title }
            },
            scales: normalizedChartType === 'pie' || normalizedChartType === 'doughnut'
                ? {}
                : {
                    y: { beginAtZero: true }
                }
        }
    };
}

function renderReportSummary(containerId, summary = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (!summary.length) {
        container.innerHTML = '<div class="report-summary-item"><strong>Сводка</strong><span>Данные отсутствуют</span></div>';
        return;
    }

    summary.forEach(item => {
        const div = document.createElement('div');
        div.className = 'report-summary-item';
        div.innerHTML = `<strong>${escapeHtml(item.label || 'Показатель')}</strong><span>${escapeHtml(String(item.value ?? '—'))}</span>`;
        container.appendChild(div);
    });
}

function renderReportTable(tableId, payload) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const headers = payload.tableHeaders || ['Показатель', 'Значение'];
    const rows = payload.rows || [];

    thead.innerHTML = `<tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`;
    tbody.innerHTML = rows.length
        ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${headers.length}" class="empty-table-message">Нет данных для отображения</td></tr>`;
}

function getRentalsReportQuery() {
    const params = new URLSearchParams({
        type: document.getElementById('rentalsReportType')?.value || 'monthly',
        chartType: document.getElementById('rentalsChartType')?.value || 'bar',
        period: document.getElementById('rentalsReportPeriod')?.value || 'all',
        year: document.getElementById('rentalsReportYear')?.value || '',
        grouping: document.getElementById('rentalsReportGrouping')?.value || 'month',
        dateFrom: document.getElementById('rentalsReportDateFrom')?.value || '',
        dateTo: document.getElementById('rentalsReportDateTo')?.value || '',
        includeDrafts: document.getElementById('rentalsIncludeDrafts')?.checked ? 'true' : 'false'
    });
    return `/api/rentals-report?${params.toString()}`;
}

function getEventsReportQuery() {
    const params = new URLSearchParams({
        type: document.getElementById('eventsReportType')?.value || 'monthly',
        chartType: document.getElementById('eventsChartType')?.value || 'bar',
        period: document.getElementById('eventsReportPeriod')?.value || 'all',
        year: document.getElementById('eventsReportYear')?.value || '',
        grouping: document.getElementById('eventsReportGrouping')?.value || 'month',
        category: document.getElementById('eventsReportCategory')?.value || '',
        dateFrom: document.getElementById('eventsReportDateFrom')?.value || '',
        dateTo: document.getElementById('eventsReportDateTo')?.value || '',
        includeDrafts: document.getElementById('eventsIncludeDrafts')?.checked ? 'true' : 'false'
    });
    return `/api/events-report?${params.toString()}`;
}

function toggleRentalsCustomDateFilters() {
    const period = document.getElementById('rentalsReportPeriod')?.value || 'all';
    const container = document.getElementById('rentalsCustomDateRange');
    if (container) {
        container.style.display = period === 'custom' ? 'grid' : 'none';
    }
}

function toggleEventsCustomDateFilters() {
    const period = document.getElementById('eventsReportPeriod')?.value || 'all';
    const container = document.getElementById('eventsCustomDateRange');
    if (container) {
        container.style.display = period === 'custom' ? 'grid' : 'none';
    }
}

function handleRentalsReportTypeChange() {
    const type = document.getElementById('rentalsReportType')?.value || 'monthly';
    const grouping = document.getElementById('rentalsReportGrouping');
    const chartType = document.getElementById('rentalsChartType');

    if (grouping) {
        grouping.disabled = type !== 'monthly';
    }

    if (chartType) {
        chartType.value = type === 'status' ? 'doughnut' : (type === 'monthly' ? 'line' : 'bar');
    }

    toggleRentalsCustomDateFilters();
    updateRentalsChart();
}

function handleEventsReportTypeChange() {
    const type = document.getElementById('eventsReportType')?.value || 'monthly';
    const grouping = document.getElementById('eventsReportGrouping');
    const category = document.getElementById('eventsReportCategory');
    const chartType = document.getElementById('eventsChartType');

    if (grouping) {
        grouping.disabled = type !== 'monthly';
    }

    if (category) {
        category.disabled = type !== 'items';
    }

    if (chartType) {
        if (type === 'status') chartType.value = 'doughnut';
        else if (type === 'monthly') chartType.value = 'line';
        else if (type === 'venues') chartType.value = 'bar';
        else chartType.value = 'bar';
    }

    toggleEventsCustomDateFilters();
    updateEventsChart();
}

async function updateRentalsChart() {
    const canvas = document.getElementById('rentalsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    try {
        const payload = await apiFetch(getRentalsReportQuery(), { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false });
        if (rentalsChart) rentalsChart.destroy();

        const selectedChartType = document.getElementById('rentalsChartType')?.value || payload.recommendedChartType || 'bar';
        rentalsChart = new Chart(canvas.getContext('2d'), buildChartConfig(selectedChartType, payload.title || getRentalsChartTitle(document.getElementById('rentalsReportType')?.value), payload));
        renderReportSummary('rentalsReportSummary', payload.summary || []);
        renderReportTable('rentalsReportTable', payload);
    } catch (error) {
        console.error('Ошибка загрузки графика аренды:', error);
        showNotification(error.message || 'Ошибка загрузки данных для графика', 'error');
    }
}

async function updateEventsChart() {
    const canvas = document.getElementById('eventsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    try {
        const payload = await apiFetch(getEventsReportQuery(), { timeoutMs: API_FAST_TIMEOUT_MS, retryOnTimeout: false });
        if (eventsChart) eventsChart.destroy();

        const selectedChartType = document.getElementById('eventsChartType')?.value || payload.recommendedChartType || 'bar';
        eventsChart = new Chart(canvas.getContext('2d'), buildChartConfig(selectedChartType, payload.title || getEventsChartTitle(document.getElementById('eventsReportType')?.value), payload));
        renderReportSummary('eventsReportSummary', payload.summary || []);
        renderReportTable('eventsReportTable', payload);
    } catch (error) {
        console.error('Ошибка загрузки графика мероприятий:', error);
        showNotification(error.message || 'Ошибка загрузки данных для графика', 'error');
    }
}

function exportReportTableToCSV(tableId, defaultFileName) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr')).map(row =>
        Array.from(row.querySelectorAll('th, td')).map(cell => `"${String(cell.textContent || '').replace(/"/g, '""')}"`).join(';')
    );

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = defaultFileName;
    link.click();
    URL.revokeObjectURL(link.href);
}

function downloadChartImage(canvasId, defaultFileName) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = defaultFileName;
    link.click();
}

async function exportChartAndTableToPDF(options) {
    const { canvasId, tableId, title, fileName } = options;
    const canvas = document.getElementById(canvasId);
    const table = document.getElementById(tableId);
    if (!canvas || !table) throw new Error('Не найден график или таблица отчёта');

    const rowsHtml = Array.from(table.querySelectorAll('tr')).map((row, rowIndex) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        const cells = Array.from(row.querySelectorAll('th, td')).map(cell => `<${tag}>${escapeHtml(String(cell.textContent || '').trim())}</${tag}>`).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    const htmlDoc = `
        <!doctype html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(fileName || title || 'report')}</title>
            <style>
                @page { size: A4; margin: 14mm; }
                body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111827; }
                h1 { margin: 0 0 8px 0; font-size: 20px; }
                .meta { margin-bottom: 14px; color: #4b5563; font-size: 12px; }
                .chart { margin-bottom: 16px; }
                .chart img { width: 100%; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #d1d5db; padding: 7px; font-size: 12px; text-align: left; }
                th { background: #f3f4f6; }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(title || 'Отчёт')}</h1>
            <div class="meta">Дата формирования: ${escapeHtml(formatDateTime(new Date()))}</div>
            <div class="chart"><img src="${canvas.toDataURL('image/png')}" alt="Chart"></div>
            <table>${rowsHtml}</table>
            <script>
                window.addEventListener('load', function () {
                    setTimeout(function () { window.print(); }, 150);
                });
            </script>
        </body>
        </html>
    `;


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
    document.body.appendChild(iframe);

    try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
            throw new Error('Не удалось подготовить окно печати');
        }

        iframeDoc.open();
        iframeDoc.write(htmlDoc);
        iframeDoc.close();

        await new Promise(resolve => {
            const done = () => setTimeout(resolve, 260);
            iframe.onload = done;
            done();
        });

        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
            throw new Error('Не удалось подготовить окно печати');
        }

        iframeWindow.focus();
        iframeWindow.print();
    } finally {
        setTimeout(() => iframe.remove(), 1500);
    }
}

async function exportRentalsReportToPDF() {
    try {
        await exportChartAndTableToPDF({
            canvasId: 'rentalsChart',
            tableId: 'rentalsReportTable',
            title: getRentalsChartTitle(document.getElementById('rentalsReportType')?.value),
            fileName: `отчёт_аренды_${document.getElementById('rentalsReportType')?.value || 'report'}.pdf`
        });
        showNotification('Отчёт по арендам экспортирован в PDF', 'success');
    } catch (error) {
        console.error('Ошибка экспорта PDF:', error);
        showNotification(error.message || 'Ошибка при экспорте в PDF', 'error');
    }
}

async function exportEventsReportToPDF() {
    try {
        await exportChartAndTableToPDF({
            canvasId: 'eventsChart',
            tableId: 'eventsReportTable',
            title: getEventsChartTitle(document.getElementById('eventsReportType')?.value),
            fileName: `отчёт_мероприятий_${document.getElementById('eventsReportType')?.value || 'report'}.pdf`
        });
        showNotification('Отчёт по мероприятиям экспортирован в PDF', 'success');
    } catch (error) {
        console.error('Ошибка экспорта PDF:', error);
        showNotification(error.message || 'Ошибка при экспорте в PDF', 'error');
    }
}

function exportRentalsReportToCSV() {
    exportReportTableToCSV('rentalsReportTable', `отчёт_аренды_${document.getElementById('rentalsReportType')?.value || 'report'}.csv`);
    showNotification('CSV по арендам сформирован', 'success');
}

function exportEventsReportToCSV() {
    exportReportTableToCSV('eventsReportTable', `отчёт_мероприятий_${document.getElementById('eventsReportType')?.value || 'report'}.csv`);
    showNotification('CSV по мероприятиям сформирован', 'success');
}

function downloadRentalsChartImage() {
    downloadChartImage('rentalsChart', `диаграмма_аренды_${document.getElementById('rentalsReportType')?.value || 'report'}.png`);
}

function downloadEventsChartImage() {
    downloadChartImage('eventsChart', `диаграмма_мероприятий_${document.getElementById('eventsReportType')?.value || 'report'}.png`);
}

const APP_NOTIFICATIONS_KEY = 'warehouse_ui_notifications_v1';
const APP_NOTIFICATIONS_DEDUP_MS = 10 * 60 * 1000;
const GLOBAL_SEARCH_RECENT_KEY = 'warehouse_global_search_recent_v1';
const INVENTORY_UNDO_WINDOW_MS = 30000;
let currentNotificationsFilter = 'all';
let globalSearchTimer = null;
let lastInventoryBulkAction = null;

function readAppNotifications() {
    try {
        const raw = JSON.parse(localStorage.getItem(APP_NOTIFICATIONS_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeAppNotifications(items) {
    localStorage.setItem(APP_NOTIFICATIONS_KEY, JSON.stringify(Array.isArray(items) ? items.slice(0, 100) : []));
}

function normalizeNotificationText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function getNotificationTypeLabel(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'success') return 'Успех';
    if (normalized === 'warning') return 'Внимание';
    if (normalized === 'error') return 'Ошибка';
    return 'Информация';
}

function inferNotificationCategory(text) {
    const normalized = normalizeNotificationText(text).toLowerCase();
    if (!normalized) return 'system';
    if (normalized.includes('аренд') || normalized.includes('мероприят')) return 'rentals-events';
    if (normalized.includes('пользоват') || normalized.includes('сотрудник') || normalized.includes('клиент')) return 'users';
    if (normalized.includes('закуп') || normalized.includes('поставк') || normalized.includes('заявк')) return 'procurement';
    if (normalized.includes('объект') || normalized.includes('склад') || normalized.includes('списан') || normalized.includes('инвентар')) return 'inventory';
    if (normalized.includes('вход') || normalized.includes('сесс') || normalized.includes('прав')) return 'system';
    return 'system';
}

function getCurrentVisiblePageId() {
    const visible = document.querySelector('.page[style*="display: block"], .page:not([style*="display: none"])');
    return visible?.id || 'dashboard';
}

function pushAppNotification(text, type = 'info', options = {}) {
    const normalizedText = normalizeNotificationText(text);
    if (!normalizedText) return;
    const items = readAppNotifications();
    const now = Date.now();
    const dedupeKey = String(options.key || `${String(type || 'info').toLowerCase()}::${normalizedText.toLowerCase()}`);
    const normalizedType = String(type || 'info').toLowerCase();
    const fallbackActionPage = normalizedType === 'error' ? getCurrentVisiblePageId() : '';
    const fallbackActionLabel = normalizedType === 'error' ? 'Открыть раздел' : '';

    const duplicate = items.find(item => String(item?.dedupeKey || '') === dedupeKey);

    if (duplicate) {
        // Keep a single notification card in panel; no repeated toasts.
        duplicate.createdAt = new Date().toISOString();
        duplicate.read = false;
        if (options.details) duplicate.details = normalizeNotificationText(options.details || '');
        if (options.actionPage || fallbackActionPage) duplicate.actionPage = String(options.actionPage || duplicate.actionPage || fallbackActionPage);
        if (options.actionLabel || fallbackActionLabel) duplicate.actionLabel = String(options.actionLabel || duplicate.actionLabel || fallbackActionLabel);
        if (options.actionRef) duplicate.actionRef = String(options.actionRef || '');
        writeAppNotifications(items);
        renderNotificationsPanel();
        return { created: false, duplicate: true };
    }

    items.unshift({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: normalizedText,
        type,
        category: String(options.category || inferNotificationCategory(normalizedText)),
        dedupeKey,
        details: normalizeNotificationText(options.details || ''),
        actionPage: String(options.actionPage || fallbackActionPage || ''),
        actionLabel: String(options.actionLabel || fallbackActionLabel || ''),
        actionRef: String(options.actionRef || ''),
        read: false,
        createdAt: new Date().toISOString()
    });
    writeAppNotifications(items);
    renderNotificationsPanel();
    return { created: true, duplicate: false };
}

function openNotificationAction(page, ref = '') {
    const safePage = String(page || '').trim();
    const safeRef = String(ref || '').trim();
    if (safePage) {
        showPage(safePage);
    }
    if (safeRef && safePage === 'documentsHub' && typeof openDocumentCardByNumber === 'function') {
        openDocumentCardByNumber(safeRef);
    }
    if (safeRef && safePage === 'sklad') {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = safeRef;
            searchData();
        }
    }
    toggleNotificationsPanel();
}

function renderNotificationsPanel() {
    const body = document.getElementById('notificationsPanelBody');
    const count = document.getElementById('notificationsBellCount');
    if (!body || !count) return;
    const allItems = readAppNotifications();
    const counters = {
        all: allItems.length,
        inventory: 0,
        'rentals-events': 0,
        users: 0,
        procurement: 0,
        system: 0
    };
    allItems.forEach(item => {
        const category = String(item.category || 'system');
        if (Object.prototype.hasOwnProperty.call(counters, category)) {
            counters[category] += 1;
        } else {
            counters.system += 1;
        }
    });
    const items = currentNotificationsFilter === 'all'
        ? allItems
        : allItems.filter(item => String(item.category || 'system') === currentNotificationsFilter);
    document.querySelectorAll('.notif-filter-btn').forEach(btn => {
        const filter = String(btn.dataset.notifFilter || 'all');
        const baseLabel = String(btn.dataset.baseLabel || btn.textContent || '').trim();
        const value = counters[filter] || 0;
        btn.textContent = `${baseLabel} (${value})`;
        btn.classList.toggle('active', filter === currentNotificationsFilter);
    });
    const unread = allItems.filter(item => item.read !== true).length;
    count.textContent = String(unread);
    body.innerHTML = items.length
        ? items.slice(0, 20).map(item => {
            const level = ['error', 'warning', 'success', 'info'].includes(String(item.type || '').toLowerCase())
                ? String(item.type || '').toLowerCase()
                : 'info';
            const hasAction = item.actionLabel && item.actionPage;
            const defaultAction = !hasAction && (level === 'warning' || level === 'error');
            const action = hasAction
                ? `<button type="button" class="inline-action-btn notif-action-btn" onclick="openNotificationAction('${escapeHtml(item.actionPage)}','${escapeHtml(item.actionRef || '')}')">${escapeHtml(item.actionLabel)}</button>`
                : (defaultAction ? '<button type="button" class="inline-action-btn notif-action-btn" onclick="openNotificationAction(\'documentsHub\')">Открыть документы</button>' : '');
            const details = item.details ? `<div class="notification-row-details">${escapeHtml(item.details)}</div>` : '';
            return `<div class="notification-row level-${level} ${item.read ? '' : 'unread'}"><div class="notification-row-title">${escapeHtml(getNotificationTypeLabel(item.type))}</div><div class="notification-row-text">${escapeHtml(item.text)}</div>${details}${action}<div class="notification-row-time">${escapeHtml(formatDateTime(item.createdAt, ''))}</div></div>`;
        }).join('')
        : '<div class="empty-table-message">Пока нет новых уведомлений.</div>';
}

function toggleNotificationsPanel() {
    const panel = document.getElementById('notificationsPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    renderNotificationsPanel();
}

function markAllNotificationsRead() {
    const items = readAppNotifications().map(item => ({ ...item, read: true }));
    writeAppNotifications(items);
    renderNotificationsPanel();
}

function clearReadNotifications() {
    const items = readAppNotifications().filter(item => item.read !== true);
    writeAppNotifications(items);
    renderNotificationsPanel();
}

function setNotificationsFilter(filter) {
    currentNotificationsFilter = String(filter || 'all');
    renderNotificationsPanel();
}

function setupDisabledActionHints() {
    document.addEventListener('mouseover', (event) => {
        const target = event.target?.closest?.('button[disabled], .inline-action-btn[disabled]');
        if (!target) return;
        if (!target.getAttribute('title')) {
            target.setAttribute('title', target.dataset.disabledReason || 'Действие недоступно: проверьте статус и права доступа');
        }
    });
}

function showOnboardingIfNeeded() {
    const key = 'warehouse_onboarding_seen_v1';
    if (localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    setTimeout(() => {
        const role = String(currentUserRole || '').toLowerCase();
        const text = role.includes('админ')
            ? 'Onboarding: 1) Проверьте Склад, 2) Откройте Документы, 3) Контролируйте Заявки на закупку.'
            : 'Onboarding: 1) Откройте Склад, 2) Проверьте дефицит, 3) Завершите действия через Документы.';
        showNotification(text, 'info', {
            key: `onboarding-${role || 'default'}`,
            category: 'system',
            actionPage: 'dashboard',
            actionLabel: 'Открыть главное'
        });
    }, 500);
}

window.toggleNotificationsPanel = toggleNotificationsPanel;
window.markAllNotificationsRead = markAllNotificationsRead;
window.clearReadNotifications = clearReadNotifications;
window.setNotificationsFilter = setNotificationsFilter;
window.openNotificationAction = openNotificationAction;

function attachUnifiedTableSorting(table) {
    if (!table || table.dataset.sortReady === '1') return;
    table.dataset.sortReady = '1';
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, idx) => {
        if (th.querySelector('input[type="checkbox"]')) return;
        th.classList.add('sortable-th');
        th.title = 'Сортировать';
        th.addEventListener('click', () => {
            const tbody = table.tBodies[0];
            if (!tbody) return;
            const rows = Array.from(tbody.querySelectorAll('tr')).filter(row => !row.querySelector('.empty-table-message'));
            const nextDir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
            headers.forEach(h => { delete h.dataset.sortDir; });
            th.dataset.sortDir = nextDir;
            rows.sort((a, b) => {
                const left = (a.children[idx]?.textContent || '').trim();
                const right = (b.children[idx]?.textContent || '').trim();
                return nextDir === 'asc'
                    ? left.localeCompare(right, 'ru', { numeric: true })
                    : right.localeCompare(left, 'ru', { numeric: true });
            });
            rows.forEach(row => tbody.appendChild(row));
        });
    });
}

function initUnifiedTables() {
    document.querySelectorAll('table').forEach(table => attachUnifiedTableSorting(table));
}

async function runGlobalSearch() {
    if (!RBAC.hasPermission('documents', 'search')) return;
    const input = document.getElementById('globalSearchInput');
    const resultsBox = document.getElementById('globalSearchResults');
    const recentBox = document.getElementById('globalSearchRecent');
    if (!input || !resultsBox) return;
    const query = String(input.value || '').trim();
    const kindFilter = String(document.getElementById('globalSearchKindFilter')?.value || 'all');
    if (globalSearchTimer) clearTimeout(globalSearchTimer);
    if (!query) {
        resultsBox.style.display = 'none';
        resultsBox.innerHTML = '';
        renderGlobalSearchRecent();
        if (recentBox) recentBox.style.display = '';
        return;
    }
    if (recentBox) recentBox.style.display = 'none';

    globalSearchTimer = setTimeout(async () => {
        try {
            const payload = await apiFetch(`/api/search/global?q=${encodeURIComponent(query)}`);
            let results = Array.isArray(payload?.results) ? payload.results : [];
            if (kindFilter === 'document' || kindFilter === 'inventory') {
                results = results.filter(item => String(item?.kind || '') === kindFilter);
            }
            resultsBox.innerHTML = results.length
                ? results.slice(0, 12).map(item => {
                    const rawTitle = String(item.title || '—');
                    const highlightedTitle = escapeHtml(rawTitle).replace(new RegExp(`(${escapeRegExp(query)})`, 'ig'), '<mark>$1</mark>');
                    return `<button type="button" class="global-search-result-item" onclick="openGlobalSearchResult('${escapeHtml(item.kind)}','${escapeHtml(item.payload?.id || item.payload?.number || '')}','${escapeHtml(rawTitle)}')"><strong>${highlightedTitle}</strong><span>${escapeHtml(item.subtitle || '')}</span></button>`;
                }).join('')
                : '<div class="empty-table-message">Ничего не найдено</div>';
            resultsBox.style.display = 'block';
        } catch {
            resultsBox.style.display = 'none';
        }
    }, 260);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readGlobalSearchRecent() {
    try {
        const raw = JSON.parse(localStorage.getItem(GLOBAL_SEARCH_RECENT_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeGlobalSearchRecent(items) {
    localStorage.setItem(GLOBAL_SEARCH_RECENT_KEY, JSON.stringify(Array.isArray(items) ? items.slice(0, 8) : []));
}

function pushGlobalSearchRecent(kind, ref, title) {
    const safeKind = String(kind || '').trim();
    const safeRef = String(ref || '').trim();
    const safeTitle = String(title || '').trim();
    if (!safeKind || !safeRef) return;
    const rows = readGlobalSearchRecent().filter(item => !(item.kind === safeKind && item.ref === safeRef));
    rows.unshift({ kind: safeKind, ref: safeRef, title: safeTitle, at: new Date().toISOString() });
    writeGlobalSearchRecent(rows);
}

function renderGlobalSearchRecent() {
    const box = document.getElementById('globalSearchRecent');
    if (!box) return;
    const rows = readGlobalSearchRecent();
    box.innerHTML = rows.length
        ? rows.map(item => `<button type="button" class="global-search-result-item" onclick="openGlobalSearchResult('${escapeHtml(item.kind)}','${escapeHtml(item.ref)}','${escapeHtml(item.title || '')}')"><strong>${escapeHtml(item.title || item.ref)}</strong><span>Недавний поиск</span></button>`).join('')
        : '';
    box.style.display = rows.length ? 'block' : 'none';
}

function openGlobalSearchResult(kind, ref, title = '') {
    if (!RBAC.hasPermission('documents', 'search')) return;
    const safeKind = String(kind || '');
    const safeRef = String(ref || '');
    if (safeKind === 'client') showPage('clients');
    if (safeKind === 'inventory') showPage('sklad');
    if (safeKind === 'document') showPage('documentsHub');
    document.getElementById('globalSearchResults').style.display = 'none';
    const recentBox = document.getElementById('globalSearchRecent');
    if (recentBox) recentBox.style.display = 'none';
    pushGlobalSearchRecent(safeKind, safeRef, title || safeRef);
    if (safeKind === 'document' && typeof openDocumentCardByNumber === 'function' && safeRef) {
        openDocumentCardByNumber(safeRef);
    }
    if (safeKind === 'inventory' && safeRef) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = safeRef;
            searchData();
        }
    }
}

window.runGlobalSearch = runGlobalSearch;
window.openGlobalSearchResult = openGlobalSearchResult;

function renderEntityProgress(containerId, status, flow) {
    const node = document.getElementById(containerId);
    if (!node) return;
    const safeStatus = String(status || '').toLowerCase();
    const doneDraft = safeStatus.includes('чернов');
    const donePosted = safeStatus.includes('провед') || safeStatus.includes('актив') || safeStatus.includes('заверш');
    const doneClosed = safeStatus.includes('заверш') || safeStatus.includes('закрыт');
    const steps = flow || ['Черновик', 'Проведено', 'Закрыто'];
    node.innerHTML = `
        <span class="${doneDraft ? 'done' : ''}">${steps[0]}</span>
        <span class="${donePosted ? 'done' : ''}">${steps[1]}</span>
        <span class="${doneClosed ? 'done' : ''}">${steps[2]}</span>
    `;
}

function setupDraftTracking(formId, storageKey, indicatorId) {
    const form = document.getElementById(formId);
    const indicator = document.getElementById(indicatorId);
    if (!form || !indicator) return;
    const syncIndicator = (dirty) => {
        indicator.textContent = dirty ? 'Есть несохраненные изменения' : 'Все изменения сохранены';
        indicator.classList.toggle('dirty', dirty);
    };
    const saveSnapshot = () => {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(field => {
            if (!field.id) return;
            if (field.type === 'checkbox') data[field.id] = field.checked;
            else data[field.id] = field.value;
        });
        sessionStorage.setItem(storageKey, JSON.stringify(data));
        syncIndicator(true);
    };
    const restoreSnapshot = () => {
        try {
            const data = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
            Object.entries(data).forEach(([id, value]) => {
                const field = document.getElementById(id);
                if (!field) return;
                if (field.type === 'checkbox') field.checked = Boolean(value);
                else field.value = String(value ?? '');
            });
            if (Object.keys(data).length) syncIndicator(true);
        } catch {
            syncIndicator(false);
        }
    };
    const clearSnapshot = () => {
        sessionStorage.removeItem(storageKey);
        syncIndicator(false);
    };
    form.addEventListener('input', saveSnapshot);
    form.addEventListener('change', saveSnapshot);
    form.addEventListener('submit', clearSnapshot);
    restoreSnapshot();
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('script.js загружен, начало инициализации');
    initializeThemeRuntime();
    window.setThemePreference = setThemePreference;
    window.toggleThemePreference = toggleThemePreference;

    // Привязываем обработчик входа до остальной инициализации,
    // чтобы submit не уходил в обычную перезагрузку страницы.
    document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);

    try {
        initLoginVisualEffects();
        loadLoginSecurityState();
        updateLoginAttemptsIndicator();
        renderLoginCaptcha();
        updateLoginLockUi();
        updateLoginSubmitAvailability();
    } catch (error) {
        console.error('Ошибка инициализации экрана входа:', error);
    }

    restoreSavedDirectoryFilters();

    document.getElementById('itemForm')?.addEventListener('submit', handleItemFormSubmit);
    document.getElementById('rentalForm')?.addEventListener('submit', handleRentalFormSubmit);
    document.getElementById('eventForm')?.addEventListener('submit', handleEventFormSubmit);
    document.getElementById('clientForm')?.addEventListener('submit', handleClientFormSubmit);
    document.getElementById('employeeForm')?.addEventListener('submit', handleEmployeeFormSubmit);
    document.getElementById('userForm')?.addEventListener('submit', handleUserFormSubmit);
    document.getElementById('userEditForm')?.addEventListener('submit', handleUserEditFormSubmit);
    document.getElementById('stockDeficitApplyBtn')?.addEventListener('click', applyStockDeficitResolution);
    document.getElementById('stockDeficitCancelBtn')?.addEventListener('click', closeStockDeficitModal);
    document.getElementById('stockDeficitCloseBtn')?.addEventListener('click', closeStockDeficitModal);
    document.getElementById('purchaseRequestChoiceCreateNewBtn')?.addEventListener('click', purchaseRequestChoiceCreateNew);
    document.getElementById('purchaseRequestChoiceUseDraftBtn')?.addEventListener('click', purchaseRequestChoiceUseDraft);
    setupDraftTracking('rentalForm', 'warehouse_rental_draft_form_snapshot', 'rentalDraftIndicator');
    setupDraftTracking('eventForm', 'warehouse_event_draft_form_snapshot', 'eventDraftIndicator');
    initUnifiedTables();
    renderNotificationsPanel();
    renderGlobalSearchRecent();
    setupDisabledActionHints();

    document.getElementById('addClient')?.addEventListener('click', openAddClientModal);
    document.getElementById('addEmployee')?.addEventListener('click', openAddEmployeeModal);

    document.getElementById('itemImageFile')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            selectedImageData = null;
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            selectedImageData = reader.result;
        };
        reader.readAsDataURL(file);
    });

    // Управление стеком модальных окон: новое/активное окно всегда выше.
    let modalZCounter = 2000;
    const bringModalToFront = (modal) => {
        if (!modal || !modal.classList?.contains('modal')) return;
        if (modal.style.display === 'none') return;
        modalZCounter += 2;
        modal.style.setProperty('--modal-z-index', String(modalZCounter));
        modal.style.zIndex = String(modalZCounter);
    };

    const syncModalVisibilityState = (modal) => {
        if (!modal || !modal.classList?.contains('modal')) return;
        const isVisible = modal.style.display === 'block';
        const wasVisible = modal.dataset.modalVisibleSynced === '1';

        if (isVisible && !wasVisible) {
            modal.dataset.modalVisibleSynced = '1';
            bringModalToFront(modal);
            return;
        }

        if (!isVisible && wasVisible) {
            delete modal.dataset.modalVisibleSynced;
        }
    };

    const refreshVisibleModalsStack = () => {
        document.querySelectorAll('.modal').forEach(modal => {
            syncModalVisibilityState(modal);
        });
    };

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('mousedown', () => bringModalToFront(modal));
        modal.querySelector('.modal-content, .item-card-content')?.addEventListener('mousedown', () => bringModalToFront(modal));
    });

    let modalRefreshQueued = false;
    const scheduleRefreshVisibleModalsStack = () => {
        if (modalRefreshQueued) return;
        modalRefreshQueued = true;
        requestAnimationFrame(() => {
            modalRefreshQueued = false;
            refreshVisibleModalsStack();
        });
    };

    const modalObserver = new MutationObserver(() => scheduleRefreshVisibleModalsStack());
    modalObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    refreshVisibleModalsStack();

    window.addEventListener('click', (event) => {
        if (event.target.id === 'noteEditorModal') {
            closeNoteEditor();
            return;
        }

        if (event.target.id === 'userEditModal') {
            closeUserEditModal();
            return;
        }

        if (event.target.id === 'stockDeficitModal') {
            closeStockDeficitModal();
            return;
        }

        // Закрываем модальное окно только при клике на фон
        const modalElement = event.target;
        if (modalElement.classList.contains('modal')) {
            // Проверяем, что клик был НА фоне (не внутри содержимого)
            const inModalContent = event.target.closest('.modal-content') !== null;
            const inItemCard = event.target.closest('.item-card-content') !== null;
            
            if (!inModalContent && !inItemCard) {
                // Клик был на фоне - закрываем окно
                if (modalElement.id === 'rentalModal') {
                    closeRentalModal();
                    return;
                }
                if (modalElement.id === 'eventModal') {
                    closeEventModal();
                    return;
                }
                modalElement.style.display = 'none';
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (autoSaveEnabled) saveData();
        else saveLocalBackup();
    });

    const hasSession = await verifyExistingSession();
    if (!hasSession) {
        document.getElementById('loginModule').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});