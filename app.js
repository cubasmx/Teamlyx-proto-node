document.getElementById('btnCargar').onclick = async () => {
    const cuerpoTabla = document.getElementById('listaAsistencia');
    cuerpoTabla.innerHTML = "<tr><td colspan='3'>⏳ Conectando con el checador Hikvision...</td></tr>";

    try {
        // 1. Llamamos a la ruta que definiste en server.js
        const respuesta = await fetch('/ejecutar-extractor');
        const data = await respuesta.json();

        // 2. Extraemos los eventos (manejando los dos posibles nombres de Hikvision)
        const eventos = data.AcsEventList?.InfoList || data.AcsEventList?.AcsEvent || [];

        // 3. Capturamos los filtros de los checkboxes e input
        const verEntradas = document.getElementById('chkEntradas').checked;
        const verSalidas = document.getElementById('chkSalidas').checked;
        const busquedaID = document.getElementById('txtEmpleado').value.trim();

        // 4. Lógica de filtrado
        const datosFiltrados = eventos.filter(ev => {
            const cumpleID = busquedaID === "" || ev.employeeNoString.includes(busquedaID);
            let cumpleTipo = true;
            if (verEntradas || verSalidas) {
                cumpleTipo = (verEntradas && ev.minor === 75) || (verSalidas && ev.minor === 76);
            }
            return cumpleID && cumpleTipo;
        });

        // 5. Renderizado de filas
        cuerpoTabla.innerHTML = "";

        if (datosFiltrados.length === 0) {
            cuerpoTabla.innerHTML = "<tr><td colspan='3'>No se encontraron registros en el equipo.</td></tr>";
            return;
        }

        datosFiltrados.forEach(ev => {
            const fila = `
            <tr>
            <td>${ev.employeeNoString}</td>
            <td>${ev.time}</td>
            <td>${ev.minor === 75 ? '🟢 ENTRADA' : '🔴 SALIDA'}</td>
            </tr>`;
            cuerpoTabla.insertAdjacentHTML('beforeend', fila);
        });

    } catch (error) {
        console.error("Error:", error);
        cuerpoTabla.innerHTML = "<tr><td colspan='3' style='color:red'>❌ Error al obtener datos del servidor.</td></tr>";
    }
};
