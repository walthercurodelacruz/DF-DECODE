/**
 * df-decode v1.0 — Script Multiplataforma de Empaquetado para Windows (.exe / .zip)
 *
 * Asegura compatibilidad completa al compilar el instalador de Windows (.exe) tanto:
 * 1. Nativamente desde Windows (incrustando icono .ico y metadatos con rcedit + NSIS de electron-builder).
 * 2. Desde Linux (detectando si Wine o makensis están disponibles y aplicando fallback seguro).
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const EB_CLI = path.join(ROOT_DIR, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

function commandExists(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function runNodeScript(scriptPath, args = []) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
  return res.status === 0;
}

function main() {
  if (!fs.existsSync(EB_CLI)) {
    console.error('Error: electron-builder no está instalado. Ejecuta "npm install" primero.');
    process.exit(1);
  }

  // Determinar targets solicitados (por defecto: nsis para generar el instalador .exe)
  const extraTargets = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  const targets = extraTargets.length > 0 ? extraTargets : ['nsis'];

  const isWin = process.platform === 'win32';
  const hasWine = !isWin && commandExists('wine');

  const ebArgs = ['--win', ...targets];

  // En Linux sin Wine, desactivar signAndEditExecutable evita que falle al invocar rcedit vía Wine
  if (!isWin && !hasWine) {
    ebArgs.push('-c.win.signAndEditExecutable=false');
  }

  console.log(`[df-decode] Generando instalador Windows (${targets.join(', ')}) en plataforma ${process.platform}...`);
  const ok = runNodeScript(EB_CLI, ebArgs);

  if (ok) {
    console.log('[df-decode] Instalador Windows generado correctamente en ./dist/');
    process.exit(0);
  }

  // Fallback para entornos Linux que usan makensis del sistema con scripts/installer.nsi
  if (!isWin && commandExists('makensis')) {
    console.log('[df-decode] Intentando fallback con directorio desempaquetado + makensis...');
    const dirOk = runNodeScript(EB_CLI, ['--win', 'dir', '-c.win.signAndEditExecutable=false']);
    if (dirOk) {
      const nsisRes = spawnSync('makensis', ['installer.nsi'], {
        cwd: path.join(ROOT_DIR, 'scripts'),
        stdio: 'inherit'
      });
      if (nsisRes.status === 0) {
        console.log('[df-decode] Instalador Windows generado con éxito vía makensis en ./dist/');
        process.exit(0);
      }
    }
  }

  console.error('[df-decode] Error al generar el instalador de Windows.');
  process.exit(1);
}

main();
