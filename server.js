const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const port = 3001;

// Sirve tus archivos HTML y JS automáticamente
app.use(express.static('.'));

// RUTA MAGICA: Aquí es donde el botón de HTML activa la terminal
app.get('/ejecutar-extractor', (req, res) => {
    console.log(">> Ejecutando comando de terminal para el checador...");

    const comandoCurl = `curl -s -k -X POST "https://HIKVISION_HOST_REDACTED/ISAPI/AccessControl/AcsEvent?format=json" \
    --digest -u "HIKVISION_USER_REDACTED:HIKVISION_PASS_REDACTED" \
    -H "Content-Type: application/json" \
    -d '{
        "AcsEventCond": {
            "searchID": "1",
            "searchResultPosition": 0,
            "maxResults": 1000,
            "major": 5,
            "minor": 75,
            "startTime": "2026-03-01T00:00:00+00:00",
            "endTime": "2026-03-31T23:59:59+00:00"
        }
    }'`;

    exec(comandoCurl, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
        if (error) {
            console.error("Error en terminal:", error.message);
            return res.status(500).json({ error: "Error al conectar con el checador" });
        }

        try {
            // Enviamos el resultado directamente al navegador como JSON
            const data = JSON.parse(stdout);
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: "Respuesta del checador no es JSON válido" });
        }
    });
});

app.listen(port, () => {
    console.log(`--- TEAMLYX ACTIVO ---`);
    console.log(`Entra a http://localhost:${port} para usar tu panel.`);
});
