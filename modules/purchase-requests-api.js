// API service for purchase request interactions.
(function initPurchaseRequestsApi(global) {
    async function fetchPurchaseRequestDraftsForItem(itemId) {
        if (!itemId || typeof global.apiFetch !== "function") return [];
        try {
            const drafts = await global.apiFetch(
                `/api/inventory/purchase-requests?status=${encodeURIComponent("Черновик")}&itemId=${encodeURIComponent(String(itemId || "").trim())}`
            );
            return Array.isArray(drafts) ? drafts : [];
        } catch (error) {
            console.error("Не удалось получить черновики заявок:", error);
            return [];
        }
    }

    global.PurchaseRequestsApi = Object.assign({}, global.PurchaseRequestsApi, {
        fetchPurchaseRequestDraftsForItem
    });
})(window);
