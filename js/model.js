/**
 * df-decode — Modelo Estructural del Diagrama (Árbol Jerárquico de Hojas y Objetos DFD)
 *
 * Tipos de Objetos soportados (idénticos al DFD clásico):
 * - INICIO (en hoja Principal) / SUBPROGRAMA (en hojas secundarias)
 * - FIN (en hoja Principal) / REGRESE (en hojas secundarias)
 * - ASIGNACION: hasta N asignaciones [{ target, expr }, ...]
 * - LECTURA: cadena de variables separadas por coma "a, b, V(i)"
 * - IMPRESION: cadena de expresiones separadas por coma "'Resultado: ', x"
 * - DECISION: condition, yesLeft (boolean: true = Sí a la izquierda, false = Sí a la derecha), yesBranch: [], noBranch: []
 * - CICLOMIENTRAS: condition, body: []
 * - CICLOPARA: id (contador), start, end, step, body: []
 * - LLAMADA: subName, args
 */

(function (global) {
  'use strict';

  let idCounter = 1;

  function generateId(prefix = 'node') {
    return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
  }

  function createEmptyProject() {
    return {
      format: 'DFX',
      version: '1.0',
      anglesInDegrees: true,
      activeSheetIndex: 0,
      sheets: [
        createMainSheet()
      ]
    };
  }

  function createMainSheet(description = '') {
    return {
      id: generateId('sheet'),
      isMain: true,
      name: 'Principal',
      params: '',
      description: description || 'Algoritmo principal',
      startId: generateId('inicio'),
      endId: generateId('fin'),
      body: []
    };
  }

  function createSubprogramSheet(name = 'Subprograma1', params = '', description = '') {
    return {
      id: generateId('sheet'),
      isMain: false,
      name,
      params,
      description,
      startId: generateId('sub'),
      endId: generateId('regrese'),
      body: []
    };
  }

  function createNode(type, props = {}) {
    const id = props.id || generateId(type.toLowerCase());
    switch (type) {
      case 'ASIGNACION':
        return {
          id,
          type: 'ASIGNACION',
          assignments: props.assignments || [
            { target: '', expr: '' }
          ]
        };
      case 'LECTURA':
        return {
          id,
          type: 'LECTURA',
          text: props.text !== undefined ? props.text : ''
        };
      case 'IMPRESION':
        return {
          id,
          type: 'IMPRESION',
          text: props.text !== undefined ? props.text : ''
        };
      case 'DECISION':
        return {
          id,
          type: 'DECISION',
          condition: props.condition !== undefined ? props.condition : '',
          yesLeft: props.yesLeft !== undefined ? Boolean(props.yesLeft) : false,
          yesBranch: props.yesBranch || [],
          noBranch: props.noBranch || [],
          closeId: props.closeId || generateId('punto')
        };
      case 'CICLOMIENTRAS':
        return {
          id,
          type: 'CICLOMIENTRAS',
          condition: props.condition !== undefined ? props.condition : '',
          body: props.body || [],
          closeId: props.closeId || generateId('fin_mq')
        };
      case 'CICLOPARA':
        return {
          id,
          type: 'CICLOPARA',
          counter: props.counter !== undefined ? props.counter : 'i',
          start: props.start !== undefined ? props.start : '1',
          end: props.end !== undefined ? props.end : '10',
          step: props.step !== undefined ? props.step : '1',
          body: props.body || [],
          closeId: props.closeId || generateId('fin_para')
        };
      case 'LLAMADA':
        return {
          id,
          type: 'LLAMADA',
          subName: props.subName !== undefined ? props.subName : '',
          args: props.args !== undefined ? props.args : ''
        };
      default:
        throw new Error(`Tipo de bloque desconocido: ${type}`);
    }
  }

  /**
   * Duplica profundamente un nodo regenerando todos los IDs internos
   */
  function cloneNodeWithNewIds(node) {
    const copy = JSON.parse(JSON.stringify(node));
    function reId(n) {
      n.id = generateId(n.type.toLowerCase());
      if (n.closeId) n.closeId = generateId('close');
      if (n.body) n.body.forEach(reId);
      if (n.yesBranch) n.yesBranch.forEach(reId);
      if (n.noBranch) n.noBranch.forEach(reId);
    }
    reId(copy);
    return copy;
  }

  /**
   * Busca un nodo por ID dentro de una hoja (incluyendo nodos virtuales Inicio/Fin/Cierres)
   */
  function findNodeInSheet(sheet, nodeId) {
    if (sheet.startId === nodeId) {
      return {
        node: {
          id: sheet.startId,
          type: sheet.isMain ? 'INICIO' : 'SUBPROGRAMA',
          sheetRef: sheet
        },
        parentList: null,
        index: -1
      };
    }
    if (sheet.endId === nodeId) {
      return {
        node: {
          id: sheet.endId,
          type: sheet.isMain ? 'FIN' : 'REGRESE',
          sheetRef: sheet
        },
        parentList: null,
        index: -1
      };
    }

    function searchList(list) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.id === nodeId) {
          return { node: item, parentList: list, index: i };
        }
        if (item.closeId === nodeId) {
          return {
            node: { id: item.closeId, type: 'CIERRE', owner: item },
            parentList: list,
            index: i
          };
        }
        if (item.body) {
          const found = searchList(item.body);
          if (found) return found;
        }
        if (item.yesBranch) {
          const found = searchList(item.yesBranch);
          if (found) return found;
        }
        if (item.noBranch) {
          const found = searchList(item.noBranch);
          if (found) return found;
        }
      }
      return null;
    }

    return searchList(sheet.body);
  }

  /**
   * Inserta un nodo en una lista contenedora dada una ruta de contenedor e índice
   * containerPath es una referencia resuelta mediante resolveContainerList(sheet, pathId)
   */
  function resolveContainerList(sheet, containerId) {
    if (containerId === 'ROOT') return sheet.body;

    function walk(list) {
      for (const item of list) {
        if (item.id === containerId && item.body) return item.body;
        if (`${item.id}:YES` === containerId && item.yesBranch) return item.yesBranch;
        if (`${item.id}:NO` === containerId && item.noBranch) return item.noBranch;

        if (item.body) {
          const r = walk(item.body);
          if (r) return r;
        }
        if (item.yesBranch) {
          const r = walk(item.yesBranch);
          if (r) return r;
        }
        if (item.noBranch) {
          const r = walk(item.noBranch);
          if (r) return r;
        }
      }
      return null;
    }

    return walk(sheet.body);
  }

  function insertNodeAt(sheet, containerId, index, newNode) {
    const list = resolveContainerList(sheet, containerId);
    if (!list) return false;
    const safeIdx = Math.max(0, Math.min(index, list.length));
    list.splice(safeIdx, 0, newNode);
    return true;
  }

  function deleteNodeById(sheet, nodeId) {
    const found = findNodeInSheet(sheet, nodeId);
    if (!found || !found.parentList) return false;
    if (found.node.type === 'CIERRE') return false;
    found.parentList.splice(found.index, 1);
    return true;
  }

  function countNodesInSheet(sheet) {
    let count = 2; // Inicio + Fin
    function walk(list) {
      for (const n of list) {
        count++;
        if (n.body) walk(n.body);
        if (n.yesBranch) walk(n.yesBranch);
        if (n.noBranch) walk(n.noBranch);
      }
    }
    walk(sheet.body);
    return count;
  }

  global.DFDModel = {
    generateId,
    createEmptyProject,
    createMainSheet,
    createSubprogramSheet,
    createNode,
    cloneNodeWithNewIds,
    findNodeInSheet,
    resolveContainerList,
    insertNodeAt,
    deleteNodeById,
    countNodesInSheet
  };
})(window);
