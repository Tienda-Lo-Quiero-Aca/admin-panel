/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const ADVANCED_TEMPLATE = `mla,sku,tipo_publicacion,precio,categoria,meliContributionPercentage
MLA2228742950,B0F47N62NN,gold_special,731399,MLA31040,2.4`;
const MAX_DIRECT_CSV_BYTES = 10 * 1024 * 1024;
const LINE_LIMIT = 100;
// Mientras algo se procesa se consulta seguido; si no, cada tanto.
const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 20000;

// Mismas reglas que _parse_mla_text en el servidor (el servidor manda).
const MLA_PATTERN = /MLA[-_ ]?(\d{6,})/gi;
const BARE_ID_PATTERN = /^(\d{8,})\b(.*)$/;
const PRICE_PATTERN = /^[\s,;|]+\$?\s*(\d[\d.,]*)\s*$/;

function parsePrice(raw) {
    let value = String(raw || "").trim().replace(/[.,]+$/, "");
    if (!value) {
        return null;
    }
    if (value.includes(".") && value.includes(",")) {
        value = value.replace(/\./g, "").replace(",", ".");
    } else if (value.includes(",")) {
        const tail = value.slice(value.lastIndexOf(",") + 1);
        value = tail.length <= 2
            ? `${value.slice(0, value.lastIndexOf(",")).replace(/,/g, "")}.${tail}`
            : value.replace(/,/g, "");
    } else if ((value.match(/\./g) || []).length > 1 || (value.includes(".") && value.slice(value.lastIndexOf(".") + 1).length === 3)) {
        value = value.replace(/\./g, "");
    }
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? price : null;
}

function parseMlaText(text) {
    const entries = new Map();
    const ignored = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const matches = [...line.matchAll(MLA_PATTERN)];
        if (matches.length > 1) {
            for (const match of matches) {
                const mla = `MLA${match[1]}`;
                if (!entries.has(mla)) {
                    entries.set(mla, null);
                }
            }
            continue;
        }
        let mla;
        let rest;
        if (matches.length) {
            mla = `MLA${matches[0][1]}`;
            rest = line.slice(matches[0].index + matches[0][0].length);
        } else {
            const bare = line.match(BARE_ID_PATTERN);
            if (!bare) {
                ignored.push(line.slice(0, 80));
                continue;
            }
            mla = `MLA${bare[1]}`;
            rest = bare[2];
        }
        const number = rest.match(PRICE_PATTERN);
        const price = number ? parsePrice(number[1]) : null;
        if (price || !entries.has(mla)) {
            entries.set(mla, price);
        }
    }
    return { entries, ignored };
}

const LISTING_LABELS = { gold_special: "Clásica", gold_pro: "Premium", free: "Gratuita" };

export class LqaMercadolibrePricing extends Component {
    static template = "lqa_admin_panel.MercadolibrePricing";

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.state = useState({
            tab: "mla",
            // Por MLA
            mlaText: "",
            mlaName: "",
            mlaContribution: "",
            creatingMla: false,
            // CSV
            csvName: "",
            csvContent: "",
            creatingCsv: false,
            // Avanzado
            manualText: ADVANCED_TEMPLATE,
            creatingManual: false,
            // Carpeta
            selectionFolders: [],
            selectedFolderId: "",
            folderImport: null,
            startingFolderImport: false,
            generatingFolderExcel: false,
            retryingFolderImport: false,
            // Procesos
            jobs: [],
            loadingJobs: true,
            selectedJobId: "",
            selectedJob: null,
            loadingJob: false,
            downloadingJobId: "",
            retryingJobId: "",
            // Detalle
            resultFilter: "all",
            search: "",
            sort: "",
            lineOffset: 0,
            expandedLineId: 0,
        });

        onWillStart(() => {
            this.lqaInitialLoad = (async () => {
                await Promise.all([
                    this.loadJobs(),
                    this.loadSelectionFolders(),
                    this.loadFolderImport(false),
                ]);
                this.schedulePoll();
            })();
        });

        onWillUnmount(() => {
            clearTimeout(this.pollTimer);
            clearTimeout(this.searchTimer);
        });
    }

    setTab(tab) {
        this.state.tab = tab;
    }

    isSelectedJob(job) {
        return String(job?.id) === String(this.state.selectedJobId);
    }

    isRetrying(job) {
        return String(job?.id) === String(this.state.retryingJobId);
    }

    isDownloading(job) {
        return String(job?.id) === String(this.state.downloadingJobId);
    }

    noop() {}

    // ------------------------------------------------------------ refresco

    get hasActiveWork() {
        return (
            this.state.jobs.some((job) => ["pending", "processing"].includes(job.state)) ||
            ["queued", "running"].includes(this.state.folderImport?.state) ||
            ["queued", "running"].includes(this.state.folderImport?.exportState) ||
            (this.state.folderImport?.pendingJobs || 0) > 0
        );
    }

    schedulePoll() {
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(async () => {
            await Promise.all([this.loadJobs(false), this.loadFolderImport(true)]);
            this.schedulePoll();
        }, this.hasActiveWork ? FAST_POLL_MS : SLOW_POLL_MS);
    }

    // ------------------------------------------------------------ por MLA

    get mlaPreview() {
        const { entries, ignored } = parseMlaText(this.state.mlaText);
        const prices = [...entries.values()].filter(Boolean).length;
        return { count: entries.size, withPrice: prices, ignored };
    }

    async submitMla() {
        const preview = this.mlaPreview;
        if (!preview.count) {
            this.notification.add("Pegá al menos un MLA.", { type: "warning" });
            return;
        }
        this.state.creatingMla = true;
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "create_mla_job",
                [
                    this.state.mlaText,
                    this.state.mlaContribution === "" ? null : Number(this.state.mlaContribution),
                    this.state.mlaName,
                ]
            );
            this.state.mlaText = "";
            this.state.mlaName = "";
            let message = `Calculando ${this.formatNumber(job.inputCount)} MLAs. Los datos se completan solos desde Catalog Sync.`;
            if (job.ignoredCount) {
                message += ` Se ignoraron ${job.ignoredCount} líneas sin MLA.`;
            }
            this.notification.add(message, { type: "success" });
            await this.afterJobCreated(job);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo crear el pricing.", { type: "danger" });
        } finally {
            this.state.creatingMla = false;
        }
    }

    async afterJobCreated(job) {
        this.resetDetailFilters();
        this.state.selectedJobId = String(job.id);
        await this.loadJobs(false);
        await this.loadJob(job.id);
        this.schedulePoll();
    }

    // ------------------------------------------------------------ CSV

    async onCsvSelected(event) {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        event.target.value = "";
        if (file.size > MAX_DIRECT_CSV_BYTES) {
            this.notification.add(
                "El CSV es demasiado grande para la carga directa: usá una carpeta de Selecciones.",
                { type: "warning" }
            );
            return;
        }
        this.state.csvName = file.name;
        this.state.csvContent = await file.text();
    }

    clearCsv() {
        this.state.csvName = "";
        this.state.csvContent = "";
    }

    async submitCsv() {
        if (!this.state.csvContent) {
            return;
        }
        this.state.creatingCsv = true;
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "create_job",
                ["csv", this.state.csvContent, this.state.csvName]
            );
            this.clearCsv();
            this.notification.add("Pricing iniciado.", { type: "success" });
            await this.afterJobCreated(job);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo procesar el CSV.", { type: "danger" });
        } finally {
            this.state.creatingCsv = false;
        }
    }

    // ------------------------------------------------------------ avanzado

    async submitManual() {
        if (!String(this.state.manualText || "").trim()) {
            return;
        }
        this.state.creatingManual = true;
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "create_job",
                ["manual", this.state.manualText, ""]
            );
            this.notification.add("Pricing iniciado.", { type: "success" });
            await this.afterJobCreated(job);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo procesar la carga.", { type: "danger" });
        } finally {
            this.state.creatingManual = false;
        }
    }

    // ------------------------------------------------------------ carpeta

    async loadSelectionFolders() {
        try {
            this.state.selectionFolders = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_folders",
                []
            );
            if (!this.state.selectedFolderId && this.state.selectionFolders.length) {
                this.state.selectedFolderId = String(this.state.selectionFolders[0].id);
            }
        } catch {
            this.state.selectionFolders = [];
        }
    }

    async loadFolderImport(notify = true) {
        try {
            const importJob = await this.orm.silent.call(
                "lqa.mercadolibre.pricing.service",
                "get_active_folder_import",
                []
            );
            const previous = this.state.folderImport;
            this.state.folderImport = importJob || null;
            if (notify && previous && importJob) {
                if (importJob.pricingState === "done" && previous.pricingState !== "done") {
                    this.notification.add(
                        `Carpeta procesada: ${this.formatNumber(importJob.success)} publicaciones con pricing.`,
                        { type: "success" }
                    );
                }
                if (importJob.exportState === "done" && previous.exportState !== "done") {
                    this.notification.add("El Excel de la carpeta está listo.", { type: "success" });
                }
            }
        } catch {
            // El proximo ciclo vuelve a intentar.
        }
    }

    async startFolderImport() {
        if (!this.state.selectedFolderId) {
            return;
        }
        this.state.startingFolderImport = true;
        try {
            this.state.folderImport = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "start_selection_folder_import",
                [Number(this.state.selectedFolderId)]
            );
            this.notification.add("Procesando la carpeta en segundo plano.", { type: "info" });
            this.schedulePoll();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo iniciar la carpeta.", { type: "danger" });
        } finally {
            this.state.startingFolderImport = false;
        }
    }

    get isFolderImportRunning() {
        return ["queued", "running"].includes(this.state.folderImport?.state);
    }

    get folderPricingProgress() {
        const total = Number(this.state.folderImport?.jobs || 0);
        const completed = Number(this.state.folderImport?.completedJobs || 0);
        return total ? Math.min(Math.round((completed / total) * 100), 100) : 0;
    }

    async generateFolderExcel() {
        const importJob = this.state.folderImport;
        if (!importJob?.id) {
            return;
        }
        this.state.generatingFolderExcel = true;
        try {
            this.state.folderImport = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "start_folder_import_export",
                [importJob.id]
            );
            this.schedulePoll();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo generar el Excel.", { type: "danger" });
        } finally {
            this.state.generatingFolderExcel = false;
        }
    }

    async retryFolderImport() {
        const importJob = this.state.folderImport;
        if (!importJob?.id) {
            return;
        }
        this.state.retryingFolderImport = true;
        try {
            this.state.folderImport = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "retry_failed_folder_jobs",
                [importJob.id]
            );
            this.notification.add("Los lotes con error volvieron a la cola.", { type: "success" });
            this.schedulePoll();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron reintentar los errores.", { type: "danger" });
        } finally {
            this.state.retryingFolderImport = false;
        }
    }

    downloadFolderExcel() {
        if (this.state.folderImport?.downloadUrl) {
            window.location.href = this.state.folderImport.downloadUrl;
        }
    }

    // ------------------------------------------------------------ procesos

    async loadJobs(showLoader = true) {
        if (showLoader) {
            this.state.loadingJobs = true;
        }
        try {
            const previous = new Map(this.state.jobs.map((job) => [job.id, job.state]));
            this.state.jobs = await this.orm.silent.call(
                "lqa.mercadolibre.pricing.service",
                "get_jobs",
                [30]
            );
            if (!this.state.selectedJobId && this.state.jobs.length) {
                this.state.selectedJobId = String(this.state.jobs[0].id);
            }
            const selected = this.selectedJobFromList;
            if (!selected) {
                this.state.selectedJob = null;
            } else if (
                !this.state.selectedJob ||
                ["pending", "processing"].includes(selected.state) ||
                previous.get(selected.id) !== selected.state
            ) {
                // Mientras se procesa, el detalle se actualiza solo.
                await this.loadJob(selected.id, false);
            }
        } catch (error) {
            if (showLoader) {
                this.notification.add(error?.data?.message || "No se pudieron cargar los procesos.", { type: "danger" });
            }
        } finally {
            this.state.loadingJobs = false;
        }
    }

    get selectedJobFromList() {
        return this.state.jobs.find((job) => String(job.id) === String(this.state.selectedJobId));
    }

    async selectJob(job) {
        if (String(job.id) === String(this.state.selectedJobId)) {
            return;
        }
        this.state.selectedJobId = String(job.id);
        this.resetDetailFilters();
        await this.loadJob(job.id);
    }

    resetDetailFilters() {
        this.state.resultFilter = "all";
        this.state.search = "";
        this.state.sort = "";
        this.state.lineOffset = 0;
        this.state.expandedLineId = 0;
    }

    async loadJob(jobId, showLoader = true) {
        if (!jobId) {
            return;
        }
        if (showLoader) {
            this.state.loadingJob = true;
        }
        try {
            const job = await this.orm.silent.call(
                "lqa.mercadolibre.pricing.service",
                "get_job",
                [
                    Number(jobId),
                    LINE_LIMIT,
                    this.state.lineOffset,
                    this.state.resultFilter,
                    this.state.search,
                    this.state.sort,
                ]
            );
            if (String(jobId) === String(this.state.selectedJobId)) {
                this.state.selectedJob = job;
            }
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo cargar el proceso.", { type: "danger" });
        } finally {
            this.state.loadingJob = false;
        }
    }

    async setResultFilter(filter) {
        this.state.resultFilter = filter;
        this.state.lineOffset = 0;
        await this.loadJob(this.state.selectedJobId);
    }

    async onSortChange(event) {
        this.state.sort = event.target.value;
        this.state.lineOffset = 0;
        await this.loadJob(this.state.selectedJobId);
    }

    onSearchInput(event) {
        this.state.search = event.target.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.state.lineOffset = 0;
            this.loadJob(this.state.selectedJobId);
        }, 350);
    }

    async previousLines() {
        const pagination = this.state.selectedJob?.linePagination;
        if (pagination?.hasPrevious) {
            this.state.lineOffset = Math.max(pagination.offset - pagination.limit, 0);
            await this.loadJob(this.state.selectedJobId);
        }
    }

    async nextLines() {
        const pagination = this.state.selectedJob?.linePagination;
        if (pagination?.hasNext) {
            this.state.lineOffset = pagination.offset + pagination.limit;
            await this.loadJob(this.state.selectedJobId);
        }
    }

    toggleLine(line) {
        this.state.expandedLineId = this.state.expandedLineId === line.id ? 0 : line.id;
    }

    get resultFilters() {
        const counts = this.state.selectedJob?.summary?.counts || {};
        return [
            { id: "all", label: "Todas", count: counts.all },
            { id: "profit", label: "Con ganancia", count: counts.profit, tone: "ok" },
            { id: "loss", label: "Con pérdida", count: counts.loss, tone: "danger" },
            { id: "nocost", label: "Sin costo", count: counts.nocost, tone: "warn" },
            { id: "failed", label: "Errores", count: counts.failed, tone: "danger" },
            { id: "pending", label: "Pendientes", count: counts.pending },
        ].filter((item) => item.id === "all" || item.count);
    }

    get jobProgress() {
        const job = this.state.selectedJob;
        if (!job?.inputCount) {
            return 0;
        }
        return Math.min(Math.round((job.processedCount / job.inputCount) * 100), 100);
    }

    jobListProgress(job) {
        return job.inputCount ? Math.min(Math.round((job.processedCount / job.inputCount) * 100), 100) : 0;
    }

    isJobActive(job) {
        return ["pending", "processing"].includes(job?.state);
    }

    async retryJob(job) {
        this.state.retryingJobId = String(job.id);
        try {
            await this.orm.call("lqa.mercadolibre.pricing.service", "retry_job", [job.id]);
            this.notification.add("Las filas con error se vuelven a calcular.", { type: "info" });
            await this.loadJobs(false);
            this.schedulePoll();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo reintentar.", { type: "danger" });
        } finally {
            this.state.retryingJobId = "";
        }
    }

    async downloadJobXlsx(job) {
        this.state.downloadingJobId = String(job.id);
        try {
            const result = await this.orm.call(
                "lqa.mercadolibre.pricing.service",
                "download_job_xlsx",
                [job.id]
            );
            const binary = window.atob(result.content || "");
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }
            const url = URL.createObjectURL(new Blob([bytes], { type: result.mimetype }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.filename || "pricing.xlsx";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo descargar el Excel.", { type: "danger" });
        } finally {
            this.state.downloadingJobId = "";
        }
    }

    async copyText(value, label) {
        try {
            await navigator.clipboard.writeText(String(value));
            this.notification.add(`${label} copiado: ${value}`, { type: "success" });
        } catch {
            this.notification.add("No se pudo copiar.", { type: "warning" });
        }
    }

    // ------------------------------------------------------------ formato

    listingLabel(value) {
        return LISTING_LABELS[value] || value || "—";
    }

    sourceLabel(source) {
        return { csv: "CSV", manual: "Avanzado", mla: "MLAs", folder: "Carpeta" }[source] || source;
    }

    stateLabel(state) {
        return (
            {
                pending: "En cola",
                processing: "Procesando",
                preparing: "Preparando",
                running: "Procesando",
                queued: "En cola",
                done: "Listo",
                failed: "Error",
            }[state] || state
        );
    }

    marginTone(line) {
        if (line.state !== "done") {
            return "";
        }
        if (line.noCost) {
            return "is-warn";
        }
        if (line.operatingProfit <= 0) {
            return "is-loss";
        }
        return line.marginValue >= 15 ? "is-good" : "is-thin";
    }

    mlaUrl(mla) {
        const digits = String(mla || "").replace(/\D/g, "");
        return digits ? `https://articulo.mercadolibre.com.ar/MLA-${digits}` : "";
    }

    relativeTime(value) {
        if (!value) {
            return "";
        }
        const date = new Date(`${value.replace(" ", "T")}Z`);
        const minutes = Math.round((Date.now() - date.getTime()) / 60000);
        if (minutes < 1) {
            return "recién";
        }
        if (minutes < 60) {
            return `hace ${minutes} min`;
        }
        const hours = Math.round(minutes / 60);
        if (hours < 24) {
            return `hace ${hours} h`;
        }
        return this.formatDateTime(value);
    }

    formatDateTime(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(`${value.replace(" ", "T")}Z`);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    formatCurrency(value) {
        const number = Number(value);
        if (value === null || value === undefined || value === "" || !Number.isFinite(number)) {
            return "—";
        }
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: "ARS",
            maximumFractionDigits: 0,
        }).format(number);
    }

    formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat("es-AR").format(number) : "0";
    }

    formatPercent(value) {
        const number = Number(value);
        if (value === null || value === undefined || !Number.isFinite(number)) {
            return "—";
        }
        return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(number)}%`;
    }

    breakdownValue(row) {
        return row.kind === "cost" ? `− ${this.formatCurrency(row.value)}` : this.formatCurrency(row.value);
    }
}

registry.category("actions").add("lqa_admin_panel.mercadolibre_pricing", LqaMercadolibrePricing);
