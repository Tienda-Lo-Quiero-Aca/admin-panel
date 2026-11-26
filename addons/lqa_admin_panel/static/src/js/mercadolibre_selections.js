/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

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
const PRESETS = {
    basic: [
        "item_id", "title", "sku", "status", "listing_type_id",
        "price", "available_quantity", "category_id", "permalink",
    ],
    performance: [
        "item_id", "title", "sku", "brand", "status", "price", "available_quantity",
        "revenue", "orders_count", "units_sold", "total_visits", "order_conversion_rate",
    ],
};
const PAGE_SIZE = 50;

const STATUS_FILTERS = [
    { id: "", label: "Todas", key: "all" },
    { id: "active", label: "Activas", key: "active", tone: "ok" },
    { id: "paused", label: "Pausadas", key: "paused", tone: "warn" },
    { id: "closed", label: "Cerradas", key: "closed" },
    { id: "out_of_stock", label: "Sin stock", key: "out_of_stock", tone: "danger" },
    { id: "no_data", label: "Sin datos", key: "no_data" },
];

const SORTS = [
    { id: "recent", label: "Más recientes" },
    { id: "revenue", label: "Más facturación" },
    { id: "orders", label: "Más órdenes" },
    { id: "visits", label: "Más visitas" },
    { id: "price_desc", label: "Mayor precio" },
    { id: "price_asc", label: "Menor precio" },
    { id: "stock_asc", label: "Menos stock" },
    { id: "title", label: "Título (A-Z)" },
];

export class LqaMercadolibreSelections extends Component {
    static template = "lqa_admin_panel.MercadolibreSelections";

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({
            folders: [],
            loadingFolders: true,
            folderSearch: "",
            // El catalogo abre esta vista con la carpeta ya elegida.
            selectedFolderId: String(this.props.action?.context?.lqa_selection_folder_id || ""),
            // Productos de la carpeta
            products: [],
            pagination: {},
            summary: null,
            loadingProducts: false,
            search: "",
            status: "",
            sort: "recent",
            offset: 0,
            selectedIds: {},
            removing: false,
            confirmRemove: false,
            // Renombrar
            renaming: false,
            renameValue: "",
            savingName: false,
            // Exportar
            showExport: false,
            selectedColumns: Object.fromEntries(PRESETS.basic.map((key) => [key, true])),
            copyingMlas: false,
            // Eliminar carpeta
            deletingFolder: null,
            confirmingDelete: false,
            // Importar
            showImportModal: false,
            importFolderName: "",
            importFilename: "",
            importContent: "",
            importingFile: false,
            importJob: null,
            cancellingImport: false,
            retryingImport: false,
        });

        onWillStart(() => {
            this.lqaInitialLoad = (async () => {
                await Promise.all([this.loadFolders(), this.loadInitialImportJob()]);
            })();
        });

        onWillUnmount(() => {
            clearTimeout(this.importTimer);
            clearTimeout(this.searchTimer);
        });
    }

    // ------------------------------------------------------------ carpetas

    get filteredFolders() {
        const query = this.state.folderSearch.trim().toLowerCase();
        if (!query) {
            return this.state.folders;
        }
        return this.state.folders.filter((folder) =>
            `${folder.name} ${folder.creatorName || ""}`.toLowerCase().includes(query)
        );
    }

    get selectedFolder() {
        return this.state.folders.find((folder) => String(folder.id) === String(this.state.selectedFolderId));
    }

    isSelectedFolder(folder) {
        return String(folder.id) === String(this.state.selectedFolderId);
    }

    get totalFolderProducts() {
        return this.state.folders.reduce((total, folder) => total + Number(folder.productCount || 0), 0);
    }

    async loadFolders() {
        this.state.loadingFolders = true;
        try {
            this.state.folders = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_folders",
                []
            );
            if (this.state.selectedFolderId && !this.selectedFolder) {
                this.state.selectedFolderId = "";
            }
            if (!this.state.selectedFolderId && this.state.folders.length) {
                this.state.selectedFolderId = String(this.state.folders[0].id);
            }
            await this.loadProducts(true);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron cargar las carpetas.", { type: "danger" });
        } finally {
            this.state.loadingFolders = false;
        }
    }

    async selectFolder(folder) {
        if (this.isSelectedFolder(folder)) {
            return;
        }
        this.state.selectedFolderId = String(folder.id);
        this.state.search = "";
        this.state.status = "";
        this.state.sort = "recent";
        this.state.offset = 0;
        this.state.renaming = false;
        this.state.summary = null;
        this.clearSelection();
        await this.loadProducts(true);
    }

    // ------------------------------------------------------------ productos

    async loadProducts(withSummary = false) {
        if (!this.state.selectedFolderId) {
            this.state.products = [];
            this.state.pagination = {};
            this.state.summary = null;
            return;
        }
        const folderId = this.state.selectedFolderId;
        this.state.loadingProducts = true;
        try {
            const response = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_products",
                [
                    Number(folderId),
                    PAGE_SIZE,
                    this.state.offset,
                    this.state.search,
                    this.state.status,
                    this.state.sort,
                    withSummary,
                ]
            );
            if (folderId !== this.state.selectedFolderId) {
                return;
            }
            this.state.products = response.products || [];
            this.state.pagination = response.pagination || {};
            if (response.summary) {
                this.state.summary = response.summary;
            }
            if (response.folder) {
                this.updateFolder(response.folder);
            }
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron cargar las publicaciones.", { type: "danger" });
        } finally {
            this.state.loadingProducts = false;
        }
    }

    updateFolder(folder) {
        this.state.folders = this.state.folders.map((item) =>
            String(item.id) === String(folder.id) ? { ...item, ...folder } : item
        );
    }

    onSearchInput(event) {
        this.state.search = event.target.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.state.offset = 0;
            this.clearSelection();
            this.loadProducts();
        }, 350);
    }

    async setStatus(status) {
        this.state.status = status;
        this.state.offset = 0;
        this.clearSelection();
        await this.loadProducts();
    }

    async onSortChange(event) {
        this.state.sort = event.target.value;
        this.state.offset = 0;
        await this.loadProducts();
    }

    get statusFilters() {
        const counts = this.state.summary?.counts || {};
        return STATUS_FILTERS.map((filter) => ({ ...filter, count: counts[filter.key] })).filter(
            (filter) => !filter.id || filter.count
        );
    }

    get sortOptions() {
        return SORTS;
    }

    get currentPage() {
        return Math.floor(Number(this.state.pagination.offset || 0) / PAGE_SIZE) + 1;
    }

    get totalPages() {
        return Math.max(Math.ceil(Number(this.state.pagination.total || 0) / PAGE_SIZE), 1);
    }

    async previousPage() {
        if (this.state.pagination.has_previous) {
            this.state.offset = Math.max(this.state.offset - PAGE_SIZE, 0);
            await this.loadProducts();
        }
    }

    async nextPage() {
        if (this.state.pagination.has_next) {
            this.state.offset += PAGE_SIZE;
            await this.loadProducts();
        }
    }

    // ------------------------------------------------------------ seleccion y quitar

    get selectedCount() {
        return Object.keys(this.state.selectedIds).length;
    }

    isSelected(product) {
        return Boolean(this.state.selectedIds[product.id]);
    }

    toggleProduct(product) {
        const selected = { ...this.state.selectedIds };
        if (selected[product.id]) {
            delete selected[product.id];
        } else {
            selected[product.id] = true;
        }
        this.state.selectedIds = selected;
    }

    get allPageSelected() {
        return this.state.products.length > 0 && this.state.products.every((product) => this.isSelected(product));
    }

    togglePage() {
        const selected = { ...this.state.selectedIds };
        const select = !this.allPageSelected;
        for (const product of this.state.products) {
            if (select) {
                selected[product.id] = true;
            } else {
                delete selected[product.id];
            }
        }
        this.state.selectedIds = selected;
    }

    clearSelection() {
        this.state.selectedIds = {};
        this.state.confirmRemove = false;
    }

    async removeSelected() {
        if (!this.selectedCount || this.state.removing) {
            return;
        }
        if (!this.state.confirmRemove) {
            this.state.confirmRemove = true;
            return;
        }
        this.state.removing = true;
        try {
            const result = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "remove_selection_products",
                [Number(this.state.selectedFolderId), Object.keys(this.state.selectedIds).map(Number)]
            );
            this.updateFolder(result);
            this.notification.add(
                `${this.formatNumber(result.removed)} publicaciones quitadas de la carpeta.`,
                { type: "success" }
            );
            this.clearSelection();
            await this.loadProducts(true);
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron quitar.", { type: "danger" });
        } finally {
            this.state.removing = false;
        }
    }

    // ------------------------------------------------------------ renombrar

    startRename() {
        this.state.renameValue = this.selectedFolder?.name || "";
        this.state.renaming = true;
    }

    cancelRename() {
        this.state.renaming = false;
    }

    onRenameKeydown(event) {
        if (event.key === "Enter") {
            this.saveRename();
        } else if (event.key === "Escape") {
            this.cancelRename();
        }
    }

    async saveRename() {
        const name = this.state.renameValue.trim();
        if (!name || name === this.selectedFolder?.name) {
            this.cancelRename();
            return;
        }
        this.state.savingName = true;
        try {
            const folder = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "rename_selection_folder",
                [Number(this.state.selectedFolderId), name]
            );
            this.updateFolder(folder);
            this.state.renaming = false;
            this.notification.add("Carpeta renombrada.", { type: "success" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo renombrar.", { type: "danger" });
        } finally {
            this.state.savingName = false;
        }
    }

    // ------------------------------------------------------------ acciones de carpeta

    openPricing() {
        this.action.doAction("lqa_admin_panel.action_lqa_mercadolibre_pricing", {
            additionalContext: { lqa_pricing_folder_id: this.state.selectedFolderId },
        });
    }

    async copyMlas() {
        this.state.copyingMlas = true;
        try {
            const mlas = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_folder_mlas",
                [Number(this.state.selectedFolderId)]
            );
            await navigator.clipboard.writeText(mlas.join("\n"));
            this.notification.add(`${this.formatNumber(mlas.length)} MLAs copiados, uno por línea.`, { type: "success" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudieron copiar los MLAs.", { type: "danger" });
        } finally {
            this.state.copyingMlas = false;
        }
    }

    get columnGroups() {
        return COLUMN_GROUPS.map((group) => ({
            group,
            columns: CSV_COLUMNS.filter((column) => column.group === group),
        }));
    }

    get selectedColumnKeys() {
        return CSV_COLUMNS.filter((column) => this.state.selectedColumns[column.key]).map((column) => column.key);
    }

    toggleColumn(key) {
        this.state.selectedColumns = { ...this.state.selectedColumns, [key]: !this.state.selectedColumns[key] };
    }

    toggleGroup(group) {
        const columns = CSV_COLUMNS.filter((column) => column.group === group);
        const select = !columns.every((column) => this.state.selectedColumns[column.key]);
        const next = { ...this.state.selectedColumns };
        for (const column of columns) {
            next[column.key] = select;
        }
        this.state.selectedColumns = next;
    }

    isGroupSelected(group) {
        return CSV_COLUMNS.filter((column) => column.group === group).every(
            (column) => this.state.selectedColumns[column.key]
        );
    }

    applyPreset(preset) {
        this.state.selectedColumns = Object.fromEntries(
            CSV_COLUMNS.map((column) => [column.key, preset === "all" || Boolean(PRESETS[preset]?.includes(column.key))])
        );
    }

    get activePreset() {
        const selected = this.selectedColumnKeys;
        if (selected.length === CSV_COLUMNS.length) {
            return "all";
        }
        for (const [id, keys] of Object.entries(PRESETS)) {
            if (keys.length === selected.length && keys.every((key) => selected.includes(key))) {
                return id;
            }
        }
        return "";
    }

    openExport() {
        this.state.showExport = true;
    }

    closeExport() {
        this.state.showExport = false;
    }

    downloadCsv() {
        if (!this.selectedColumnKeys.length || !this.selectedFolder) {
            return;
        }
        const params = new URLSearchParams({ columns: this.selectedColumnKeys.join(",") });
        window.location.href = `/lqa_admin_panel/mercadolibre/selections/${encodeURIComponent(
            this.selectedFolder.id
        )}/csv?${params.toString()}`;
        this.state.showExport = false;
        this.notification.add(
            `Descargando ${this.formatNumber(this.selectedFolder.productCount)} publicaciones. El archivo se arma por lotes y puede tardar.`,
            { type: "info" }
        );
    }

    openDeleteFolder() {
        this.state.deletingFolder = this.selectedFolder;
    }

    closeDeleteFolder() {
        if (!this.state.confirmingDelete) {
            this.state.deletingFolder = null;
        }
    }

    async confirmDeleteFolder() {
        const folder = this.state.deletingFolder;
        if (!folder) {
            return;
        }
        this.state.confirmingDelete = true;
        try {
            await this.orm.call("lqa.mercadolibre.catalog.service", "delete_selection_folder", [folder.id]);
            this.state.deletingFolder = null;
            this.state.selectedFolderId = "";
            this.notification.add(`Carpeta "${folder.name}" eliminada.`, { type: "success" });
            await this.loadFolders();
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo eliminar la carpeta.", { type: "danger" });
        } finally {
            this.state.confirmingDelete = false;
        }
    }

    // ------------------------------------------------------------ importar

    async loadInitialImportJob() {
        try {
            this.state.importJob = (await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "get_latest_mla_file_job",
                []
            )) || null;
            this.scheduleImportPoll();
        } catch {
            this.state.importJob = null;
        }
    }

    openImportModal() {
        this.state.showImportModal = true;
    }

    closeImportModal() {
        if (!this.state.importingFile) {
            this.state.showImportModal = false;
        }
    }

    async onImportFileSelected(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) {
            return;
        }
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (!["csv", "xlsx"].includes(extension)) {
            this.notification.add("El archivo tiene que ser CSV o Excel (.xlsx).", { type: "warning" });
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            this.notification.add("El archivo puede pesar hasta 20 MB.", { type: "warning" });
            return;
        }
        this.state.importFilename = file.name;
        this.state.importContent = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        if (!this.state.importFolderName) {
            this.state.importFolderName = file.name.replace(/\.(csv|xlsx)$/i, "");
        }
    }

    clearImportFile() {
        this.state.importFilename = "";
        this.state.importContent = "";
    }

    async submitMlaImport() {
        if (!this.state.importFolderName.trim() || !this.state.importContent) {
            return;
        }
        this.state.importingFile = true;
        try {
            const result = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "import_mla_file_to_folder",
                [this.state.importFolderName, this.state.importFilename, this.state.importContent]
            );
            this.state.importJob = result.job;
            this.state.selectedFolderId = String(result.folder.id);
            this.state.showImportModal = false;
            this.state.importFolderName = "";
            this.clearImportFile();
            await this.loadFolders();
            this.scheduleImportPoll();
            this.notification.add(
                `Carpeta creada. Importando ${this.formatNumber(result.job.matched)} MLAs.`,
                { type: "success" }
            );
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo importar el archivo.", { type: "danger" });
        } finally {
            this.state.importingFile = false;
        }
    }

    get importIsActive() {
        return ["queued", "running"].includes(this.state.importJob?.state);
    }

    get importPhaseLabel() {
        return (
            {
                saving: "Guardando los MLAs en la carpeta",
                enriching: "Completando datos desde Catalog Sync",
                done: "Importación completa",
                failed: "La importación se detuvo",
                cancelled: "Importación cancelada",
            }[this.state.importJob?.phase] || "Procesando"
        );
    }

    get importProgress() {
        const job = this.state.importJob;
        const total = Number(job?.matched || 0);
        if (!total) {
            return 0;
        }
        const done = job?.phase === "saving" ? Number(job?.saved || 0) : Number(job?.processed || 0);
        return Math.min(Math.round((done / total) * 100), 100);
    }

    scheduleImportPoll() {
        clearTimeout(this.importTimer);
        if (this.importIsActive) {
            this.importTimer = setTimeout(() => this.refreshImportJob(), 3000);
        }
    }

    async refreshImportJob() {
        const job = this.state.importJob;
        if (!job?.id) {
            return;
        }
        try {
            const updated = await this.orm.silent.call(
                "lqa.mercadolibre.catalog.service",
                "get_selection_job",
                [job.id]
            );
            this.state.importJob = updated;
            this.state.folders = this.state.folders.map((folder) =>
                String(folder.id) === String(updated.folderId)
                    ? { ...folder, productCount: Number(updated.folderCount || 0) }
                    : folder
            );
            if (["done", "failed", "cancelled"].includes(updated.state)) {
                if (updated.state === "done") {
                    this.notification.add(`"${updated.folderName}" terminó de importar.`, { type: "success" });
                }
                if (String(updated.folderId) === String(this.state.selectedFolderId)) {
                    await this.loadProducts(true);
                }
            } else if (String(updated.folderId) === String(this.state.selectedFolderId) && !this.state.loadingProducts) {
                await this.loadProducts(true);
            }
        } catch {
            // El proximo ciclo vuelve a consultar.
        }
        this.scheduleImportPoll();
    }

    async cancelImport() {
        const job = this.state.importJob;
        if (!job?.id || this.state.cancellingImport) {
            return;
        }
        this.state.cancellingImport = true;
        try {
            this.state.importJob = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "cancel_selection_job",
                [job.id]
            );
            await this.loadFolders();
            this.notification.add("Importación cancelada. Los MLAs ya guardados quedan en la carpeta.", { type: "info" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo cancelar.", { type: "danger" });
        } finally {
            this.state.cancellingImport = false;
        }
    }

    async retryImport() {
        const job = this.state.importJob;
        if (!job?.id || this.state.retryingImport) {
            return;
        }
        this.state.retryingImport = true;
        try {
            this.state.importJob = await this.orm.call(
                "lqa.mercadolibre.catalog.service",
                "retry_selection_job",
                [job.id]
            );
            this.scheduleImportPoll();
            this.notification.add("Retomando la importación.", { type: "info" });
        } catch (error) {
            this.notification.add(error?.data?.message || "No se pudo retomar.", { type: "danger" });
        } finally {
            this.state.retryingImport = false;
        }
    }

    dismissImportJob() {
        this.state.importJob = null;
    }

    // ------------------------------------------------------------ formato

    noop() {}

    formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat("es-AR").format(number) : "0";
    }

    formatCurrency(value, currency = "ARS") {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return "—";
        }
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: currency || "ARS",
            maximumFractionDigits: 0,
        }).format(number);
    }

    formatCompact(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return "—";
        }
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: "ARS",
            notation: "compact",
            maximumFractionDigits: 1,
        }).format(number);
    }

    formatPercent(value) {
        const number = Number(value);
        return Number.isFinite(number)
            ? `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(number)}%`
            : "—";
    }

    relativeDate(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(`${String(value).replace(" ", "T")}Z`);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        const days = Math.floor((Date.now() - date.getTime()) / 86400000);
        if (days <= 0) {
            return "hoy";
        }
        if (days === 1) {
            return "ayer";
        }
        if (days < 30) {
            return `hace ${days} días`;
        }
        return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
    }

    statusLabel(status) {
        return (
            { active: "Activa", paused: "Pausada", closed: "Cerrada", under_review: "En revisión", not_found: "No encontrada" }[status] ||
            status ||
            "Sin datos"
        );
    }

    statusTone(status) {
        return { active: "is-active", paused: "is-paused", closed: "is-closed" }[status] || "is-other";
    }

    hasData(product) {
        return Boolean(product.title);
    }
}

registry.category("actions").add("lqa_admin_panel.mercadolibre_selections", LqaMercadolibreSelections);
