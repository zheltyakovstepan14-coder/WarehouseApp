// ============================================================================
// Core UI/text/date utilities (Шаг 3: вынесено из script.js)
// Загружать перед script.js — глобальные функции для остального фронта.
// ============================================================================

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function tryFixUtf8Mojibake(value) {
    if (typeof value !== 'string') return value;
    if (value.length < 2) return value;
    try {
        const fixed = decodeURIComponent(escape(value));
        if (fixed !== value && !/%u/i.test(fixed) && /[А-Яа-яЁё]/.test(fixed)) {
            return fixed;
        }
    } catch (error) {
        // ignore invalid URI sequences
    }
    return value;
}

function restoreText(value) {
    return tryFixUtf8Mojibake(String(value || ''));
}

function parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }

    const fallback = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function toDateTimeLocalValue(value, fallbackDate = null) {
    const date = value ? parseDateValue(value) : fallbackDate;
    if (!date) return '';

    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value, fallback = '') {
    if (!value) return fallback;
    const date = parseDateValue(value);
    if (!date) return String(value);

    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateOnly(value, fallback = '—') {
    if (!value) return fallback;
    const date = parseDateValue(value);
    if (!date) return fallback;
    return date.toLocaleDateString('ru-RU');
}

function formatDateTimeSafe(value, fallback = '—') {
    if (!value) return fallback;
    const date = parseDateValue(value);
    if (!date) return fallback;
    return date.toLocaleString('ru-RU');
}
