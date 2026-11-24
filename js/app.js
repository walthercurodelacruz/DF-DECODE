/**
 * df-decode — Controlador Principal de la Aplicación Web
 *
 * Conecta:
 * - Gestión de proyecto, hojas (Principal + Subprogramas) e historial Undo/Redo
 * - Paleta de herramientas y puntos de inserción
 * - Modales clásicos de edición para cada tipo de bloque DFD
 * - Ejecución, Paso a paso, Diálogos emergentes de Lectura/Salida y Consola
 * - Inspector en vivo (Tabla de variables, Pila de llamadas, Código generado, Prueba de escritorio)
 * - Importación/Exportación (.dfx, .dfdx, .dfd clásico, SVG, PNG, CSV)
 */

(function (global) {
  'use strict';

  const {
    createEmptyProject,
    createSubprogramSheet,
    createNode,
    cloneNodeWithNewIds,
    findNodeInSheet,
    insertNodeAt,
    deleteNodeById,
    countNodesInSheet
  } = global.DFDModel;

  const {
    SymbolTable,
    evaluateExpression,
    parseUserInputValue,
    formatDFDValueForWatch
  } = global.DFDEvaluator;

  const {
    serializeDFX,
    serializeDFDX,
    serializeClassicDFD,
    loadAnyDFDFile,
    encodeClassicDFDBytes,
    decodeFileBytes
  } = global.DFDFormat;

  const {
    buildShareableURL,
    extractProjectFromHash,
    saveAutosave,
    loadAutosave
  } = global.DFDStorage;

  const { generateCode } = global.DFDCodeGen;
  const { EXAMPLES } = global.DFDExamples;
  const { renderSheetToSVG } = global.DFDRenderer;
  const DFDInterpreter = global.DFDInterpreter;

  // Estado global de la sesión
  const state = {
    fileName: 'Sin_titulo.dfx',
    project: createEmptyProject(),
    isDirty: false,
    undoStack: [],
    redoStack: [],
    activeTool: 'CURSOR', // CURSOR | ASIGNACION | CICLOMIENTRAS | CICLOPARA | DECISION | LECTURA | IMPRESION | LLAMADA
    selectedNodeId: null,
    clipboardNode: null,
    executingNodeId: null,
    errorNodeId: null,
    zoom: 1,
    panX: 0,
    panY: 20,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    diagramBounds: { width: 600, height: 500 }
  };

  // Referencias al DOM
  const dom = {};

  function initDOMRefs() {
    dom.fileNameBadge = document.getElementById('file-name-badge');
    dom.themeSelector = document.getElementById('theme-selector');
    dom.btnUndo = document.getElementById('btn-undo');
    dom.btnRedo = document.getElementById('btn-redo');
    dom.btnRun = document.getElementById('btn-run');
    dom.btnStep = document.getElementById('btn-step');
    dom.btnPause = document.getElementById('btn-pause');
    dom.btnStop = document.getElementById('btn-stop');
    dom.execSpeed = document.getElementById('exec-speed');
    dom.zoomLevelText = document.getElementById('zoom-level-text');
    dom.subprogramTabs = document.getElementById('subprogram-tabs');
    dom.activeToolBanner = document.getElementById('active-tool-banner');
    dom.viewport = document.getElementById('canvas-viewport');
    dom.svgCanvas = document.getElementById('dfd-canvas');
    dom.viewportTransform = document.getElementById('viewport-transform');
    dom.edgesLayer = document.getElementById('edges-layer');
    dom.hotspotsLayer = document.getElementById('insertion-points-layer');
    dom.nodesLayer = document.getElementById('nodes-layer');
    dom.consoleDrawer = document.getElementById('console-drawer');
    dom.consoleOutput = document.getElementById('console-output');
    dom.execStatusPill = document.getElementById('exec-status-pill');
    dom.toggleClassicModals = document.getElementById('toggle-classic-modals');
    dom.resizerConsole = document.getElementById('resizer-console');
    dom.resizerInspector = document.getElementById('resizer-inspector');
    dom.inspectorPanel = document.getElementById('inspector-panel');
    dom.watchTbody = document.getElementById('watch-tbody');
    dom.varCountBadge = document.getElementById('var-count-badge');
    dom.callstackList = document.getElementById('callstack-list');
    dom.quickEvalInput = document.getElementById('quick-eval-input');
    dom.btnQuickEval = document.getElementById('btn-quick-eval');
    dom.quickEvalResult = document.getElementById('quick-eval-result');
    dom.codeLangSelect = document.getElementById('code-lang-select');
    dom.generatedCodeBox = document.getElementById('generated-code-box');
    dom.btnCopyCode = document.getElementById('btn-copy-code');
    dom.traceTbody = document.getElementById('trace-tbody');
    dom.btnExportTrace = document.getElementById('btn-export-trace');
    dom.statusMessage = document.getElementById('status-message');
    dom.statusSubprogram = document.getElementById('status-subprogram');
    dom.statusAngles = document.getElementById('status-angles');
    dom.statusObjects = document.getElementById('status-objects');
    dom.hiddenFileInput = document.getElementById('hidden-file-input');
    dom.modalOverlay = document.getElementById('modal-overlay');
    dom.modalTitle = document.getElementById('modal-title');
    dom.modalBody = document.getElementById('modal-body');
    dom.modalFooter = document.getElementById('modal-footer');
    dom.modalCloseBtn = document.getElementById('modal-close-btn');
    dom.examplesMenuList = document.getElementById('examples-menu-list');
    dom.checkDeg = document.getElementById('check-deg');
    dom.checkRad = document.getElementById('check-rad');
    dom.btnInstallPwa = document.getElementById('btn-install-pwa');
    dom.statusAutosave = document.getElementById('status-autosave');
  }

  // Instancia del Intérprete
  let interpreter = null;

  function initInterpreter() {
    interpreter = new DFDInterpreter({
      getSpeedDelay() {
        const val = Number(dom.execSpeed.value ?? 800);
        if (val >= 1000) return 0; // Modo inmediato (0 ms)
        const factor = (1000 - val) / 1000;
        return Math.round(10 + factor * factor * 590);
      },
      onStateChange(execState) {
        state.executingNodeId = execState.nodeId;
        state.errorNodeId = execState.errorNodeId;

        if (
          typeof execState.sheetIndex === 'number' &&
          execState.sheetIndex >= 0 &&
          execState.sheetIndex < state.project.sheets.length &&
          state.project.activeSheetIndex !== execState.sheetIndex
        ) {
          state.project.activeSheetIndex = execState.sheetIndex;
          renderTabs();
        }

        updateExecutionButtons(execState.status);
        updateInspectorWatch(execState.symbolTable, execState.callStack);
        updateTraceTable(execState.traceLog);
        renderCanvas();
      },
      async requestInput(targetStr) {
        return showRuntimeInputModal(targetStr);
      },
      async displayOutput(outputText) {
        logToConsole(`Salida: ${outputText}`, 'output');
        if (dom.toggleClassicModals && dom.toggleClassicModals.checked) {
          await showRuntimeOutputModal(outputText);
        }
      },
      onFinished(traceLog) {
        logToConsole(`Ejecución finalizada con éxito (${traceLog.length} pasos ejecutados).`, 'success');
        setStatusMessage('La ejecución ha terminado con normalidad.');
      },
      onError(errMsg, nodeId) {
        logToConsole(`Error de ejecución: ${errMsg}`, 'error');
        setStatusMessage(`Error: ${errMsg}`);
        showAlertModal('Error de Ejecución DFD', errMsg, true);
      }
    });
  }

  // =========================================================================
  // GESTIÓN DE HISTORIAL (UNDO / REDO) Y ESTADO DEL PROYECTO
  // =========================================================================
  function getActiveSheet() {
    const idx = Math.min(state.project.activeSheetIndex || 0, state.project.sheets.length - 1);
    state.project.activeSheetIndex = Math.max(0, idx);
    return state.project.sheets[state.project.activeSheetIndex];
  }

  function pushUndoSnapshot() {
    state.undoStack.push(JSON.stringify(state.project));
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
    state.isDirty = true;
    updateUndoRedoButtons();
  }

  function undo() {
    if (state.undoStack.length === 0) return;
    state.redoStack.push(JSON.stringify(state.project));
    const prev = state.undoStack.pop();
    state.project = JSON.parse(prev);
    state.isDirty = true;
    updateUndoRedoButtons();
    refreshAll();
    setStatusMessage('Acción deshecha.');
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    state.undoStack.push(JSON.stringify(state.project));
    const next = state.redoStack.pop();
    state.project = JSON.parse(next);
    state.isDirty = true;
    updateUndoRedoButtons();
    refreshAll();
    setStatusMessage('Acción rehecha.');
  }

  function updateUndoRedoButtons() {
    dom.btnUndo.disabled = state.undoStack.length === 0;
    dom.btnRedo.disabled = state.redoStack.length === 0;
  }

  // =========================================================================
  // RENDERIZADO DEL LIENZO, PESTAÑAS Y PANELES
  // =========================================================================
  function refreshAll() {
    dom.fileNameBadge.textContent = state.fileName;
    renderTabs();
    renderCanvas();
    updateLiveCode();
    updateStatusBar();
    // Autoguardado automático en localStorage
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'modern-dark';
    if (saveAutosave(state.project, state.fileName, currentTheme) && dom.statusAutosave) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      dom.statusAutosave.innerHTML = `<i class="fa-solid fa-cloud-arrow-up" style="color:var(--success);margin-right:4px;"></i> Autoguardado (${hh}:${mm})`;
    }
  }

  function renderTabs() {
    dom.subprogramTabs.innerHTML = '';
    state.project.sheets.forEach((sheet, idx) => {
      const btn = document.createElement('div');
      btn.className = 'sub-tab' + (idx === state.project.activeSheetIndex ? ' active' : '');
      const titleSpan = document.createElement('span');
      titleSpan.innerHTML = sheet.isMain
        ? '<i class="fa-solid fa-house" style="margin-right:5px;font-size:11px;"></i> Principal'
        : `<i class="fa-solid fa-diagram-project" style="margin-right:5px;font-size:11px;"></i> ${escapeHtml(sheet.name)}(${escapeHtml(sheet.params || '')})`;
      btn.appendChild(titleSpan);

      btn.addEventListener('click', () => {
        state.project.activeSheetIndex = idx;
        state.selectedNodeId = null;
        refreshAll();
      });

      btn.addEventListener('dblclick', () => {
        openEditNodeModal(sheet.startId);
      });

      if (!sheet.isMain) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        closeBtn.title = 'Eliminar este Subprograma';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSubprogramAtIndex(idx);
        });
        btn.appendChild(closeBtn);
      }

      dom.subprogramTabs.appendChild(btn);
    });
  }

  function renderCanvas() {
    const sheet = getActiveSheet();
    const bounds = renderSheetToSVG(
      sheet,
      {
        edgesLayer: dom.edgesLayer,
        hotspotsLayer: dom.hotspotsLayer,
        nodesLayer: dom.nodesLayer
      },
      {
        activeTool: state.activeTool,
        selectedNodeId: state.selectedNodeId,
        executingNodeId: state.executingNodeId,
        errorNodeId: state.errorNodeId,
        onSelectNode(nodeId) {
          state.selectedNodeId = nodeId;
          state.errorNodeId = null;
          renderCanvas();
          setStatusMessage('Objeto seleccionado. Presiona Enter o doble clic para editar, Supr para eliminar.');
        },
        onEditNode(nodeId) {
          state.selectedNodeId = nodeId;
          openEditNodeModal(nodeId);
        },
        onInsertAt(containerId, index) {
          handleInsertObjectAt(containerId, index);
        }
      }
    );

    state.diagramBounds = bounds;
    applyViewportTransform();
    updateStatusBar();
  }

  function applyViewportTransform() {
    const rect = dom.viewport.getBoundingClientRect();
    const centerX = rect.width / 2 + state.panX;
    const topY = state.panY;
    dom.viewportTransform.setAttribute(
      'transform',
      `translate(${centerX}, ${topY}) scale(${state.zoom})`
    );
    dom.zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function centerDiagram() {
    const rect = dom.viewport ? dom.viewport.getBoundingClientRect() : { width: 800, height: 600 };
    const viewportW = rect.width || 800;
    const viewportH = rect.height || 600;

    const bounds = state.diagramBounds || { minX: -200, maxX: 200, width: 400, height: 500 };
    const diagW = Math.max(100, bounds.width);
    const diagH = Math.max(100, bounds.height);

    const midX = (bounds.minX + bounds.maxX) / 2;

    const paddingX = 70;
    const paddingY = 60;
    const fitW = (viewportW - paddingX) / diagW;
    const fitH = (viewportH - paddingY) / diagH;

    const targetZoom = Math.min(1, fitW, fitH);
    state.zoom = Math.max(0.35, Math.min(1.2, Number(targetZoom.toFixed(2))));
    state.panX = -midX * state.zoom;
    state.panY = 24;
    applyViewportTransform();
  }

  function setActiveTool(toolName) {
    state.activeTool = toolName;
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    const toolLabels = {
      CURSOR: 'Modo Selección: Haz clic en un bloque para seleccionarlo o doble clic para editarlo.',
      ASIGNACION: 'Insertar Asignación: Haz clic en cualquier círculo (+) del diagrama para insertar el bloque.',
      CICLOMIENTRAS: 'Insertar Ciclo Mientras: Haz clic en cualquier círculo (+) del diagrama para insertar el ciclo.',
      CICLOPARA: 'Insertar Ciclo Para: Haz clic en cualquier círculo (+) del diagrama para insertar el ciclo.',
      DECISION: 'Insertar Decisión: Haz clic en cualquier círculo (+) del diagrama para insertar la condición.',
      LECTURA: 'Insertar Lectura: Haz clic en cualquier círculo (+) del diagrama para insertar lectura.',
      IMPRESION: 'Insertar Salida: Haz clic en cualquier círculo (+) del diagrama para insertar salida.',
      LLAMADA: 'Insertar Llamada: Haz clic en cualquier círculo (+) del diagrama para invocar un subprograma.'
    };

    dom.activeToolBanner.textContent = toolLabels[toolName] || toolLabels.CURSOR;
    dom.viewport.classList.toggle('inserting-mode', toolName !== 'CURSOR');
    renderCanvas();
  }

  function handleInsertObjectAt(containerId, index) {
    if (!state.activeTool || state.activeTool === 'CURSOR') return;
    const sheet = getActiveSheet();
    pushUndoSnapshot();
    const newNode = createNode(state.activeTool);
    insertNodeAt(sheet, containerId, index, newNode);
    state.selectedNodeId = newNode.id;
    setActiveTool('CURSOR');
    refreshAll();
    // Abrir el diálogo de edición inmediatamente para mayor fluidez
    openEditNodeModal(newNode.id);
  }

  function updateLiveCode() {
    const lang = dom.codeLangSelect.value || 'pseudocode';
    dom.generatedCodeBox.textContent = generateCode(state.project, lang);
  }

  function updateStatusBar() {
    const sheet = getActiveSheet();
    dom.statusSubprogram.textContent = `Hoja: ${sheet.name}`;
    dom.statusAngles.textContent = state.project.anglesInDegrees
      ? 'Ángulos: Grados (DEG)'
      : 'Ángulos: Radianes (RAD)';
    dom.statusObjects.textContent = `Objetos: ${countNodesInSheet(sheet)}`;
    dom.checkDeg.innerHTML = state.project.anglesInDegrees ? '<i class="fa-solid fa-check"></i>' : '&nbsp;';
    dom.checkRad.innerHTML = !state.project.anglesInDegrees ? '<i class="fa-solid fa-check"></i>' : '&nbsp;';
  }

  function setStatusMessage(msg) {
    dom.statusMessage.textContent = msg;
  }

  function logToConsole(text, type = 'info') {
    const div = document.createElement('div');
    div.className = `console-line ${type}`;

    const iconMap = {
      info: 'fa-solid fa-circle-info',
      success: 'fa-solid fa-circle-check',
      error: 'fa-solid fa-circle-xmark',
      output: 'fa-solid fa-volume-high',
      input: 'fa-solid fa-keyboard'
    };
    const iconClass = iconMap[type] || 'fa-solid fa-angle-right';
    const cleanedText = String(text || '').replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '');

    div.innerHTML = `<i class="${iconClass}" style="margin-right:7px;opacity:0.9;"></i><span>${escapeHtml(cleanedText)}</span>`;
    dom.consoleOutput.appendChild(div);
    if (dom.consoleOutput.scrollHeight) {
      dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
    }
  }

  // =========================================================================
  // INSPECTOR DE EJECUCIÓN (WATCH, CALL STACK, PRUEBA DE ESCRITORIO)
  // =========================================================================
  function updateExecutionButtons(status) {
    const isRunning = status === 'RUNNING';
    const isPaused = status === 'PAUSED' || status === 'WAITING_IO';
    const isIdle = status === 'IDLE' || status === 'ERROR';

    dom.btnPause.disabled = !isRunning;
    dom.btnStop.disabled = isIdle;

    dom.execStatusPill.className = 'status-pill';
    if (status === 'RUNNING') {
      dom.execStatusPill.classList.add('status-running');
      dom.execStatusPill.textContent = 'Ejecutando';
    } else if (status === 'PAUSED' || status === 'WAITING_IO') {
      dom.execStatusPill.classList.add('status-paused');
      dom.execStatusPill.textContent = status === 'WAITING_IO' ? 'Esperando E/S' : 'En Pausa (Paso)';
    } else if (status === 'ERROR') {
      dom.execStatusPill.classList.add('status-error');
      dom.execStatusPill.textContent = 'Error';
    } else {
      dom.execStatusPill.classList.add('status-idle');
      dom.execStatusPill.textContent = 'Listo';
    }
  }

  function updateInspectorWatch(symbolTable, callStack) {
    if (!symbolTable) {
      dom.varCountBadge.textContent = '0';
      dom.watchTbody.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Sin variables activas. Ejecuta el diagrama para inspeccionar.</td></tr>';
    } else {
      const entries = symbolTable.getAllEntries();
      dom.varCountBadge.textContent = String(entries.length);
      if (entries.length === 0) {
        dom.watchTbody.innerHTML =
          '<tr><td colspan="3" class="empty-cell">Aún no se han asignado variables en este ámbito.</td></tr>';
      } else {
        dom.watchTbody.innerHTML = entries
          .map(
            e => `<tr>
              <td><strong>${escapeHtml(e.name)}</strong></td>
              <td>${escapeHtml(e.type)}</td>
              <td>${escapeHtml(e.formatted)}</td>
            </tr>`
          )
          .join('');
      }
    }

    if (!callStack || callStack.length === 0) {
      dom.callstackList.innerHTML = '<li class="empty-cell">Inactivo</li>';
    } else {
      dom.callstackList.innerHTML = callStack
        .slice()
        .reverse()
        .map(
          (frame, idx) =>
            `<li class="${idx === 0 ? 'active-frame' : ''}">${idx === 0 ? '▶ ' : ''}${escapeHtml(frame.sheetName)}</li>`
        )
        .join('');
    }
  }

  function updateTraceTable(traceLog) {
    if (!traceLog || traceLog.length === 0) {
      dom.traceTbody.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Aún no se ha ejecutado ningún paso.</td></tr>';
      return;
    }
    dom.traceTbody.innerHTML = traceLog
      .slice(-150) // Mostrar últimos 150 pasos para mantener fluidez
      .map(
        row => `<tr>
          <td>${row.step}</td>
          <td><strong>${escapeHtml(row.nodeType)}</strong></td>
          <td>${escapeHtml(row.detail)}</td>
        </tr>`
      )
      .join('');
  }

  // =========================================================================
  // DIÁLOGOS MODALES DE EDICIÓN DE OBJETOS DFD Y EJECUCIÓN
  // =========================================================================
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let activeModalOnCancel = null;

  function showModal({ title, bodyHtml, footerButtons, onMount, onCancel }) {
    activeModalOnCancel = typeof onCancel === 'function' ? onCancel : null;
    dom.modalTitle.innerHTML = title;
    dom.modalBody.innerHTML = bodyHtml;
    dom.modalFooter.innerHTML = '';

    for (const btnCfg of footerButtons || []) {
      const b = document.createElement('button');
      b.className = btnCfg.className || 'btn-secondary';
      b.innerHTML = btnCfg.label;
      b.addEventListener('click', () => btnCfg.onClick());
      dom.modalFooter.appendChild(b);
    }

    dom.modalOverlay.classList.remove('hidden');
    if (onMount) onMount(dom.modalBody);
  }

  function closeModal(silent = false) {
    const onCancel = activeModalOnCancel;
    activeModalOnCancel = null;
    dom.modalOverlay.classList.add('hidden');
    if (silent !== true && typeof onCancel === 'function') {
      onCancel();
    }
  }

  function showAlertModal(title, message, isError = false) {
    const icon = isError
      ? '<i class="fa-solid fa-circle-xmark" style="color:var(--danger);margin-right:6px;"></i>'
      : '<i class="fa-solid fa-circle-info" style="color:var(--accent);margin-right:6px;"></i>';
    showModal({
      title: `${icon} ${escapeHtml(title)}`,
      bodyHtml: `<div class="help-hint" style="border-left-color:${isError ? 'var(--danger)' : 'var(--accent)'}"><i class="${isError ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info'}"></i> ${escapeHtml(message)}</div>`,
      footerButtons: [
        { label: '<i class="fa-solid fa-check"></i> Aceptar', className: 'btn-primary', onClick: closeModal }
      ]
    });
  }

  function isProjectDirty() {
    return Boolean(state.isDirty);
  }

  function confirmDiscardChanges(onConfirm) {
    if (!isProjectDirty()) {
      onConfirm();
      return;
    }
    showModal({
      title: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);margin-right:6px;"></i> Confirmar descarte de cambios',
      bodyHtml: `
        <div class="help-hint" style="border-left-color: var(--warning); margin-bottom: 12px;">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>Tienes un diagrama con trabajo actual sin guardar o descargar.</strong>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: var(--text-main);">
          Al realizar esta acción se reemplazará el diagrama actual. ¿Deseas descartar el trabajo actual y continuar?
        </p>
      `,
      footerButtons: [
        {
          label: '<i class="fa-solid fa-xmark"></i> Cancelar',
          className: 'btn-secondary',
          onClick: closeModal
        },
        {
          label: '<i class="fa-solid fa-trash-can"></i> Descartar y continuar',
          className: 'btn-danger',
          onClick: () => {
            closeModal();
            onConfirm();
          }
        }
      ]
    });
  }

  function showRuntimeInputModal(targetStr) {
    return new Promise((resolve, reject) => {
      let settled = false;
      function cancelExecution() {
        if (settled) return;
        settled = true;
        closeModal(true);
        interpreter.stop();
        logToConsole('Ejecución detenida por el usuario.', 'info');
        setStatusMessage('Ejecución detenida.');
        const err = new Error('Ejecución detenida por el usuario.');
        err.isCancelled = true;
        reject(err);
      }

      showModal({
        title: '<i class="fa-solid fa-keyboard" style="color:var(--accent);margin-right:6px;"></i> Lectura de Datos (DFD)',
        bodyHtml: `
          <div class="form-group">
            <label>Ingrese el valor para <strong>${escapeHtml(targetStr)}</strong>:</label>
            <input type="text" id="runtime-input-field" class="form-input" placeholder="Ej: 25, 'Hola' o .V." autocomplete="off" />
            <div id="runtime-input-err" style="color:var(--danger);font-size:11.5px;min-height:16px"></div>
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> Puedes ingresar números reales (ej. <code>15.5</code>), valores lógicos (<code>.V.</code> o <code>.F.</code>) o cadenas entre comillas simples (<code>'Texto'</code>).
          </div>
        `,
        footerButtons: [
          {
            label: '<i class="fa-solid fa-stop"></i> Detener',
            className: 'btn-danger',
            onClick: cancelExecution
          },
          {
            label: '<i class="fa-solid fa-play"></i> Continuar (Enter)',
            className: 'btn-primary',
            onClick: submitVal
          }
        ],
        onCancel: cancelExecution,
        onMount(container) {
          const input = container.querySelector('#runtime-input-field');
          input.focus();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitVal();
            }
          });
        }
      });

      function submitVal() {
        if (settled) return;
        const input = document.getElementById('runtime-input-field');
        const errBox = document.getElementById('runtime-input-err');
        try {
          const parsed = parseUserInputValue(input.value);
          settled = true;
          logToConsole(`Entrada [${targetStr}]: ${formatDFDValueForWatch(parsed)}`, 'input');
          closeModal(true);
          resolve(parsed);
        } catch (err) {
          errBox.textContent = err.message;
        }
      }
    });
  }

  function showRuntimeOutputModal(outputText) {
    return new Promise((resolve, reject) => {
      let settled = false;
      function cancelExecution() {
        if (settled) return;
        settled = true;
        closeModal(true);
        interpreter.stop();
        logToConsole('Ejecución detenida por el usuario.', 'info');
        setStatusMessage('Ejecución detenida.');
        const err = new Error('Ejecución detenida por el usuario.');
        err.isCancelled = true;
        reject(err);
      }

      showModal({
        title: '<i class="fa-solid fa-display" style="color:var(--accent);margin-right:6px;"></i> Salida por Pantalla (DFD)',
        bodyHtml: `
          <div class="form-group">
            <div style="background:var(--bg-app);border:2px solid var(--accent);padding:14px;border-radius:6px;font-family:var(--font-mono);font-size:15px;word-break:break-word;user-select:text;">
              ${escapeHtml(outputText)}
            </div>
          </div>
        `,
        footerButtons: [
          {
            label: '<i class="fa-solid fa-stop"></i> Detener',
            className: 'btn-danger',
            onClick: cancelExecution
          },
          {
            label: '<i class="fa-solid fa-play"></i> Continuar (Enter)',
            className: 'btn-primary',
            onClick() {
              if (settled) return;
              settled = true;
              closeModal(true);
              resolve();
            }
          }
        ],
        onCancel: cancelExecution,
        onMount() {
          const primaryBtn = dom.modalFooter.querySelector('.btn-primary');
          if (primaryBtn) primaryBtn.focus();
        }
      });
    });
  }

  /**
   * Abre el cuadro de diálogo clásico de DFD correspondiente al nodo seleccionado
   */
  function openEditNodeModal(nodeId) {
    const sheet = getActiveSheet();
    const found = findNodeInSheet(sheet, nodeId);
    if (!found) return;

    const { node } = found;
    if (node.type === 'FIN' || node.type === 'REGRESE' || node.type === 'CIERRE') {
      return;
    }

    if (node.type === 'INICIO') {
      showModal({
        title: '<i class="fa-solid fa-play" style="color:var(--accent);margin-right:6px;"></i> Inicio (Algoritmo Principal)',
        bodyHtml: `
          <div class="form-group">
            <label>Descripción / Comentario del Algoritmo:</label>
            <textarea id="edit-desc" class="form-textarea" rows="3" placeholder="Describe qué hace este diagrama...">${escapeHtml(sheet.description)}</textarea>
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              sheet.description = document.getElementById('edit-desc').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) { c.querySelector('#edit-desc').focus(); }
      });
      return;
    }

    if (node.type === 'SUBPROGRAMA') {
      showModal({
        title: '<i class="fa-solid fa-diagram-project" style="color:var(--accent);margin-right:6px;"></i> Subprograma',
        bodyHtml: `
          <div class="form-group">
            <label>Nombre del Subprograma:</label>
            <input type="text" id="edit-sub-name" class="form-input" value="${escapeHtml(sheet.name)}" />
          </div>
          <div class="form-group">
            <label>Parámetros (separados por comas):</label>
            <input type="text" id="edit-sub-params" class="form-input" value="${escapeHtml(sheet.params)}" placeholder="Ej: X, Nivel" />
          </div>
          <div class="form-group">
            <label>Descripción:</label>
            <textarea id="edit-sub-desc" class="form-textarea" rows="2">${escapeHtml(sheet.description)}</textarea>
          </div>
          <div id="edit-sub-err" style="color:var(--danger);font-size:11.5px;min-height:16px"></div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              const newName = document.getElementById('edit-sub-name').value.trim();
              const errEl = document.getElementById('edit-sub-err');
              if (!newName) {
                errEl.textContent = 'El nombre del subprograma no puede estar vacío.';
                return;
              }
              if (!/^[a-zA-Z_áéíóúÁÉÍÓÚñÑ][a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]*$/.test(newName)) {
                errEl.textContent = 'Nombre inválido: debe iniciar con letra o guión bajo y sin espacios.';
                return;
              }
              const dup = state.project.sheets.some(
                (s, i) => i > 0 && s.id !== sheet.id && s.name.toUpperCase() === newName.toUpperCase()
              );
              if (dup) {
                errEl.textContent = `Ya existe otro subprograma llamado "${newName}".`;
                return;
              }
              pushUndoSnapshot();
              sheet.name = newName;
              sheet.params = document.getElementById('edit-sub-params').value.trim();
              sheet.description = document.getElementById('edit-sub-desc').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) { c.querySelector('#edit-sub-name').focus(); }
      });
      return;
    }

    if (node.type === 'ASIGNACION') {
      const currentAssigns = node.assignments && node.assignments.length > 0
        ? JSON.parse(JSON.stringify(node.assignments))
        : [{ target: '', expr: '' }];

      // En DFD clásico siempre hay al menos 3 filas disponibles o botón de agregar más
      while (currentAssigns.length < 3) {
        currentAssigns.push({ target: '', expr: '' });
      }

      function renderAssignRows() {
        return currentAssigns
          .map(
            (a, idx) => `
          <div class="assign-row" data-idx="${idx}">
            <input type="text" class="form-input assign-target" placeholder="Variable ej: Suma o V(i)" value="${escapeHtml(a.target)}" />
            <span class="assign-arrow">←</span>
            <input type="text" class="form-input assign-expr" placeholder="Expresión ej: A + B" value="${escapeHtml(a.expr)}" />
            <button type="button" class="btn-xs btn-del-assign" data-idx="${idx}" title="Limpiar fila"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `
          )
          .join('');
      }

      showModal({
        title: '<i class="fa-regular fa-square" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Asignación',
        bodyHtml: `
          <div class="form-group">
            <label>Asignaciones (Variable ← Expresión):</label>
            <div id="assign-rows-container" style="display:flex;flex-direction:column;gap:8px;">
              ${renderAssignRows()}
            </div>
            <button type="button" id="btn-add-assign-row" class="btn-xs" style="align-self:flex-start;margin-top:6px;">
              <i class="fa-solid fa-plus"></i> Agregar otra línea de asignación
            </button>
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> Puedes asignar escalares (<code>x ← 10</code>), vectores/matrices (<code>V(i) ← i * 2</code>), cadenas (<code>nom ← 'Ana'</code>) o lógicos (<code>activo ← .V.</code>).
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              const rows = Array.from(document.querySelectorAll('#assign-rows-container .assign-row'));
              const updated = rows
                .map(r => ({
                  target: r.querySelector('.assign-target').value.trim(),
                  expr: r.querySelector('.assign-expr').value.trim()
                }))
                .filter(item => item.target !== '' || item.expr !== '');

              pushUndoSnapshot();
              node.assignments = updated.length > 0 ? updated : [{ target: '', expr: '' }];
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(container) {
          const firstInput = container.querySelector('.assign-target');
          if (firstInput) firstInput.focus();

          container.querySelector('#btn-add-assign-row').addEventListener('click', () => {
            const box = container.querySelector('#assign-rows-container');
            const div = document.createElement('div');
            div.className = 'assign-row';
            div.innerHTML = `
              <input type="text" class="form-input assign-target" placeholder="Variable" />
              <span class="assign-arrow">←</span>
              <input type="text" class="form-input assign-expr" placeholder="Expresión" />
              <button type="button" class="btn-xs btn-del-assign" title="Eliminar fila"><i class="fa-solid fa-xmark"></i></button>
            `;
            div.querySelector('.btn-del-assign').addEventListener('click', () => div.remove());
            box.appendChild(div);
          });

          container.querySelectorAll('.btn-del-assign').forEach(btn => {
            btn.addEventListener('click', () => {
              const row = btn.closest('.assign-row');
              row.querySelector('.assign-target').value = '';
              row.querySelector('.assign-expr').value = '';
            });
          });
        }
      });
      return;
    }

    if (node.type === 'LECTURA') {
      showModal({
        title: '<i class="fa-solid fa-keyboard" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Lectura (Entrada por Teclado)',
        bodyHtml: `
          <div class="form-group">
            <label>Variables a leer (separadas por comas):</label>
            <input type="text" id="edit-lectura-text" class="form-input" value="${escapeHtml(node.text)}" placeholder="Ej: A, B, V(i)" />
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> Separa múltiples variables con comas, por ejemplo: <code>N, Edad, Vector(i)</code>.
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.text = document.getElementById('edit-lectura-text').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          const inp = c.querySelector('#edit-lectura-text');
          inp.focus();
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') dom.modalFooter.querySelector('.btn-primary').click();
          });
        }
      });
      return;
    }

    if (node.type === 'IMPRESION') {
      showModal({
        title: '<i class="fa-solid fa-display" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Salida (Impresión por Pantalla)',
        bodyHtml: `
          <div class="form-group">
            <label>Expresiones a mostrar (separadas por comas):</label>
            <input type="text" id="edit-impresion-text" class="form-input" value="${escapeHtml(node.text)}" placeholder="Ej: 'El resultado es: ', Total" />
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> Los textos literales van entre comillas simples (<code>'Hola '</code>) y puedes combinarlos con variables o cálculos separados por comas: <code>'La suma es: ', A + B</code>.
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.text = document.getElementById('edit-impresion-text').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          const inp = c.querySelector('#edit-impresion-text');
          inp.focus();
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') dom.modalFooter.querySelector('.btn-primary').click();
          });
        }
      });
      return;
    }

    if (node.type === 'DECISION') {
      showModal({
        title: '<i class="fa-solid fa-code-branch" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Decisión (Condicional)',
        bodyHtml: `
          <div class="form-group">
            <label>Condición lógica:</label>
            <input type="text" id="edit-dec-cond" class="form-input" value="${escapeHtml(node.condition)}" placeholder="Ej: A > B AND A > 0" />
          </div>
          <div class="form-group">
            <label>Ubicación de la rama verdadera ("Sí"):</label>
            <div class="radio-group">
              <label>
                <input type="radio" name="dec-side" value="left" ${node.yesLeft ? 'checked' : ''} />
                Izquierda (Sí a la izquierda)
              </label>
              <label>
                <input type="radio" name="dec-side" value="right" ${!node.yesLeft ? 'checked' : ''} />
                Derecha (Sí a la derecha)
              </label>
            </div>
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> Operadores relacionales: <code>=</code>, <code>!=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>&lt;=</code>, <code>&gt;=</code>. Lógicos: <code>AND</code>, <code>OR</code>, <code>NOT</code>, <code>XOR</code>.
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.condition = document.getElementById('edit-dec-cond').value.trim();
              const side = document.querySelector('input[name="dec-side"]:checked')?.value;
              node.yesLeft = side === 'left';
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          const inp = c.querySelector('#edit-dec-cond');
          inp.focus();
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') dom.modalFooter.querySelector('.btn-primary').click();
          });
        }
      });
      return;
    }

    if (node.type === 'CICLOMIENTRAS') {
      showModal({
        title: '<i class="fa-solid fa-rotate" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Ciclo Mientras (While)',
        bodyHtml: `
          <div class="form-group">
            <label>Condición de permanencia en el ciclo:</label>
            <input type="text" id="edit-mq-cond" class="form-input" value="${escapeHtml(node.condition)}" placeholder="Ej: i <= N" />
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> El cuerpo del ciclo se repetirá mientras la condición se evalúe como verdadera (<code>.V.</code>).
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.condition = document.getElementById('edit-mq-cond').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          const inp = c.querySelector('#edit-mq-cond');
          inp.focus();
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') dom.modalFooter.querySelector('.btn-primary').click();
          });
        }
      });
      return;
    }

    if (node.type === 'CICLOPARA') {
      showModal({
        title: '<i class="fa-solid fa-repeat" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Ciclo Para (For)',
        bodyHtml: `
          <div class="form-group">
            <label>Variable contadora:</label>
            <input type="text" id="edit-para-id" class="form-input" value="${escapeHtml(node.counter)}" placeholder="Ej: i" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <div class="form-group">
              <label>Valor Inicial:</label>
              <input type="text" id="edit-para-start" class="form-input" value="${escapeHtml(node.start)}" />
            </div>
            <div class="form-group">
              <label>Valor Final:</label>
              <input type="text" id="edit-para-end" class="form-input" value="${escapeHtml(node.end)}" />
            </div>
            <div class="form-group">
              <label>Incremento (Paso):</label>
              <input type="text" id="edit-para-step" class="form-input" value="${escapeHtml(node.step)}" />
            </div>
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.counter = document.getElementById('edit-para-id').value.trim();
              node.start = document.getElementById('edit-para-start').value.trim();
              node.end = document.getElementById('edit-para-end').value.trim();
              node.step = document.getElementById('edit-para-step').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          c.querySelector('#edit-para-id').focus();
        }
      });
      return;
    }

    if (node.type === 'LLAMADA') {
      const subNames = state.project.sheets.slice(1).map(s => s.name);
      const hintSubs = subNames.length > 0
        ? `Subprogramas disponibles: <strong>${subNames.map(escapeHtml).join(', ')}</strong>`
        : 'Aún no has creado subprogramas. Usa el botón "+ Nuevo Subprograma" para agregar uno.';

      showModal({
        title: '<i class="fa-solid fa-diagram-project" style="color:var(--accent);margin-right:6px;"></i> Editar Objeto Llamada a Subprograma',
        bodyHtml: `
          <div class="form-group">
            <label>Nombre del Subprograma a invocar:</label>
            <input type="text" id="edit-call-name" class="form-input" value="${escapeHtml(node.subName)}" placeholder="Ej: Fact" />
          </div>
          <div class="form-group">
            <label>Argumentos (separados por comas):</label>
            <input type="text" id="edit-call-args" class="form-input" value="${escapeHtml(node.args)}" placeholder="Ej: X, N" />
          </div>
          <div class="help-hint">
            <i class="fa-solid fa-lightbulb"></i> ${hintSubs}
          </div>
        `,
        footerButtons: [
          { label: '<i class="fa-solid fa-xmark"></i> Cancelar', className: 'btn-secondary', onClick: closeModal },
          {
            label: '<i class="fa-solid fa-check"></i> Aceptar',
            className: 'btn-primary',
            onClick() {
              pushUndoSnapshot();
              node.subName = document.getElementById('edit-call-name').value.trim();
              node.args = document.getElementById('edit-call-args').value.trim();
              closeModal();
              refreshAll();
            }
          }
        ],
        onMount(c) {
          c.querySelector('#edit-call-name').focus();
        }
      });
      return;
    }
  }

  // =========================================================================
  // SUBPROGRAMAS, COPIAR/CORTAR/PEGAR Y ELIMINACIÓN
  // =========================================================================
  function createNewSubprogramInteractive() {
    const nextNum = state.project.sheets.length;
    showModal({
      title: '<i class="fa-solid fa-plus" style="color:var(--accent);margin-right:6px;"></i> Crear Nuevo Subprograma',
      bodyHtml: `
        <div class="form-group">
          <label>Nombre del Subprograma:</label>
          <input type="text" id="new-sub-name" class="form-input" value="Subprograma${nextNum}" />
        </div>
        <div class="form-group">
          <label>Parámetros (separados por comas):</label>
          <input type="text" id="new-sub-params" class="form-input" placeholder="Ej: res, a, b" />
        </div>
        <div class="form-group">
          <label>Descripción:</label>
          <textarea id="new-sub-desc" class="form-textarea" rows="2" placeholder="Propósito del subprograma..."></textarea>
        </div>
        <div id="new-sub-err" style="color:var(--danger);font-size:11.5px;min-height:16px"></div>
      `,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
        {
          label: '<i class="fa-solid fa-check"></i> Crear Subprograma',
          className: 'btn-primary',
          onClick() {
            const name = document.getElementById('new-sub-name').value.trim();
            const errEl = document.getElementById('new-sub-err');
            if (!name) {
              errEl.textContent = 'El nombre del subprograma no puede estar vacío.';
              return;
            }
            if (!/^[a-zA-Z_áéíóúÁÉÍÓÚñÑ][a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]*$/.test(name)) {
              errEl.textContent = 'Nombre inválido: debe iniciar con letra o guión bajo y sin espacios.';
              return;
            }
            const dup = state.project.sheets.some(
              (s, i) => i > 0 && s.name.toUpperCase() === name.toUpperCase()
            );
            if (dup) {
              errEl.textContent = `Ya existe un subprograma con el nombre "${name}".`;
              return;
            }
            pushUndoSnapshot();
            const sub = createSubprogramSheet(
              name,
              document.getElementById('new-sub-params').value.trim(),
              document.getElementById('new-sub-desc').value.trim()
            );
            state.project.sheets.push(sub);
            state.project.activeSheetIndex = state.project.sheets.length - 1;
            closeModal();
            refreshAll();
          }
        }
      ],
      onMount(c) { c.querySelector('#new-sub-name').focus(); }
    });
  }

  function deleteSubprogramAtIndex(idx) {
    if (idx <= 0 || idx >= state.project.sheets.length) return;
    const sub = state.project.sheets[idx];
    pushUndoSnapshot();
    state.project.sheets.splice(idx, 1);
    state.project.activeSheetIndex = Math.max(0, state.project.activeSheetIndex - 1);
    refreshAll();
    setStatusMessage(`Subprograma "${sub.name}" eliminado.`);
  }

  function deleteSelectedNode() {
    if (!state.selectedNodeId) return;
    const sheet = getActiveSheet();
    const found = findNodeInSheet(sheet, state.selectedNodeId);
    if (!found || !found.parentList) {
      setStatusMessage('Los bloques Inicio y Fin no se pueden eliminar.');
      return;
    }
    pushUndoSnapshot();
    deleteNodeById(sheet, state.selectedNodeId);
    state.selectedNodeId = null;
    refreshAll();
    setStatusMessage('Objeto eliminado.');
  }

  function copySelectedNode() {
    if (!state.selectedNodeId) return;
    const sheet = getActiveSheet();
    const found = findNodeInSheet(sheet, state.selectedNodeId);
    if (!found || !found.parentList) return;
    state.clipboardNode = cloneNodeWithNewIds(found.node);
    setStatusMessage('Objeto copiado al portapapeles.');
  }

  function cutSelectedNode() {
    if (!state.selectedNodeId) return;
    copySelectedNode();
    deleteSelectedNode();
    setStatusMessage('Objeto cortado al portapapeles.');
  }

  function pasteClipboardNode() {
    if (!state.clipboardNode) return;
    const sheet = getActiveSheet();
    pushUndoSnapshot();
    const copy = cloneNodeWithNewIds(state.clipboardNode);

    if (state.selectedNodeId) {
      const found = findNodeInSheet(sheet, state.selectedNodeId);
      if (found && found.parentList) {
        found.parentList.splice(found.index + 1, 0, copy);
        state.selectedNodeId = copy.id;
        refreshAll();
        return;
      }
    }
    sheet.body.push(copy);
    state.selectedNodeId = copy.id;
    refreshAll();
  }

  // =========================================================================
  // ARCHIVOS: GUARDAR / ABRIR (.DFDX, .DFD, SVG, PNG)
  // =========================================================================
  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function saveAsDFX() {
    let name = state.fileName || 'Algoritmo.dfx';
    if (!name.toLowerCase().endsWith('.dfx')) {
      name = name.replace(/\.[^.]+$/, '') + '.dfx';
    }
    state.fileName = name;
    const serializer = serializeDFX || serializeDFDX;
    const content = serializer(state.project);

    if (window.electronAPI && window.electronAPI.saveFileDialog) {
      const res = await window.electronAPI.saveFileDialog({
        defaultFileName: name,
        content: content,
        filters: [
          { name: 'Diagrama df-decode (*.dfx)', extensions: ['dfx'] },
          { name: 'Todos los archivos (*.*)', extensions: ['*'] }
        ]
      });
      if (res && res.success) {
        state.fileName = res.fileName;
        state.isDirty = false;
        refreshAll();
        setStatusMessage(`Guardado como ${res.fileName}`);
      }
      return;
    }

    downloadBlob(content, name, 'application/json;charset=utf-8');
    state.isDirty = false;
    refreshAll();
    setStatusMessage(`Guardado como ${name}`);
  }

  const saveAsDFDX = saveAsDFX;

  async function saveAsClassicDFD() {
    let name = (state.fileName || 'Algoritmo').replace(/\.[^.]+$/, '') + '.dfd';
    const content = serializeClassicDFD(state.project);
    const latin1Bytes = encodeClassicDFDBytes(content);

    if (window.electronAPI && window.electronAPI.saveFileDialog) {
      const res = await window.electronAPI.saveFileDialog({
        defaultFileName: name,
        content: content,
        bytes: latin1Bytes,
        filters: [
          { name: 'Diagrama DFD Clásico (*.dfd)', extensions: ['dfd'] },
          { name: 'Todos los archivos (*.*)', extensions: ['*'] }
        ]
      });
      if (res && res.success) {
        state.fileName = res.fileName;
        state.isDirty = false;
        refreshAll();
        setStatusMessage(`Exportado en formato compatible DFD clásico: ${res.fileName}`);
      }
      return;
    }

    // Bytes Latin-1 reales (un Blob de texto siempre se codificaría en UTF-8)
    downloadBlob(latin1Bytes, name, 'application/octet-stream');
    state.isDirty = false;
    setStatusMessage(`Exportado en formato compatible DFD clásico: ${name}`);
  }

  async function triggerOpenFile() {
    if (window.electronAPI && window.electronAPI.openFileDialog) {
      const fileData = await window.electronAPI.openFileDialog();
      if (!fileData) return;
      confirmDiscardChanges(() => {
        try {
          interpreter.stop();
          pushUndoSnapshot();
          const rawText = fileData.bytes ? decodeFileBytes(fileData.bytes) : fileData.content;
          state.project = loadAnyDFDFile(rawText);
          state.fileName = fileData.fileName;
          state.selectedNodeId = null;
          state.isDirty = false;
          centerDiagram();
          refreshAll();
          logToConsole(`Archivo cargado correctamente: ${fileData.fileName}`, 'success');
        } catch (err) {
          showAlertModal('Error al abrir archivo', err.message, true);
        }
      });
      return;
    }
    dom.hiddenFileInput.click();
  }

  function exportDiagramSVG() {
    const cloneSvg = dom.svgCanvas.cloneNode(true);
    const b = state.diagramBounds;
    const pad = 40;
    const minX = b.minX - pad;
    const minY = 0;
    const width = b.width + pad * 2;
    const height = b.height + pad;

    cloneSvg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    cloneSvg.setAttribute('width', width);
    cloneSvg.setAttribute('height', height);

    const vp = cloneSvg.querySelector('#viewport-transform');
    if (vp) vp.setAttribute('transform', 'translate(0, 10) scale(1)');
    const bg = cloneSvg.querySelector('#grid-bg');
    if (bg) bg.remove();

    // Inyectar estilos computados para que el SVG sea autónomo
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    const cs = getComputedStyle(document.documentElement);
    styleEl.textContent = `
      svg { background: ${cs.getPropertyValue('--bg-canvas')}; font-family: monospace; }
      .flow-line { stroke: ${cs.getPropertyValue('--line-color')}; stroke-width: 1.8px; fill: none; }
      .node-shape { stroke: ${cs.getPropertyValue('--node-stroke')}; stroke-width: 1.8px; }
      .node-label { fill: ${cs.getPropertyValue('--node-text')}; font-family: monospace; font-size: 12px; text-anchor: middle; dominant-baseline: middle; }
      .node-sublabel { fill: ${cs.getPropertyValue('--text-muted')}; font-family: sans-serif; font-size: 10px; font-weight: bold; text-anchor: middle; }
      .branch-label { fill: ${cs.getPropertyValue('--text-main')}; font-family: sans-serif; font-size: 11px; font-weight: bold; }
    `;
    cloneSvg.insertBefore(styleEl, cloneSvg.firstChild);

    // Reemplazar variables CSS en los atributos fill
    const varMap = {
      'var(--shape-inicio)': cs.getPropertyValue('--shape-inicio').trim(),
      'var(--shape-asignacion)': cs.getPropertyValue('--shape-asignacion').trim(),
      'var(--shape-mientras)': cs.getPropertyValue('--shape-mientras').trim(),
      'var(--shape-para)': cs.getPropertyValue('--shape-para').trim(),
      'var(--shape-decision)': cs.getPropertyValue('--shape-decision').trim(),
      'var(--shape-lectura)': cs.getPropertyValue('--shape-lectura').trim(),
      'var(--shape-impresion)': cs.getPropertyValue('--shape-impresion').trim(),
      'var(--shape-llamada)': cs.getPropertyValue('--shape-llamada').trim(),
      'var(--shape-cierre)': cs.getPropertyValue('--shape-cierre').trim(),
      'var(--line-color)': cs.getPropertyValue('--line-color').trim()
    };

    let svgString = new XMLSerializer().serializeToString(cloneSvg);
    for (const [k, v] of Object.entries(varMap)) {
      svgString = svgString.split(k).join(v);
    }

    return { svgString, width, height };
  }

  function downloadSVG() {
    const { svgString } = exportDiagramSVG();
    const outName = (state.fileName || 'diagrama').replace(/\.[^.]+$/, '') + '.svg';
    downloadBlob(svgString, outName, 'image/svg+xml;charset=utf-8');
  }

  function downloadPNG() {
    const { svgString, width, height } = exportDiagramSVG();
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const outName = (state.fileName || 'diagrama').replace(/\.[^.]+$/, '') + '.png';
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = outName;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.src = url;
  }

  // =========================================================================
  // EVALUADOR INTERACTIVO Y MANUAL DE AYUDA DFD
  // =========================================================================
  function openEvaluatorModal() {
    showModal({
      title: '<i class="fa-solid fa-calculator" style="color:var(--accent);margin-right:6px;"></i> Evaluador de Expresiones DFD',
      bodyHtml: `
        <div class="form-group">
          <label>Escribe cualquier expresión aritmética, lógica o de cadenas:</label>
          <input type="text" id="modal-eval-expr" class="form-input" placeholder="Ej: SQRT(144) + SUBSTRING('COLOMBIA', 1, 3)" />
        </div>
        <div class="form-group">
          <label>Resultado:</label>
          <div id="modal-eval-out" style="background:var(--bg-app);padding:12px;border-radius:6px;font-family:var(--font-mono);min-height:42px;">
            Presiona Evaluar...
          </div>
        </div>
      `,
      footerButtons: [
        { label: 'Cerrar', className: 'btn-secondary', onClick: closeModal },
        {
          label: '<i class="fa-solid fa-calculator"></i> Evaluar Expresión',
          className: 'btn-primary',
          onClick: runModalEval
        }
      ],
      onMount(c) {
        const inp = c.querySelector('#modal-eval-expr');
        inp.focus();
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') runModalEval();
        });
      }
    });

    function runModalEval() {
      const expr = document.getElementById('modal-eval-expr').value;
      const out = document.getElementById('modal-eval-out');
      try {
        const sym = interpreter.activeSymbolTable || new SymbolTable();
        const res = evaluateExpression(expr, sym, {
          anglesInDegrees: state.project.anglesInDegrees
        });
        out.style.color = 'var(--success)';
        out.textContent = `${formatDFDValueForWatch(res)}  (Tipo: ${global.DFDEvaluator.getDFDTypeName(res)})`;
      } catch (err) {
        out.style.color = 'var(--danger)';
        out.textContent = err.message;
      }
    }
  }

  function openHelpModal() {
    showModal({
      title: '<i class="fa-solid fa-book-open" style="color:var(--accent);margin-right:6px;"></i> Manual de Referencia de Funciones y Operadores DFD',
      bodyHtml: `
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;line-height:1.5;">
          <div class="help-hint">
            <strong><i class="fa-solid fa-layer-group" style="color:var(--accent);margin-right:4px;"></i> Tipos de Datos en DFD:</strong><br/>
            • <strong>Real:</strong> Números enteros o decimales (ej. <code>42</code>, <code>3.1416</code>, <code>-5</code>).<br/>
            • <strong>Cadena:</strong> Texto entre comillas simples (ej. <code>'Hola mundo'</code>).<br/>
            • <strong>Lógico:</strong> <code>.V.</code> (Verdadero) y <code>.F.</code> (Falso).<br/>
            • <strong>Vectores y Matrices:</strong> Indexados con paréntesis <code>V(i)</code> o <code>Matriz(f, c)</code>.
          </div>
          <div class="help-hint">
            <strong><i class="fa-solid fa-arrow-down-1-9" style="color:var(--accent);margin-right:4px;"></i> Operadores por Orden de Precedencia:</strong><br/>
            1. <code>( )</code> Paréntesis<br/>
            2. <code>^</code> Potenciación, signos unarios <code>+ -</code>, <code>NOT</code> y funciones matemáticas<br/>
            3. <code>*</code> Multiplicación, <code>/</code> División, <code>MOD</code> Residuo entero<br/>
            4. <code>+</code> Suma o concatenación de cadenas, <code>-</code> Resta<br/>
            5. <code>&lt;</code>, <code>&gt;</code>, <code>&lt;=</code>, <code>&gt;=</code>, <code>=</code>, <code>!=</code> (o <code>&lt;&gt;</code>)<br/>
            6. <code>AND</code>, <code>NAND</code>, <code>NOR</code>, <code>OR</code>, <code>XOR</code>, <code>XNOR</code>
          </div>
          <div class="help-hint">
            <strong><i class="fa-solid fa-square-root-variable" style="color:var(--accent);margin-right:4px;"></i> Funciones Matemáticas y de Cadena Incorporadas:</strong><br/>
            • <code>SQRT(x)</code>: Raíz cuadrada de x<br/>
            • <code>ABS(x)</code>: Valor absoluto de x<br/>
            • <code>TRUNC(x)</code>: Parte entera de x | <code>ROUND(x)</code>: Redondeo al entero más cercano<br/>
            • <code>RANDOM(x)</code>: Entero aleatorio entre 0 y x-1<br/>
            • <code>LN(x)</code>, <code>LOG(x)</code>, <code>EXP(x)</code>: Logaritmo natural, base 10 y exponencial<br/>
            • <code>SIN(x)</code>, <code>COS(x)</code>, <code>TAN(x)</code>, <code>ASIN(x)</code>, <code>ACOS(x)</code>, <code>ATAN(x)</code><br/>
            • <code>LEN(cad)</code>: Longitud de una cadena<br/>
            • <code>SUBSTRING(cad, inicio, longitud)</code>: Extrae subcadena (empezando en posición 1)
          </div>
        </div>
      `,
      footerButtons: [
        { label: 'Entendido', className: 'btn-primary', onClick: closeModal }
      ]
    });
  }

  function openShareLinkModal() {
    const shareUrl = buildShareableURL(state.project, state.fileName);
    showModal({
      title: '<i class="fa-solid fa-share-nodes" style="color:var(--accent);margin-right:6px;"></i> Compartir Diagrama por Enlace Directo',
      bodyHtml: `
        <div class="form-group">
          <label>Enlace único con todo el diagrama incluido (listo para enviar por WhatsApp, Classroom o Correo):</label>
          <input type="text" id="share-url-input" class="form-input" value="${escapeHtml(shareUrl)}" readonly />
        </div>
        <div class="help-hint">
          <i class="fa-solid fa-lightbulb" style="color:var(--warning);margin-right:4px;"></i> Este enlace contiene todos los bloques y subprogramas codificados directamente en la URL. Quien lo abra verá tu diagrama al instante sin necesidad de descargar ni subir archivos.
        </div>
      `,
      footerButtons: [
        { label: 'Cerrar', className: 'btn-secondary', onClick: closeModal },
        {
          label: '<i class="fa-solid fa-copy"></i> Copiar Enlace',
          className: 'btn-primary',
          onClick() {
            const inp = document.getElementById('share-url-input');
            inp.select();
            navigator.clipboard.writeText(shareUrl);
            const token = shareUrl.includes('#dfx=') ? shareUrl.split('#dfx=')[1] : shareUrl.split('#dfdx=')[1];
            window.history.replaceState(null, '', `#dfx=${token}`);
            setStatusMessage('Enlace de diagrama copiado al portapapeles.');
            closeModal();
          }
        }
      ],
      onMount(c) {
        const inp = c.querySelector('#share-url-input');
        inp.focus();
        inp.select();
      }
    });
  }

  function openAboutModal() {
    showModal({
      title: '<i class="fa-solid fa-circle-info" style="color:var(--accent);margin-right:6px;"></i> Acerca de df-decode v1.0',
      bodyHtml: `
        <div style="display:flex;flex-direction:column;gap:10px;line-height:1.5;">
          <div style="display:flex;justify-content:center;padding:14px;background:#ffffff;border-radius:10px;">
            <img src="assets/logo.svg" alt="df-decode v1.0" style="height:96px;width:auto;" />
          </div>
          <p><strong>df-decode v1.0</strong> — Entorno Web y de Escritorio para Diseño, Ejecución y Depuración de Diagramas de Flujo de Datos.</p>
          <p>Proyecto original desarrollado íntegramente desde cero e <strong>inspirado en el clásico software educativo DFD</strong>. <em>No es una versión derivada</em> ni contiene código fuente de implementaciones previas, manteniendo compatibilidad con archivos <code>.dfd</code> para facilitar la enseñanza de algoritmos.</p>
          <ul style="padding-left:18px;color:var(--text-muted);">
            <li>Soporte nativo para la extensión moderna <code>.dfx</code> y compatibilidad bidireccional con <code>.dfd</code> y <code>.dfdx</code>.</li>
            <li>Subprogramas recursivos, vectores y matrices dinámicas N-dimensionales.</li>
            <li>Traductor en vivo a Pseudocódigo PSeInt, Python 3, JavaScript (ES6) y C++.</li>
            <li>Prueba de escritorio automática y tabla de seguimiento de variables en tiempo real.</li>
          </ul>
          <p style="border-top:1px solid var(--border-color);padding-top:10px;">
            <i class="fa-solid fa-user-check" style="color:var(--accent);margin-right:4px;"></i> Autoría: <strong>Walther Curo De La Cruz</strong> · © ${new Date().getFullYear()} df-decode v1.0<br/>
            <i class="fa-solid fa-scale-balanced" style="color:var(--accent);margin-right:4px;"></i> Distribuido bajo <strong>Licencia GNU General Public License v3.0 (GPLv3)</strong>.
          </p>
        </div>
      `,
      footerButtons: [
        { label: 'Cerrar', className: 'btn-primary', onClick: closeModal }
      ]
    });
  }

  // =========================================================================
  // EVENTOS Y ATAJOS DE TECLADO
  // =========================================================================
  function bindEvents() {
    // Poblar galería de ejemplos
    EXAMPLES.forEach(ex => {
      const btn = document.createElement('button');
      btn.innerHTML = `<span><i class="fa-solid fa-book-bookmark menu-icon"></i> ${escapeHtml(ex.title)}</span>`;
      btn.addEventListener('click', () => {
        confirmDiscardChanges(() => {
          interpreter.stop();
          pushUndoSnapshot();
          state.project = ex.build();
          state.fileName = `${ex.id}.dfx`;
          state.selectedNodeId = null;
          state.isDirty = false;
          centerDiagram();
          refreshAll();
          logToConsole(`Ejemplo cargado: "${ex.title}". Presiona Ejecutar (F9) o Paso (F7).`, 'info');
        });
      });
      dom.examplesMenuList.appendChild(btn);
    });

    // Apertura de archivos enviada desde el sistema operativo (Electron Desktop)
    if (window.electronAPI && window.electronAPI.onFileOpenedFromOS) {
      window.electronAPI.onFileOpenedFromOS(({ fileName, content, bytes }) => {
        confirmDiscardChanges(() => {
          try {
            interpreter.stop();
            pushUndoSnapshot();
            const rawText = bytes ? decodeFileBytes(bytes) : content;
            state.project = loadAnyDFDFile(rawText);
            state.fileName = fileName;
            state.selectedNodeId = null;
            state.isDirty = false;
            centerDiagram();
            refreshAll();
            logToConsole(`Archivo abierto desde el sistema: ${fileName}`, 'success');
          } catch (err) {
            showAlertModal('Error al abrir archivo', err.message, true);
          }
        });
      });
    }

    // Delegación de acciones data-action
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      handleCommandAction(action);
    });

    // Selector de tema
    dom.themeSelector.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', dom.themeSelector.value);
    });

    // Pestañas del inspector derecho
    document.querySelectorAll('.insp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.insp-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.insp-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Cambio de lenguaje en generador de código
    dom.codeLangSelect.addEventListener('change', updateLiveCode);
    dom.btnCopyCode.addEventListener('click', () => {
      navigator.clipboard.writeText(dom.generatedCodeBox.textContent);
      setStatusMessage('Código copiado al portapapeles.');
    });

    // Exportar Prueba de Escritorio a CSV
    dom.btnExportTrace.addEventListener('click', () => {
      const rows = [['Paso', 'Hoja', 'Bloque', 'Detalle']];
      for (const item of interpreter.traceLog) {
        rows.push([item.step, item.sheetName, item.nodeType, `"${String(item.detail).replace(/"/g, '""')}"`]);
      }
      const csv = rows.map(r => r.join(',')).join('\n');
      downloadBlob(csv, 'prueba_escritorio.csv', 'text/csv;charset=utf-8');
    });

    // Evaluador rápido en el panel lateral
    dom.btnQuickEval.addEventListener('click', runQuickEval);
    dom.quickEvalInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') runQuickEval();
    });

    // Limpiar consola
    document.getElementById('btn-clear-console').addEventListener('click', () => {
      dom.consoleOutput.innerHTML = '';
    });

    // Cerrar modal
    dom.modalCloseBtn.addEventListener('click', () => closeModal(false));

    // Redimensionamiento de la Consola Inferior
    if (dom.resizerConsole) {
      let isResizingConsole = false;
      let startY = 0;
      let startHeight = 0;

      dom.resizerConsole.addEventListener('mousedown', (e) => {
        isResizingConsole = true;
        startY = e.clientY;
        startHeight = dom.consoleDrawer.getBoundingClientRect().height;
        dom.resizerConsole.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isResizingConsole) return;
        const delta = startY - e.clientY;
        const newHeight = Math.max(32, Math.min(window.innerHeight * 0.75, startHeight + delta));
        dom.consoleDrawer.style.height = `${newHeight}px`;
        if (newHeight <= 35) {
          dom.consoleDrawer.classList.add('collapsed');
        } else {
          dom.consoleDrawer.classList.remove('collapsed');
        }
      });

      window.addEventListener('mouseup', () => {
        if (!isResizingConsole) return;
        isResizingConsole = false;
        dom.resizerConsole.classList.remove('resizing');
        document.body.style.cursor = '';
      });
    }

    // Redimensionamiento del Panel Lateral Derecho
    if (dom.resizerInspector) {
      let isResizingInspector = false;
      let startX = 0;
      let startWidth = 0;

      dom.resizerInspector.addEventListener('mousedown', (e) => {
        isResizingInspector = true;
        startX = e.clientX;
        startWidth = dom.inspectorPanel.getBoundingClientRect().width;
        dom.resizerInspector.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isResizingInspector) return;
        const delta = startX - e.clientX;
        const newWidth = Math.max(220, Math.min(window.innerWidth * 0.7, startWidth + delta));
        dom.inspectorPanel.style.width = `${newWidth}px`;
        renderCanvas();
      });

      window.addEventListener('mouseup', () => {
        if (!isResizingInspector) return;
        isResizingInspector = false;
        dom.resizerInspector.classList.remove('resizing');
        document.body.style.cursor = '';
      });
    }

    // Input de carga de archivos (.dfx, .dfdx y .dfd)
    dom.hiddenFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      confirmDiscardChanges(() => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            interpreter.stop();
            pushUndoSnapshot();
            state.project = loadAnyDFDFile(decodeFileBytes(reader.result));
            state.fileName = file.name;
            state.selectedNodeId = null;
            state.isDirty = false;
            centerDiagram();
            refreshAll();
            logToConsole(`Archivo cargado correctamente: ${file.name}`, 'success');
          } catch (err) {
            showAlertModal('Error al abrir archivo', err.message, true);
          }
        };
        reader.readAsArrayBuffer(file);
      });
      e.target.value = '';
    });

    // Pan & Zoom sobre el lienzo SVG
    dom.viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.dfd-node') || e.target.closest('.insert-hotspot') || e.target.closest('.float-btn')) {
        return;
      }
      state.selectedNodeId = null;
      renderCanvas();
      state.isPanning = true;
      state.panStartX = e.clientX - state.panX;
      state.panStartY = e.clientY - state.panY;
      dom.viewport.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.isPanning) return;
      state.panX = e.clientX - state.panStartX;
      state.panY = e.clientY - state.panStartY;
      applyViewportTransform();
    });

    window.addEventListener('mouseup', () => {
      state.isPanning = false;
      dom.viewport.classList.remove('dragging');
    });

    dom.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      state.zoom = Math.min(2.5, Math.max(0.35, Number((state.zoom + delta).toFixed(2))));
      applyViewportTransform();
    }, { passive: false });

    // Atajos de teclado globales
    window.addEventListener('keydown', (e) => {
      const isModalOpen = !dom.modalOverlay.classList.contains('hidden');
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

      if (e.key === 'Escape') {
        if (isModalOpen) {
          closeModal();
        } else {
          setActiveTool('CURSOR');
        }
        return;
      }

      if (isModalOpen || isInputFocused) return;

      if (e.key === 'F9') {
        e.preventDefault();
        handleCommandAction('run-start');
      } else if (e.key === 'F7') {
        e.preventDefault();
        handleCommandAction('run-step');
      } else if (e.key === 'F4') {
        e.preventDefault();
        openEvaluatorModal();
      } else if (e.key === 'F1') {
        e.preventDefault();
        openHelpModal();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNode();
      } else if (e.key === 'Enter' && state.selectedNodeId) {
        e.preventDefault();
        openEditNodeModal(state.selectedNodeId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAsDFDX();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        triggerOpenFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelectedNode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutSelectedNode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboardNode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        createNewSubprogramInteractive();
      } else if (e.key === '1') setActiveTool('ASIGNACION');
      else if (e.key === '2') setActiveTool('CICLOMIENTRAS');
      else if (e.key === '3') setActiveTool('CICLOPARA');
      else if (e.key === '4') setActiveTool('DECISION');
      else if (e.key === '5') setActiveTool('LECTURA');
      else if (e.key === '6') setActiveTool('IMPRESION');
      else if (e.key === '7') setActiveTool('LLAMADA');
    });

    window.addEventListener('resize', () => {
      renderCanvas();
    });

    window.addEventListener('beforeunload', (e) => {
      // En entorno de escritorio (Electron), permitir cerrar la ventana sin bloquear el botón (X)
      if (window.electronAPI && window.electronAPI.isElectron) {
        return;
      }
      if (isProjectDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function runQuickEval() {
    const expr = dom.quickEvalInput.value.trim();
    if (!expr) return;
    try {
      const sym = interpreter.activeSymbolTable || new SymbolTable();
      const val = evaluateExpression(expr, sym, {
        anglesInDegrees: state.project.anglesInDegrees
      });
      dom.quickEvalResult.style.color = 'var(--success)';
      dom.quickEvalResult.textContent = `= ${formatDFDValueForWatch(val)}`;
    } catch (err) {
      dom.quickEvalResult.style.color = 'var(--danger)';
      dom.quickEvalResult.textContent = err.message;
    }
  }

  function handleCommandAction(action) {
    switch (action) {
      case 'new-project':
        confirmDiscardChanges(() => {
          interpreter.stop();
          pushUndoSnapshot();
          state.project = createEmptyProject();
          state.fileName = 'Sin_titulo.dfx';
          state.selectedNodeId = null;
          state.isDirty = false;
          centerDiagram();
          refreshAll();
          setStatusMessage('Nuevo proyecto creado.');
        });
        break;

      case 'open-file':
        triggerOpenFile();
        break;

      case 'save-dfx':
      case 'save-dfdx':
        saveAsDFX();
        break;

      case 'save-dfd':
        saveAsClassicDFD();
        break;

      case 'share-link':
        openShareLinkModal();
        break;

      case 'export-svg':
        downloadSVG();
        break;

      case 'export-png':
        downloadPNG();
        break;

      case 'exit-app':
        if (window.electronAPI && window.electronAPI.exitApp) {
          window.electronAPI.exitApp();
        } else {
          window.close();
        }
        break;

      case 'undo':
        undo();
        break;

      case 'redo':
        redo();
        break;

      case 'edit-selected':
        if (state.selectedNodeId) openEditNodeModal(state.selectedNodeId);
        break;

      case 'copy-selected':
        copySelectedNode();
        break;

      case 'cut-selected':
        cutSelectedNode();
        break;

      case 'paste-selected':
        pasteClipboardNode();
        break;

      case 'delete-selected':
        deleteSelectedNode();
        break;

      case 'tool-cursor':
        setActiveTool('CURSOR');
        break;

      case 'tool-ASIGNACION':
      case 'tool-CICLOMIENTRAS':
      case 'tool-CICLOPARA':
      case 'tool-DECISION':
      case 'tool-LECTURA':
      case 'tool-IMPRESION':
      case 'tool-LLAMADA':
        setActiveTool(action.replace('tool-', ''));
        break;

      case 'new-subprogram':
        createNewSubprogramInteractive();
        break;

      case 'delete-subprogram':
        if (state.project.activeSheetIndex > 0) {
          deleteSubprogramAtIndex(state.project.activeSheetIndex);
        } else {
          showAlertModal('Aviso', 'El algoritmo Principal no puede ser eliminado.');
        }
        break;

      case 'zoom-in':
        state.zoom = Math.min(2.5, Number((state.zoom + 0.15).toFixed(2)));
        applyViewportTransform();
        break;

      case 'zoom-out':
        state.zoom = Math.max(0.35, Number((state.zoom - 0.15).toFixed(2)));
        applyViewportTransform();
        break;

      case 'zoom-reset':
        centerDiagram();
        break;

      case 'toggle-panel':
        if (window.innerWidth <= 768) {
          dom.inspectorPanel.classList.toggle('open-panel');
        } else {
          dom.inspectorPanel.classList.toggle('hidden');
        }
        renderCanvas();
        break;

      case 'toggle-console':
        dom.consoleDrawer.classList.toggle('collapsed');
        renderCanvas();
        break;

      case 'run-start':
        if (interpreter.status === 'PAUSED') {
          interpreter.resume();
        } else {
          logToConsole('Iniciando ejecución del diagrama...', 'info');
          interpreter.start(state.project, 'RUN');
        }
        break;

      case 'run-step':
        if (interpreter.status === 'IDLE' || interpreter.status === 'ERROR') {
          logToConsole('Iniciando depuración Paso a Paso...', 'info');
          interpreter.start(state.project, 'STEP');
        } else {
          interpreter.pause();
          interpreter.stepOnce();
        }
        break;

      case 'run-pause':
        interpreter.pause();
        break;

      case 'run-stop':
        interpreter.stop();
        logToConsole('Ejecución detenida.', 'info');
        break;

      case 'open-evaluator':
        openEvaluatorModal();
        break;

      case 'angles-deg':
        state.project.anglesInDegrees = true;
        refreshAll();
        break;

      case 'angles-rad':
        state.project.anglesInDegrees = false;
        refreshAll();
        break;

      case 'theme-dark':
        dom.themeSelector.value = 'modern-dark';
        document.documentElement.setAttribute('data-theme', 'modern-dark');
        refreshAll();
        break;

      case 'theme-light':
        dom.themeSelector.value = 'modern-light';
        document.documentElement.setAttribute('data-theme', 'modern-light');
        refreshAll();
        break;

      case 'theme-retro':
        dom.themeSelector.value = 'retro-classic';
        document.documentElement.setAttribute('data-theme', 'retro-classic');
        refreshAll();
        break;

      case 'open-help':
        openHelpModal();
        break;

      case 'open-about':
        openAboutModal();
        break;
    }
  }

  // Inicialización de PWA (Service Worker + Botón Instalar)
  let deferredPwaPrompt = null;

  function initPWA() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      if (dom.btnInstallPwa) {
        dom.btnInstallPwa.classList.remove('hidden');
      }
    });

    if (dom.btnInstallPwa) {
      dom.btnInstallPwa.addEventListener('click', async () => {
        if (!deferredPwaPrompt) return;
        deferredPwaPrompt.prompt();
        await deferredPwaPrompt.userChoice;
        deferredPwaPrompt = null;
        dom.btnInstallPwa.classList.add('hidden');
      });
    }
  }

  // Inicialización al cargar la página
  window.addEventListener('DOMContentLoaded', () => {
    initDOMRefs();
    initInterpreter();
    bindEvents();
    initPWA();

    const yearEl = document.getElementById('credits-year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // 1. Prioridad máxima: ¿Viene un diagrama compartido en el hash de la URL (#dfx=... o retrocompatible #dfdx=...)?
    let loadedInitial = false;
    if (window.location.hash && (window.location.hash.startsWith('#dfx=') || window.location.hash.startsWith('#dfdx='))) {
      try {
        const shared = extractProjectFromHash(window.location.hash);
        if (shared) {
          state.project = shared.project;
          state.fileName = shared.fileName;
          loadedInitial = true;
          logToConsole(`Diagrama cargado desde enlace compartido: "${shared.fileName}".`, 'success');
        }
      } catch (err) {
        logToConsole(`El enlace compartido no pudo abrirse: ${err.message}`, 'error');
      }
    }

    // 2. Segunda prioridad: ¿Existe una sesión autoguardada en localStorage?
    if (!loadedInitial) {
      const saved = loadAutosave();
      if (saved && saved.project) {
        state.project = saved.project;
        state.fileName = saved.fileName || 'Sin_titulo.dfx';
        if (saved.theme) {
          dom.themeSelector.value = saved.theme;
          document.documentElement.setAttribute('data-theme', saved.theme);
        }
        loadedInitial = true;
        logToConsole(`Sesión recuperada automáticamente (${state.fileName}).`, 'info');
      }
    }

    // 3. Por defecto: Cargar el primer ejemplo interactivo
    if (!loadedInitial) {
      state.project = EXAMPLES[0].build();
      state.fileName = 'Suma_Promedio.dfx';
    }

    refreshAll();
  });
})(window);
