/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const defaultFilters = () => ({
    search: "",
    brand: "",
    categoryId: "",
    domainId: "",
    status: "",
    condition: "",
    listingTypeId: "",
    skuPrefix: "",
    hasOrders: "",
    hasVisits: "",
    minOrders: "",
    minRevenue: "",
    createdFrom: "",
    createdTo: "",
    sortBy: "revenue",
    sortOrder: "desc",
    limit: "100",
    offset: 0,
});

// Filtros que viven en "Más filtros"; si alguno esta aplicado, el panel abre.
const ADVANCED_KEYS = [
    "brand", "categoryId", "domainId", "condition", "listingTypeId", "skuPrefix",
    "hasOrders", "hasVisits", "minOrders", "minRevenue", "createdFrom", "createdTo",
];

// Lo que cuenta como filtro (no orden ni paginacion), con su rotulo para chips.
const FILTER_LABELS = {
    search: "Búsqueda",
    status: "Estado",
    brand: "Marca",
    categoryId: "Categoría",
    domainId: "Dominio",
    condition: "Condición",
    listingTypeId: "Tipo",
    skuPrefix: "SKU empieza con",
    hasOrders: "Con órdenes",
    hasVisits: "Con visitas",
    minOrders: "Órdenes ≥",
    minRevenue: "Facturación ≥",
    createdFrom: "Creado desde",
    createdTo: "Creado hasta",
};

const STATUS_OPTIONS = [
    { id: "", label: "Todas" },
    { id: "active", label: "Activas" },
    { id: "paused", label: "Pausadas" },
    { id: "closed", label: "Cerradas" },
];

const SORT_OPTIONS = [
    { id: "revenue:desc", label: "Más facturación" },
    { id: "ordersCount:desc", label: "Más órdenes" },
    { id: "unitsSold:desc", label: "Más unidades vendidas" },
    { id: "totalVisits:desc", label: "Más visitas" },
    { id: "orderConversionRate:desc", label: "Mejor conversión" },
    { id: "avgTicket:desc", label: "Mayor ticket promedio" },
    { id: "price:desc", label: "Mayor precio" },
    { id: "price:asc", label: "Menor precio" },
    { id: "stock:desc", label: "Más stock" },
    { id: "stock:asc", label: "Menos stock" },
    { id: "dateCreated:desc", label: "Más nuevas" },
    { id: "dateCreated:asc", label: "Más viejas" },
    { id: "lastOrderDate:desc", label: "Venta más reciente" },
    { id: "title:asc", label: "Título (A-Z)" },
];

const MAX_FOLDER_PRODUCTS = 500000;
// Igual que EXPORT_MAX_ROWS del servidor (el servidor lo informa en el job).
const MAX_EXPORT_ROWS = 500000;
// Medido contra Catalog Sync en produccion: 15-55 s por pagina de 1.000.
const EXPORT_SECONDS_PER_PAGE = 30;
const VIEW_KEY = "lqa_meli_catalog_view";

const CSV_COLUMNS = [
    { key: "item_id", label: "MLA" },
    { key: "title", label: "Título" },
    { key: "sku", label: "SKU" },
    { key: "brand", label: "Marca" },
    { key: "status", label: "Estado" },
    { key: "condition", label: "Condición" },
    { key: "listing_type_id", label: "Tipo de publicación" },
    { key: "price", label: "Precio" },
    { key: "currency_id", label: "Moneda" },
    { key: "available_quantity", label: "Stock" },
    { key: "revenue", label: "Facturación" },
    { key: "orders_count", label: "Órdenes" },
    { key: "units_sold", label: "Unidades vendidas" },
    { key: "total_visits", label: "Visitas" },
    { key: "order_conversion_rate", label: "Conversión de órdenes" },
    { key: "category_id", label: "Categoría" },
    { key: "domain_id", label: "Dominio" },
    { key: "permalink", label: "Link" },
    { key: "date_created", label: "Fecha de creación" },
    { key: "last_updated", label: "Última actualización" },
    { key: "catalog_sold_quantity", label: "Ventas de catálogo" },
    { key: "avg_ticket", label: "Ticket promedio" },
    { key: "first_order_date", label: "Primera orden" },
    { key: "last_order_date", label: "Última orden" },
    { key: "unit_conversion_rate", label: "Conversión de unidades" },
];

const DEFAULT_EXPORT_COLUMNS = [
    "item_id", "title", "sku", "status", "listing_type_id",
    "price", "available_quantity", "category_id", "permalink",
];

function readView() {
    try {
        return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "grid";
    } catch {
        return "grid";
    }
}

function parseServerDate(value) {
    if (!value) {
        return null;
    }
    // Odoo manda UTC sin zona.
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? `${value.replace(" ", "T")}Z`
        : value;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

export class LqaMercadolibreCatalog extends Component {
    static template = "lqa_admin_panel.MercadolibreCatalog";

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({
            // Consulta del catalogo
            loading: true,
            pageLoading: "",
            catalogError: "",
            catalogQueryId: null,
            queryStartedAt: 0,
            now: Date.now(),
            products: [],
            pagination: {},
            sort: {},
            filters: defaultFilters(),
            // Lo que efectivamente se consulto: exportar y guardar usan esto,
            // no lo que este escrito en el formulario sin aplicar.
            appliedFilters: defaultFilters(),
            showAdvanced: false,
            view: readView(),
            // Seleccion y carpetas
            selectedIds: {},
            folders: [],
            foldersLoading: true,
            selectedFolderId: "",
            newFolderName: "",
            creatingFolder: false,
            savingSelection: false,
            savingFilteredSelection: false,
            confirmSaveFiltered: false,
            selectionJob: null,
            retryingSelection: false,
            // Eliminar
            showDeleteConfirmation: false,
            deleting: false,
            appKey: "default",
            deleteReason: "",
            // Exportar
            showExportModal: false,
            exportColumns: {},
            exportPartCount: "1",
            startingExport: false,
            cancellingExport: false,
            exportJob: null,
        });
        this.state.exportColumns = Object.fromEntries(
            CSV_COLUMNS.map((column) => [column.key, DEFAULT_EXPORT_COLUMNS.includes(column.key)])
        );

        // Reloj para el cronometro de la consulta y el tiempo restante de la
        // exportacion: solo late mientras hay algo en curso.
        this.clock = setInterval(() => {
            if (this.state.loading || this.exportIsActive || this.isSelectionJobRunning) {
                this.state.now = Date.now();
            }
        }, 1000);

        // Sin await: la vista se dibuja al instante y los datos llegan despues.
        onWillStart(() => {
            this.lqaInitialLoad = (async () => {
                await Promise.all([
                    (async () => {
                        await this.loadFolders();
                        await this.loadActiveSelectionJob();
                    })(),
                    this.loadActiveExport(),
                    this.loadProducts(),
                ]);
            })();
        });

        onWillUnmount(() => {
            clearInterval(this.clock);
            for (const timer of [this.selectionJobTimer, this.catalogQueryTimer, this.exportTimer]) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
        });
    }

    // ------------------------------------------------------------ opciones

    get statusOptions() {
        return STATUS_OPTIONS;
    }

    get sortOptions() {
        return SORT_OPTIONS;
    }

    get exportCsvColumns() {
        return CSV_COLUMNS;
    }

    get sortKey() {
        return `${this.state.filters.sortBy}:${this.state.filters.sortOrder}`;
    }

    // ------------------------------------------------------------ filtros

    filterIsSet(filters, key) {
        const value = filters[key];
        return value !== undefined && value !== null && String(value).trim() !== "";
    }

    get filtersDirty() {
        return Object.keys(FILTER_LABELS).some(
            (key) => String(this.state.filters[key] ?? "") !== String(this.state.appliedFilters[key] ?? "")
        );
    }

    get advancedActiveCount() {
        return ADVANCED_KEYS.filter((key) => this.filterIsSet(this.state.appliedFilters, key)).length;
    }

    get activeChips() {
        const applied = this.state.appliedFilters;
        return Object.keys(FILTER_LABELS)
            .filter((key) => this.filterIsSet(applied, key))
            .map((key) => ({ key, label: FILTER_LABELS[key], value: this.chipValue(key, applied[key]) }));
    }

    chipValue(key, value) {
        if (key === "status") {
            return this.statusLabel(value);
        }
        if (key === "hasOrders" || key === "hasVisits") {
            return value === "true" ? "Sí" : "No";
        }
        if (key === "minRevenue") {
            return this.formatCurrency(value);
        }
        if (key === "createdFrom" || key === "createdTo") {
            return this.formatDate(value);
        }
        return String(value);
    }

    async removeChip(key) {
        this.state.filters[key] = defaultFilters()[key];
        await this.applyFilters();
    }

    toggleAdvanced() {
        this.state.showAdvanced = !this.state.showAdvanced;
    }

    async setStatus(status) {
        this.state.filters.status = status;
        await this.applyFilters();
    }

    async onSortChange(event) {
        const [sortBy, sortOrder] = String(event.target.value).split(":");
        this.state.filters.sortBy = sortBy;
        this.state.filters.sortOrder = sortOrder || "desc";
        await this.applyFilters();
    }

    async onLimitChange(event) {
        this.state.filters.limit = String(event.target.value);
        await this.applyFilters();
    }

    get rangeStart() {
        return Number(this.state.pagination.offset || 0) + 1;
    }

    get rangeEnd() {
        return Number(this.state.pagination.offset || 0) + this.state.products.length;
    }

    isOut(product) {
        return !Number(product?.available_quantity);
    }

    noop() {}

    setView(view) {
        this.state.view = view;
        try {
            window.localStorage.setItem(VIEW_KEY, view);
        } catch {
            // Solo es una preferencia: sin storage arranca en tarjetas.
        }
    }

    async applyFilters() {
        this.clearSelection();
        this.state.filters.offset = 0;
        await this.loadProducts();
    }

    async clearFilters() {
        this.clearSelection();
        const { sortBy, sortOrder, limit } = this.state.filters;
        this.state.filters = { ...defaultFilters(), sortBy, sortOrder, limit };
        await this.loadProducts();
    }

    // ------------------------------------------------------------ consulta

    get queryElapsed() {
        if (!this.state.loading || !this.state.queryStartedAt) {
            return 0;
        }
        return Math.max(0, Math.floor((this.state.now - this.state.queryStartedAt) / 1000));
    }

    async loadProducts() {
        if (this.catalogQueryTimer) {
            clearTimeout(this.catalogQueryTimer);
        }
        const requested = { ...this.state.filters };
        this.state.loading = true;
        this.state.catalogError = "";
        this.state.catalogQueryId = null;
        this.state.queryStartedAt = Date.now();
        this.state.now = Date.now();
        this.pendingFilters = requested;
        try {
            const query = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "start_products_query",
                [requested]
            );
            this.state.catalogQueryId = query.id;
            if (query.state === "done") {
                await this.pollCatalogQuery();
            } else {
                this.scheduleCatalogQueryPolling();
            }
        } catch (error) {
            this.state.loading = false;
            this.state.pageLoading = "";
            this.state.catalogError =
                error?.data?.message || "No se pudo iniciar la consulta del catálogo.";
        }
    }

    // Abandona la consulta en curso: el servidor la termina igual, pero la
    // pantalla deja de esperarla y conserva los resultados anteriores.
    cancelQuery() {
        if (this.catalogQueryTimer) {
            clearTimeout(this.catalogQueryTimer);
        }
        this.state.catalogQueryId = null;
        this.state.loading = false;
        this.state.pageLoading = "";
        this.state.filters = { ...this.state.appliedFilters };
    }

    scheduleCatalogQueryPolling() {
        if (this.catalogQueryTimer) {
            clearTimeout(this.catalogQueryTimer);
        }
        if (!this.state.loading || !this.state.catalogQueryId) {
            return;
        }
        this.catalogQueryTimer = setTimeout(() => this.pollCatalogQuery(), 2500);
    }

    async pollCatalogQuery() {
        const queryId = this.state.catalogQueryId;
        if (!queryId) {
            return;
        }
        try {
            const query = await this.orm.silent.call(
                "lqa.mercadolibre.catalog.service",
                "get_products_query",
                [queryId]
            );
            if (queryId !== this.state.catalogQueryId) {
                return;
            }
            if (query.state === "done") {
                const response = query.result || {};
                this.state.products = response.products || [];
                this.state.pagination = response.pagination || {};
                this.state.sort = response.sort || {};
                this.state.appliedFilters = { ...(this.pendingFilters || this.state.filters) };
                this.state.loading = false;
                this.state.pageLoading = "";
                this.state.catalogError = "";
                if (this.advancedActiveCount) {
                    this.state.showAdvanced = true;
                }
            } else if (query.state === "failed") {
                this.state.loading = false;
                this.state.pageLoading = "";
                this.state.catalogError =
                    query.error || "Catalog Sync API no pudo completar la consulta.";
                if (this.state.products.length) {
                    this.notification.add(
                        `${this.state.catalogError} Se mantienen los resultados anteriores.`,
                        { type: "warning" }
                    );
                }
            }
        } catch (error) {
            if (queryId === this.state.catalogQueryId) {
                this.state.loading = false;
                this.state.pageLoading = "";
                this.state.catalogError =
                    error?.data?.message || "No se pudo consultar el progreso.";
            }
        } finally {
            this.scheduleCatalogQueryPolling();
        }
    }

    get currentPage() {
        const limit = Number(this.state.pagination.limit || this.state.appliedFilters.limit || 100);
        return Math.floor(Number(this.state.pagination.offset || 0) / limit) + 1;
    }

    get totalPages() {
        const limit = Number(this.state.pagination.limit || this.state.appliedFilters.limit || 100);
        return Math.max(Math.ceil(Number(this.state.pagination.total || 0) / limit), 1);
    }

    get hasPreviousPage() {
        return Number(this.state.pagination.offset || 0) > 0;
    }

    get hasNextPage() {
        return this.currentPage < this.totalPages;
    }

    async previousPage() {
        if (!this.hasPreviousPage || this.state.loading) {
            return;
        }
        const limit = Number(this.state.pagination.limit || this.state.appliedFilters.limit);
        this.state.filters = { ...this.state.appliedFilters };
        this.state.filters.offset = Math.max(Number(this.state.pagination.offset || 0) - limit, 0);
        this.state.pageLoading = "prev";
        await this.loadProducts();
    }

    async nextPage() {
        if (!this.hasNextPage || this.state.loading) {
            return;
        }
        const limit = Number(this.state.pagination.limit || this.state.appliedFilters.limit);
        this.state.filters = { ...this.state.appliedFilters };
        this.state.filters.offset = Number(this.state.pagination.offset || 0) + limit;
        this.state.pageLoading = "next";
        await this.loadProducts();
    }

    // ------------------------------------------------------------ exportar

    async loadActiveExport() {
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_active_catalog_export",
                []
            );
            this.state.exportJob = job || null;
            this.scheduleExportPoll();
        } catch {
            this.state.exportJob = null;
        }
    }

    get selectedExportColumns() {
        return CSV_COLUMNS.filter((c) => this.state.exportColumns[c.key]).map((c) => c.key);
    }

    get exportIsActive() {
        return ["queued", "running"].includes(this.state.exportJob?.state);
    }

    get exportTotal() {
        return Number(this.state.pagination?.total || 0);
    }

    get maxExportRows() {
        return MAX_EXPORT_ROWS;
    }

    // Antes de arrancar: si el filtro aplicado supera el tope, no tiene
    // sentido encolar algo que va a correr horas y terminar fallando.
    get exportBlocked() {
        return this.exportTotal > MAX_EXPORT_ROWS;
    }

    get exportEstimateLabel() {
        const total = this.exportTotal;
        if (!total) {
            return "";
        }
        return this.durationLabel(Math.ceil(total / 1000) * EXPORT_SECONDS_PER_PAGE);
    }

    get exportEstimateIsLong() {
        return Math.ceil(this.exportTotal / 1000) * EXPORT_SECONDS_PER_PAGE > 30 * 60;
    }

    get exportRowsPerPart() {
        const parts = Math.max(Number(this.state.exportPartCount || 1), 1);
        return Math.ceil(this.exportTotal / parts);
    }

    get exportSizeLabel() {
        const bytes = Number(this.state.exportJob?.sizeBytes || 0);
        if (!bytes) {
            return "";
        }
        const mb = bytes / (1024 * 1024);
        return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
    }

    // Velocidad real y tiempo restante a partir de lo procesado hasta ahora.
    get exportEta() {
        const job = this.state.exportJob;
        const started = parseServerDate(job?.startedAt);
        const processed = Number(job?.processed || 0);
        const total = Number(job?.matched || 0);
        if (!started || !processed || !total || processed >= total) {
            return null;
        }
        const elapsed = Math.max((this.state.now - started.getTime()) / 1000, 1);
        const perMinute = (processed / elapsed) * 60;
        const remaining = ((total - processed) / processed) * elapsed;
        return { perMinute: Math.round(perMinute), remaining: this.durationLabel(remaining) };
    }

    durationLabel(seconds) {
        if (seconds < 90) {
            return "menos de 2 minutos";
        }
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) {
            return `~${minutes} min`;
        }
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `~${hours} h ${rest} min` : `~${hours} h`;
    }

    openExportModal() {
        if (this.exportIsActive) {
            this.notification.add("Ya hay una exportación en curso: esperá a que termine o cancelala.", {
                type: "warning",
            });
            return;
        }
        this.state.showExportModal = true;
    }

    closeExportModal() {
        if (!this.state.startingExport) {
            this.state.showExportModal = false;
        }
    }

    toggleExportColumn(key) {
        this.state.exportColumns[key] = !this.state.exportColumns[key];
    }

    selectExportColumns(mode) {
        for (const column of CSV_COLUMNS) {
            this.state.exportColumns[column.key] =
                mode === "all" ? true : mode === "basic" && DEFAULT_EXPORT_COLUMNS.includes(column.key);
        }
    }

    async startExport() {
        if (!this.selectedExportColumns.length) {
            this.notification.add("Elegí al menos una columna.", { type: "warning" });
            return;
        }
        if (this.exportBlocked) {
            return;
        }
        this.state.startingExport = true;
        try {
            this.state.exportJob = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "start_catalog_export",
                [
                    { ...this.state.appliedFilters },
                    this.selectedExportColumns,
                    Number(this.state.exportPartCount || 1),
                ]
            );
            this.state.showExportModal = false;
            this.scheduleExportPoll();
            this.notification.add("Exportación iniciada. Podés seguir usando el panel.", {
                type: "success",
            });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo iniciar la exportación.", {
                type: "danger",
            });
        } finally {
            this.state.startingExport = false;
        }
    }

    scheduleExportPoll() {
        if (this.exportTimer) {
            clearTimeout(this.exportTimer);
        }
        if (!this.exportIsActive) {
            return;
        }
        this.exportTimer = setTimeout(() => this.refreshExport(), 4000);
    }

    async refreshExport() {
        const current = this.state.exportJob;
        if (!current?.id) {
            return;
        }
        try {
            const updated = await this.orm.silent.call(
                "lqa.mercadolibre.catalog.service",
                "get_catalog_export",
                [current.id]
            );
            this.state.exportJob = updated;
            if (updated.state === "done") {
                this.notification.add("El Excel está listo para descargar.", { type: "success" });
            } else if (updated.state === "failed") {
                this.notification.add(updated.error || "La exportación falló.", { type: "danger" });
            }
        } catch {
            // El proximo ciclo vuelve a consultar.
        }
        this.scheduleExportPoll();
    }

    async cancelExport() {
        const current = this.state.exportJob;
        if (!current?.id || this.state.cancellingExport) {
            return;
        }
        this.state.cancellingExport = true;
        try {
            this.state.exportJob = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "cancel_catalog_export",
                [current.id]
            );
            this.notification.add("Exportación cancelada.", { type: "info" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo cancelar.", { type: "danger" });
        } finally {
            this.state.cancellingExport = false;
        }
    }

    dismissExport() {
        this.state.exportJob = null;
    }

    // ------------------------------------------------------------ carpetas

    async loadFolders() {
        this.state.foldersLoading = true;
        try {
            this.state.folders = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_folders",
                []
            );
            if (!this.state.selectedFolderId && this.state.folders.length) {
                this.state.selectedFolderId = String(this.state.folders[0].id);
            }
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron cargar las carpetas.", {
                type: "danger",
            });
        } finally {
            this.state.foldersLoading = false;
        }
    }

    async loadActiveSelectionJob() {
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_active_selection_job",
                []
            );
            if (job) {
                this.state.selectionJob = job;
                this.state.selectedFolderId = String(job.folderId || "");
                this.updateSelectionFolderProgress(job);
                this.scheduleSelectionJobPolling();
            }
        } catch (error) {
            this.notification.add(
                error?.data?.message || "No se pudo recuperar el guardado en curso.",
                { type: "warning" }
            );
        }
    }

    async createFolder() {
        const name = String(this.state.newFolderName || "").trim();
        if (!name || this.state.creatingFolder) {
            return;
        }
        this.state.creatingFolder = true;
        try {
            const folder = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "create_selection_folder",
                [name]
            );
            this.state.newFolderName = "";
            this.state.selectedFolderId = String(folder.id);
            await this.loadFolders();
            this.notification.add(`Carpeta "${name}" creada.`, { type: "success" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo crear la carpeta.", {
                type: "danger",
            });
        } finally {
            this.state.creatingFolder = false;
        }
    }

    isFolderSelected(folder) {
        return String(folder.id) === String(this.state.selectedFolderId);
    }

    get selectedFolderName() {
        return this.selectedFolder?.name || "la carpeta";
    }

    selectFolder(folderId) {
        this.state.selectedFolderId = String(folderId || "");
    }

    openSelections() {
        this.action.doAction("lqa_admin_panel.action_lqa_mercadolibre_selections", {
            additionalContext: { lqa_selection_folder_id: this.state.selectedFolderId },
        });
    }

    async saveSelectionToFolder() {
        if (!this.selectedCount || !this.state.selectedFolderId || this.state.savingSelection) {
            return;
        }
        this.state.savingSelection = true;
        try {
            const result = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "save_products_to_folder",
                [Number(this.state.selectedFolderId), this.selectedProductsList]
            );
            await this.loadFolders();
            this.clearSelection();
            this.notification.add(
                `Guardado en "${this.selectedFolder?.name || "la carpeta"}": ${this.formatNumber(result.added)} nuevos y ${this.formatNumber(result.updated)} actualizados.`,
                { type: "success" }
            );
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo guardar la selección.", {
                type: "danger",
            });
        } finally {
            this.state.savingSelection = false;
        }
    }

    get filterExceedsFolderLimit() {
        return Number(this.state.pagination.total || 0) > MAX_FOLDER_PRODUCTS;
    }

    get maxFolderProducts() {
        return MAX_FOLDER_PRODUCTS;
    }

    openSaveFiltered() {
        if (!this.state.selectedFolderId || !this.state.pagination.total || this.filterExceedsFolderLimit) {
            return;
        }
        this.state.confirmSaveFiltered = true;
    }

    closeSaveFiltered() {
        if (!this.state.savingFilteredSelection) {
            this.state.confirmSaveFiltered = false;
        }
    }

    async saveFilteredSelectionToFolder() {
        if (this.state.savingFilteredSelection) {
            return;
        }
        this.state.savingFilteredSelection = true;
        try {
            const job = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "save_filtered_products_to_folder",
                [Number(this.state.selectedFolderId), { ...this.state.appliedFilters }]
            );
            this.state.selectionJob = job;
            this.state.confirmSaveFiltered = false;
            this.updateSelectionFolderProgress(job);
            this.notification.add("El guardado arrancó y sigue en segundo plano.", { type: "info" });
            this.scheduleSelectionJobPolling();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo guardar todo el filtro.", {
                type: "danger",
            });
        } finally {
            this.state.savingFilteredSelection = false;
        }
    }

    scheduleSelectionJobPolling() {
        if (this.selectionJobTimer) {
            clearTimeout(this.selectionJobTimer);
        }
        if (!this.isSelectionJobRunning) {
            return;
        }
        this.selectionJobTimer = setTimeout(() => this.pollSelectionJob(), 2500);
    }

    async pollSelectionJob() {
        const jobId = this.state.selectionJob?.id;
        if (!jobId) {
            return;
        }
        try {
            const job = await this.orm.silent.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_job",
                [jobId]
            );
            this.state.selectionJob = job;
            this.updateSelectionFolderProgress(job);
            if (job.state === "done") {
                await this.loadFolders();
                this.clearSelection();
                this.notification.add(
                    `Filtro guardado: ${this.formatNumber(job.added)} nuevos y ${this.formatNumber(job.updated)} actualizados.`,
                    { type: "success" }
                );
            } else if (job.state === "failed") {
                this.notification.add(job.error || "El guardado masivo falló.", { type: "danger" });
            }
        } catch (error) {
            this.notification.add(
                error?.data?.message || "No se pudo consultar el progreso del guardado.",
                { type: "danger" }
            );
        } finally {
            this.scheduleSelectionJobPolling();
        }
    }

    async retrySelectionJob() {
        const jobId = this.state.selectionJob?.id;
        if (!jobId || this.state.selectionJob?.state !== "failed" || this.state.retryingSelection) {
            return;
        }
        this.state.retryingSelection = true;
        try {
            this.state.selectionJob = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "retry_selection_job",
                [jobId]
            );
            this.updateSelectionFolderProgress(this.state.selectionJob);
            this.notification.add("Se retoma desde el último lote guardado.", { type: "info" });
            this.scheduleSelectionJobPolling();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo reintentar el guardado.", {
                type: "danger",
            });
        } finally {
            this.state.retryingSelection = false;
        }
    }

    dismissSelectionJob() {
        this.state.selectionJob = null;
    }

    updateSelectionFolderProgress(job) {
        const folderId = String(job?.folderId || "");
        const folderCount = Number(job?.folderCount);
        if (!folderId || !Number.isFinite(folderCount)) {
            return;
        }
        this.state.folders = this.state.folders.map((folder) =>
            String(folder.id) === folderId ? { ...folder, productCount: folderCount } : folder
        );
    }

    get selectedFolder() {
        return this.state.folders.find(
            (folder) => String(folder.id) === String(this.state.selectedFolderId)
        );
    }

    get isSelectionJobRunning() {
        return ["queued", "running"].includes(this.state.selectionJob?.state);
    }

    get selectionJobProgress() {
        const processed = Number(this.state.selectionJob?.processed || 0);
        const matched = Number(this.state.selectionJob?.matched || 0);
        if (!matched) {
            return 0;
        }
        return Math.min(Math.round((processed / matched) * 100), 100);
    }

    // ------------------------------------------------------------ seleccion

    get selectedCount() {
        return Object.keys(this.state.selectedIds).length;
    }

    get selectedProductsList() {
        return Object.values(this.state.selectedIds || {});
    }

    get selectedMlaIds() {
        return this.selectedProductsList
            .map((product) => product.item_id || product.itemId)
            .filter(Boolean);
    }

    get allPageSelected() {
        return (
            this.state.products.length > 0 &&
            this.state.products.every((product) => this.isSelected(this.productKey(product)))
        );
    }

    isSelected(itemId) {
        return Boolean(itemId && this.state.selectedIds[itemId]);
    }

    toggleProduct(product) {
        const itemId = this.productKey(product);
        if (!itemId) {
            return;
        }
        const selectedIds = { ...this.state.selectedIds };
        if (selectedIds[itemId]) {
            delete selectedIds[itemId];
        } else {
            selectedIds[itemId] = product;
        }
        this.state.selectedIds = selectedIds;
    }

    togglePage() {
        const selectedIds = { ...this.state.selectedIds };
        const select = !this.allPageSelected;
        for (const product of this.state.products) {
            const itemId = this.productKey(product);
            if (!itemId) {
                continue;
            }
            if (select) {
                selectedIds[itemId] = product;
            } else {
                delete selectedIds[itemId];
            }
        }
        this.state.selectedIds = selectedIds;
    }

    clearSelection() {
        this.state.selectedIds = {};
    }

    productKey(product) {
        return product?.item_id || product?.itemId || product?.sku || product?.permalink || "";
    }

    // ------------------------------------------------------------ eliminar

    openDeleteConfirmation() {
        if (!this.selectedMlaIds.length) {
            this.notification.add("La selección no tiene IDs MLA válidos.", { type: "warning" });
            return;
        }
        this.state.deleteReason = "";
        this.state.showDeleteConfirmation = true;
    }

    closeDeleteConfirmation() {
        if (!this.state.deleting) {
            this.state.showDeleteConfirmation = false;
        }
    }

    async confirmSelectedDeletion() {
        if (!this.state.deleteReason.trim() || this.state.deleting) {
            return;
        }
        this.state.deleting = true;
        try {
            const result = await this.orm.call(
                "lqa.mercadolibre.deletion.service",
                "delete_products",
                [this.selectedMlaIds, this.state.appKey, this.state.deleteReason.trim()]
            );
            this.notification.add(result.message, { type: result.ok ? "success" : "danger" });
            this.state.showDeleteConfirmation = false;
            if (result.deleted_count) {
                this.clearSelection();
                await this.loadProducts();
            }
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo ejecutar la eliminación.", {
                type: "danger",
            });
        } finally {
            this.state.deleting = false;
        }
    }

    // ------------------------------------------------------------ formato

    formatCurrency(value, currency = "ARS") {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "—";
        }
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: currency || "ARS",
            maximumFractionDigits: 0,
        }).format(numericValue);
    }

    formatCompactCurrency(value, currency = "ARS") {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "—";
        }
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: currency || "ARS",
            notation: "compact",
            maximumFractionDigits: 1,
        }).format(numericValue);
    }

    formatNumber(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "0";
        }
        return new Intl.NumberFormat("es-AR").format(numericValue);
    }

    formatPercent(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "0%";
        }
        return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(numericValue)}%`;
    }

    formatDate(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }).format(date);
    }

    statusLabel(status) {
        return (
            { active: "Activa", paused: "Pausada", closed: "Cerrada", under_review: "En revisión" }[
                status
            ] || status || "Sin estado"
        );
    }

    statusTone(status) {
        return { active: "is-active", paused: "is-paused", closed: "is-closed" }[status] || "is-other";
    }
}

registry
    .category("actions")
    .add("lqa_admin_panel.mercadolibre_catalog", LqaMercadolibreCatalog);
