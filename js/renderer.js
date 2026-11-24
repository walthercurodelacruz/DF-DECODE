/**
 * df-decode v1.0 — Motor de Layout Automático y Renderizado SVG
 *
 * Implementación original en SVG vectorial inspirada en la disposición clásica de DFD:
 * - Calcula recursivamente el ancho izquierdo (leftW), ancho derecho (rightW) y alto (height)
 *   de cada nodo y sub-rama para evitar cualquier colisión.
 * - Dibuja todas las figuras clásicas de diagramas de flujo DFD:
 *   * Inicio / Fin / Subprograma / Regrese (Cápsula redondeada)
 *   * Asignación (Rectángulo con hasta 3 líneas visibles)
 *   * Lectura (Trapecio inclinado a la derecha)
 *   * Impresión / Salida (Cono / pantalla clásica de DFD)
 *   * Decisión (Rombo con ramas Sí / No a izquierda y derecha)
 *   * Ciclo Mientras (Pentágono superior + círculo de Cierre)
 *   * Ciclo Para (Hexágono superior + círculo de Cierre)
 *   * Llamada (Rectángulo con doble barra lateral)
 * - Genera puntos de inserción (hotspots "+") en cada arista cuando el usuario selecciona
 *   una herramienta de creación en la paleta.
 */

(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const V_GAP = 34;         // Distancia vertical entre bloques
  const BRANCH_GAP = 42;    // Separación horizontal mínima entre ramas Sí/No

  function el(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) {
        node.setAttribute(k, String(v));
      }
    }
    for (const c of children) {
      if (typeof c === 'string') {
        node.appendChild(document.createTextNode(c));
      } else if (c) {
        node.appendChild(c);
      }
    }
    return node;
  }

  function truncateLabel(str, maxChars = 22) {
    const s = String(str || '').trim();
    if (!s) return '';
    return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s;
  }

  /**
   * Calcula las dimensiones intrínsecas de un nodo simple
   */
  function getBoxMetrics(node) {
    switch (node.type) {
      case 'INICIO':
      case 'FIN':
      case 'REGRESE':
        return { w: 116, h: 40 };
      case 'SUBPROGRAMA':
        return { w: 185, h: 44 };
      case 'ASIGNACION': {
        const assigns = (node.assignments || []).filter(a => a.target || a.expr);
        const count = Math.max(1, assigns.length);
        return { w: 170, h: 20 + count * 18 };
      }
      case 'LECTURA':
        return { w: 146, h: 42 };
      case 'IMPRESION':
        return { w: 152, h: 44 };
      case 'LLAMADA':
        return { w: 154, h: 42 };
      case 'DECISION':
        return { w: 138, h: 58 };
      case 'CICLOMIENTRAS':
        return { w: 150, h: 48 };
      case 'CICLOPARA':
        return { w: 162, h: 46 };
      case 'CIERRE':
        return { w: 32, h: 32 };
      default:
        return { w: 130, h: 42 };
    }
  }

  /**
   * Fase 1: Medición recursiva (Acomoda)
   * Retorna un árbol de layout con { leftW, rightW, height } para una secuencia de nodos
   */
  function measureSequence(nodeList) {
    let maxLeftW = 80;
    let maxRightW = 80;
    let totalHeight = V_GAP; // Espacio para la flecha inicial antes del primer nodo
    const items = [];

    for (const node of nodeList) {
      const m = measureNode(node);
      items.push(m);
      if (m.leftW > maxLeftW) maxLeftW = m.leftW;
      if (m.rightW > maxRightW) maxRightW = m.rightW;
      totalHeight += m.height + V_GAP;
    }

    return {
      items,
      leftW: maxLeftW,
      rightW: maxRightW,
      height: totalHeight
    };
  }

  function measureNode(node) {
    const box = getBoxMetrics(node);

    if (node.type === 'DECISION') {
      const leftList = node.yesLeft ? (node.yesBranch || []) : (node.noBranch || []);
      const rightList = node.yesLeft ? (node.noBranch || []) : (node.yesBranch || []);

      const leftSeq = measureSequence(leftList);
      const rightSeq = measureSequence(rightList);

      const branchOffsetLeft = Math.max(box.w / 2 + 35, leftSeq.rightW + BRANCH_GAP / 2);
      const branchOffsetRight = Math.max(box.w / 2 + 35, rightSeq.leftW + BRANCH_GAP / 2);

      const totalLeftW = branchOffsetLeft + leftSeq.leftW + 20;
      const totalRightW = branchOffsetRight + rightSeq.rightW + 20;
      const branchesHeight = Math.max(leftSeq.height, rightSeq.height, 56);
      const closeBox = getBoxMetrics({ type: 'CIERRE' });

      return {
        node,
        box,
        closeBox,
        leftSeq,
        rightSeq,
        branchOffsetLeft,
        branchOffsetRight,
        leftW: totalLeftW,
        rightW: totalRightW,
        branchesHeight,
        height: box.h + branchesHeight + closeBox.h
      };
    }

    if (node.type === 'CICLOMIENTRAS' || node.type === 'CICLOPARA') {
      const bodySeq = measureSequence(node.body || []);
      const closeBox = getBoxMetrics({ type: 'CIERRE' });
      const loopReturnX = Math.max(box.w / 2 + 34, bodySeq.leftW + 26);

      return {
        node,
        box,
        closeBox,
        bodySeq,
        loopReturnX,
        leftW: loopReturnX + 20,
        rightW: Math.max(box.w / 2 + 24, bodySeq.rightW + 20),
        height: box.h + bodySeq.height + closeBox.h
      };
    }

    return {
      node,
      box,
      leftW: box.w / 2 + 20,
      rightW: box.w / 2 + 20,
      height: box.h
    };
  }

  /**
   * Fase 2: Ubicación y Dibujo en capas SVG (edges, hotspots, nodes)
   */
  function renderSheetToSVG(sheet, svgLayers, state) {
    const { edgesLayer, hotspotsLayer, nodesLayer } = svgLayers;
    edgesLayer.innerHTML = '';
    hotspotsLayer.innerHTML = '';
    nodesLayer.innerHTML = '';

    const startVirtual = {
      id: sheet.startId,
      type: sheet.isMain ? 'INICIO' : 'SUBPROGRAMA',
      sheetRef: sheet
    };
    const endVirtual = {
      id: sheet.endId,
      type: sheet.isMain ? 'FIN' : 'REGRESE',
      sheetRef: sheet
    };

    const startBox = getBoxMetrics(startVirtual);
    const endBox = getBoxMetrics(endVirtual);
    const mainSeq = measureSequence(sheet.body || []);

    const centerX = 0;
    let curY = 40;

    // 1. Dibujar Nodo Inicio / Subprograma
    drawSingleNode(startVirtual, centerX, curY + startBox.h / 2, startBox, nodesLayer, state);
    curY += startBox.h;

    // 2. Dibujar Secuencia Principal
    curY = drawSequence(
      mainSeq,
      'ROOT',
      centerX,
      curY,
      edgesLayer,
      hotspotsLayer,
      nodesLayer,
      state
    );

    // 3. Dibujar Nodo Fin / Regrese
    drawSingleNode(endVirtual, centerX, curY + endBox.h / 2, endBox, nodesLayer, state);

    const totalHeight = curY + endBox.h + 60;
    const padLeft = Math.max(mainSeq.leftW, 100);
    const padRight = Math.max(mainSeq.rightW, 100);
    return {
      minX: -padLeft,
      maxX: padRight,
      width: padLeft + padRight,
      height: totalHeight
    };
  }

  function drawArrowLine(x1, y1, x2, y2, edgesLayer, withArrow = true) {
    const line = el('line', {
      x1, y1, x2, y2,
      class: 'flow-line',
      'marker-end': withArrow ? 'url(#arrow-head)' : null
    });
    edgesLayer.appendChild(line);
  }

  function drawPolyline(points, edgesLayer, withArrow = false) {
    const poly = el('polyline', {
      points: points.map(p => `${p[0]},${p[1]}`).join(' '),
      class: 'flow-line',
      'marker-end': withArrow ? 'url(#arrow-head)' : null
    });
    edgesLayer.appendChild(poly);
  }

  function drawHotspot(containerId, index, x, y, hotspotsLayer, state) {
    if (!state.activeTool || state.activeTool === 'CURSOR') return;

    const g = el('g', {
      class: 'insert-hotspot',
      transform: `translate(${x}, ${y})`,
      'data-container': containerId,
      'data-index': index
    });

    const circle = el('circle', {
      r: 8,
      cx: 0,
      cy: 0,
      class: 'hotspot-bg'
    });
    const plus = el('text', { x: 0, y: 0 }, ['+']);
    g.appendChild(circle);
    g.appendChild(plus);

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.onInsertAt) {
        state.onInsertAt(containerId, index);
      }
    });

    hotspotsLayer.appendChild(g);
  }

  function drawSequence(seqLayout, containerId, x, startY, edgesLayer, hotspotsLayer, nodesLayer, state) {
    let curY = startY;

    for (let i = 0; i < seqLayout.items.length; i++) {
      const item = seqLayout.items[i];
      // Flecha vertical antes del nodo i
      const nextY = curY + V_GAP;
      drawArrowLine(x, curY, x, nextY, edgesLayer, true);
      drawHotspot(containerId, i, x, curY + V_GAP / 2, hotspotsLayer, state);
      curY = nextY;

      curY = drawMeasuredItem(item, x, curY, edgesLayer, hotspotsLayer, nodesLayer, state);
    }

    // Flecha final después del último nodo de la secuencia
    const endY = curY + V_GAP;
    drawArrowLine(x, curY, x, endY, edgesLayer, true);
    drawHotspot(containerId, seqLayout.items.length, x, curY + V_GAP / 2, hotspotsLayer, state);

    return endY;
  }

  function drawMeasuredItem(item, x, topY, edgesLayer, hotspotsLayer, nodesLayer, state) {
    const { node, box } = item;

    if (node.type === 'DECISION') {
      const centerY = topY + box.h / 2;
      drawSingleNode(node, x, centerY, box, nodesLayer, state);

      const leftX = x - item.branchOffsetLeft;
      const rightX = x + item.branchOffsetRight;
      const leftLabel = node.yesLeft ? 'Sí' : 'No';
      const rightLabel = node.yesLeft ? 'No' : 'Sí';
      const leftContainerId = node.yesLeft ? `${node.id}:YES` : `${node.id}:NO`;
      const rightContainerId = node.yesLeft ? `${node.id}:NO` : `${node.id}:YES`;

      // Etiquetas Sí / No sobre los brazos horizontales
      nodesLayer.appendChild(
        el('text', { x: x - box.w / 2 - 14, y: centerY - 6, class: 'branch-label' }, [leftLabel])
      );
      nodesLayer.appendChild(
        el('text', { x: x + box.w / 2 + 14, y: centerY - 6, class: 'branch-label' }, [rightLabel])
      );

      const branchStartY = topY + box.h;
      // Líneas desde los vértices laterales del rombo hacia las columnas izquierda y derecha
      drawPolyline([[x - box.w / 2, centerY], [leftX, centerY], [leftX, branchStartY]], edgesLayer, false);
      drawPolyline([[x + box.w / 2, centerY], [rightX, centerY], [rightX, branchStartY]], edgesLayer, false);

      const leftEndY = drawSequence(
        item.leftSeq,
        leftContainerId,
        leftX,
        branchStartY,
        edgesLayer,
        hotspotsLayer,
        nodesLayer,
        state
      );
      const rightEndY = drawSequence(
        item.rightSeq,
        rightContainerId,
        rightX,
        branchStartY,
        edgesLayer,
        hotspotsLayer,
        nodesLayer,
        state
      );

      const joinY = Math.max(leftEndY, rightEndY);
      const closeCenterY = joinY + item.closeBox.h / 2;
      const closeR = 6; // Pequeño nodo conector de cierre de decisión

      // Conectar ambos brazos al punto de unión central
      drawPolyline([[leftX, leftEndY], [leftX, closeCenterY], [x - closeR, closeCenterY]], edgesLayer, true);
      drawPolyline([[rightX, rightEndY], [rightX, closeCenterY], [x + closeR, closeCenterY]], edgesLayer, true);

      // Pequeño círculo conector en (x, closeCenterY)
      nodesLayer.appendChild(
        el('circle', {
          cx: x,
          cy: closeCenterY,
          r: closeR,
          fill: 'var(--shape-cierre)',
          stroke: 'var(--node-stroke)',
          'stroke-width': 1.8
        })
      );

      return joinY + item.closeBox.h;
    }

    if (node.type === 'CICLOMIENTRAS' || node.type === 'CICLOPARA') {
      const centerY = topY + box.h / 2;
      drawSingleNode(node, x, centerY, box, nodesLayer, state);

      const bodyStartY = topY + box.h;
      const bodyEndY = drawSequence(
        item.bodySeq,
        node.id,
        x,
        bodyStartY,
        edgesLayer,
        hotspotsLayer,
        nodesLayer,
        state
      );

      // Nodo Cierre (Fin Mientras / Fin Para)
      const closeCenterY = bodyEndY + item.closeBox.h / 2;
      const closeVirtual = {
        id: node.closeId,
        type: 'CIERRE',
        owner: node
      };
      drawSingleNode(closeVirtual, x, closeCenterY, item.closeBox, nodesLayer, state);

      // Línea de retorno del ciclo (sale por la izquierda del Cierre y regresa al bloque del Ciclo)
      const retX = x - item.loopReturnX;
      drawPolyline(
        [
          [x - item.closeBox.w / 2, closeCenterY],
          [retX, closeCenterY],
          [retX, centerY],
          [x - box.w / 2, centerY]
        ],
        edgesLayer,
        true
      );

      return bodyEndY + item.closeBox.h;
    }

    // Nodo secuencial simple (Asignación, Lectura, Impresión, Llamada)
    const centerY = topY + box.h / 2;
    drawSingleNode(node, x, centerY, box, nodesLayer, state);
    return topY + box.h;
  }

  function drawSingleNode(node, cx, cy, box, nodesLayer, state) {
    const classes = ['dfd-node'];
    if (state.selectedNodeId === node.id) classes.push('selected');
    if (state.executingNodeId === node.id) classes.push('executing');
    if (state.errorNodeId === node.id) classes.push('error-node');

    const g = el('g', {
      class: classes.join(' '),
      transform: `translate(${cx}, ${cy})`,
      'data-node-id': node.id,
      'data-node-type': node.type
    });

    const hw = box.w / 2;
    const hh = box.h / 2;

    switch (node.type) {
      case 'INICIO':
      case 'FIN':
      case 'REGRESE': {
        const label = node.type === 'INICIO' ? 'Inicio' : (node.type === 'FIN' ? 'Fin' : 'Regrese');
        g.appendChild(
          el('rect', {
            x: -hw,
            y: -hh,
            width: box.w,
            height: box.h,
            rx: hh,
            ry: hh,
            fill: 'var(--shape-inicio)',
            class: 'node-shape'
          })
        );
        g.appendChild(el('text', { x: 0, y: 0, class: 'node-label', 'font-weight': 'bold' }, [label]));
        break;
      }

      case 'SUBPROGRAMA': {
        const s = node.sheetRef;
        const title = s.params ? `${s.name}(${s.params})` : s.name;
        g.appendChild(
          el('rect', {
            x: -hw,
            y: -hh,
            width: box.w,
            height: box.h,
            rx: hh,
            ry: hh,
            fill: 'var(--shape-inicio)',
            class: 'node-shape'
          })
        );
        g.appendChild(
          el('text', { x: 0, y: 0, class: 'node-label', 'font-weight': 'bold' }, [truncateLabel(title, 24)])
        );
        break;
      }

      case 'ASIGNACION': {
        g.appendChild(
          el('rect', {
            x: -hw,
            y: -hh,
            width: box.w,
            height: box.h,
            rx: 3,
            ry: 3,
            fill: 'var(--shape-asignacion)',
            class: 'node-shape'
          })
        );
        const assigns = (node.assignments || []).filter(a => a.target || a.expr);
        if (assigns.length === 0) {
          g.appendChild(el('text', { x: 0, y: 0, class: 'node-label' }, ['(Asignación)']));
        } else {
          const lineH = 16;
          const startOffset = -((assigns.length - 1) * lineH) / 2;
          assigns.forEach((a, idx) => {
            const txt = `${a.target || '?'} ← ${a.expr || '?'}`;
            g.appendChild(
              el('text', { x: 0, y: startOffset + idx * lineH, class: 'node-label' }, [truncateLabel(txt, 22)])
            );
          });
        }
        break;
      }

      case 'LECTURA': {
        // Trapecio clásico de Lectura en DFD (borde derecho inclinado)
        const pts = [
          `${-hw},${-hh}`,
          `${hw},${-hh}`,
          `${hw - 16},${hh}`,
          `${-hw},${hh}`
        ].join(' ');
        g.appendChild(
          el('polygon', {
            points: pts,
            fill: 'var(--shape-lectura)',
            class: 'node-shape'
          })
        );
        // Pequeña flecha diagonal de entrada en la esquina superior izquierda
        g.appendChild(
          el('text', { x: -hw + 14, y: -hh + 10, class: 'node-sublabel' }, ['↘'])
        );
        g.appendChild(
          el('text', { x: -4, y: 2, class: 'node-label' }, [truncateLabel(node.text || '(Lectura)', 18)])
        );
        break;
      }

      case 'IMPRESION': {
        // Figura clásica de Impresión / Salida en DFD: cono apuntando a la izquierda con lado derecho curvo
        const d = [
          `M ${-hw} 0`,
          `L ${-hw + 26} ${-hh}`,
          `L ${hw - 12} ${-hh}`,
          `A 12 ${hh} 0 0 1 ${hw - 12} ${hh}`,
          `L ${-hw + 26} ${hh}`,
          'Z'
        ].join(' ');
        g.appendChild(
          el('path', {
            d,
            fill: 'var(--shape-impresion)',
            class: 'node-shape'
          })
        );
        g.appendChild(
          el('text', { x: 6, y: 0, class: 'node-label' }, [truncateLabel(node.text || '(Salida)', 18)])
        );
        break;
      }

      case 'DECISION': {
        // Rombo
        const pts = [
          `0,${-hh}`,
          `${hw},0`,
          `0,${hh}`,
          `${-hw},0`
        ].join(' ');
        g.appendChild(
          el('polygon', {
            points: pts,
            fill: 'var(--shape-decision)',
            class: 'node-shape'
          })
        );
        g.appendChild(
          el('text', { x: 0, y: 0, class: 'node-label' }, [truncateLabel(node.condition || '(Condición)', 15)])
        );
        break;
      }

      case 'CICLOMIENTRAS': {
        // Pentágono apuntando hacia abajo (clásico MQ de DFD)
        const pts = [
          `${-hw},${-hh}`,
          `${hw},${-hh}`,
          `${hw},${hh - 14}`,
          `0,${hh}`,
          `${-hw},${hh - 14}`
        ].join(' ');
        g.appendChild(
          el('polygon', {
            points: pts,
            fill: 'var(--shape-mientras)',
            class: 'node-shape'
          })
        );
        g.appendChild(
          el('text', { x: 0, y: -hh + 10, class: 'node-sublabel' }, ['MIENTRAS'])
        );
        g.appendChild(
          el('text', { x: 0, y: 3, class: 'node-label' }, [truncateLabel(node.condition || '(Condición)', 18)])
        );
        break;
      }

      case 'CICLOPARA': {
        // Hexágono horizontal clásico de Ciclo Para en DFD
        const pts = [
          `${-hw + 16},${-hh}`,
          `${hw - 16},${-hh}`,
          `${hw},0`,
          `${hw - 16},${hh}`,
          `${-hw + 16},${hh}`,
          `${-hw},0`
        ].join(' ');
        g.appendChild(
          el('polygon', {
            points: pts,
            fill: 'var(--shape-para)',
            class: 'node-shape'
          })
        );
        const label = `${node.counter || 'i'} ← ${node.start || 1} , ${node.end || 10} , ${node.step || 1}`;
        g.appendChild(
          el('text', { x: 0, y: -hh + 10, class: 'node-sublabel' }, ['PARA'])
        );
        g.appendChild(
          el('text', { x: 0, y: 4, class: 'node-label' }, [truncateLabel(label, 20)])
        );
        break;
      }

      case 'LLAMADA': {
        g.appendChild(
          el('rect', {
            x: -hw,
            y: -hh,
            width: box.w,
            height: box.h,
            fill: 'var(--shape-llamada)',
            class: 'node-shape'
          })
        );
        // Barras verticales laterales de Llamada
        g.appendChild(
          el('line', { x1: -hw + 10, y1: -hh, x2: -hw + 10, y2: hh, class: 'node-shape' })
        );
        g.appendChild(
          el('line', { x1: hw - 10, y1: -hh, x2: hw - 10, y2: hh, class: 'node-shape' })
        );
        const callTxt = node.subName
          ? (node.args ? `${node.subName}(${node.args})` : node.subName)
          : '(Llamada)';
        g.appendChild(
          el('text', { x: 0, y: 0, class: 'node-label' }, [truncateLabel(callTxt, 18)])
        );
        break;
      }

      case 'CIERRE': {
        g.appendChild(
          el('circle', {
            cx: 0,
            cy: 0,
            r: box.w / 2,
            fill: 'var(--shape-cierre)',
            class: 'node-shape'
          })
        );
        const txt = node.owner && node.owner.type === 'CICLOPARA' ? 'FinP' : 'FinM';
        g.appendChild(
          el('text', { x: 0, y: 0, class: 'node-sublabel' }, [txt])
        );
        break;
      }
    }

    // Eventos de selección y edición con doble clic
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.onSelectNode) {
        state.onSelectNode(node.id);
      }
    });

    g.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (state.onEditNode) {
        state.onEditNode(node.id);
      }
    });

    nodesLayer.appendChild(g);
  }

  global.DFDRenderer = {
    getBoxMetrics,
    measureSequence,
    measureNode,
    renderSheetToSVG
  };
})(window);
