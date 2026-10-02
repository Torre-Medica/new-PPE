#!/usr/bin/env bash
set -euo pipefail

app_dir="$HOME/Desktop/new-PPE"
app_url="http://127.0.0.1:5173"
log_file="$HOME/.cache/ppe-kiosk.log"

mkdir -p "$(dirname "$log_file")"
exec >>"$log_file" 2>&1
echo "=== $(date '+%F %T') inicio kiosko"

# El autostart de GNOME no carga ~/.bashrc, asi que node/pm2 (instalados con nvm)
# no estan en el PATH. Sin esto el script moria con "node: command not found".
export NVM_DIR="$HOME/.nvm"
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$NVM_DIR/nvm.sh" ]; then
  set +u
  . "$NVM_DIR/nvm.sh"
  set -u
fi
pm2_bin="$(command -v pm2)"

cd "$app_dir"

if ! "$pm2_bin" jlist | node -e '
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const names = new Set(["ppe-backend", "ppe-frontend"]);
  const apps = JSON.parse(input).filter((app) => names.has(app.name));
  process.exit(apps.length === 2 && apps.every((app) => app.pm2_env.status === "online") ? 0 : 1);
});
'; then
  echo "ppe-backend/ppe-frontend no estan online; arrancando con pm2"
  "$pm2_bin" startOrRestart "$app_dir/ecosystem.config.js"
fi

for attempt in $(seq 1 60); do
  if curl --fail --silent "$app_url" >/dev/null 2>&1; then
    echo "frontend disponible (intento $attempt); abriendo Firefox en modo kiosko"
    exec /usr/bin/firefox --kiosk "$app_url"
  fi
  sleep 2
done

printf 'PPE frontend did not become available at %s\n' "$app_url" >&2
exit 1
