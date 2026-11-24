/** @odoo-module **/

// Links a los logs de products-api en Datadog.
//
// Reproduce la busqueda que usa el equipo: el log "Publication job finished"
// que el worker escribe al terminar cada SKU, con columnas service, @reason y
// @sku. Solo cambian el runId y el rango de fechas.

const DATADOG_LOGS_URL = "https://us5.datadoghq.com/logs";
const SERVICE = "products-api";
const FINISHED_MESSAGE = '"Publication job finished"';

// Un run de 1000 SKU tarda al menos media hora (Fravega: 30 por minuto) y en
// la practica bastante mas: 24 h cubre cualquier run sin pedir rango a mano.
const RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
const BEFORE_RUN_MS = 10 * 60 * 1000;

// Odoo guarda UTC sin zona ("2026-11-24 14:05:00"); madre manda ISO con Z.
export function parseRunDate(value) {
    if (!value) {
        return null;
    }
    const text = String(value);
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
        ? `${text.replace(" ", "T")}Z`
        : text;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

function buildUrl(query, fromMs, toMs) {
    const params = {
        query,
        agg_m: "count",
        agg_m_source: "base",
        agg_t: "count",
        cols: "service,@reason,@sku",
        fromUser: "true",
        messageDisplay: "inline",
        refresh_mode: "paused",
        storage: "hot",
        stream_sort: "time,desc",
        viz: "stream",
        from_ts: String(Math.round(fromMs)),
        to_ts: String(Math.round(toMs)),
        live: "false",
    };
    // encodeURIComponent (espacios como %20), igual que los links que arma
    // Datadog; URLSearchParams los pondria como "+".
    const qs = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");
    return `${DATADOG_LOGS_URL}?${qs}`;
}

/**
 * Logs de un run.
 * @param {string|number} runId
 * @param {string|Date|null} startedAt  cuando se lanzo (si se sabe)
 * @param {{onlyProblems?: boolean}} options  solo warn/error (omitidos y fallidos)
 */
export function datadogRunLogsUrl(runId, startedAt = null, { onlyProblems = false } = {}) {
    const levels = onlyProblems ? "(warn OR error)" : "(info OR warn OR error)";
    const query = `service:${SERVICE} ${FINISHED_MESSAGE} @runId:${runId} status:${levels}`;
    const now = Date.now();
    const start = startedAt instanceof Date ? startedAt : parseRunDate(startedAt);
    if (!start) {
        // Sin fecha: la ultima semana, que es mas de lo que guarda "hot".
        return buildUrl(query, now - 7 * RUN_WINDOW_MS, now);
    }
    const from = start.getTime() - BEFORE_RUN_MS;
    const to = Math.min(start.getTime() + RUN_WINDOW_MS, now);
    return buildUrl(query, from, Math.max(to, from + BEFORE_RUN_MS));
}

/** Todos los logs del publicador de las ultimas `hours` horas. */
export function datadogPublisherLogsUrl(hours = 24, { onlyProblems = false } = {}) {
    const levels = onlyProblems ? "(warn OR error)" : "(info OR warn OR error)";
    const query = `service:${SERVICE} ${FINISHED_MESSAGE} status:${levels}`;
    const now = Date.now();
    return buildUrl(query, now - hours * 60 * 60 * 1000, now);
}
