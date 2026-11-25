/**
 * df-decode v1.0 — Hook afterPack para Windows
 *
 * Permite incrustar el icono (assets/icon.ico) y metadatos de versión en df-decode.exe
 * usando rcedit-x64.exe cuando está disponible en caché local, sin fallar en cuentas
 * de Windows sin privilegios de creación de enlaces simbólicos (winCodeSign darwin symlinks)
 * ni en compilaciones cruzadas desde Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findRceditBinary() {
  if (process.platform !== 'win32') return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const cacheDir = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cacheDir)) return null;

  try {
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(cacheDir, entry.name, 'rcedit-x64.exe');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32' || process.platform !== 'win32') {
    return;
  }

  const exePath = path.join(context.appOutDir, 'df-decode.exe');
  const iconPath = path.resolve(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) {
    return;
  }

  const rcedit = findRceditBinary();
  if (!rcedit) {
    return;
  }

  try {
    spawnSync(
      rcedit,
      [
        exePath,
        '--set-icon', iconPath,
        '--set-version-string', 'ProductName', 'df-decode',
        '--set-version-string', 'FileDescription', 'df-decode v1.0 — Editor e Intérprete de Diagramas de Flujo',
        '--set-version-string', 'CompanyName', 'Walther Curo De La Cruz',
        '--set-version-string', 'LegalCopyright', 'Copyright © 2026 Walther Curo De La Cruz — Licencia GNU GPL v3.0',
        '--set-file-version', '1.0.0',
        '--set-product-version', '1.0.0'
      ],
      { stdio: 'ignore' }
    );
  } catch (_) {
    // Continuar silenciosamente si rcedit no puede ejecutarse
  }
};
