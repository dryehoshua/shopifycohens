#!/bin/zsh
set -euo pipefail

APP_NAME="Cohen's Nekudot NFC"
BASE_URL="https://cohens-operations-production.up.railway.app"
NODE_RELEASE_URL="https://nodejs.org/download/release/latest-v22.x"
CURRENT_USER="$(id -un)"
USER_HOME="$(dscl . -read "/Users/${CURRENT_USER}" NFSHomeDirectory | awk '{print $2}')"
APP_DIR="${USER_HOME}/Library/Application Support/Cohens NFC"
BIN_DIR="${APP_DIR}/bin"
LOG_DIR="${APP_DIR}/logs"
LAUNCH_AGENT_DIR="${USER_HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENT_DIR}/com.cohens.nekudot-nfc.plist"
TEMP_DIR="$(mktemp -d -t cohens-nfc.XXXXXX)"

cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "${TEMP_DIR}" && "${TEMP_DIR:t}" == cohens-nfc.* ]]; then
    rm -rf -- "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

print ""
print "============================================================"
print "  ${APP_NAME} · Instalación automática"
print "============================================================"
print ""

if [[ "$(uname -s)" != "Darwin" ]]; then
  print "Este instalador es únicamente para macOS."
  read -k 1 "?Presiona una tecla para cerrar…"
  exit 1
fi

case "$(uname -m)" in
  arm64)
    NODE_PLATFORM="darwin-arm64"
    READER_PLATFORM="macos-arm64"
    ;;
  x86_64)
    NODE_PLATFORM="darwin-x64"
    READER_PLATFORM="macos-x64"
    ;;
  *)
    print "Arquitectura no compatible: $(uname -m)"
    read -k 1 "?Presiona una tecla para cerrar…"
    exit 1
    ;;
esac

print "[1/5] Preparando la carpeta local…"
mkdir -p "${BIN_DIR}" "${LOG_DIR}" "${LAUNCH_AGENT_DIR}"

print "[2/5] Descargando el motor seguro desde nodejs.org…"
curl --fail --silent --show-error --location "${NODE_RELEASE_URL}/SHASUMS256.txt" -o "${TEMP_DIR}/SHASUMS256.txt"
NODE_ARCHIVE="$(awk -v platform="${NODE_PLATFORM}" '$2 ~ ("node-v[0-9.]+-" platform "\\.tar\\.gz$") { print $2; exit }' "${TEMP_DIR}/SHASUMS256.txt")"
if [[ -z "${NODE_ARCHIVE}" ]]; then
  print "No se encontró el paquete oficial de Node.js para esta Mac."
  exit 1
fi
curl --fail --silent --show-error --location "${NODE_RELEASE_URL}/${NODE_ARCHIVE}" -o "${TEMP_DIR}/${NODE_ARCHIVE}"
EXPECTED_NODE_SHA="$(awk -v archive="${NODE_ARCHIVE}" '$2 == archive { print $1 }' "${TEMP_DIR}/SHASUMS256.txt")"
ACTUAL_NODE_SHA="$(shasum -a 256 "${TEMP_DIR}/${NODE_ARCHIVE}" | awk '{print $1}')"
if [[ "${EXPECTED_NODE_SHA}" != "${ACTUAL_NODE_SHA}" ]]; then
  print "La verificación de seguridad de Node.js no coincidió. Instalación cancelada."
  exit 1
fi
tar -xzf "${TEMP_DIR}/${NODE_ARCHIVE}" -C "${TEMP_DIR}"
cp "${TEMP_DIR}/${NODE_ARCHIVE%.tar.gz}/bin/node" "${BIN_DIR}/node"

print "[3/5] Instalando el puente y el controlador Cohen's…"
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/dryehoshua/shopifycohens/main/apps/cohen-inventory-entry/scripts/nekudot-nfc-bridge.mjs" \
  -o "${APP_DIR}/nekudot-nfc-bridge.mjs"
curl --fail --silent --show-error --location \
  "${BASE_URL}/downloads/nfc/acr122u-reader-${READER_PLATFORM}" \
  -o "${BIN_DIR}/acr122u-reader"
chmod 700 "${BIN_DIR}/node" "${BIN_DIR}/acr122u-reader"
chmod 600 "${APP_DIR}/nekudot-nfc-bridge.mjs"

print "[4/5] Activando el lector automáticamente al iniciar sesión…"
cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cohens.nekudot-nfc</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DIR}/node</string>
    <string>${APP_DIR}/nekudot-nfc-bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NEKUDOT_NFC_READER_EXECUTABLE</key>
    <string>${BIN_DIR}/acr122u-reader</string>
    <key>NEKUDOT_NFC_ALLOWED_ORIGINS</key>
    <string>${BASE_URL}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/bridge-error.log</string>
</dict>
</plist>
PLIST
plutil -lint "${PLIST_PATH}" >/dev/null
launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl enable "gui/$(id -u)/com.cohens.nekudot-nfc"

print "[5/5] Comprobando el servicio local…"
sleep 2
if curl --fail --silent --max-time 3 "http://127.0.0.1:17812/health" > "${TEMP_DIR}/health.json"; then
  print ""
  print "✓ El puente NFC quedó instalado y activo."
  if grep -q '"readerConnected":true' "${TEMP_DIR}/health.json"; then
    print "✓ El lector ACR122U está conectado y listo."
  else
    print "! El servicio está activo, pero aún no detecta el lector."
    print "  Conecta el USB directamente y, si persiste, instala el driver ACS."
  fi
else
  print ""
  print "! El servicio fue instalado, pero todavía no respondió."
  print "  Abre el módulo Lector NFC en la POS para volver a comprobarlo."
fi

print ""
print "La primera lectura puede pedir permiso para controlar System Events."
print "Selecciona Permitir: es necesario para enviar el UID a la POS segura."
print ""
open "${BASE_URL}/retail-pos" >/dev/null 2>&1 || true
read -k 1 "?Instalación terminada. Presiona una tecla para cerrar…"
print ""
