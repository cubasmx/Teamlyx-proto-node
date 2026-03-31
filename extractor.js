// Usamos módulos nativos de Node.js, cero librerías externas
const { exec } = require('child_process');
const fs = require('fs');

console.log("Iniciando conexión nativa con el checador Hikvision...");

// Este es exactamente tu comando de la terminal, envuelto en una variable.
// Le agregamos la bandera "-s" (silent) para que curl no ensucie la respuesta con su barra de progreso.
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

// Ejecutamos el comando directamente en el sistema operativo
// Le damos un maxBuffer grande por si el checador devuelve muchísimos registros
exec(comandoCurl, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
        console.error(`Error de red al ejecutar curl: ${error.message}`);
        return;
    }

    try {
        // Convertimos el texto a JSON
        const data = JSON.parse(stdout);

        fs.writeFileSync('asistencia.json', JSON.stringify(data, null, 2));
        console.log("\nArchivo guardado para inspección: asistencia.json");

        // Vamos a ser más curiosos y ver qué nos mandó exactamente el equipo
        console.log("\nEstructura recibida del checador:", Object.keys(data.AcsEventList));

        // Le decimos que busque en 'InfoList', y si no existe, que busque en 'AcsEvent'
        const eventos = data.AcsEventList?.InfoList || data.AcsEventList?.AcsEvent;

        if (!eventos || eventos.length === 0) {
            console.log("La petición fue exitosa, pero no encontró el arreglo de eventos.");
            console.log("Respuesta cruda de la API:", JSON.stringify(data.AcsEventList, null, 2));
            return;
        }

        console.log(`\n¡Éxito total! Se descargaron ${eventos.length} registros en tiempo real.\n`);
        console.log('--- Últimos 3 registros extraídos ---');

        eventos.slice(0, 3).forEach(evento => {
            console.log(`Empleado ID: ${evento.employeeNoString} | Fecha/Hora: ${evento.time} | Tipo: ${evento.minor}`);
        });

        fs.writeFileSync('asistencia_descargada_por_node.json', JSON.stringify(data, null, 2));

    } catch (parseError) {
        console.error("\nError al procesar la respuesta.");
        console.log(stdout);
    }
});
