// =====================================================
// TEAMLYX — ui-logic.js  v3.0
// Funciones de utilidad compartidas entre UI y tests
// =====================================================

// ── Constantes de eventos Hikvision ISAPI ──────────
const EVENTO_ENTRADA = 75;
const EVENTO_SALIDA  = 76;

/** Date → "YYYY-MM-DD" */
function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Calcula el rango de fechas para un preset.
 * @param {'today'|'yesterday'|'week'|'month'} preset
 * @returns {{ desde: string, hasta: string }} YYYY-MM-DD
 */
function calcularPreset(preset) {
    const hoy = new Date();
    switch (preset) {
        case 'today':
            return { desde: formatDateInput(hoy), hasta: formatDateInput(hoy) };
        case 'yesterday': {
            const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
            return { desde: formatDateInput(ayer), hasta: formatDateInput(ayer) };
        }
        case 'week': {
            const l = new Date(hoy); l.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
            return { desde: formatDateInput(l), hasta: formatDateInput(hoy) };
        }
        default: { // month
            const p = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            return { desde: formatDateInput(p), hasta: formatDateInput(hoy) };
        }
    }
}

/**
 * ISO string → { fecha, hora } en español.
 * Usa new Date() para manejar timezone offset del dispositivo.
 */
function parsearFechaHora(isoString) {
    if (!isoString) return { fecha: '—', hora: '—' };
    try {
        const d = new Date(isoString);
        return {
            fecha: d.toLocaleDateString('es-MX', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
            hora : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
    } catch { return { fecha: isoString, hora: '' }; }
}

/**
 * Extrae "HH:MM" local de un ISO string (para filtro de hora).
 * El Hikvision guarda la hora local con offset (-06:00), así que
 * tomamos directamente los chars 11-15 del string.
 */
function extraerHora(isoString) {
    if (!isoString || isoString.length < 16) return '';
    return isoString.substring(11, 16); // "HH:MM"
}

/** Nombre corto del día de la semana en español. */
function nombreDia(isoDate) {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return dias[new Date(isoDate + 'T12:00:00').getDay()];
}

/**
 * Animación de contador numérico (ease-out cubic).
 */
function animarContador(el, target, duration = 600) {
    const start = performance.now(), initial = parseInt(el.textContent) || 0;
    const step = now => {
        const p = Math.min((now - start) / duration, 1);
        el.textContent = Math.round(initial + (target - initial) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/**
 * Agrupa eventos por empleado y calcula:
 * - Total de días presente
 * - Total entradas / salidas
 * - Primera entrada del día actual (si existe)
 * - Última actividad registrada
 */
function computarResumenEmpleados(eventos) {
    const mapa = {};

    for (const ev of eventos) {
        const key = ev.employeeNoString;
        if (!key || key === 'undefined') continue; // ignorar eventos sin ID de empleado
        if (!mapa[key]) {
            mapa[key] = { id: key, nombre: ev.name || '—', dias: {}, totalEntradas: 0, totalSalidas: 0, ultimaActividad: null };
        }
        const emp   = mapa[key];
        const fecha = ev.time.substring(0, 10);
        if (!emp.dias[fecha]) emp.dias[fecha] = { entradas: [], salidas: [] };

        if (ev.minor === EVENTO_ENTRADA) { emp.dias[fecha].entradas.push(ev.time); emp.totalEntradas++; }
        else                             { emp.dias[fecha].salidas.push(ev.time);  emp.totalSalidas++;  }

        if (!emp.ultimaActividad || ev.time > emp.ultimaActividad) emp.ultimaActividad = ev.time;
    }

    const hoy = formatDateInput(new Date());

    return Object.values(mapa).map(emp => {
        const diaHoy = emp.dias[hoy];
        return {
            id             : emp.id,
            nombre         : emp.nombre,
            diasPresente   : Object.keys(emp.dias).length,
            totalEntradas  : emp.totalEntradas,
            totalSalidas   : emp.totalSalidas,
            ultimaActividad: emp.ultimaActividad,
            primeraEntrada : diaHoy?.entradas.sort()[0] || null,
            ultimaSalida   : diaHoy?.salidas.sort().at(-1) || null,
        };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Agrupa eventos por fecha y retorna resumen diario ordenado desc.
 */
function computarResumenDiario(eventos) {
    const mapa = {};
    for (const ev of eventos) {
        const f = ev.time.substring(0, 10);
        if (!mapa[f]) mapa[f] = { fecha: f, empleados: new Set(), entradas: 0, salidas: 0 };
        mapa[f].empleados.add(ev.employeeNoString);
        ev.minor === EVENTO_ENTRADA ? mapa[f].entradas++ : mapa[f].salidas++;
    }
    return Object.values(mapa)
        .map(d => ({ fecha: d.fecha, empleados: d.empleados.size, entradas: d.entradas, salidas: d.salidas }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Genera CSV con BOM para compatibilidad con Excel. */
function generarCSV(eventos, horaLimite) {
    const enc  = ['ID', 'Nombre', 'Fecha', 'Hora', 'Tipo', 'Estado'].join(',');
    const rows = eventos.map(ev => {
        const { fecha, hora } = parsearFechaHora(ev.time);
        
        let tipo = ev.minor === EVENTO_ENTRADA ? 'ENTRADA' : 'SALIDA';
        let estado = '—';
        
        if (ev._falta) {
            tipo = 'NO CHECÓ';
            estado = 'FALTA';
        } else if (ev.minor === EVENTO_ENTRADA) {
            if (!horaLimite) {
                estado = 'PRESENTE';
            } else {
                const hStr = extraerHora(ev.time);
                if (hStr <= horaLimite) estado = 'A TIEMPO';
                else if (hStr < "12:00") estado = 'RETARDO';
                else estado = 'PRESENTE';
            }
        }
        
        const horaVal = ev._falta ? '—' : hora;
        
        return [ev.employeeNoString, ev.name || '', fecha, horaVal, tipo, estado]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',');
    });
    return [enc, ...rows].join('\r\n');
}

function descargarCSV(csv, filename) {
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getDiasEnRangoConfig(start, end, diasLaboralesValidos = [1,2,3,4,5]) {
    const dias = [];
    const d    = new Date(start + 'T12:00:00');
    const fin  = new Date(end   + 'T12:00:00');
    while (d <= fin) {
        const dow = d.getDay();
        if (diasLaboralesValidos.includes(dow)) {
            dias.push(d.toISOString().substring(0, 10));
        }
        d.setDate(d.getDate() + 1);
    }
    return dias;
}

// ── Exportar para Node.js (tests) ──────────────────
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EVENTO_ENTRADA, EVENTO_SALIDA,
        formatDateInput, calcularPreset, parsearFechaHora, extraerHora,
        animarContador, computarResumenEmpleados, computarResumenDiario,
        nombreDia, generarCSV, descargarCSV, getDiasEnRango,
    };
}
