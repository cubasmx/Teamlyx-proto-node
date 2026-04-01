// =====================================================
// TEAMLYX — app.js  v3.0
// =====================================================

// ── Estado global ──────────────────────────────────
let eventosActuales  = [];
let paginaActual     = 1;
let eventosPorPagina = 50;
let columnaOrden     = 'fecha';
let ordenAsc         = false;
let vistaActual      = 'eventos';
const filtrosActivos = { [EVENTO_ENTRADA]: true, [EVENTO_SALIDA]: true };
const checkboxFiltros = {
    ocultarSinNombre : true,
    ocultarSinId     : true,
};
let pollingInterval  = null;

// ── Boot ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initFechas();
    initPresets();
    initTabs();
    initSortHeaders();
    initEventListeners();
    iniciarPollingEstado();
});

// ══════════════════════════════════════════════════
// POLLING DEL CACHÉ
// ══════════════════════════════════════════════════
function iniciarPollingEstado() {
    actualizarEstadoCache();
    pollingInterval = setInterval(actualizarEstadoCache, 3000);
}

async function actualizarEstadoCache() {
    try {
        const estado = await fetch('/api/estado').then(r => r.json());
        const banner = document.getElementById('cacheBanner');
        const btn    = document.getElementById('btnCargar');
        const dot    = document.getElementById('statusDot');
        const txt    = document.getElementById('statusText');

        if (estado.listo) {
            if (banner) banner.style.display = 'none';
            btn.disabled = false;
            dot.className = 'status-dot';
            txt.textContent = `Listo · ${estado.total.toLocaleString()} eventos`;
            clearInterval(pollingInterval); pollingInterval = null;
        } else {
            if (banner) {
                banner.style.display = 'flex';
                const sp = banner.querySelector('.cache-count');
                if (sp) sp.textContent = estado.total > 0 ? `(${estado.total} descargados…)` : '';
            }
            btn.disabled = true;
            dot.className = 'status-dot loading';
            txt.textContent = 'Descargando historial…';
        }
    } catch { /* servidor no disponible */ }
}

// ══════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════
function initFechas() {
    const hoy  = new Date();
    const prim = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    document.getElementById('txtDesde').value = formatDateInput(prim);
    document.getElementById('txtHasta').value = formatDateInput(hoy);
}

function initPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const { desde, hasta } = calcularPreset(btn.dataset.preset);
            document.getElementById('txtDesde').value = desde;
            document.getElementById('txtHasta').value = hasta;
        });
    });
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            vistaActual = btn.dataset.view;
            document.querySelectorAll('.view-panel').forEach(p => p.style.display = 'none');
            document.getElementById('view-' + vistaActual).style.display = '';
            actualizarTituloVista();
            if (eventosActuales.length > 0) renderVista();
        });
    });
}

function initSortHeaders() {
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (columnaOrden === col) { ordenAsc = !ordenAsc; }
            else { columnaOrden = col; ordenAsc = col !== 'fecha'; }
            document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(ordenAsc ? 'sort-asc' : 'sort-desc');
            const sel = document.getElementById('selOrden');
            sel.value = `${col}-${ordenAsc ? 'asc' : 'desc'}`;
            paginaActual = 1;
            if (eventosActuales.length > 0) aplicarFiltrosLocales();
        });
    });
}

function initEventListeners() {
    // Botón cargar
    document.getElementById('btnCargar').addEventListener('click', cargarAsistencia);

    // Exportar CSV
    document.getElementById('btnExportar').addEventListener('click', exportarCSV);

    // Checkboxes de tipo (Entradas / Salidas)
    document.getElementById('chkEntradas').addEventListener('change', e => {
        filtrosActivos[EVENTO_ENTRADA] = e.target.checked;
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });
    document.getElementById('chkSalidas').addEventListener('change', e => {
        filtrosActivos[EVENTO_SALIDA] = e.target.checked;
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });

    // Checkboxes de calidad de datos
    document.getElementById('chkOcultarSinNombre').addEventListener('change', e => {
        checkboxFiltros.ocultarSinNombre = e.target.checked;
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });
    document.getElementById('chkOcultarSinId').addEventListener('change', e => {
        checkboxFiltros.ocultarSinId = e.target.checked;
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });

    // Búsqueda en tiempo real
    const txtEmp = document.getElementById('txtEmpleado');
    txtEmp.addEventListener('input', () => {
        const btn = document.getElementById('btnClearSearch');
        btn.classList.toggle('visible', txtEmp.value.length > 0);
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });
    txtEmp.addEventListener('keydown', e => { if (e.key === 'Enter') cargarAsistencia(); });
    document.getElementById('btnClearSearch').addEventListener('click', () => {
        txtEmp.value = '';
        document.getElementById('btnClearSearch').classList.remove('visible');
        paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });

    // Filtro hora range
    ['txtHoraDesde', 'txtHoraHasta'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            paginaActual = 1; if (eventosActuales.length > 0) aplicarFiltrosLocales();
        });
    });

    // Ordenar selector
    document.getElementById('selOrden').addEventListener('change', e => {
        const [col, dir] = e.target.value.split('-');
        columnaOrden = col; ordenAsc = dir === 'asc'; paginaActual = 1;
        if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });

    // Por página
    document.getElementById('selPorPagina').addEventListener('change', e => {
        eventosPorPagina = parseInt(e.target.value) || 0; paginaActual = 1;
        if (eventosActuales.length > 0) aplicarFiltrosLocales();
    });

    // Paginación
    document.getElementById('btnPrevPage').addEventListener('click', () => {
        if (paginaActual > 1) { paginaActual--; renderVista(); }
    });
    document.getElementById('btnNextPage').addEventListener('click', () => {
        const total = obtenerEventosFiltrados().length;
        const pages = eventosPorPagina ? Math.ceil(total / eventosPorPagina) : 1;
        if (paginaActual < pages) { paginaActual++; renderVista(); }
    });
}

// ══════════════════════════════════════════════════
// CARGA PRINCIPAL
// ══════════════════════════════════════════════════
async function cargarAsistencia() {
    const startDate = document.getElementById('txtDesde').value;
    const endDate   = document.getElementById('txtHasta').value;
    const btn       = document.getElementById('btnCargar');

    if (!startDate || !endDate) { mostrarError('Selecciona un rango de fechas válido.'); return; }
    if (new Date(startDate) > new Date(endDate)) { mostrarError('La fecha inicio es mayor que la fecha fin.'); return; }

    setLoading(true);
    btn.classList.add('loading');
    btn.querySelector('.btn-icon').textContent = '⏳';
    resetStats();

    try {
        const resp = await fetch(`/api/asistencia?${new URLSearchParams({ startDate, endDate })}`);
        const data = await resp.json();

        if (resp.status === 202 || data.cargando) { mostrarCargando(data.total || 0); return; }
        if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);

        eventosActuales = data.eventos || [];
        paginaActual    = 1;

        // Sync timestamp en banner
        if (data.ultimaSync) {
            const sp = document.querySelector('.cache-sync');
            if (sp) { const h = parsearFechaHora(data.ultimaSync); sp.textContent = `Sync: ${h.hora}`; }
        }

        aplicarFiltrosLocales();

    } catch (err) {
        console.error('[Teamlyx]', err);
        mostrarError(err.message);
        eventosActuales = [];
        document.getElementById('btnExportar').disabled = true;
    } finally {
        setLoading(false);
        btn.classList.remove('loading');
        btn.querySelector('.btn-icon').textContent = '⚡';
    }
}

// ══════════════════════════════════════════════════
// FILTROS Y ORDENAMIENTO
// ══════════════════════════════════════════════════
function obtenerEventosFiltrados() {
    const busq      = document.getElementById('txtEmpleado').value.trim().toLowerCase();
    const horaDesde = document.getElementById('txtHoraDesde').value;
    const horaHasta = document.getElementById('txtHoraHasta').value;

    return eventosActuales.filter(ev => {
        // ── Filtros de calidad de datos ──
        const id     = (ev.employeeNoString || '').trim();
        const nombre = (ev.name || '').trim();
        if (checkboxFiltros.ocultarSinId     && (!id     || id     === 'null')) return false;
        if (checkboxFiltros.ocultarSinNombre && (!nombre || nombre === 'null')) return false;

        // ── Tipo de evento ──
        if (!filtrosActivos[ev.minor]) return false;

        // ── Búsqueda de texto (cualquier parte del nombre o ID) ──
        if (busq) {
            const hayId     = id.toLowerCase().includes(busq);
            const hayNombre = nombre.toLowerCase().includes(busq);
            if (!hayId && !hayNombre) return false;
        }

        // ── Rango de hora ──
        if (horaDesde || horaHasta) {
            const h = extraerHora(ev.time);
            if (horaDesde && h < horaDesde) return false;
            if (horaHasta && h > horaHasta) return false;
        }

        return true;
    });
}

function ordenarEventos(eventos) {
    return [...eventos].sort((a, b) => {
        let va, vb;
        if (columnaOrden === 'empleado') { va = a.employeeNoString; vb = b.employeeNoString; }
        else if (columnaOrden === 'nombre') { va = a.name || ''; vb = b.name || ''; }
        else if (columnaOrden === 'tipo')   { va = a.minor; vb = b.minor; }
        else                                { va = a.time;  vb = b.time;  }
        const c = String(va).localeCompare(String(vb), 'es', { numeric: true });
        return ordenAsc ? c : -c;
    });
}

function aplicarFiltrosLocales() {
    const filtrados  = obtenerEventosFiltrados();
    const ordenados  = ordenarEventos(filtrados);
    actualizarStats(filtrados);
    renderVista(filtrados, ordenados);
    document.getElementById('btnExportar').disabled = filtrados.length === 0;
}

// ══════════════════════════════════════════════════
// RENDER PRINCIPAL (dispatcher)
// ══════════════════════════════════════════════════
function renderVista(filtrados, ordenados) {
    filtrados = filtrados || obtenerEventosFiltrados();
    ordenados = ordenados || ordenarEventos(filtrados);
    switch (vistaActual) {
        case 'eventos':  renderTablaEventos(ordenados, filtrados.length); break;
        case 'resumen':  renderResumenEmpleados(filtrados); break;
        case 'diario':   renderVistaDiaria(filtrados); break;
    }
}

// ── Vista: EVENTOS ──────────────────────────────
function renderTablaEventos(eventos, total) {
    const tbody = document.getElementById('listaAsistencia');
    const ppc   = eventosPorPagina;
    const pages = ppc ? Math.ceil(total / ppc) : 1;

    actualizarPaginacion(total, pages);

    const slice = ppc ? eventos.slice((paginaActual - 1) * ppc, paginaActual * ppc) : eventos;
    const busq  = document.getElementById('txtEmpleado').value.trim().toLowerCase();

    if (slice.length === 0) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5">
            <div class="empty-inner"><div class="state-icon">🔍</div>
            <p>No hay registros con los filtros aplicados.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    slice.forEach((ev, i) => {
        const { fecha, hora } = parsearFechaHora(ev.time);
        const entrada = ev.minor === EVENTO_ENTRADA;
        const tr  = document.createElement('tr');
        tr.style.animationDelay = `${Math.min(i * 15, 350)}ms`;

        const idHtml     = resaltar(ev.employeeNoString, busq);
        const nombreHtml = resaltar(ev.name || '—', busq);

        tr.innerHTML = `
            <td><span class="employee-id">${idHtml}</span></td>
            <td class="employee-name">${nombreHtml}</td>
            <td style="color:var(--text-2)">${fecha}</td>
            <td class="hora-cell">${hora}</td>
            <td><span class="event-badge ${entrada ? 'event-badge--entry' : 'event-badge--exit'}">
                ● ${entrada ? 'ENTRADA' : 'SALIDA'}</span></td>`;
        tbody.appendChild(tr);
    });
}

// ── Vista: RESUMEN POR EMPLEADO ──────────────────
function renderResumenEmpleados(eventos) {
    const tbody   = document.getElementById('listaResumen');
    const resumen = computarResumenEmpleados(eventos);

    actualizarPaginacion(resumen.length, 1); // sin paginación en resumen

    if (resumen.length === 0) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7">
            <div class="empty-inner"><div class="state-icon">👥</div>
            <p>No hay empleados en el rango seleccionado.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    resumen.forEach((emp, i) => {
        const ultima = parsearFechaHora(emp.ultimaActividad);
        const horaEnt = emp.primeraEntrada ? parsearFechaHora(emp.primeraEntrada).hora : null;
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${Math.min(i * 12, 300)}ms`;
        tr.innerHTML = `
            <td><span class="employee-id">${emp.id}</span></td>
            <td class="employee-name">${emp.nombre}</td>
            <td class="text-center"><span class="dias-badge">${emp.diasPresente}</span></td>
            <td class="text-center"><span class="num-badge num-badge--entry">${emp.totalEntradas}</span></td>
            <td class="text-center"><span class="num-badge num-badge--exit">${emp.totalSalidas}</span></td>
            <td class="hora-cell ${horaEnt ? '' : 'muted'}">${horaEnt || '—'}</td>
            <td class="hora-cell">${ultima.fecha !== '—' ? ultima.hora + ' · ' + ultima.fecha : '—'}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Vista: DIARIA ────────────────────────────────
function renderVistaDiaria(eventos) {
    const tbody  = document.getElementById('listaDiaria');
    const diario = computarResumenDiario(eventos);
    const maxEmp = diario.reduce((m, d) => Math.max(m, d.empleados), 1);

    actualizarPaginacion(diario.length, 1);

    if (diario.length === 0) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6">
            <div class="empty-inner"><div class="state-icon">📅</div>
            <p>No hay días con registros en el rango seleccionado.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    diario.forEach((d, i) => {
        const pct = Math.round((d.empleados / maxEmp) * 100);
        const { fecha } = parsearFechaHora(d.fecha + 'T12:00:00');
        const dia = nombreDia(d.fecha);
        const tr  = document.createElement('tr');
        tr.style.animationDelay = `${Math.min(i * 15, 350)}ms`;
        tr.innerHTML = `
            <td style="color:var(--text-2)">${fecha}</td>
            <td><span class="day-badge">${dia}</span></td>
            <td class="text-center"><strong>${d.empleados}</strong></td>
            <td class="text-center num-badge--entry"><strong>${d.entradas}</strong></td>
            <td class="text-center num-badge--exit"><strong>${d.salidas}</strong></td>
            <td>
                <div class="activity-bar">
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                    <span class="bar-pct">${pct}%</span>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ══════════════════════════════════════════════════
// HELPERS DE UI
// ══════════════════════════════════════════════════
function actualizarStats(eventos) {
    const total    = eventos.length;
    const entradas = eventos.filter(e => e.minor === EVENTO_ENTRADA).length;
    const salidas  = eventos.filter(e => e.minor === EVENTO_SALIDA).length;
    const empUnicos = new Set(eventos.map(e => e.employeeNoString)).size;

    animarContador(document.getElementById('statTotal'),     total);
    animarContador(document.getElementById('statEntradas'),  entradas);
    animarContador(document.getElementById('statSalidas'),   salidas);
    animarContador(document.getElementById('statEmpleados'), empUnicos);

    document.getElementById('resultsCount').textContent =
        `${total} registro${total !== 1 ? 's' : ''}`;
}

function resetStats() {
    ['statTotal', 'statEntradas', 'statSalidas', 'statEmpleados'].forEach(id => {
        document.getElementById(id).textContent = '—';
    });
    document.getElementById('resultsCount').textContent = '0';
}

function actualizarPaginacion(total, pages) {
    const ctrl = document.getElementById('paginationControls');
    const prev = document.getElementById('btnPrevPage');
    const next = document.getElementById('btnNextPage');
    const info = document.getElementById('pageInfo');

    if (!eventosPorPagina || vistaActual !== 'eventos') {
        ctrl.style.display = 'none'; return;
    }
    ctrl.style.display = 'flex';
    info.textContent  = `${paginaActual} / ${pages}`;
    prev.disabled     = paginaActual <= 1;
    next.disabled     = paginaActual >= pages;
}

function actualizarTituloVista() {
    const titulos = {
        eventos: 'Registros de Asistencia',
        resumen: 'Resumen por Empleado',
        diario : 'Vista Diaria',
    };
    document.getElementById('resultsTitle').textContent = titulos[vistaActual] || 'Resultados';
}

/** Resalta término en texto HTML */
function resaltar(texto, busq) {
    if (!busq || !texto) return texto || '';
    const re = new RegExp(`(${busq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return texto.replace(re, '<mark style="background:rgba(59,130,246,.35);color:var(--text);border-radius:2px">$1</mark>');
}

function setLoading(loading) {
    if (!loading) return;
    document.getElementById('listaAsistencia').innerHTML = `
        <tr class="loading-state"><td colspan="5">
            <div class="loading-inner">
                <div class="spinner"></div>
                <p>Consultando el checador Hikvision y actualizando…</p>
            </div></td></tr>`;
}

function mostrarError(msg) {
    resetStats();
    document.getElementById('listaAsistencia').innerHTML = `
        <tr class="error-state"><td colspan="5">
            <div class="error-inner">
                <div class="state-icon">❌</div>
                <p><strong>Error:</strong> ${msg}</p>
            </div></td></tr>`;
}

function mostrarCargando(n) {
    resetStats();
    document.getElementById('listaAsistencia').innerHTML = `
        <tr class="loading-state"><td colspan="5">
            <div class="loading-inner">
                <div class="spinner"></div>
                <p>El historial se está descargando en segundo plano.<br>
                <strong>${n} eventos</strong> descargados hasta ahora.<br>
                Intenta de nuevo en unos segundos.</p>
            </div></td></tr>`;
}

function exportarCSV() {
    const eventos = obtenerEventosFiltrados();
    if (!eventos.length) return;
    const desde = document.getElementById('txtDesde').value;
    const hasta = document.getElementById('txtHasta').value;
    descargarCSV(generarCSV(ordenarEventos(eventos)), `asistencia_${desde}_al_${hasta}.csv`);
}
