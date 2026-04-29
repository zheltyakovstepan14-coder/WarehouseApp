// Shared dashboard helpers reused by advanced dashboard charts.
(function initWarehouseDashboard(global) {
    function getDashboardChartTheme() {
        return {
            tick: "#eaf2ff",
            grid: "rgba(186, 206, 232, 0.24)",
            gridSoft: "rgba(186, 206, 232, 0.14)"
        };
    }

    global.WarehouseDashboard = Object.assign({}, global.WarehouseDashboard, {
        getDashboardChartTheme
    });
})(window);
