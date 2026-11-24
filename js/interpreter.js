/**
 * df-decode v1.0 — Motor de Ejecución Paso a Paso y Depuración (Intérprete Asíncrono)
 *
 * Implementación original de ejecución e inspección inspirada en el software clásico DFD:
 * - Basado en generadores asíncronos (yield por cada objeto del diagrama) para permitir:
 *   * Ejecución continua con velocidad ajustable (slider)
 *   * Ejecución Paso a Paso (F7)
 *   * Pausa y Detención en cualquier instante
 *   * Subprogramas y Recursión con paso de parámetros por valor/referencia (como en Factorial.dfd)
 *   * Protección contra bucles infinitos
 *   * Registro completo para la Prueba de Escritorio (Trace Table)
 */

(function (global) {
  'use strict';

  const {
    SymbolTable,
    splitTopLevelCommas,
    evaluateExpression,
    parseTargetLValue,
    assignToTarget,
    formatDFDValue,
    formatDFDValueForWatch
  } = global.DFDEvaluator;

  class DFDInterpreter {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.reset();
    }

    reset() {
      this.status = 'IDLE'; // IDLE | RUNNING | PAUSED | WAITING_IO | ERROR
      this.project = null;
      this.callStack = []; // [{ sheetName, sheetIndex, symbolTable }]
      this.traceLog = [];  // [{ step, sheetName, nodeType, detail }]
      this.stepCount = 0;
      this.maxSteps = 500000;
      this.generator = null;
      this.timer = null;
      this.inBurst = false;
      this.currentSheetIndex = 0;
      this.currentNodeId = null;
      this.errorNodeId = null;
    }

    get activeSymbolTable() {
      if (this.callStack.length === 0) return null;
      return this.callStack[this.callStack.length - 1].symbolTable;
    }

    start(project, mode = 'RUN') {
      this.stop();
      this.project = project;
      const mainSheet = project.sheets[0];
      if (!mainSheet) return;

      this.callStack = [
        {
          sheetName: mainSheet.name || 'Principal',
          sheetIndex: 0,
          symbolTable: new SymbolTable()
        }
      ];
      this.traceLog = [];
      this.stepCount = 0;
      this.errorNodeId = null;
      this.generator = this.executeSheetGenerator(mainSheet, 0);

      if (mode === 'STEP') {
        this.status = 'PAUSED';
        this.notifyState();
        this.stepOnce();
      } else {
        this.status = 'RUNNING';
        this.notifyState();
        this.scheduleNextTick();
      }
    }

    pause() {
      if (this.status === 'RUNNING') {
        this.inBurst = false;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.status = 'PAUSED';
        this.notifyState();
      }
    }

    resume() {
      if (this.status === 'PAUSED') {
        this.status = 'RUNNING';
        this.notifyState();
        this.scheduleNextTick();
      }
    }

    stop() {
      this.inBurst = false;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.status = 'IDLE';
      this.currentNodeId = null;
      this.generator = null;
      this.notifyState();
    }

    scheduleNextTick() {
      if (this.status !== 'RUNNING') return;
      const delay = this.callbacks.getSpeedDelay ? this.callbacks.getSpeedDelay() : 35;
      if (delay <= 0) {
        this.runBurst();
      } else {
        this.timer = setTimeout(() => {
          this.stepOnce();
        }, delay);
      }
    }

    async runBurst() {
      if (this.status !== 'RUNNING' || !this.generator) return;
      this.inBurst = true;
      try {
        const BATCH_SIZE = 250;
        let count = 0;
        while (this.status === 'RUNNING' && count < BATCH_SIZE) {
          count++;
          const res = await this.generator.next();
          if (res.done) {
            this.status = 'IDLE';
            this.currentNodeId = null;
            this.inBurst = false;
            this.notifyState();
            if (this.callbacks.onFinished) {
              this.callbacks.onFinished(this.traceLog);
            }
            return;
          }
          if (this.status === 'WAITING_IO') {
            this.inBurst = false;
            return;
          }
        }
        this.inBurst = false;
        this.notifyState();
        if (this.status === 'RUNNING') {
          this.timer = setTimeout(() => {
            this.scheduleNextTick();
          }, 0);
        }
      } catch (err) {
        this.inBurst = false;
        if (this.status === 'IDLE' || (err && err.isCancelled)) {
          this.status = 'IDLE';
          this.currentNodeId = null;
          this.generator = null;
          this.notifyState();
          return;
        }
        this.status = 'ERROR';
        this.errorNodeId = this.currentNodeId;
        this.notifyState();
        if (this.callbacks.onError) {
          this.callbacks.onError(err.message || String(err), this.currentNodeId, this.currentSheetIndex);
        }
      }
    }

    async stepOnce() {
      if (!this.generator) return;
      if (this.status === 'WAITING_IO') return;

      try {
        const res = await this.generator.next();
        if (res.done) {
          this.status = 'IDLE';
          this.currentNodeId = null;
          this.notifyState();
          if (this.callbacks.onFinished) {
            this.callbacks.onFinished(this.traceLog);
          }
          return;
        }

        // Si continúa en modo RUNNING, programar el siguiente paso
        if (this.status === 'RUNNING') {
          this.scheduleNextTick();
        } else {
          this.notifyState();
        }
      } catch (err) {
        if (this.status === 'IDLE' || (err && err.isCancelled)) {
          this.status = 'IDLE';
          this.currentNodeId = null;
          this.generator = null;
          this.notifyState();
          return;
        }
        this.status = 'ERROR';
        this.errorNodeId = this.currentNodeId;
        this.notifyState();
        if (this.callbacks.onError) {
          this.callbacks.onError(err.message || String(err), this.currentNodeId, this.currentSheetIndex);
        }
      }
    }

    recordStep(sheetIndex, nodeId, nodeType, detail) {
      this.stepCount++;
      if (this.stepCount > this.maxSteps) {
        throw new Error(`Posible ciclo infinito detectado (se superaron ${this.maxSteps} pasos).`);
      }
      this.currentSheetIndex = sheetIndex;
      this.currentNodeId = nodeId;
      const sheetName = this.project.sheets[sheetIndex]?.name || 'Principal';
      if (this.traceLog.length >= 5000) {
        this.traceLog.shift();
      }
      this.traceLog.push({
        step: this.stepCount,
        sheetName,
        nodeType,
        detail
      });
      if (!this.inBurst) {
        this.notifyState();
      }
    }

    notifyState() {
      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange({
          status: this.status,
          sheetIndex: this.currentSheetIndex,
          nodeId: this.currentNodeId,
          errorNodeId: this.errorNodeId,
          symbolTable: this.activeSymbolTable,
          callStack: this.callStack,
          traceLog: this.traceLog
        });
      }
    }

    /**
     * Generador asíncrono que recorre una hoja (Principal o Subprograma)
     */
    async *executeSheetGenerator(sheet, sheetIndex) {
      const options = { anglesInDegrees: this.project.anglesInDegrees !== false };

      // Paso en nodo Inicio / Subprograma
      this.recordStep(
        sheetIndex,
        sheet.startId,
        sheet.isMain ? 'INICIO' : 'SUBPROGRAMA',
        sheet.isMain ? 'Inicio del algoritmo principal' : `Entrada a ${sheet.name}(${sheet.params || ''})`
      );
      yield;

      // Ejecutar cuerpo de la hoja
      yield* this.executeSequenceGenerator(sheet.body || [], sheetIndex, options);

      // Paso en nodo Fin / Regrese
      this.recordStep(
        sheetIndex,
        sheet.endId,
        sheet.isMain ? 'FIN' : 'REGRESE',
        sheet.isMain ? 'Fin del algoritmo' : `Retorno de ${sheet.name}`
      );
      yield;
    }

    async *executeSequenceGenerator(nodeList, sheetIndex, options) {
      for (const node of nodeList) {
        this.currentSheetIndex = sheetIndex;
        this.currentNodeId = node.id;

        switch (node.type) {
          case 'ASIGNACION': {
            const sym = this.activeSymbolTable;
            const changes = [];
            for (const item of node.assignments || []) {
              const target = (item.target || '').trim();
              const expr = (item.expr || '').trim();
              if (!target && !expr) continue;
              if (!target) throw new Error('Asignación incompleta: falta el nombre de la variable destino.');
              if (!expr) throw new Error(`Asignación incompleta para "${target}": falta la expresión.`);

              const val = evaluateExpression(expr, sym, options);
              const desc = assignToTarget(target, val, sym, options);
              changes.push(desc);
            }
            this.recordStep(sheetIndex, node.id, 'Asignación', changes.join(' ; ') || 'Sin cambios');
            yield;
            break;
          }

          case 'LECTURA': {
            const sym = this.activeSymbolTable;
            const targets = splitTopLevelCommas(node.text || '');
            if (targets.length === 0) {
              throw new Error('El objeto Lectura no tiene variables especificadas.');
            }
            const readSummary = [];
            for (const targetStr of targets) {
              // Validar L-Value antes de pedir el dato
              parseTargetLValue(targetStr, sym, options);
              this.recordStep(sheetIndex, node.id, 'Lectura', `Esperando entrada para: ${targetStr}`);

              const prevStatus = this.status;
              this.status = 'WAITING_IO';
              this.notifyState();

              const val = await this.callbacks.requestInput(targetStr);
              if (this.status === 'IDLE') return;
              this.status = prevStatus === 'WAITING_IO' ? 'PAUSED' : prevStatus;

              const desc = assignToTarget(targetStr, val, sym, options);
              readSummary.push(desc);
              this.notifyState();
            }
            this.recordStep(sheetIndex, node.id, 'Lectura', readSummary.join(' , '));
            yield;
            break;
          }

          case 'IMPRESION': {
            const sym = this.activeSymbolTable;
            const exprs = splitTopLevelCommas(node.text || '');
            if (exprs.length === 0) {
              throw new Error('El objeto Salida/Impresión está vacío.');
            }
            const parts = exprs.map(e => {
              const v = evaluateExpression(e, sym, options);
              return formatDFDValue(v);
            });
            const outputText = parts.join('');
            this.recordStep(sheetIndex, node.id, 'Salida', `Imprime: ${outputText}`);

            const prevStatus = this.status;
            this.status = 'WAITING_IO';
            this.notifyState();

            await this.callbacks.displayOutput(outputText);
            if (this.status === 'IDLE') return;
            this.status = prevStatus === 'WAITING_IO' ? 'PAUSED' : prevStatus;
            this.notifyState();
            yield;
            break;
          }

          case 'DECISION': {
            const sym = this.activeSymbolTable;
            const condVal = evaluateExpression(node.condition, sym, options);
            if (typeof condVal !== 'boolean') {
              throw new Error(`La condición de la Decisión ("${node.condition}") debe producir un valor Lógico (.V. o .F.).`);
            }
            this.recordStep(
              sheetIndex,
              node.id,
              'Decisión',
              `${node.condition} → ${condVal ? '.V. (Sí)' : '.F. (No)'}`
            );
            yield;

            if (condVal) {
              yield* this.executeSequenceGenerator(node.yesBranch || [], sheetIndex, options);
            } else {
              yield* this.executeSequenceGenerator(node.noBranch || [], sheetIndex, options);
            }
            break;
          }

          case 'CICLOMIENTRAS': {
            while (true) {
              const sym = this.activeSymbolTable;
              const condVal = evaluateExpression(node.condition, sym, options);
              if (typeof condVal !== 'boolean') {
                throw new Error(`La condición del Ciclo Mientras ("${node.condition}") debe ser Lógica (.V. o .F.).`);
              }
              this.recordStep(
                sheetIndex,
                node.id,
                'Mientras',
                `${node.condition} → ${condVal ? '.V. (Entra)' : '.F. (Sale)'}`
              );
              yield;

              if (!condVal) break;

              yield* this.executeSequenceGenerator(node.body || [], sheetIndex, options);

              this.recordStep(sheetIndex, node.closeId, 'Fin Mientras', 'Regresa a evaluar condición');
              yield;
            }
            break;
          }

          case 'CICLOPARA': {
            const sym = this.activeSymbolTable;
            const counterName = (node.counter || '').trim();
            if (!counterName) {
              throw new Error('El Ciclo Para requiere una variable contadora.');
            }
            const startVal = evaluateExpression(node.start, sym, options);
            const endVal = evaluateExpression(node.end, sym, options);
            const stepVal = evaluateExpression(node.step, sym, options);

            if (typeof startVal !== 'number' || typeof endVal !== 'number' || typeof stepVal !== 'number') {
              throw new Error('Los límites e incremento del Ciclo Para deben ser numéricos.');
            }
            if (stepVal === 0) {
              throw new Error('El incremento (paso) del Ciclo Para no puede ser 0.');
            }

            assignToTarget(counterName, startVal, sym, options);

            while (true) {
              const curVal = evaluateExpression(counterName, sym, options);
              const keepGoing = stepVal > 0 ? curVal <= endVal : curVal >= endVal;
              this.recordStep(
                sheetIndex,
                node.id,
                'Para',
                `${counterName} = ${formatDFDValue(curVal)} (Hasta ${formatDFDValue(endVal)}, Paso ${formatDFDValue(stepVal)}) → ${keepGoing ? '.V.' : '.F.'}`
              );
              yield;

              if (!keepGoing) break;

              yield* this.executeSequenceGenerator(node.body || [], sheetIndex, options);

              // En Cierre Para se incrementa la variable contadora
              const updatedVal = evaluateExpression(counterName, sym, options) + stepVal;
              assignToTarget(counterName, updatedVal, sym, options);
              this.recordStep(
                sheetIndex,
                node.closeId,
                'Fin Para',
                `Incrementa ${counterName} ← ${formatDFDValue(updatedVal)}`
              );
              yield;
            }
            break;
          }

          case 'LLAMADA': {
            const subName = (node.subName || '').trim();
            if (!subName) {
              throw new Error('El objeto Llamada no especifica el nombre del Subprograma.');
            }
            const subIndex = this.project.sheets.findIndex(
              (s, idx) => idx > 0 && s.name.toUpperCase() === subName.toUpperCase()
            );
            if (subIndex === -1) {
              throw new Error(`No existe ningún Subprograma llamado "${subName}".`);
            }

            const targetSheet = this.project.sheets[subIndex];
            const formalParams = splitTopLevelCommas(targetSheet.params || '');
            const actualArgs = splitTopLevelCommas(node.args || '');

            if (formalParams.length !== actualArgs.length) {
              throw new Error(
                `El subprograma "${targetSheet.name}" espera ${formalParams.length} parámetro(s) y recibió ${actualArgs.length}.`
              );
            }

            const callerSym = this.activeSymbolTable;
            const calleeSym = new SymbolTable(callerSym);

            // Mapeo de argumentos (en DFD los parámetros pueden pasarse por referencia si son variables simples
            // incluso aún no inicializadas en el llamador, como `Fact(X, N)` donde X recibe el resultado)
            const refBindings = []; // [{ formalName, callerTargetStr }]

            for (let i = 0; i < formalParams.length; i++) {
              const formal = formalParams[i].trim();
              const actual = actualArgs[i].trim();

              // ¿Es el argumento actual un L-Value válido (variable o elemento de vector)?
              let isLValue = false;
              try {
                parseTargetLValue(actual, callerSym, options);
                isLValue = true;
              } catch (_) {
                isLValue = false;
              }

              if (isLValue) {
                const parsedLV = parseTargetLValue(actual, callerSym, options);
                refBindings.push({ formalName: formal, callerTargetStr: actual, resolvedLV: parsedLV });
                // Si ya tiene valor en el llamador (escalar o arreglo completo), copiarlo al parámetro formal
                if (parsedLV.indices === null && callerSym.has(parsedLV.name)) {
                  const rawEntry = callerSym.vars.get(parsedLV.name.toUpperCase()).value;
                  // Si es un arreglo, pasamos la referencia del arreglo para que el subprograma pueda leer/modificar sus celdas
                  calleeSym.setScalar(formal, rawEntry);
                } else {
                  try {
                    const currentVal = evaluateExpression(actual, callerSym, options);
                    calleeSym.setScalar(formal, currentVal);
                  } catch (_) {
                    // Variable de salida pura (ej. X en Fact(X, N)): se inicializa dentro del subprograma
                  }
                }
              } else {
                const val = evaluateExpression(actual, callerSym, options);
                calleeSym.setScalar(formal, val);
              }
            }

            this.recordStep(
              sheetIndex,
              node.id,
              'Llamada',
              `Invoca ${targetSheet.name}(${node.args || ''})`
            );
            yield;

            // Apilar nuevo frame de activación
            this.callStack.push({
              sheetName: targetSheet.name,
              sheetIndex: subIndex,
              symbolTable: calleeSym
            });

            yield* this.executeSheetGenerator(targetSheet, subIndex);

            // Desapilar y copiar de vuelta los parámetros por referencia (como en DFD original)
            this.callStack.pop();
            for (const binding of refBindings) {
              if (calleeSym.has(binding.formalName)) {
                const rawVal = calleeSym.vars.get(binding.formalName.toUpperCase()).value;
                if (binding.resolvedLV.indices === null) {
                  callerSym.setScalar(binding.resolvedLV.name, rawVal);
                } else {
                  callerSym.setArrayElement(binding.resolvedLV.name, binding.resolvedLV.indices, rawVal);
                }
              }
            }

            this.currentSheetIndex = sheetIndex;
            this.currentNodeId = node.id;
            this.notifyState();
            break;
          }
        }
      }
    }
  }

  global.DFDInterpreter = DFDInterpreter;
})(window);
