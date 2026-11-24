/**
 * df-decode v1.0 — Serialización e Interoperabilidad de Archivos (.dfx, .dfdx y .dfd clásico)
 *
 * Implementación original desarrollada desde cero e inspirada en el clásico software DFD:
 * - Cabecera de interoperabilidad: "\x04 Dfd \x02\x08(c)" (o variante en texto plano "Dfd" + "(c)")
 * - Códigos de ObjetoEjecucion:
 *   0 = INICIO
 *   1 = FIN
 *   2 = SUBPROGRAMA
 *   3 = REGRESE
 *   4 = IMPRESION
 *   5 = LECTURA
 *   6 = ASIGNACION
 *   7 = DECISION
 *   8 = CICLOPARA
 *   9 = CICLOMIENTRAS
 *   10 = CIERREPARA
 *   11 = CIERREMIENTRAS
 *   12 = LLAMADA
 *   13 = PUNTO (cierre de rama de DECISION)
 */

(function (global) {
  'use strict';

  const {
    createEmptyProject,
    createMainSheet,
    createSubprogramSheet,
    createNode
  } = global.DFDModel;

  const TIPO = {
    INICIO: 0,
    FIN: 1,
    SUBPROGRAMA: 2,
    REGRESE: 3,
    IMPRESION: 4,
    LECTURA: 5,
    ASIGNACION: 6,
    DECISION: 7,
    CICLOPARA: 8,
    CICLOMIENTRAS: 9,
    CIERREPARA: 10,
    CIERREMIENTRAS: 11,
    LLAMADA: 12,
    PUNTO: 13
  };

  /**
   * Exporta el proyecto actual a formato nativo .dfx (JSON estructurado)
   */
  function serializeDFX(project) {
    const payload = {
      format: 'DFX',
      version: '1.0',
      savedAt: new Date().toISOString(),
      anglesInDegrees: Boolean(project.anglesInDegrees),
      activeSheetIndex: project.activeSheetIndex || 0,
      sheets: project.sheets
    };
    return JSON.stringify(payload, null, 2);
  }

  // Alias para retrocompatibilidad
  const serializeDFDX = serializeDFX;

  /**
   * Importa un archivo .dfx (o .dfdx heredado)
   */
  function parseDFX(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data || !Array.isArray(data.sheets) || data.sheets.length === 0) {
      throw new Error('El archivo .dfx no contiene hojas de diagrama válidas.');
    }
    return {
      format: 'DFX',
      version: data.version || '1.0',
      anglesInDegrees: data.anglesInDegrees !== false,
      activeSheetIndex: Math.min(data.activeSheetIndex || 0, data.sheets.length - 1),
      sheets: data.sheets
    };
  }

  // Alias para retrocompatibilidad
  const parseDFDX = parseDFX;

  /**
   * Exporta el proyecto actual al formato clásico compatible con DFD (.dfd)
   */
  function serializeClassicDFD(project) {
    const lines = [];
    // Cabecera mágica de compatibilidad con formato .dfd clásico
    lines.push('\x04 Dfd \x02\x08(c)');
    lines.push('1'); // Versión = 1
    lines.push(project.anglesInDegrees ? '1' : '0');
    lines.push(String(project.sheets.length));

    function writeOptionalString(str) {
      const s = (str || '').replace(/\r?\n/g, ' ');
      if (s.length > 0) {
        lines.push('1');
        lines.push(String(s.length));
        lines.push(s);
      } else {
        lines.push('0');
      }
    }

    function writeSequence(nodeList) {
      for (const node of nodeList) {
        switch (node.type) {
          case 'IMPRESION':
            lines.push(String(TIPO.IMPRESION));
            writeOptionalString(node.text);
            break;

          case 'LECTURA':
            lines.push(String(TIPO.LECTURA));
            writeOptionalString(node.text);
            break;

          case 'ASIGNACION': {
            lines.push(String(TIPO.ASIGNACION));
            const validAssigns = (node.assignments || []).filter(
              a => (a.target || '').trim() !== '' || (a.expr || '').trim() !== ''
            );
            lines.push(String(validAssigns.length));
            for (const a of validAssigns) {
              const dst = (a.target || '').trim();
              const src = (a.expr || '').trim();
              lines.push(String(dst.length));
              lines.push(dst);
              lines.push(String(src.length));
              lines.push(src);
            }
            break;
          }

          case 'DECISION':
            lines.push(String(TIPO.DECISION));
            lines.push(node.yesLeft ? '1' : '0');
            writeOptionalString(node.condition);
            writeSequence(node.yesBranch || []);
            lines.push(String(TIPO.PUNTO));
            writeSequence(node.noBranch || []);
            lines.push(String(TIPO.PUNTO));
            break;

          case 'CICLOPARA':
            lines.push(String(TIPO.CICLOPARA));
            writeOptionalString(node.counter);
            writeOptionalString(node.start);
            writeOptionalString(node.end);
            writeOptionalString(node.step);
            writeSequence(node.body || []);
            lines.push(String(TIPO.CIERREPARA));
            break;

          case 'CICLOMIENTRAS':
            lines.push(String(TIPO.CICLOMIENTRAS));
            writeOptionalString(node.condition);
            writeSequence(node.body || []);
            lines.push(String(TIPO.CIERREMIENTRAS));
            break;

          case 'LLAMADA':
            lines.push(String(TIPO.LLAMADA));
            writeOptionalString(node.subName);
            writeOptionalString(node.args);
            break;
        }
      }
    }

    for (const sheet of project.sheets) {
      if (sheet.isMain) {
        lines.push(String(TIPO.INICIO));
        writeOptionalString(sheet.description);
        writeSequence(sheet.body || []);
        lines.push(String(TIPO.FIN));
      } else {
        lines.push(String(TIPO.SUBPROGRAMA));
        writeOptionalString(sheet.name);
        writeOptionalString(sheet.params);
        writeOptionalString(sheet.description);
        writeSequence(sheet.body || []);
        lines.push(String(TIPO.REGRESE));
      }
    }

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Parsea un archivo clásico `.dfd` de DFD y lo convierte al árbol de df-decode
   */
  function parseClassicDFD(rawText) {
    // Normalizar saltos de línea a \n
    const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let lineIdx = 0;

    function nextLineTrimmed() {
      while (lineIdx < lines.length) {
        const l = lines[lineIdx++].trim();
        if (l !== '') return l;
      }
      return null;
    }

    function nextInt() {
      const val = nextLineTrimmed();
      if (val === null) throw new Error('Fin de archivo inesperado leyendo entero en .dfd');
      const n = parseInt(val, 10);
      if (Number.isNaN(n)) throw new Error(`Se esperaba número entero y se encontró: "${val}"`);
      return n;
    }

    function readLengthPrefixedString() {
      const len = nextInt();
      if (lineIdx >= lines.length) return '';
      // En DFD clásico, la cadena está en la línea siguiente tras el largo
      const rawLine = lines[lineIdx++];
      return rawLine.substring(0, len);
    }

    function readOptionalString() {
      const flag = nextInt();
      if (flag === 0) return '';
      return readLengthPrefixedString();
    }

    // Verificar primera línea de cabecera ("Dfd" y "(c)")
    const header = lines[lineIdx++] || '';
    if (!header.includes('Dfd') || !header.includes('(c)')) {
      throw new Error('El archivo no tiene una cabecera válida de DFD clásico.');
    }

    const version = nextInt(); // usualmente 1
    const anglesFlag = nextInt(); // 1 = Grados, 0 = Radianes
    const numSheets = nextInt();

    const project = createEmptyProject();
    project.version = String(version);
    project.anglesInDegrees = anglesFlag === 1;
    project.sheets = [];

    function readSequenceUntil(stopTypes) {
      const list = [];
      while (lineIdx < lines.length) {
        const tipo = nextInt();
        if (stopTypes.includes(tipo)) {
          return { list, stoppedBy: tipo };
        }

        switch (tipo) {
          case TIPO.IMPRESION: {
            const text = readOptionalString();
            list.push(createNode('IMPRESION', { text }));
            break;
          }
          case TIPO.LECTURA: {
            const text = readOptionalString();
            list.push(createNode('LECTURA', { text }));
            break;
          }
          case TIPO.ASIGNACION: {
            const count = nextInt();
            const assignments = [];
            for (let i = 0; i < count; i++) {
              const target = readLengthPrefixedString();
              const expr = readLengthPrefixedString();
              assignments.push({ target, expr });
            }
            if (assignments.length === 0) {
              assignments.push({ target: '', expr: '' });
            }
            list.push(createNode('ASIGNACION', { assignments }));
            break;
          }
          case TIPO.DECISION: {
            const yesLeft = nextInt() === 1;
            const condition = readOptionalString();
            const yesBranchRes = readSequenceUntil([TIPO.PUNTO]);
            const noBranchRes = readSequenceUntil([TIPO.PUNTO]);
            list.push(
              createNode('DECISION', {
                yesLeft,
                condition,
                yesBranch: yesBranchRes.list,
                noBranch: noBranchRes.list
              })
            );
            break;
          }
          case TIPO.CICLOPARA: {
            const counter = readOptionalString();
            const start = readOptionalString();
            const end = readOptionalString();
            const step = readOptionalString();
            const bodyRes = readSequenceUntil([TIPO.CIERREPARA]);
            list.push(
              createNode('CICLOPARA', {
                counter,
                start,
                end,
                step,
                body: bodyRes.list
              })
            );
            break;
          }
          case TIPO.CICLOMIENTRAS: {
            const condition = readOptionalString();
            const bodyRes = readSequenceUntil([TIPO.CIERREMIENTRAS]);
            list.push(
              createNode('CICLOMIENTRAS', {
                condition,
                body: bodyRes.list
              })
            );
            break;
          }
          case TIPO.LLAMADA: {
            const subName = readOptionalString();
            const args = readOptionalString();
            list.push(createNode('LLAMADA', { subName, args }));
            break;
          }
          default:
            throw new Error(`Código de objeto DFD desconocido (${tipo}).`);
        }
      }
      return { list, stoppedBy: null };
    }

    for (let s = 0; s < numSheets; s++) {
      const rootType = nextInt();
      if (rootType === TIPO.INICIO) {
        const desc = readOptionalString();
        const sheet = createMainSheet(desc);
        const seq = readSequenceUntil([TIPO.FIN]);
        sheet.body = seq.list;
        project.sheets.push(sheet);
      } else if (rootType === TIPO.SUBPROGRAMA) {
        const name = readOptionalString() || `Subprograma${s}`;
        const params = readOptionalString();
        const desc = readOptionalString();
        const sheet = createSubprogramSheet(name, params, desc);
        const seq = readSequenceUntil([TIPO.REGRESE]);
        sheet.body = seq.list;
        project.sheets.push(sheet);
      } else {
        throw new Error(`Tipo de inicio de hoja inesperado en .dfd: ${rootType}`);
      }
    }

    if (project.sheets.length === 0) {
      project.sheets.push(createMainSheet());
    }
    return project;
  }

  /**
   * Detecta automáticamente si un contenido es JSON (.dfx / .dfdx) o formato clásico (.dfd)
   */
  function loadAnyDFDFile(content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      return parseDFX(trimmed);
    }
    return parseClassicDFD(content);
  }

  /**
   * Convierte el texto del DFD clásico a bytes Latin-1 (compatible con el formato .dfd clásico).
   * Los caracteres fuera de Latin-1 se sustituyen por '?' conservando la longitud de la cadena.
   */
  function encodeClassicDFDBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[i] = code <= 0xff ? code : 0x3f;
    }
    return bytes;
  }

  /**
   * Decodifica los bytes de un archivo cargado. JSON (.dfx) siempre es UTF-8; el .dfd clásico se
   * intenta como UTF-8 estricto (archivos guardados por versiones anteriores) y, si no es válido,
   * como Windows-1252 / Latin-1.
   */
  function decodeFileBytes(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
    const body = start ? bytes.subarray(start) : bytes;

    let firstChar = '';
    for (let i = 0; i < body.length; i++) {
      if (body[i] > 0x20) { firstChar = String.fromCharCode(body[i]); break; }
    }
    if (firstChar === '{') return new TextDecoder('utf-8').decode(body);

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (_) {
      return new TextDecoder('windows-1252').decode(body);
    }
  }

  global.DFDFormat = {
    encodeClassicDFDBytes,
    decodeFileBytes,
    serializeDFX,
    parseDFX,
    serializeDFDX,
    parseDFDX,
    serializeClassicDFD,
    parseClassicDFD,
    loadAnyDFDFile
  };
})(window);
