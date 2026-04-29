// Shared formatting helpers (safe, non-breaking bridge).
(function initWarehouseFormatters(global) {
    function toNumberSafe(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function shortDate(value, fallback = "—") {
        if (typeof global.formatDateOnly === "function") {
            return global.formatDateOnly(value, fallback);
        }
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("ru-RU") : fallback;
    }

    function dateTime(value, fallback = "—") {
        if (typeof global.formatDateTime === "function") {
            return global.formatDateTime(value, fallback);
        }
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("ru-RU") : fallback;
    }

    global.WarehouseFormatters = Object.assign({}, global.WarehouseFormatters, {
        toNumberSafe,
        shortDate,
        dateTime
    });
})(window);
