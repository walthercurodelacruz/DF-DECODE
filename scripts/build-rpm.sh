#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="df-decode"
APP_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
UNPACKED_DIR="$ROOT_DIR/dist/linux-unpacked"
OUT_RPM="$ROOT_DIR/dist/${APP_NAME}-${APP_VERSION}.x86_64.rpm"

if [ ! -d "$UNPACKED_DIR" ] || [ ! -f "$UNPACKED_DIR/$APP_NAME" ]; then
  echo "Generating unpacked Linux build first..."
  (cd "$ROOT_DIR" && npx electron-builder --linux dir)
fi

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "Error: 'rpmbuild' is not installed. Install 'rpm-build' (Fedora/RHEL) or 'rpm' (Debian/Ubuntu)." >&2
  exit 1
fi

TMP_TOPDIR="$(mktemp -d)"
trap 'rm -rf "$TMP_TOPDIR"' EXIT

mkdir -p "$TMP_TOPDIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

cat > "$TMP_TOPDIR/SPECS/${APP_NAME}.spec" << EOF
%global _build_id_links none
%global debug_package %{nil}
%global __strip /bin/true
%global __os_install_post %{nil}

Name:           ${APP_NAME}
Version:        ${APP_VERSION}
Release:        1
Summary:        Editor e Intérprete de Diagramas de Flujo de Datos v1.0 (Inspirado en DFD)
License:        GPL-3.0-only
URL:            https://github.com/walthercurodelacruz/DF-DECODE
Group:          Applications/Engineering
BuildArch:      x86_64
AutoReqProv:    no
Requires:       gtk3, libnotify, nss, libXScrnSaver, (libXtst or libXtst6), xdg-utils, at-spi2-core, (libuuid or libuuid1), libsecret

%description
df-decode v1.0 es una implementación original desde cero, inspirada en el clásico
software educativo DFD, para el diseño, ejecución paso a paso y depuración de algoritmos
en diagramas de flujo.

%install
mkdir -p %{buildroot}/opt/${APP_NAME}
cp -a "${UNPACKED_DIR}/." %{buildroot}/opt/${APP_NAME}/

mkdir -p %{buildroot}/usr/share/icons/hicolor/512x512/apps
cp -a "${ROOT_DIR}/assets/icon-512.png" %{buildroot}/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png

mkdir -p %{buildroot}/usr/share/applications
cat > %{buildroot}/usr/share/applications/${APP_NAME}.desktop << 'DESKTOP_EOF'
[Desktop Entry]
Name=df-decode
Exec=/opt/df-decode/df-decode --no-sandbox %U
Terminal=false
Type=Application
Icon=df-decode
StartupWMClass=df-decode
Comment=df-decode es una herramienta moderna compatible con DFD para el diseño, ejecución paso a paso y depuración de algoritmos en diagramas de flujo.
MimeType=application/x-dfx;application/x-dfd;application/x-dfdx;
Categories=Education;Development;
DESKTOP_EOF

mkdir -p %{buildroot}/usr/share/mime/packages
cat > %{buildroot}/usr/share/mime/packages/${APP_NAME}.xml << 'MIME_EOF'
<?xml version="1.0" encoding="utf-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
<mime-type type="application/x-dfx">
  <glob pattern="*.dfx"/>
  <comment>Archivo de diagrama de flujo de datos df-decode</comment>
  <icon name="x-office-document" />
</mime-type>
<mime-type type="application/x-dfd">
  <glob pattern="*.dfd"/>
  <comment>Archivo de diagrama de flujo clásico DFD</comment>
  <icon name="x-office-document" />
</mime-type>
<mime-type type="application/x-dfdx">
  <glob pattern="*.dfdx"/>
  <comment>Archivo de diagrama df-decode formato JSON</comment>
  <icon name="x-office-document" />
</mime-type>
</mime-info>
MIME_EOF

%post
cat > '/usr/bin/df-decode' << 'WRAPPER_EOF'
#!/bin/bash
exec /opt/df-decode/df-decode --no-sandbox "\$@"
WRAPPER_EOF
chmod 0755 '/usr/bin/df-decode'
ln -sf '/usr/bin/df-decode' '/usr/bin/decod' 2>/dev/null || true

if [ -f '/opt/df-decode/chrome-sandbox' ]; then
  chown root:root '/opt/df-decode/chrome-sandbox' 2>/dev/null || true
  chmod 4755 '/opt/df-decode/chrome-sandbox' 2>/dev/null || true
fi

if [ -d "/etc/apparmor.d" ]; then
  cat > /etc/apparmor.d/df-decode << 'AA_EOF'
abi <abi/5.0>,
include <tunables/global>

profile df-decode /opt/df-decode/df-decode flags=(unconfined) {
  userns,
  @{exec_path} mr,

  include if exists <local/df-decode>
}
AA_EOF
  chmod 0644 /etc/apparmor.d/df-decode 2>/dev/null || true
  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -r /etc/apparmor.d/df-decode 2>/dev/null || true
  fi
fi

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

%postun
if [ "\$1" = "0" ]; then
  if [ -f "/etc/apparmor.d/df-decode" ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser -R /etc/apparmor.d/df-decode 2>/dev/null || true
    fi
    rm -f "/etc/apparmor.d/df-decode" 2>/dev/null || true
  fi
  rm -f '/usr/bin/df-decode' 2>/dev/null || true
  rm -f '/usr/bin/decod' 2>/dev/null || true
  if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
  fi
  if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
  fi
fi

%files
%defattr(-,root,root,-)
/opt/${APP_NAME}
/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png
/usr/share/applications/${APP_NAME}.desktop
/usr/share/mime/packages/${APP_NAME}.xml
EOF

rpmbuild -bb \
  --define "_topdir $TMP_TOPDIR" \
  --define "_binary_payload w6.xzdio" \
  "$TMP_TOPDIR/SPECS/${APP_NAME}.spec"

BUILT_RPM="$(find "$TMP_TOPDIR/RPMS" -name '*.rpm' | head -n 1)"
if [ -z "$BUILT_RPM" ] || [ ! -f "$BUILT_RPM" ]; then
  echo "Error: RPM build completed but no .rpm file was found." >&2
  exit 1
fi

cp -f "$BUILT_RPM" "$OUT_RPM"
echo "Generated RPM: $OUT_RPM"
