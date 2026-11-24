/**
 * df-decode — Persistencia Local (Autoguardado en localStorage) y Enlaces Compartibles (#dfx=...)
 *
 * Funcionalidades:
 * 1. Codificación/Decodificación URL-Safe (Base64URL UTF-8 compacto) para compartir cualquier
 *    diagrama mediante un enlace directo sin necesidad de backend.
 * 2. Autoguardado automático en localStorage (proyecto activo, nombre de archivo y tema visual)
 *    para recuperar el trabajo si se cierra la pestaña o el navegador.
 */

(function (global) {
  'use strict';

  const STORAGE_KEY_PROJECT = 'dfdecode_autosave_v1';
  const STORAGE_KEY_META = 'dfdecode_meta_v1';

  /**
   * Convierte una cadena UTF-8 a Base64URL seguro para hashes de URL
   */
  function encodeUTF8ToBase64Url(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Decodifica una cadena Base64URL de vuelta a UTF-8
   */
  function decodeBase64UrlToUTF8(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
      b64 += '=';
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  /**
   * Empaqueta un proyecto DFX en un token compacto para URL
   */
  function encodeProjectToShareToken(project, fileName = 'Compartido.dfx') {
    const minPayload = {
      f: fileName,
      d: project.anglesInDegrees !== false ? 1 : 0,
      s: project.sheets
    };
    const json = JSON.stringify(minPayload);
    return encodeUTF8ToBase64Url(json);
  }

  /**
   * Reconstruye un proyecto DFX desde un token de URL
   */
  function decodeProjectFromShareToken(token) {
    const json = decodeBase64UrlToUTF8(token.trim());
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.s) || data.s.length === 0) {
      throw new Error('El enlace compartido no contiene un diagrama válido.');
    }
    return {
      fileName: data.f || 'Compartido.dfx',
      project: {
        format: 'DFX',
        version: '1.0',
        anglesInDegrees: data.d !== 0,
        activeSheetIndex: 0,
        sheets: data.s
      }
    };
  }

  /**
   * Genera la URL completa para compartir a partir de la ubicación actual
   */
  function buildShareableURL(project, fileName, baseHref) {
    const token = encodeProjectToShareToken(project, fileName);
    const base = (baseHref || (global.location ? global.location.href : '')).split('#')[0];
    return `${base}#dfx=${token}`;
  }

  /**
   * Extrae el proyecto si la URL actual contiene `#dfx=...` o retrocompatible `#dfdx=...`
   */
  function extractProjectFromHash(hashStr) {
    const h = (hashStr || '').replace(/^#/, '');
    let token = '';
    if (h.startsWith('dfx=')) {
      token = h.slice(4);
    } else if (h.startsWith('dfdx=')) {
      token = h.slice(5);
    } else {
      return null;
    }
    if (!token) return null;
    return decodeProjectFromShareToken(token);
  }

  /**
   * Guarda el estado actual en localStorage
   */
  function saveAutosave(project, fileName, theme) {
    try {
      if (!global.localStorage) return false;
      const serializer = (global.DFDFormat && global.DFDFormat.serializeDFX) || (global.DFDFormat && global.DFDFormat.serializeDFDX);
      const serialized = serializer(project);
      global.localStorage.setItem(STORAGE_KEY_PROJECT, serialized);
      global.localStorage.setItem(
        STORAGE_KEY_META,
        JSON.stringify({
          fileName: fileName || 'Sin_titulo.dfx',
          theme: theme || 'modern-dark',
          updatedAt: new Date().toISOString()
        })
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Recupera el autoguardado desde localStorage si existe
   */
  function loadAutosave() {
    try {
      if (!global.localStorage) return null;
      let rawProj = global.localStorage.getItem(STORAGE_KEY_PROJECT);
      let rawMeta = global.localStorage.getItem(STORAGE_KEY_META);

      // Migración suave si existía guardado previo con claves anteriores
      if (!rawProj) {
        rawProj = global.localStorage.getItem('decod_autosave_v1') || global.localStorage.getItem('decodeflow_autosave_v1') || global.localStorage.getItem('dfx_studio_autosave_v2') || global.localStorage.getItem('dfdx_studio_autosave_v2');
        rawMeta = global.localStorage.getItem('decod_meta_v1') || global.localStorage.getItem('decodeflow_meta_v1') || global.localStorage.getItem('dfx_studio_meta_v2') || global.localStorage.getItem('dfdx_studio_meta_v2');
      }

      if (!rawProj) return null;
      const parser = (global.DFDFormat && global.DFDFormat.parseDFX) || (global.DFDFormat && global.DFDFormat.parseDFDX);
      const project = parser(rawProj);
      let meta = { fileName: 'Sin_titulo.dfx', theme: 'modern-dark', updatedAt: null };
      if (rawMeta) {
        meta = Object.assign(meta, JSON.parse(rawMeta));
      }
      return {
        project,
        fileName: meta.fileName,
        theme: meta.theme,
        updatedAt: meta.updatedAt
      };
    } catch (_) {
      return null;
    }
  }

  function clearAutosave() {
    try {
      if (!global.localStorage) return;
      global.localStorage.removeItem(STORAGE_KEY_PROJECT);
      global.localStorage.removeItem(STORAGE_KEY_META);
    } catch (_) {}
  }

  global.DFDStorage = {
    encodeUTF8ToBase64Url,
    decodeBase64UrlToUTF8,
    encodeProjectToShareToken,
    decodeProjectFromShareToken,
    buildShareableURL,
    extractProjectFromHash,
    saveAutosave,
    loadAutosave,
    clearAutosave
  };
})(typeof window !== 'undefined' ? window : global);
