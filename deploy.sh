#!/bin/bash
echo "🚀 Iniciando despliegue hacia 10.10.2.63..."

# Definimos variables
SERVER="admin@10.10.2.63"
DEST_DIR="/home/admin/deployments/teamlyx-checador"

# 1. Crear directorio en el servidor si no existe
echo "📁 Asegurando que el directorio destino existe en el servidor..."
ssh $SERVER "mkdir -p $DEST_DIR"

# 2. Copiar archivos excluyendo basura
echo "📦 Transfiriendo archivos de la aplicación..."
rsync -avz --exclude-from='.dockerignore' --exclude='.git' ./ $SERVER:$DEST_DIR/

# 3. Levantar contenedores
echo "🐳 Levantando contenedores en producción con Docker Compose..."
ssh $SERVER "cd $DEST_DIR && docker compose up -d --build"

echo "✅ ¡Despliegue finalizado exitosamente! El panel debería estar en http://10.10.2.63:3001"
