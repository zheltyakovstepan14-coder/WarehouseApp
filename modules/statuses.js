// Shared status semantics extracted from script.js.
(function initWarehouseStatuses(global) {
    function getStatusMeta(status) {
        const value = String(status || "").trim();
        switch (value) {
            case "Черновик":
                return { icon: "📝", label: "Черновик", badgeClass: "status-pill status-pill-draft", rowClass: "status-draft-row" };
            case "Проведен":
                return { icon: "✅", label: "Проведен", badgeClass: "status-pill status-pill-posted", rowClass: "status-active" };
            case "Активна":
            case "Активно":
                return { icon: "▶️", label: value, badgeClass: "status-pill status-pill-active", rowClass: "status-active" };
            case "Завершена":
            case "Завершено":
                return { icon: "✔️", label: value, badgeClass: "status-pill status-pill-completed", rowClass: "status-completed" };
            case "Просрочена":
            case "Просрочено":
                return { icon: "⏰", label: value, badgeClass: "status-pill status-pill-overdue", rowClass: "status-overdue" };
            default:
                return { icon: "📝", label: value || "Черновик", badgeClass: "status-pill status-pill-draft", rowClass: "status-default" };
        }
    }

    function renderStatusBadge(status) {
        const meta = getStatusMeta(status);
        const escape = typeof global.escapeHtml === "function" ? global.escapeHtml : (v) => String(v ?? "");
        return `<span class="${meta.badgeClass}"><span>${meta.icon}</span><span>${escape(meta.label)}</span></span>`;
    }

    function getRentalStatusClass(status) {
        return getStatusMeta(status).rowClass;
    }

    function normalizePurchaseRequestStatusString(status) {
        const restore = typeof global.restoreText === "function" ? global.restoreText : (v) => String(v || "");
        const raw = String(restore(status || "")).trim().toLowerCase().replace(/ё/g, "е");
        if (!raw) return "";
        const aliases = {
            pending: "approval",
            partial_approved: "approved_partial",
            approved_partial: "approved_partial",
            cancelled: "rejected",
            canceled: "rejected",
            canceled_by_manager: "rejected",
            черновик: "draft",
            новая: "draft",
            "на согласовании": "approval",
            согласование: "approval",
            согласована: "approved",
            "частично согласована": "approved_partial",
            заказана: "ordered",
            поставлена: "ordered",
            поставлен: "ordered",
            "частично поставлено": "partial",
            "частично получен": "partial",
            "частично получено": "partial",
            частично: "partial",
            получен: "completed",
            получено: "completed",
            проведен: "completed",
            проведена: "completed",
            отменена: "rejected",
            отменен: "rejected",
            закрыта: "closed"
        };
        return aliases[raw] || raw;
    }

    global.WarehouseStatuses = Object.assign({}, global.WarehouseStatuses, {
        getStatusMeta,
        renderStatusBadge,
        getRentalStatusClass,
        normalizePurchaseRequestStatusString
    });
})(window);
