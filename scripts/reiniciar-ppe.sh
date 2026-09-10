#!/bin/bash
# Reinicia todos los servicios del PPE (backend, frontend, navegador) sin
# apagar la maquina. Usar cuando la pantalla se quede colgada: cerrar el
# navegador (si responde) y ejecutar este script desde el escritorio.

echo "=== Reiniciando servicios del PPE ==="
echo ""
echo "[1/3] Backend..."
pm2 restart ppe-backend
sleep 5

echo ""
echo "[2/3] Frontend..."
pm2 restart ppe-frontend
sleep 3

echo ""
echo "[3/3] Navegador..."
pm2 restart abrir-navegador

echo ""
echo "=== Listo. La pantalla de pago deberia aparecer en unos segundos. ==="
echo ""
read -p 'Presione Enter para cerrar esta ventana...'
