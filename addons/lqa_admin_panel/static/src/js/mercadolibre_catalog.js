/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

// Filtros de un valor, con su rotulo para las etiquetas de filtros aplicados.
const SIMPLE_FILTERS = {
    search: "Búsqueda",
    status: "Estado",
    brand: "Marca",
    categoryId: "Categoría",
    domainId: "Dominio",
    sku: "SKU",
    skuPrefix: "SKU empieza con",
    condition: "Condición",
    listingTypeId: "Tipo",
    currencyId: "Moneda",
    hasOrders: "Con órdenes",
    hasVisits: "Con visitas",
};

// Rangos (minimo y maximo) que acepta Catalog Sync.
const RANGE_FILTERS = [
    { id: "price", label: "Precio", min: "minPrice", max: "maxPrice", kind: "money" },
    { id: "stock", label: "Stock disponible", min: "minAvailableQuantity", max: "maxAvailableQuantity", kind: "number" },
    { id: "revenue", label: "Facturación", min: "minRevenue", max: "maxRevenue", kind: "money" },
    { id: "orders", label: "Órdenes", min: "minOrders", max: "maxOrders", kind: "number" },
    { id: "units", label: "Unidades vendidas", min: "minUnitsSold", max: "maxUnitsSold", kind: "number" },
    { id: "visits", label: "Visitas", min: "minVisits", max: "maxVisits", kind: "number" },
    { id: "conversion", label: "Conversión (%)", min: "minOrderConversionRate", max: "maxOrderConversionRate", kind: "percent" },
    { id: "ticket", label: "Ticket promedio", min: "minAvgTicket", max: "maxAvgTicket", kind: "money" },
    { id: "catalogSold", label: "Ventas de catálogo", min: "minCatalogSoldQuantity", max: "maxCatalogSoldQuantity", kind: "number" },
    { id: "daysToFirst", label: "Días hasta la 1ª venta", min: "minDaysToFirstOrder", max: "maxDaysToFirstOrder", kind: "number" },
];

const DATE_FILTERS = [
    { id: "created", label: "Publicada", min: "createdFrom", max: "createdTo", kind: "date" },
    { id: "firstOrder", label: "Primera venta", min: "firstOrderFrom", max: "firstOrderTo", kind: "date" },
    { id: "lastOrder", label: "Última venta", min: "lastOrderFrom", max: "lastOrderTo", kind: "date" },
];

const RANGES = [...RANGE_FILTERS, ...DATE_FILTERS];

const FILTER_KEYS = [
    ...Object.keys(SIMPLE_FILTERS),
    ...RANGES.flatMap((range) => [range.min, range.max]),
];

// Filtros que viven en "Más filtros"; si alguno esta aplicado, el panel abre.
const ADVANCED_KEYS = FILTER_KEYS.filter((key) => key !== "search" && key !== "status");

const VALUE_LABELS = {
    status: { active: "Activa", paused: "Pausada", closed: "Cerrada", under_review: "En revisión" },
    condition: { new: "Nuevo", used: "Usado", refurbished: "Reacondicionado" },
    listingTypeId: { gold_special: "Clásica", gold_pro: "Premium", free: "Gratuita" },
    hasOrders: { true: "Sí", false: "No" },
    hasVisits: { true: "Sí", false: "No" },
};

const defaultFilters = () => ({
    ...Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])),
    sortBy: "revenue",
    sortOrder: "desc",
    limit: "100",
    offset: 0,
});

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
// Se piden 4 paginas a la vez: ~10 s por cada 1.000 productos.
const EXPORT_SECONDS_PER_PAGE = 10;
const EXPORT_DISMISSED_KEY = "lqa_meli_export_dismissed";
const VIEW_KEY = "lqa_meli_catalog_view";

const CSV_COLUMNS = [
    { key: "item_id", label: "MLA", group: "Publicación" },
    { key: "title", label: "Título", group: "Publicación" },
    { key: "sku", label: "SKU", group: "Publicación" },
    { key: "brand", label: "Marca", group: "Publicación" },
    { key: "status", label: "Estado", group: "Publicación" },
    { key: "condition", label: "Condición", group: "Publicación" },
    { key: "listing_type_id", label: "Tipo de publicación", group: "Publicación" },
    { key: "category_id", label: "Categoría", group: "Publicación" },
    { key: "domain_id", label: "Dominio", group: "Publicación" },
    { key: "permalink", label: "Link", group: "Publicación" },
    { key: "price", label: "Precio", group: "Precio y stock" },
    { key: "currency_id", label: "Moneda", group: "Precio y stock" },
    { key: "available_quantity", label: "Stock", group: "Precio y stock" },
    { key: "revenue", label: "Facturación", group: "Rendimiento" },
    { key: "orders_count", label: "Órdenes", group: "Rendimiento" },
    { key: "units_sold", label: "Unidades vendidas", group: "Rendimiento" },
    { key: "total_visits", label: "Visitas", group: "Rendimiento" },
    { key: "order_conversion_rate", label: "Conversión de órdenes", group: "Rendimiento" },
    { key: "unit_conversion_rate", label: "Conversión de unidades", group: "Rendimiento" },
    { key: "avg_ticket", label: "Ticket promedio", group: "Rendimiento" },
    { key: "catalog_sold_quantity", label: "Ventas de catálogo", group: "Rendimiento" },
    { key: "date_created", label: "Fecha de creación", group: "Fechas" },
    { key: "last_updated", label: "Última actualización", group: "Fechas" },
    { key: "first_order_date", label: "Primera orden", group: "Fechas" },
    { key: "last_order_date", label: "Última orden", group: "Fechas" },
];

const COLUMN_GROUPS = ["Publicación", "Precio y stock", "Rendimiento", "Fechas"];

const EXPORT_PRESETS = {
    basic: [
        "item_id", "title", "sku", "status", "listing_type_id",
        "price", "available_quantity", "category_id", "permalink",
    ],
    performance: [
        "item_id", "title", "sku", "brand", "status", "price", "available_quantity",
        "revenue", "orders_count", "units_sold", "total_visits", "order_conversion_rate",
        "avg_ticket", "last_order_date",
    ],
};

const EXPORT_PRESET_OPTIONS = [
    { id: "basic", label: "Básicas" },
    { id: "performance", label: "Rendimiento" },
    { id: "all", label: "Todas" },
];

const DEFAULT_EXPORT_COLUMNS = EXPORT_PRESETS.basic;

function readStorage(key) {
    try {
        return window.localStorage.getItem(key) || "";
    } catch {
        return "";
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Solo es una preferencia.
    }
}

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
            // Detalle desplegable: fila abierta en la tabla o panel en tarjetas.
            detailKey: "",
            detailProduct: null,
            showExportHistory: false,
            exportHistory: [],
            exportHistoryLoading: false,
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
        // Mientras busca, lo escrito ya esta en camino: no es "sin aplicar".
        if (this.state.loading) {
            return false;
        }
        return FILTER_KEYS.some(
            (key) => String(this.state.filters[key] ?? "") !== String(this.state.appliedFilters[key] ?? "")
        );
    }

    get advancedActiveCount() {
        return this.chipsFor(this.state.appliedFilters).filter(
            (chip) => chip.keys.some((key) => ADVANCED_KEYS.includes(key))
        ).length;
    }

    get activeChips() {
        return this.chipsFor(this.state.appliedFilters);
    }

    get rangeFilters() {
        return RANGE_FILTERS;
    }

    get dateFilters() {
        return DATE_FILTERS;
    }

    // Etiquetas legibles de un juego de filtros: sirve para los filtros
    // aplicados y para mostrar con que filtro se hizo cada exportacion.
    chipsFor(filters) {
        filters = filters || {};
        const chips = [];
        for (const [key, label] of Object.entries(SIMPLE_FILTERS)) {
            if (this.filterIsSet(filters, key)) {
                chips.push({ id: key, keys: [key], label, value: this.simpleValue(key, filters[key]) });
            }
        }
        for (const range of RANGES) {
            const hasMin = this.filterIsSet(filters, range.min);
            const hasMax = this.filterIsSet(filters, range.max);
            if (!hasMin && !hasMax) {
                continue;
            }
            const min = hasMin ? this.rangeValue(range.kind, filters[range.min]) : "";
            const max = hasMax ? this.rangeValue(range.kind, filters[range.max]) : "";
            let value;
            if (hasMin && hasMax) {
                value = `${min} – ${max}`;
            } else if (range.kind === "date") {
                value = hasMin ? `desde ${min}` : `hasta ${max}`;
            } else {
                value = hasMin ? `≥ ${min}` : `≤ ${max}`;
            }
            chips.push({ id: range.id, keys: [range.min, range.max], label: range.label, value });
        }
        return chips;
    }

    simpleValue(key, value) {
        const labels = VALUE_LABELS[key];
        if (!labels) {
            return String(value);
        }
        return String(value)
            .split(",")
            .map((part) => labels[part.trim()] || part.trim())
            .join(", ");
    }

    rangeValue(kind, value) {
        if (kind === "money") {
            return this.formatCurrency(value);
        }
        if (kind === "percent") {
            return this.formatPercent(value);
        }
        if (kind === "date") {
            return this.formatDate(value);
        }
        return this.formatNumber(value);
    }

    async removeChip(chip) {
        const defaults = defaultFilters();
        for (const key of chip.keys) {
            this.state.filters[key] = defaults[key];
        }
        await this.applyFilters();
    }

    async clearAdvanced() {
        const defaults = defaultFilters();
        for (const key of ADVANCED_KEYS) {
            this.state.filters[key] = defaults[key];
        }
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
        this.state.detailKey = "";
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
            // Una exportacion terminada que el usuario ya cerro no vuelve a
            // aparecer como tarjeta (queda en "Mis exportaciones").
            const dismissed = readStorage(EXPORT_DISMISSED_KEY);
            const active = ["queued", "running"].includes(job?.state);
            this.state.exportJob = job && (active || String(job.id) !== dismissed) ? job : null;
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

    get exportColumnGroups() {
        return COLUMN_GROUPS.map((group) => ({
            group,
            columns: CSV_COLUMNS.filter((column) => column.group === group),
        }));
    }

    get exportPresetOptions() {
        return EXPORT_PRESET_OPTIONS;
    }

    get exportPreset() {
        const selected = this.selectedExportColumns;
        if (selected.length === CSV_COLUMNS.length) {
            return "all";
        }
        for (const [id, keys] of Object.entries(EXPORT_PRESETS)) {
            if (keys.length === selected.length && keys.every((key) => selected.includes(key))) {
                return id;
            }
        }
        return "custom";
    }

    selectExportColumns(mode) {
        for (const column of CSV_COLUMNS) {
            this.state.exportColumns[column.key] =
                mode === "all" || Boolean(EXPORT_PRESETS[mode]?.includes(column.key));
        }
    }

    toggleExportGroup(group) {
        const columns = CSV_COLUMNS.filter((column) => column.group === group);
        const select = !columns.every((column) => this.state.exportColumns[column.key]);
        for (const column of columns) {
            this.state.exportColumns[column.key] = select;
        }
    }

    isGroupSelected(group) {
        return CSV_COLUMNS.filter((column) => column.group === group).every(
            (column) => this.state.exportColumns[column.key]
        );
    }

    setExportParts(count) {
        this.state.exportPartCount = String(count);
    }

    get exportPartOptions() {
        return [1, 2, 3, 5, 10];
    }

    get exportJobChips() {
        return this.chipsFor(this.state.exportJob?.filters);
    }

    // En que esta la exportacion, en palabras.
    get exportStage() {
        const job = this.state.exportJob;
        if (!job) {
            return "";
        }
        if (job.state === "queued" && !job.processed) {
            return "En cola, arranca en segundos…";
        }
        if (!job.matched) {
            return "Contando los productos del filtro…";
        }
        if (job.processed >= job.matched) {
            return "Armando el Excel…";
        }
        return `Bajando productos: ${this.formatNumber(job.processed)} de ${this.formatNumber(job.matched)}`;
    }

    async openExportHistory() {
        this.state.showExportHistory = true;
        await this.loadExportHistory();
    }

    closeExportHistory() {
        this.state.showExportHistory = false;
    }

    async loadExportHistory() {
        this.state.exportHistoryLoading = true;
        try {
            this.state.exportHistory = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_recent_catalog_exports",
                [10]
            );
        } catch (error) {
            this.notification.add(
                error?.data?.message || "No se pudieron cargar las exportaciones.",
                { type: "danger" }
            );
        } finally {
            this.state.exportHistoryLoading = false;
        }
    }

    exportStateLabel(job) {
        return (
            {
                queued: "En cola",
                running: "Exportando",
                done: job?.expired ? "Vencida" : "Lista",
                failed: "Falló",
                cancelled: "Cancelada",
            }[job?.state] || job?.state
        );
    }

    exportStateTone(job) {
        if (job?.state === "done") {
            return job.expired ? "is-closed" : "is-active";
        }
        if (job?.state === "failed") {
            return "is-failed";
        }
        if (job?.state === "cancelled") {
            return "is-closed";
        }
        return "is-other";
    }

    formatDateTime(value) {
        const date = parseServerDate(value);
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

    expiresLabel(job) {
        const date = parseServerDate(job?.expiresAt);
        if (!date) {
            return "";
        }
        const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
        if (days <= 0) {
            return "vence hoy";
        }
        return days === 1 ? "vence mañana" : `vence en ${days} días`;
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
        if (this.state.exportJob?.id) {
            writeStorage(EXPORT_DISMISSED_KEY, String(this.state.exportJob.id));
        }
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
        if (!this.state.pagination.total || this.filterExceedsFolderLimit) {
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
        if (this.state.savingFilteredSelection || !this.state.selectedFolderId) {
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

    // ------------------------------------------------------------ detalle

    isDetailOpen(product) {
        return this.state.detailKey === this.productKey(product);
    }

    toggleDetail(product) {
        const key = this.productKey(product);
        this.state.detailKey = this.state.detailKey === key ? "" : key;
    }

    openDetailPanel(product) {
        this.state.detailProduct = product;
    }

    closeDetailPanel() {
        this.state.detailProduct = null;
    }

    async copyText(value, label) {
        if (!value) {
            return;
        }
        try {
            await navigator.clipboard.writeText(String(value));
            this.notification.add(`${label} copiado: ${value}`, { type: "success" });
        } catch {
            this.notification.add("No se pudo copiar al portapapeles.", { type: "warning" });
        }
    }

    // Todo lo que trae Catalog Sync de una publicacion, agrupado y legible.
    productDetails(product) {
        const money = (value) =>
            value === null || value === undefined || value === "" ? "—" : this.formatCurrency(value, product.currency_id);
        const number = (value) => (value === null || value === undefined || value === "" ? "—" : this.formatNumber(value));
        const dateTime = (value) => this.formatDateTimeLong(value);
        const listing = VALUE_LABELS.listingTypeId[product.listing_type_id] || product.listing_type_id || "—";
        const condition = VALUE_LABELS.condition[product.condition] || product.condition || "—";
        return [
            {
                title: "Publicación",
                icon: "fa-tag",
                rows: [
                    { label: "MLA", value: product.item_id || "—", copy: product.item_id, mono: true },
                    { label: "SKU", value: product.sku || "—", copy: product.sku, mono: true },
                    { label: "Marca", value: product.brand || "—" },
                    { label: "Categoría", value: product.category_id || "—", copy: product.category_id, mono: true },
                    { label: "Dominio", value: product.domain_id || "—", mono: true },
                    { label: "Tipo", value: listing },
                    { label: "Condición", value: condition },
                    { label: "Vendedor", value: product.seller_id || "—", mono: true },
                ],
            },
            {
                title: "Precio y stock",
                icon: "fa-usd",
                rows: [
                    { label: "Precio", value: money(product.price), strong: true },
                    { label: "Precio promedio vendido", value: money(product.avg_unit_price) },
                    { label: "Moneda", value: product.currency_id || "—" },
                    { label: "Stock", value: number(product.stock), danger: this.isOut(product) },
                    { label: "Disponible", value: number(product.available_quantity), danger: this.isOut(product) },
                    { label: "Ventas de catálogo", value: number(product.catalog_sold_quantity) },
                ],
            },
            {
                title: "Rendimiento",
                icon: "fa-line-chart",
                rows: [
                    { label: "Facturación", value: money(product.revenue), strong: true },
                    { label: "Órdenes", value: number(product.orders_count) },
                    { label: "Unidades vendidas", value: number(product.units_sold) },
                    { label: "Ticket promedio", value: money(product.avg_ticket) },
                    { label: "Visitas", value: number(product.total_visits) },
                    { label: "Conversión de órdenes", value: this.formatPercent(product.order_conversion_rate) },
                    { label: "Conversión de unidades", value: this.formatPercent(product.unit_conversion_rate) },
                ],
            },
            {
                title: "Fechas",
                icon: "fa-calendar",
                rows: [
                    { label: "Publicada", value: dateTime(product.date_created) },
                    { label: "Última actualización", value: dateTime(product.last_updated) },
                    { label: "Primera venta", value: dateTime(product.first_order_date) },
                    { label: "Última venta", value: dateTime(product.last_order_date) },
                    {
                        label: "Días hasta la 1ª venta",
                        value: product.days_to_first_order === null || product.days_to_first_order === undefined
                            ? "Sin ventas"
                            : `${this.formatNumber(product.days_to_first_order)} días`,
                    },
                    { label: "Visitas medidas", value: dateTime(product.visits_captured_at) },
                    { label: "Sincronizado", value: dateTime(product.last_synced_at) },
                ],
            },
        ];
    }

    formatDateTimeLong(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
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
