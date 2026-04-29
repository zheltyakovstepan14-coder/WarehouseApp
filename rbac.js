/**
 * RBAC (Role-Based Access Control) System
 * Система управления правами доступа на основе ролей
 */

const RBAC = (() => {
    const ROLE_ALIASES = {
        admin: 'admin',
        administrator: 'admin',
        'администратор': 'admin',
        'руководитель': 'руководитель',
        'менеджер': 'менеджер',
        'менеджер по аренде': 'менеджер',
        'кладовщик': 'кладовщик',
        'гость': 'гость',
        'наблюдатель': 'гость',
        'гость/наблюдатель': 'гость'
    };

    // Стандартные роли и их права
    const DEFAULT_ROLE_PERMISSIONS = {
        admin: {
            stock: { view: true, create: true, edit: true, delete: true, changeQty: true },
            rental: { view: true, create: true, edit: true, delete: true, changeStatus: true, documents: true },
            events: { view: true, create: true, edit: true, delete: true, changeStatus: true, documents: true },
            reports: { view: true, export: true },
            users: { view: true, create: true, edit: true, delete: true, permissions: true },
            documents: { view: true, generate: true, search: true, changeStatus: true, print: true },
            calendar: { view: true },
            purchaseRequests: { view: true, create: true, edit: true, delete: true, approve: true, order: true, delivery: true, print: true }
        },
        
        руководитель: {
            stock: { view: true, create: true, edit: true, delete: false, changeQty: true },
            rental: { view: true, create: true, edit: true, delete: false, changeStatus: true, documents: true },
            events: { view: true, create: true, edit: true, delete: false, changeStatus: true, documents: true },
            reports: { view: true, export: true },
            users: { view: false, create: false, edit: false, delete: false, permissions: false },
            documents: { view: true, generate: true, search: true, changeStatus: true, print: true },
            calendar: { view: true },
            purchaseRequests: { view: true, create: true, edit: true, delete: true, approve: true, order: true, delivery: true, print: true }
        },
        
        менеджер: {
            stock: { view: true, create: false, edit: false, delete: false, changeQty: false },
            rental: { view: true, create: true, edit: true, delete: true, changeStatus: true, documents: true },
            events: { view: true, create: false, edit: false, delete: false, changeStatus: false, documents: false },
            reports: { view: false, export: false },
            users: { view: false, create: false, edit: false, delete: false, permissions: false },
            documents: { view: true, generate: true, search: true, changeStatus: true, print: true },
            calendar: { view: true },
            purchaseRequests: { view: true, create: false, edit: false, delete: false, approve: true, order: false, delivery: false, print: true }
        },
        
        кладовщик: {
            stock: { view: true, create: true, edit: true, delete: true, changeQty: true },
            rental: { view: true, create: false, edit: false, delete: false, changeStatus: false, documents: false },
            events: { view: true, create: false, edit: false, delete: false, changeStatus: false, documents: false },
            reports: { view: false, export: false },
            users: { view: false, create: false, edit: false, delete: false, permissions: false },
            documents: { view: true, generate: true, search: true, changeStatus: false, print: true },
            calendar: { view: true },
            purchaseRequests: { view: true, create: true, edit: true, delete: true, approve: false, order: true, delivery: true, print: true }
        },
        
        гость: {
            stock: { view: true, create: false, edit: false, delete: false, changeQty: false },
            rental: { view: true, create: false, edit: false, delete: false, changeStatus: false, documents: false },
            events: { view: true, create: false, edit: false, delete: false, changeStatus: false, documents: false },
            reports: { view: true, export: false },
            users: { view: false, create: false, edit: false, delete: false, permissions: false },
            documents: { view: true, generate: false, search: true, changeStatus: false, print: false },
            calendar: { view: true },
            purchaseRequests: { view: true, create: false, edit: false, delete: false, approve: false, order: false, delivery: false, print: false }
        }
    };

    // Текущий пользователь с правами
    let currentUser = {
        id: null,
        username: '',
        role: 'гость',
        active: true,
        permissions: null  // Кастомные права (если переопределены)
    };

    /**
     * Набор прав для каждого модуля
     */
    const PERMISSION_STRUCTURE = {
        stock: ['view', 'create', 'edit', 'delete', 'changeQty'],
        rental: ['view', 'create', 'edit', 'delete', 'changeStatus', 'documents'],
        events: ['view', 'create', 'edit', 'delete', 'changeStatus', 'documents'],
        reports: ['view', 'export'],
        users: ['view', 'create', 'edit', 'delete', 'permissions'],
        documents: ['view', 'generate', 'search', 'changeStatus', 'print'],
        calendar: ['view'],
        purchaseRequests: ['view', 'create', 'edit', 'delete', 'approve', 'order', 'delivery', 'print']
    };

    function normalizeRole(role) {
        const normalized = String(role || 'гость').trim().toLowerCase();
        return ROLE_ALIASES[normalized] || normalized;
    }

    /**
     * Установить текущего пользователя
     */
    function setCurrentUser(userData) {
        currentUser = {
            id: userData.id,
            username: userData.username,
            role: normalizeRole(userData.role || 'гость'),
            active: userData.active !== false,
            permissions: userData.permissions || null
        };
        console.log('RBAC: Current user set', currentUser);
    }

    /**
     * Получить текущего пользователя
     */
    function getCurrentUser() {
        return { ...currentUser };
    }

    /**
     * Проверить есть ли у пользователя право
     * @param {string} module - модуль (stock, rental, events, reports, users)
     * @param {string} action - действие (view, create, edit, delete, changeStatus и т.д.)
     * @returns {boolean}
     */
    function hasPermission(module, action) {
        // Admin всегда имеет все права
        if (currentUser.role === 'admin') return true;

        // Проверка кастомных прав (если установлены)
        if (currentUser.permissions && currentUser.permissions[module]) {
            const customPerm = currentUser.permissions[module][action];
            if (customPerm !== undefined) {
                return customPerm === true;
            }
        }

        // Проверка прав по роли
        if (DEFAULT_ROLE_PERMISSIONS[currentUser.role] && 
            DEFAULT_ROLE_PERMISSIONS[currentUser.role][module]) {
            const rolePerm = DEFAULT_ROLE_PERMISSIONS[currentUser.role][module][action];
            return rolePerm === true;
        }

        return false;
    }

    /**
     * Получить права пользователя (для отображения)
     */
    function getUserPermissions(role, customPermissions = null) {
        // Если есть кастомные права, вернуть их
        if (customPermissions) {
            return customPermissions;
        }

        // Иначе вернуть права по роли
        return DEFAULT_ROLE_PERMISSIONS[normalizeRole(role)] || {};
    }

    /**
     * Получить все доступные роли
     */
    function getAvailableRoles() {
        return Object.keys(DEFAULT_ROLE_PERMISSIONS);
    }

    /**
     * Получить стандартные права для роли
     */
    function getDefaultPermissionsForRole(role) {
        return DEFAULT_ROLE_PERMISSIONS[normalizeRole(role)] || {};
    }

    /**
     * Сохранить кастомные права пользователю
     */
    function setUserCustomPermissions(userId, customPermissions) {
        const storageKey = `user_permissions_${userId}`;
        localStorage.setItem(storageKey, JSON.stringify(customPermissions));
        if (String(currentUser.id) === String(userId)) {
            currentUser.permissions = customPermissions || null;
        }
    }

    /**
     * Загрузить кастомные права пользователя
     */
    function loadUserCustomPermissions(userId) {
        const storageKey = `user_permissions_${userId}`;
        try {
            const stored = localStorage.getItem(storageKey);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            console.error('Error loading permissions:', e);
            return null;
        }
    }

    /**
     * Сбросить кастомные права (вернуть к стандартной роли)
     */
    function resetUserCustomPermissions(userId) {
        const storageKey = `user_permissions_${userId}`;
        localStorage.removeItem(storageKey);
        if (String(currentUser.id) === String(userId)) {
            currentUser.permissions = null;
        }
    }

    /**
     * Инициализировать коэффициент прав (вызвать при загрузке пользователя)
     */
    function initializeUser(userData) {
        setCurrentUser(userData);
        if (userData && Object.prototype.hasOwnProperty.call(userData, 'permissions')) {
            currentUser.permissions = userData.permissions || null;
            return;
        }

        // Поддержка старых локально сохранённых прав как fallback
        const customPerms = loadUserCustomPermissions(userData.id);
        if (customPerms) {
            currentUser.permissions = customPerms;
        }
    }

    /**
     * Получить описание роли
     */
    function getRoleDescription(role) {
        const normalizedRole = normalizeRole(role);
        const descriptions = {
            admin: 'Администратор - полный доступ',
            руководитель: 'Руководитель - управление и отчёты',
            менеджер: 'Менеджер по аренде - работа с арендой',
            кладовщик: 'Кладовщик - работа со складом',
            гость: 'Гость - только просмотр'
        };
        return descriptions[normalizedRole] || role;
    }

    /**
     * Скрыть/показать элемент по правам
     */
    function checkElementPermission(element, module, action) {
        if (!element) return;
        
        if (hasPermission(module, action)) {
            element.style.display = '';
            element.disabled = false;
        } else {
            element.style.display = 'none';
            element.disabled = true;
        }
    }

    return {
        setCurrentUser,
        getCurrentUser,
        hasPermission,
        getUserPermissions,
        getAvailableRoles,
        getDefaultPermissionsForRole,
        setUserCustomPermissions,
        loadUserCustomPermissions,
        resetUserCustomPermissions,
        initializeUser,
        getRoleDescription,
        normalizeRole,
        checkElementPermission,
        PERMISSION_STRUCTURE,
        DEFAULT_ROLE_PERMISSIONS
    };
})();

// Экспортировать для использования в других скриптах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RBAC;
}
