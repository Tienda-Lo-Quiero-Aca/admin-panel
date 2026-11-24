/** @odoo-module **/

import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import {
    datadogPublisherLogsUrl,
    datadogRunLogsUrl,
    parseRunDate,
} from "@lqa_admin_panel/js/publisher_logs_url";

export class LqaRetailersPublisherLogs extends Component {
    static template = "lqa_admin_panel.RetailersPublisherLogs";

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({
            history: [],
            folders: [],
            loading: true,
            runQuery: "",
        });

        // Sin await: la vista se dibuja al instante y la lista llega despues.
        onWillStart(() => {
            this.lqaInitialLoad = this.load();
        });
    }

    get runs() {
        return this.state.history.filter(
            (execution) => execution.run_id && !this.isHistoryError(execution)
        );
    }

    get manualRunId() {
        return this.state.runQuery.trim().replace(/^#/, "");
    }

    get manualRunValid() {
        return /^\d+$/.test(this.manualRunId);
    }

    async load() {
        this.state.loading = true;
        try {
            const [history, folders] = await Promise.all([
                this.orm.call("lqa.retailers.publisher.service", "get_publication_history", [50]),
                // Solo nombres: sin conteos, que cuestan una consulta por carpeta.
                this.orm.call("lqa.retailers.publisher.service", "get_folders", [false]),
            ]);
            this.state.history = history || [];
            this.state.folders = folders || [];
        } catch (error) {
            this.notification.add(
                error?.data?.message || "No se pudo cargar el historial de publicaciones.",
                { type: "danger" }
            );
        } finally {
            this.state.loading = false;
        }
    }

    runLogsUrl(execution, onlyProblems = false) {
        return datadogRunLogsUrl(execution.run_id, execution.triggered_at, { onlyProblems });
    }

    manualLogsUrl(onlyProblems = false) {
        // Fecha desconocida si no esta en el historial: rango amplio.
        const known = this.runs.find((execution) => String(execution.run_id) === this.manualRunId);
        return datadogRunLogsUrl(this.manualRunId, known?.triggered_at || null, { onlyProblems });
    }

    recentLogsUrl(onlyProblems = false) {
        return datadogPublisherLogsUrl(24, { onlyProblems });
    }

    openTracking(runId) {
        this.action.doAction("lqa_admin_panel.action_lqa_retailers_publisher_tracking", {
            additionalContext: { lqa_publisher_run_id: String(runId) },
        });
    }

    folderName(folderId) {
        const folder = this.state.folders.find((item) => String(item.id) === String(folderId));
        return folder ? folder.name : `Carpeta #${folderId}`;
    }

    folderExists(folderId) {
        return this.state.folders.some((item) => String(item.id) === String(folderId));
    }

    isHistoryError(execution) {
        return ["ERROR", "FAILED"].includes(String(execution.status || "").toUpperCase());
    }

    formatNumber(value) {
        const numericValue = Number(value);
        return new Intl.NumberFormat("es-AR").format(
            Number.isFinite(numericValue) ? numericValue : 0
        );
    }

    formatDateTime(value) {
        const date = parseRunDate(value);
        if (!date) {
            return "—";
        }
        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }
}

registry
    .category("actions")
    .add("lqa_admin_panel.retailers_publisher_logs", LqaRetailersPublisherLogs);
