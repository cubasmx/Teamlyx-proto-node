/**
 * TEAMLYX — tests/test.js
 * Suite de pruebas unificadas: unitarias + integración
 *
 * Ejecución:
 *   node tests/test.js              → todos los tests
 *   node tests/test.js --unit       → solo unitarios
 *   node tests/test.js --integration → solo integración (requiere servidor)
 */

'use strict';

const assert = require('assert');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');

// ── Helpers de test ────────────────────────────────
let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        results.push({ ok: true, name });
        process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
        failed++;
        results.push({ ok: false, name, err: err.message });
        process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`);
    }
}

function get(urlPath) {
    return new Promise((resolve, reject) => {
        const port = process.env.PORT || 3001;
        http.get(`http://localhost:${port}${urlPath}`, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        }).on('error', reject);
    });
}

// ── Carga módulos ──────────────────────────────────
const ui = require(path.join(__dirname, '..', 'ui-logic.js'));
const { mergeEventos } = require(path.join(__dirname, '..', 'server.js'));

// ── Datos mock ─────────────────────────────────────
const EVS = [
    { serialNo: 1, employeeNoString: '101', name: 'GARCIA JUAN',   minor: 75, time: '2026-03-10T08:00:00-06:00' },
    { serialNo: 2, employeeNoString: '101', name: 'GARCIA JUAN',   minor: 76, time: '2026-03-10T17:00:00-06:00' },
    { serialNo: 3, employeeNoString: '202', name: 'LOPEZ MARIA',   minor: 75, time: '2026-03-10T08:30:00-06:00' },
    { serialNo: 4, employeeNoString: '202', name: 'LOPEZ MARIA',   minor: 75, time: '2026-03-11T08:15:00-06:00' },
    { serialNo: 5, employeeNoString: '303', name: 'TORRES CARLOS', minor: 75, time: '2026-03-11T09:00:00-06:00' },
];

// ══════════════════════════════════════════════════
// TESTS UNITARIOS — ui-logic.js
// ══════════════════════════════════════════════════
const args = process.argv.slice(2);
const soloIntegracion = args.includes('--integration');
const soloUnit        = args.includes('--unit');
const runUnit         = !soloIntegracion;
const runIntegration  = !soloUnit;

if (runUnit) {
    console.log('\n━━━ TESTS UNITARIOS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // formatDateInput
    test('formatDateInput — devuelve YYYY-MM-DD', () => {
        const d = new Date(2026, 2, 5); // 5 mar 2026
        assert.strictEqual(ui.formatDateInput(d), '2026-03-05');
    });
    test('formatDateInput — padding correcto en mes/día < 10', () => {
        const d = new Date(2026, 0, 1);
        assert.strictEqual(ui.formatDateInput(d), '2026-01-01');
    });

    // calcularPreset
    test('calcularPreset(today) — desde === hasta === hoy', () => {
        const hoy = ui.formatDateInput(new Date());
        const { desde, hasta } = ui.calcularPreset('today');
        assert.strictEqual(desde, hoy);
        assert.strictEqual(hasta, hoy);
    });
    test('calcularPreset(yesterday) — desde es hoy-1', () => {
        const { desde } = ui.calcularPreset('yesterday');
        const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
        assert.strictEqual(desde, ui.formatDateInput(ayer));
    });
    test('calcularPreset(month) — inicia el día 01', () => {
        const { desde } = ui.calcularPreset('month');
        assert.match(desde, /^\d{4}-\d{2}-01$/);
    });

    // extraerHora
    test('extraerHora — extrae HH:MM del ISO string', () => {
        assert.strictEqual(ui.extraerHora('2026-03-10T08:30:00-06:00'), '08:30');
    });
    test('extraerHora — string vacío devuelve ""', () => {
        assert.strictEqual(ui.extraerHora(''), '');
    });

    // parsearFechaHora
    test('parsearFechaHora — retorna objeto { fecha, hora }', () => {
        const r = ui.parsearFechaHora('2026-03-10T08:00:00-06:00');
        assert.ok(r.fecha && r.fecha !== '—');
        assert.ok(r.hora  && r.hora  !== '—');
    });
    test('parsearFechaHora — null/undefined devuelve "—"', () => {
        const r = ui.parsearFechaHora(null);
        assert.strictEqual(r.fecha, '—');
        assert.strictEqual(r.hora,  '—');
    });

    // nombreDia
    test('nombreDia — lunes correcto', () => {
        assert.strictEqual(ui.nombreDia('2026-03-09'), 'Lun'); // 9 mar 2026 = lunes
    });

    // computarResumenEmpleados
    test('computarResumenEmpleados — agrupa por employeeNoString', () => {
        const res = ui.computarResumenEmpleados(EVS);
        assert.strictEqual(res.length, 3); // 101, 202, 303
    });
    test('computarResumenEmpleados — cuenta entradas/salidas correctamente', () => {
        const res = ui.computarResumenEmpleados(EVS);
        const garcia = res.find(e => e.id === '101');
        assert.strictEqual(garcia.totalEntradas, 1);
        assert.strictEqual(garcia.totalSalidas,  1);
    });
    test('computarResumenEmpleados — días presente correcto', () => {
        const res = ui.computarResumenEmpleados(EVS);
        const lopez = res.find(e => e.id === '202');
        assert.strictEqual(lopez.diasPresente, 2); // días 10 y 11
    });

    // computarResumenDiario
    test('computarResumenDiario — agrupa por fecha', () => {
        const res = ui.computarResumenDiario(EVS);
        assert.strictEqual(res.length, 2); // días 10 y 11
    });
    test('computarResumenDiario — cuenta empleados únicos por día', () => {
        const res = ui.computarResumenDiario(EVS);
        const dia10 = res.find(d => d.fecha === '2026-03-10');
        assert.strictEqual(dia10.empleados, 2); // 101 y 202
    });
    test('computarResumenDiario — ordenado descendente', () => {
        const res = ui.computarResumenDiario(EVS);
        assert.ok(res[0].fecha >= res[res.length - 1].fecha);
    });

    // generarCSV
    test('generarCSV — primera línea es header correcto', () => {
        const csv = ui.generarCSV([EVS[0]]);
        const lineas = csv.split('\r\n');
        assert.strictEqual(lineas[0], 'ID,Nombre,Fecha,Hora,Tipo');
    });
    test('generarCSV — contiene ENTRADA para minor=75', () => {
        const csv = ui.generarCSV([EVS[0]]);
        assert.ok(csv.includes('ENTRADA'));
    });
    test('generarCSV — contiene SALIDA para minor=76', () => {
        const csv = ui.generarCSV([EVS[1]]);
        assert.ok(csv.includes('SALIDA'));
    });
    test('generarCSV — filas correctas (N eventos = N+1 líneas)', () => {
        const csv = ui.generarCSV(EVS);
        assert.strictEqual(csv.split('\r\n').length, EVS.length + 1);
    });

    // mergeEventos (server.js)
    test('mergeEventos — no duplica por serialNo', () => {
        const base   = [EVS[0], EVS[1]];
        const nuevos = [EVS[0], EVS[2]]; // EVS[0] ya está en base
        const result = mergeEventos(base, nuevos);
        assert.strictEqual(result.length, 3); // 0,1,2 (sin duplicar 0)
    });
    test('mergeEventos — agrega eventos nuevos', () => {
        const result = mergeEventos([EVS[0]], [EVS[1]]);
        assert.strictEqual(result.length, 2);
    });
    test('mergeEventos — retorna base si no hay nuevos', () => {
        const base = [EVS[0]];
        const r    = mergeEventos(base, [EVS[0]]); // mismo serialNo
        assert.strictEqual(r, base); // misma referencia
    });
    test('mergeEventos — ordena por tiempo descendente', () => {
        const r = mergeEventos([EVS[0]], [EVS[2]]);
        assert.ok(r[0].time >= r[1].time);
    });
}

// ══════════════════════════════════════════════════
// TESTS DE INTEGRACIÓN — API HTTP
// ══════════════════════════════════════════════════
async function runIntegrationTests() {
    console.log('\n━━━ TESTS DE INTEGRACIÓN ━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // GET /api/estado
    try {
        const { status, json } = await get('/api/estado');
        test('GET /api/estado → 200', () => assert.strictEqual(status, 200));
        test('GET /api/estado → tiene campo "listo"',    () => assert.ok('listo'    in json));
        test('GET /api/estado → tiene campo "cargando"', () => assert.ok('cargando' in json));
        test('GET /api/estado → tiene campo "total"',    () => assert.ok('total'    in json));
        test('GET /api/estado → total es número',        () => assert.strictEqual(typeof json.total, 'number'));
    } catch (e) {
        test('GET /api/estado → conectar al servidor', () => { throw new Error(`No se puede conectar: ${e.message}`); });
    }

    // GET /api/asistencia sin params
    try {
        const { status } = await get('/api/asistencia');
        test('GET /api/asistencia sin params → 400', () => assert.strictEqual(status, 400));
    } catch (e) {
        test('GET /api/asistencia sin params → 400', () => { throw new Error(e.message); });
    }

    // GET /api/asistencia fechas invertidas
    try {
        const { status } = await get('/api/asistencia?startDate=2026-03-31&endDate=2026-03-01');
        test('GET /api/asistencia fechas invertidas → 400', () => assert.strictEqual(status, 400));
    } catch (e) {
        test('GET /api/asistencia fechas invertidas → 400', () => { throw new Error(e.message); });
    }

    // GET /api/asistencia con rango válido
    try {
        const hoy = ui.formatDateInput(new Date());
        const { status, json } = await get(`/api/asistencia?startDate=${hoy}&endDate=${hoy}`);
        test('GET /api/asistencia rango válido → 200 o 202',    () => assert.ok(status === 200 || status === 202));
        test('GET /api/asistencia → tiene campo "total"',       () => assert.ok('total'    in json));
        test('GET /api/asistencia → tiene campo "eventos"',     () => assert.ok(status !== 200 || Array.isArray(json.eventos)));
        test('GET /api/asistencia → total es número',           () => assert.strictEqual(typeof json.total, 'number'));
    } catch (e) {
        test('GET /api/asistencia rango válido → respuesta válida', () => { throw new Error(e.message); });
    }
}

// ── Ejecución principal ────────────────────────────
async function main() {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   TEAMLYX — Test Suite  v3.0         ║');
    console.log('╚══════════════════════════════════════╝');

    if (runIntegration) await runIntegrationTests();

    // Resumen
    const total = passed + failed;
    console.log('\n━━━ RESULTADO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`  Total : ${total}`);
    console.log(`  ✓ Pasan: ${passed}`);
    console.log(`  ✗ Fallan: ${failed}`);
    console.log('');

    if (failed > 0) {
        console.log('  Tests fallidos:');
        results.filter(r => !r.ok).forEach(r => console.log(`    - ${r.name}: ${r.err}`));
        console.log('');
        process.exit(1);
    } else {
        console.log('  ✅ Todos los tests pasan.\n');
        process.exit(0);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
