require('dotenv').config();

const express = require('express');
const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

// ══════════════════════════════════════════════════════
//  CONFIGURACIÓN DINÁMICA
// ══════════════════════════════════════════════════════
const CONFIG_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR);
}

const DEFAULT_CONFIG = {
    hikvision_url: process.env.HIKVISION_URL || '',
    hikvision_user: process.env.HIKVISION_USER || 'admin',
    hikvision_pass: process.env.HIKVISION_PASS || '',
    horaEntrada: '08:00',
    toleranciaEntrada: 15,
    horaSalida: '18:00',
    diasLaborales: [1, 2, 3, 4, 5],
    temaGlobal: ''
};

function getConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
        }
    } catch(e) {
        console.error("[Config] Error leyendo config.json", e);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(newConf) {
    const current = getConfig();
    const merged = { ...current, ...newConf };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

const app     = express();
const PORT    = process.env.PORT || 3001;

// Middlewares necesarios
app.use(express.json());

// ── Constantes de eventos Hikvision ISAPI ──────────
const EVENTO_ENTRADA = 75;
const EVENTO_SALIDA  = 76;

app.use(express.static(path.join(__dirname)));

// ══════════════════════════════════════════════════════
//  CACHÉ EN MEMORIA
// ══════════════════════════════════════════════════════
const cache = {
    eventos    : [],       // todos los eventos descargados del mes
    listo      : false,    // carga inicial completa
    cargando   : false,    // carga inicial en curso
    ultimaSync : null,     // Date de la última sincronización
    mesEnCache : null,     // "YYYY-MM" para detectar cambio de mes
};

// ── Helpers de fecha ──
const pad     = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
// Hikvision rechaza milisegundos: "2026-03-01T06:00:00+00:00" ✓  vs  "2026-03-01T06:00:00.000+00:00" ✗
const isoTS   = d => d.toISOString().slice(0, 19) + '+00:00';
const mesStr  = ()  => {
    const h = new Date();
    return `${h.getFullYear()}-${pad(h.getMonth()+1)}`;
};

// ── Merge sin duplicados (clave = serialNo) ──
function mergeEventos(base, nuevos) {
    const vistos   = new Set(base.map(e => e.serialNo));
    const frescos  = nuevos.filter(e => !vistos.has(e.serialNo));
    if (frescos.length === 0) return base;
    return [...base, ...frescos].sort((a, b) => new Date(b.time) - new Date(a.time));
}

// ══════════════════════════════════════════════════════
//  DIGEST AUTH — implementación nativa Node.js
// ══════════════════════════════════════════════════════
const md5 = str => crypto.createHash('md5').update(str).digest('hex');

function parseDigestChallenge(header) {
    const result = {};
    header.replace(/(\w+)="([^"]+)"/g, (_, k, v) => { result[k] = v; });
    const qopMatch = header.match(/qop=([^,\s"]+)/);
    if (qopMatch && !result.qop) result.qop = qopMatch[1];
    return result;
}

function buildDigestHeader(user, pass, method, uri, ch) {
    const qop  = ch.qop ? 'auth' : null;
    const ha1  = md5(`${user}:${ch.realm}:${pass}`);
    const ha2  = md5(`${method}:${uri}`);
    const nc   = '00000001';
    const cnon = crypto.randomBytes(8).toString('hex');
    const resp = qop
        ? md5(`${ha1}:${ch.nonce}:${nc}:${cnon}:${qop}:${ha2}`)
        : md5(`${ha1}:${ch.nonce}:${ha2}`);

    let h = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${resp}"`;
    if (qop)      h += `, qop=${qop}, nc=${nc}, cnonce="${cnon}"`;
    if (ch.opaque) h += `, opaque="${ch.opaque}"`;
    return h;
}

function digestPost(urlStr, body) {
    return new Promise((resolve, reject) => {
        const parsed  = new URL(urlStr);
        const isSsl   = parsed.protocol === 'https:';
        const xport   = isSsl ? https : http;
        const agent   = isSsl ? new https.Agent({ rejectUnauthorized: false }) : undefined;
        const bodyStr = JSON.stringify(body);
        const uri     = parsed.pathname + parsed.search;

        const base = {
            hostname: parsed.hostname,
            port    : parsed.port || (isSsl ? 443 : 80),
            path    : uri, method: 'POST', agent,
            headers : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        };

        // Paso 1: obtener nonce
        const r1 = xport.request(base, s1 => {
            if (s1.statusCode !== 401) {
                let raw = ''; s1.on('data', c => raw += c); s1.on('end', () => resolve(raw));
                return;
            }
            const wwwAuth = s1.headers['www-authenticate'] || '';
            s1.resume();

            const ch   = parseDigestChallenge(wwwAuth);
            const auth = buildDigestHeader(
                getConfig().hikvision_user, getConfig().hikvision_pass, 'POST', uri, ch
            );

            // Paso 2: petición autenticada
            const r2 = xport.request({ ...base, headers: { ...base.headers, Authorization: auth } }, s2 => {
                let data = ''; s2.on('data', c => data += c);
                s2.on('end', () => {
                    if (s2.statusCode !== 200) return reject(new Error(`HTTP ${s2.statusCode}`));
                    resolve(data);
                });
            });
            r2.on('error', reject); r2.write(bodyStr); r2.end();
        });
        r1.on('error', reject); r1.write(bodyStr); r1.end();
    });
}

// ══════════════════════════════════════════════════════
//  FETCH PAGINADO
//  startTime / endTime → strings ISO completos
// ══════════════════════════════════════════════════════
async function fetchHikvision(minor, startTime, endTime) {
    const config = getConfig();
    if (!config.hikvision_url) {
        return Promise.reject(new Error("Hikvision URL no configurada en el panel ni entorno."));
    }
    const url    = `${config.hikvision_url}/ISAPI/AccessControl/AcsEvent?format=json`;
    const todos  = [];
    let   pos    = 0;
    const PAGE   = 30;

    while (true) {
        const raw = await digestPost(url, {
            AcsEventCond: {
                searchID             : `TLX-${Date.now()}-${pos}`,
                searchResultPosition : pos,
                maxResults           : PAGE,
                major: 5, minor,
                startTime, endTime,
            },
        });

        const bloque = JSON.parse(raw)?.AcsEvent;
        const pagina = bloque?.InfoList || bloque?.AcsEvent || [];
        todos.push(...pagina);

        if (bloque?.responseStatusStrg !== 'MORE' || pagina.length === 0) break;
        pos += pagina.length;
        if (pos >= 6000) { console.warn(`[Checador] Límite de seguridad (${pos})`); break; }
    }

    return todos;
}

// ══════════════════════════════════════════════════════
//  CACHÉ — CARGA INICIAL (background, al arrancar)
// ══════════════════════════════════════════════════════
async function cargarCacheInicial() {
    if (cache.cargando) return;
    cache.cargando  = true;
    cache.listo     = false;
    cache.mesEnCache = mesStr();

    const hoy    = new Date();
    const primer = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const desde  = isoTS(primer);
    const hasta  = isoTS(hoy);

    console.log('[Caché] 🔄 Descargando mes completo en background...');

    try {
        const [entradas, salidas] = await Promise.all([
            fetchHikvision(EVENTO_ENTRADA, desde, hasta),
            fetchHikvision(EVENTO_SALIDA, desde, hasta),
        ]);

        cache.eventos  = [...entradas, ...salidas]
            .sort((a, b) => new Date(b.time) - new Date(a.time));
        cache.listo    = true;
        cache.cargando = false;
        cache.ultimaSync = new Date();

        console.log(`[Caché] ✅ Listo. ${cache.eventos.length} eventos (${entradas.length} entr. + ${salidas.length} sal.)`);
    } catch (err) {
        cache.cargando = false;
        console.error('[Caché] ❌ Error:', err.message);
        console.log('[Caché] Reintentando en 30 segundos...');
        setTimeout(cargarCacheInicial, 30_000);
    }
}

// ══════════════════════════════════════════════════════
//  CACHÉ — ACTUALIZACIÓN INCREMENTAL (últimas 2 horas)
// ══════════════════════════════════════════════════════
async function actualizarIncremental() {
    const ahora  = new Date();
    const hace2h = new Date(ahora - 2 * 60 * 60 * 1000);

    // Si cambia el mes, recargar todo
    if (mesStr() !== cache.mesEnCache) {
        console.log('[Caché] 📅 Cambio de mes detectado — recargando completo.');
        setImmediate(cargarCacheInicial);
        return;
    }

    const [entradas, salidas] = await Promise.all([
        fetchHikvision(EVENTO_ENTRADA, isoTS(hace2h), isoTS(ahora)),
        fetchHikvision(EVENTO_SALIDA, isoTS(hace2h), isoTS(ahora)),
    ]);

    const antes  = cache.eventos.length;
    cache.eventos = mergeEventos(cache.eventos, [...entradas, ...salidas]);
    cache.ultimaSync = ahora;

    const nuevos = cache.eventos.length - antes;
    console.log(`[Caché] ⚡ Incremental: +${nuevos} nuevo(s). Total: ${cache.eventos.length}`);
}

// ── Arrancar la carga en background al inicio ──
setImmediate(cargarCacheInicial);

// ══════════════════════════════════════════════════════
//  ENDPOINTS
// ══════════════════════════════════════════════════════

// GET /api/estado → estado actual del caché
app.get('/api/estado', (req, res) => {
    res.json({
        listo     : cache.listo,
        cargando  : cache.cargando,
        total     : cache.eventos.length,
        ultimaSync: cache.ultimaSync,
        mes       : cache.mesEnCache,
    });
});

// GET /api/asistencia?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/asistencia', async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate)
        return res.status(400).json({ error: 'Se requieren startDate y endDate' });

    if (new Date(startDate) > new Date(endDate))
        return res.status(400).json({ error: 'startDate no puede ser mayor a endDate' });

    // Caché aún cargando → responder con estado parcial
    if (!cache.listo) {
        return res.status(202).json({
            cargando: true,
            total   : cache.eventos.length,
            error   : 'El historial del mes aún se está descargando. Intenta en unos segundos.',
        });
    }

    // ── Actualización incremental (rápida, ~2s) ──
    console.log(`[API] Solicitud ${startDate}→${endDate} | Actualizando últimas 2h...`);
    try {
        await actualizarIncremental();
    } catch (err) {
        console.warn('[API] Incremental falló (usando caché actual):', err.message);
    }

    // ── Filtrar caché por rango de fechas ──
    const desde  = new Date(`${startDate}T00:00:00`);
    const hasta  = new Date(`${endDate}T23:59:59`);
    const eventos = cache.eventos.filter(ev => {
        const t = new Date(ev.time);
        return t >= desde && t <= hasta;
    });

    res.json({
        total   : eventos.length,
        entradas: eventos.filter(e => e.minor === EVENTO_ENTRADA).length,
        salidas : eventos.filter(e => e.minor === EVENTO_SALIDA).length,
        eventos,
        ultimaSync: cache.ultimaSync,
    });
});

// POST /api/config -> Guardar configuración global
app.post('/api/config', (req, res) => {
    try {
        saveConfig(req.body);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/config -> Leer config actual
app.get('/api/config', (req, res) => {
    res.json(getConfig());
});

// GET /api/empleados → devuelve lista de todos los empleados únicos en el caché
app.get('/api/empleados', (req, res) => {
    const empleados = new Map();
    for (const ev of cache.eventos) {
        const id = (ev.employeeNoString || '').trim();
        const nom = (ev.name || '').trim();
        if (id && id !== 'null' && nom && nom !== 'null') {
            if (!empleados.has(id)) empleados.set(id, nom);
        }
    }
    const arr = Array.from(empleados.entries()).map(([id, nombre]) => ({ id, nombre }));
    res.json(arr);
});

// ══════════════════════════════════════════════════════
//  INICIO
// ══════════════════════════════════════════════════════
// Exportar funciones para tests unitarios
if (require.main !== module) {
    module.exports = { mergeEventos };
} else {
    app.listen(PORT, () => {
        console.log('');
        console.log('  ╔══════════════════════════════════╗');
        console.log('  ║   TEAMLYX — Checador  v3.0       ║');
        console.log('  ╚══════════════════════════════════╝');
        console.log(`  Panel:    http://localhost:${PORT}`);
        console.log(`  Checador: ${getConfig().hikvision_url || '¡No configurado!'}`);
        console.log('');
    });
}
