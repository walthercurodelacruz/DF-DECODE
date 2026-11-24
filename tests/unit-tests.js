/**
 * df-decode — Suite Completa de Pruebas Unitarias e Integración
 *
 * Compatible con:
 * 1. Navegador Web (tests.html)
 * 2. Consola Node.js (`node tests/unit-tests.js`)
 *
 * Cubre:
 * - Tokenizador y Evaluador de Expresiones DFD (precedencia, tipos, cadenas, lógicos, errores)
 * - Funciones Matemáticas y de Cadenas (Grados vs Radianes, SUBSTRING base 1, LEN, TRUNC, ROUND, etc.)
 * - Tabla de Símbolos, Vectores 1D y Matrices N-dimensionales (validación de subíndices enteros, ordenamiento)
 * - Modelo Estructural del Diagrama (inserción en ramas anidadas, duplicación de nodos, eliminación, conteo)
 * - Serialización e Interoperabilidad (.dfx, retrocompatibilidad .dfdx y formato clásico .dfd compatible con DFD)
 * - Intérprete Asíncrono Paso a Paso (Asignación, Lectura, Salida, Decisión, Mientras, Para incremental/decremental,
 *   Subprogramas recursivos, paso de arreglos a subprogramas, detección de bucles infinitos)
 * - Generador de Código (Pseudocódigo PSeInt, Python, JavaScript, C++ sin alterar literales de cadena)
 * - Motor de Layout Geométrico SVG (`measureSequence` y `measureNode` sin colisiones)
 */

(function (global) {
  'use strict';

  // Si se ejecuta desde Node.js, cargar los módulos en global.window
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  if (isNode && !global.DFDEvaluator) {
    global.window = global;
    require('../js/evaluator.js');
    require('../js/model.js');
    require('../js/dfd-format.js');
    require('../js/storage.js');
    require('../js/codegen.js');
    require('../js/examples.js');
    require('../js/renderer.js');
    require('../js/interpreter.js');
  }

  const {
    SymbolTable,
    tokenize,
    splitTopLevelCommas,
    evaluateExpression,
    parseTargetLValue,
    assignToTarget,
    parseUserInputValue,
    formatDFDValue,
    formatDFDValueForWatch
  } = global.DFDEvaluator;

  const {
    createEmptyProject,
    createMainSheet,
    createSubprogramSheet,
    createNode,
    cloneNodeWithNewIds,
    findNodeInSheet,
    insertNodeAt,
    deleteNodeById,
    countNodesInSheet
  } = global.DFDModel;

  const {
    serializeDFX,
    parseDFX,
    serializeDFDX,
    parseDFDX,
    serializeClassicDFD,
    parseClassicDFD,
    encodeClassicDFDBytes,
    decodeFileBytes,
    loadAnyDFDFile
  } = global.DFDFormat;

  const {
    encodeProjectToShareToken,
    decodeProjectFromShareToken,
    buildShareableURL,
    extractProjectFromHash,
    saveAutosave,
    loadAutosave,
    clearAutosave
  } = global.DFDStorage;

  const { generateCode } = global.DFDCodeGen;
  const { EXAMPLES } = global.DFDExamples;
  const { measureSequence, getBoxMetrics } = global.DFDRenderer;
  const DFDInterpreter = global.DFDInterpreter;

  // Mini Framework de Aserciones sin dependencias externas
  const suites = [];
  let currentSuite = null;

  function describe(suiteName, fn) {
    currentSuite = { name: suiteName, tests: [] };
    suites.push(currentSuite);
    fn();
    currentSuite = null;
  }

  function it(testName, fn) {
    currentSuite.tests.push({ name: testName, fn });
  }

  function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
      throw new Error(`${msg ? msg + ' — ' : ''}Esperado: ${JSON.stringify(expected)}, Recibido: ${JSON.stringify(actual)}`);
    }
  }

  function assertApprox(actual, expected, tol = 1e-6, msg = '') {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
      throw new Error(`${msg ? msg + ' — ' : ''}Esperado ~${expected}, Recibido: ${actual}`);
    }
  }

  function assertDeepEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`${msg ? msg + ' — ' : ''}Esperado: ${b}, Recibido: ${a}`);
    }
  }

  function assertThrows(fn, expectedSubstring = '') {
    let threw = false;
    let errObj = null;
    try {
      fn();
    } catch (e) {
      threw = true;
      errObj = e;
    }
    if (!threw) {
      throw new Error(`Se esperaba una excepción${expectedSubstring ? ` con "${expectedSubstring}"` : ''}, pero no lanzó error.`);
    }
    if (expectedSubstring && !String(errObj.message || errObj).toLowerCase().includes(expectedSubstring.toLowerCase())) {
      throw new Error(`El error "${errObj.message}" no contiene "${expectedSubstring}".`);
    }
  }

  // Helper para ejecutar un proyecto completo en el intérprete de forma silenciosa
  async function runProjectHeadless(project, inputs = []) {
    let inputIdx = 0;
    const outputs = [];
    const interp = new DFDInterpreter({
      getSpeedDelay: () => 0,
      requestInput: async () => {
        if (inputIdx >= inputs.length) throw new Error('No hay más entradas simuladas.');
        return inputs[inputIdx++];
      },
      displayOutput: async (txt) => {
        outputs.push(txt);
      }
    });

    interp.project = project;
    const mainSym = new SymbolTable();
    interp.callStack = [{ sheetName: 'Principal', sheetIndex: 0, symbolTable: mainSym }];
    for await (const _ of interp.executeSheetGenerator(project.sheets[0], 0)) {
      // Ejecutar todos los pasos
    }
    return { outputs, symbolTable: mainSym, traceLog: interp.traceLog };
  }

  // =========================================================================
  // SUITE 1: TOKENIZADOR Y EVALUADOR DE EXPRESIONES DFD
  // =========================================================================
  describe('1. Evaluador de Expresiones y Precedencia DFD', () => {
    it('Evalúa aritmética básica respetando jerarquía (*, /, MOD antes de +, -)', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression('2 + 3 * 4', sym), 14);
      assertEqual(evaluateExpression('(2 + 3) * 4', sym), 20);
      assertEqual(evaluateExpression('17 MOD 5 + 2 * 3', sym), 8);
      assertEqual(evaluateExpression('20 / 4 - 2', sym), 3);
    });

    it('Evalúa potenciación (^) y signos unarios (+, -)', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression('2 ^ 3 ^ 2', sym), 512); // Asociatividad derecha 2^(3^2) = 2^9
      assertEqual(evaluateExpression('-5 + 12', sym), 7);
      assertEqual(evaluateExpression('-(3 + 2) * 4', sym), -20);
    });

    it('Evalúa todos los operadores relacionales (=, !=, <>, <, >, <=, >=)', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression('5 = 5', sym), true);
      assertEqual(evaluateExpression('5 != 4', sym), true);
      assertEqual(evaluateExpression('5 <> 5', sym), false);
      assertEqual(evaluateExpression('3 < 5 AND 5 <= 5', sym), true);
      assertEqual(evaluateExpression("'Ana' < 'Beto'", sym), true);
    });

    it('Evalúa todos los operadores lógicos de DFD (.V., .F., NOT, AND, NAND, OR, NOR, XOR, XNOR)', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression('.V. AND .F.', sym), false);
      assertEqual(evaluateExpression('.V. NAND .F.', sym), true);
      assertEqual(evaluateExpression('.F. OR .V.', sym), true);
      assertEqual(evaluateExpression('.F. NOR .F.', sym), true);
      assertEqual(evaluateExpression('.V. XOR .V.', sym), false);
      assertEqual(evaluateExpression('.V. XOR .F.', sym), true);
      assertEqual(evaluateExpression('.V. XNOR .V.', sym), true);
      assertEqual(evaluateExpression('NOT .F. AND .V.', sym), true);
    });

    it('Maneja cadenas con comillas simples, concatenación (+) y comillas escapadas', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression("'Hola ' + 'Mundo'", sym), 'Hola Mundo');
      assertEqual(evaluateExpression("'Free' + 'DFD'", sym), 'FreeDFD');
      assertThrows(() => evaluateExpression("'abc' + 5", sym), 'Tipos incompatibles');
    });

    it('Separa listas de argumentos con comas respetando paréntesis y comillas (splitTopLevelCommas)', () => {
      const parts = splitTopLevelCommas("'Hola, mundo', M(1, 2) + 5, SUBSTRING('A,B', 1, 2)");
      assertDeepEqual(parts, ["'Hola, mundo'", 'M(1, 2) + 5', "SUBSTRING('A,B', 1, 2)"]);
    });

    it('Detecta errores matemáticos y sintácticos (división por 0, tipos incompatibles, paréntesis)', () => {
      const sym = new SymbolTable();
      assertThrows(() => evaluateExpression('10 / 0', sym), 'división por cero');
      assertThrows(() => evaluateExpression('10 MOD 0', sym), 'módulo por cero');
      assertThrows(() => evaluateExpression('SQRT(-9)', sym), 'negativo');
      assertThrows(() => evaluateExpression("5 = '5'", sym), 'incompatibles');
      assertThrows(() => evaluateExpression('(2 + 3', sym), 'paréntesis');
    });
  });

  // =========================================================================
  // SUITE 2: FUNCIONES MATEMÁTICAS Y DE CADENAS NATIVAS DFD
  // =========================================================================
  describe('2. Funciones Matemáticas y de Cadenas (Grados vs Radianes)', () => {
    it('Calcula funciones trigonométricas en Grados (por defecto) y en Radianes', () => {
      const sym = new SymbolTable();
      assertApprox(evaluateExpression('SIN(90)', sym, { anglesInDegrees: true }), 1);
      assertApprox(evaluateExpression('COS(0)', sym, { anglesInDegrees: true }), 1);
      assertEqual(evaluateExpression('COS(90)', sym, { anglesInDegrees: true }), 0);
      assertThrows(() => evaluateExpression('TAN(90)', sym, { anglesInDegrees: true }), 'Tangente (TAN) indefinida');
      assertApprox(evaluateExpression('TAN(45)', sym, { anglesInDegrees: true }), 1);
      assertApprox(evaluateExpression('ASIN(1)', sym, { anglesInDegrees: true }), 90);

      // En radianes
      assertApprox(evaluateExpression(`SIN(${Math.PI / 2})`, sym, { anglesInDegrees: false }), 1);
    });

    it('Calcula TRUNC, ROUND, ABS, SQRT, LN, LOG, EXP', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression('TRUNC(9.87)', sym), 9);
      assertEqual(evaluateExpression('TRUNC(-9.87)', sym), -9);
      assertEqual(evaluateExpression('ROUND(9.6)', sym), 10);
      assertEqual(evaluateExpression('ROUND(-2.5)', sym), -3);
      assertEqual(evaluateExpression('ABS(-42.5)', sym), 42.5);
      assertEqual(evaluateExpression('SQRT(81)', sym), 9);
      assertApprox(evaluateExpression('LOG(1000)', sym), 3);
      assertApprox(evaluateExpression('LN(EXP(2))', sym), 2);
    });

    it('Calcula LEN y SUBSTRING (1-based index como en DFD clásico)', () => {
      const sym = new SymbolTable();
      assertEqual(evaluateExpression("LEN('UNIMAGDALENA')", sym), 12);
      assertEqual(evaluateExpression("LEN(12345678)", sym), 8);
      assertEqual(evaluateExpression("SUBSTRING('UNIMAGDALENA', 1, 3)", sym), 'UNI');
      assertEqual(evaluateExpression("SUBSTRING('UNIMAGDALENA', 4, 9)", sym), 'MAGDALENA');
      assertThrows(() => evaluateExpression("SUBCAD('Hola', 1, 2)", sym), 'Función desconocida');
    });
  });

  // =========================================================================
  // SUITE 3: TABLA DE SÍMBOLOS, VECTORES Y MATRICES
  // =========================================================================
  describe('3. Tabla de Símbolos, Vectores y Matrices N-Dimensionales', () => {
    it('Es insensible a mayúsculas/minúsculas para nombres de variables', () => {
      const sym = new SymbolTable();
      assignToTarget('Contador', 10, sym);
      assertEqual(evaluateExpression('contador + CONTADOR', sym), 20);
    });

    it('Soporta vectores 1D y matrices 2D/3D con ordenamiento numérico de índices', () => {
      const sym = new SymbolTable();
      assignToTarget('V(1)', 10, sym);
      assignToTarget('V(2)', 20, sym);
      assignToTarget('V(10)', 100, sym);
      assertEqual(evaluateExpression('V(1) + V(10)', sym), 110);

      // Verificar que formatDFDValue ordene [1], [2], [10] numéricamente y no [1], [10], [2]
      const formatted = sym.getAllEntries()[0].formatted;
      assertEqual(formatted, '{ [1]=10, [2]=20, [10]=100 }');

      // Matriz 2D
      assignToTarget('M(1, 2)', 99, sym);
      assertEqual(evaluateExpression('M(1, 2)', sym), 99);
    });

    it('Impide usar palabras reservadas como nombres de variables o subíndices no enteros', () => {
      const sym = new SymbolTable();
      assertThrows(() => assignToTarget('SIN', 5, sym), 'reservada');
      assertThrows(() => assignToTarget('MOD', 5, sym), 'reservada');
      assertThrows(() => assignToTarget('VERDADERO', 5, sym), 'reservada');
      assertThrows(() => assignToTarget('V(1.5)', 10, sym), 'enteros');
    });
  });

  // =========================================================================
  // SUITE 4: MODELO DEL DIAGRAMA Y OPERACIONES DE ÁRBOL
  // =========================================================================
  describe('4. Modelo Estructural del Diagrama (Inserción, Duplicación, Eliminación)', () => {
    it('Inserta, busca, duplica y elimina nodos en ramas anidadas', () => {
      const proj = createEmptyProject();
      const main = proj.sheets[0];

      const dec = createNode('DECISION', { condition: 'x > 0', yesLeft: true });
      insertNodeAt(main, 'ROOT', 0, dec);
      assertEqual(countNodesInSheet(main), 3); // Inicio + Decisión + Fin

      const asigYes = createNode('ASIGNACION', { assignments: [{ target: 'r', expr: '1' }] });
      insertNodeAt(main, `${dec.id}:YES`, 0, asigYes);
      assertEqual(countNodesInSheet(main), 4);

      const found = findNodeInSheet(main, asigYes.id);
      assertEqual(found.node.id, asigYes.id);

      const cloned = cloneNodeWithNewIds(dec);
      assertEqual(cloned.id !== dec.id, true);
      assertEqual(cloned.yesBranch[0].id !== asigYes.id, true);

      deleteNodeById(main, asigYes.id);
      assertEqual(countNodesInSheet(main), 3);
    });
  });

  // =========================================================================
  // SUITE 5: COMPATIBILIDAD CON ARCHIVOS .DFX, .DFDX Y .DFD CLÁSICO
  // =========================================================================
  describe('5. Serialización e Interoperabilidad (.dfx, .dfdx y .dfd Clásico)', () => {
    it('Realiza round-trip exacto en formato oficial .dfx y retrocompatible .dfdx (JSON)', () => {
      const original = EXAMPLES[2].build(); // Factorial recursivo
      const rawDfx = serializeDFX(original);
      const loaded = parseDFX(rawDfx);
      assertEqual(loaded.format, 'DFX');
      assertEqual(loaded.sheets.length, 2);
      assertEqual(loaded.sheets[1].name, 'Fact');

      // Prueba de compatibilidad con archivos guardados con 'format: DFDX'
      const legacyDfdx = JSON.stringify({ format: 'DFDX', version: '1.0', sheets: original.sheets });
      const loadedLegacy = parseDFX(legacyDfdx);
      assertEqual(loadedLegacy.sheets.length, 2);
    });

    it('Realiza round-trip exacto en formato .dfd Clásico', () => {
      for (const ex of EXAMPLES) {
        const proj = ex.build();
        const dfdContent = serializeClassicDFD(proj);
        const parsed = parseClassicDFD(dfdContent);
        assertEqual(parsed.sheets.length, proj.sheets.length, `Hojas en ejemplo ${ex.id}`);
        assertEqual(parsed.sheets[0].body.length, proj.sheets[0].body.length, `Nodos raíz en ${ex.id}`);
      }
    });

    it('Detecta automáticamente si un archivo es .dfx/.dfdx o .dfd con loadAnyDFDFile', () => {
      const proj = EXAMPLES[1].build();
      const fromJson = loadAnyDFDFile(serializeDFX(proj));
      const fromDfd = loadAnyDFDFile(serializeClassicDFD(proj));
      assertEqual(fromJson.sheets[0].body.length, fromDfd.sheets[0].body.length);
    });

    it('Conserva caracteres Unicode y comillas de cierre en .dfd clásico y .dfx (Round-trip con decodeFileBytes)', () => {
      const proj = createEmptyProject();
      const testStr = "'operación rápida: á é í ó ú ñ °'";
      proj.sheets[0].body.push(createNode('IMPRESION', { text: testStr }));

      // 1. DFD clásico con Latin-1 / Windows-1252
      const dfdText = serializeClassicDFD(proj);
      const dfdBytes = encodeClassicDFDBytes(dfdText);
      const decodedDfdText = decodeFileBytes(dfdBytes);
      const parsedDfd = parseClassicDFD(decodedDfdText);
      assertEqual(parsedDfd.sheets[0].body[0].text, testStr, 'Texto en DFD clásico recuperado con comillas y tildes');

      // 2. DFX con UTF-8
      const dfxText = serializeDFX(proj);
      const dfxBytes = new TextEncoder().encode(dfxText);
      const decodedDfxText = decodeFileBytes(dfxBytes);
      const parsedDfx = parseDFX(decodedDfxText);
      assertEqual(parsedDfx.sheets[0].body[0].text, testStr, 'Texto en DFX recuperado con comillas y tildes');

      // 3. Rechaza cabeceras .dfd incompletas o inválidas
      assertThrows(() => parseClassicDFD('Solo dice Dfd sin copyright\n1\n1\n1\n0\n0\n1\n'), 'cabecera válida');
    });
  });

  // =========================================================================
  // SUITE 6: INTÉRPRETE ASÍNCRONO Y EJECUCIÓN DE ALGORITMOS
  // =========================================================================
  describe('6. Ejecución de Algoritmos en el Intérprete DFD', () => {
    it('Ejecuta Conversión Decimal a Binario (Num = 13 -> 1101)', async () => {
      const proj = EXAMPLES[1].build();
      const { outputs } = await runProjectHeadless(proj, [13]);
      assertDeepEqual(outputs, ['En binario es: 1101']);
    });

    it('Ejecuta Subprograma Recursivo Factorial (Fact de 6 -> 720)', async () => {
      const proj = EXAMPLES[2].build();
      const { outputs } = await runProjectHeadless(proj, [6]);
      assertDeepEqual(outputs, ['El factorial de 6 es: 720']);
    });

    it('Ejecuta Ciclo Para con incremento negativo (cuenta regresiva)', async () => {
      const proj = createEmptyProject();
      proj.sheets[0].body = [
        createNode('CICLOPARA', {
          counter: 'k',
          start: '3',
          end: '1',
          step: '-1',
          body: [createNode('IMPRESION', { text: 'k' })]
        })
      ];
      const { outputs } = await runProjectHeadless(proj);
      assertDeepEqual(outputs, ['3', '2', '1']);
    });

    it('Ejecuta Ordenamiento Burbuja con Vectores y Ciclos Anidados', async () => {
      const proj = EXAMPLES[5].build();
      const { outputs } = await runProjectHeadless(proj);
      assertDeepEqual(outputs, ['V(1) = 8', 'V(2) = 15', 'V(3) = 23', 'V(4) = 42', 'V(5) = 99']);
    });

    it('Soporta pasar un Vector/Arreglo completo por referencia a un Subprograma', async () => {
      const main = createMainSheet();
      main.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'Arr(1)', expr: '10' }, { target: 'Arr(2)', expr: '20' }] }),
        createNode('LLAMADA', { subName: 'Duplicar', args: 'Arr' }),
        createNode('IMPRESION', { text: 'Arr(1) + Arr(2)' })
      ];
      const sub = createSubprogramSheet('Duplicar', 'Vec');
      sub.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'Vec(1)', expr: 'Vec(1) * 2' }, { target: 'Vec(2)', expr: 'Vec(2) * 2' }] })
      ];
      const proj = { format: 'DFDX', version: '1.0', anglesInDegrees: true, activeSheetIndex: 0, sheets: [main, sub] };
      const { outputs } = await runProjectHeadless(proj);
      assertDeepEqual(outputs, ['60']);
    });

    it('Ejecuta Ciclo Para de 20 000 iteraciones sin error de ciclo infinito (sumatoria 1 a 20 000)', async () => {
      const proj = createEmptyProject();
      const nInit = createNode('ASIGNACION', { assignments: [{ target: 's', expr: '0' }] });
      const nPara = createNode('CICLOPARA', { counter: 'i', start: '1', end: '20000', step: '1' });
      const nAcc = createNode('ASIGNACION', { assignments: [{ target: 's', expr: 's + i' }] });
      nPara.body = [nAcc];
      proj.sheets[0].body = [nInit, nPara, createNode('IMPRESION', { text: 's' })];
      const { outputs } = await runProjectHeadless(proj);
      assertDeepEqual(outputs, ['200010000']);
    });

    it('Protege contra ciclos infinitos superando maxSteps', async () => {
      const proj = createEmptyProject();
      proj.sheets[0].body = [
        createNode('CICLOMIENTRAS', { condition: '.V.', body: [] })
      ];
      let caughtError = null;
      try {
        const interp = new DFDInterpreter({ getSpeedDelay: () => 0 });
        interp.maxSteps = 200; // Límite corto para el test
        interp.project = proj;
        interp.callStack = [{ sheetName: 'Principal', sheetIndex: 0, symbolTable: new SymbolTable() }];
        for await (const _ of interp.executeSheetGenerator(proj.sheets[0], 0)) {}
      } catch (e) {
        caughtError = e;
      }
      assertEqual(Boolean(caughtError && caughtError.message.includes('ciclo infinito')), true);
    });

    it('Preserva el índice de V(i) capturado al invocar un subprograma aunque i cambie dentro', async () => {
      const main = createMainSheet();
      main.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'i', expr: '1' }, { target: 'V(1)', expr: '10' }, { target: 'V(2)', expr: '99' }] }),
        createNode('LLAMADA', { subName: 'Modificar', args: 'i, V(i)' }),
        createNode('IMPRESION', { text: 'V(1), \'-\', V(2)' })
      ];
      const sub = createSubprogramSheet('Modificar', 'idx, elem');
      sub.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'idx', expr: '2' }, { target: 'elem', expr: '55' }] })
      ];
      const proj = { format: 'DFX', version: '1.0', anglesInDegrees: true, activeSheetIndex: 0, sheets: [main, sub] };
      const { outputs } = await runProjectHeadless(proj);
      assertDeepEqual(outputs, ['55-99']);
    });

    it('Cancela limpiamente la ejecución sin pasar a estado ERROR cuando se detiene en Lectura', async () => {
      const proj = createEmptyProject();
      proj.sheets[0].body = [createNode('LECTURA', { text: 'X' })];
      let errorCalled = false;
      let inputRequested = false;
      const interp = new DFDInterpreter({
        getSpeedDelay: () => 0,
        requestInput: async () => {
          inputRequested = true;
          interp.stop();
          const err = new Error('Ejecución detenida por el usuario.');
          err.isCancelled = true;
          throw err;
        },
        onError: () => { errorCalled = true; }
      });
      interp.start(proj, 'RUN');
      await new Promise(r => setTimeout(r, 30));
      assertEqual(inputRequested, true, 'Debe haber alcanzado el nodo Lectura');
      assertEqual(errorCalled, false, 'No debe invocar onError al cancelar');
      assertEqual(interp.status, 'IDLE', 'El estado debe quedar en IDLE');
    });
  });

  // =========================================================================
  // SUITE 7: GENERADOR DE CÓDIGO Y MOTOR DE LAYOUT
  // =========================================================================
  describe('7. Generador de Código Multi-Lenguaje y Layout SVG', () => {
    it('Genera código en Pseudocódigo, Python, JS y C++ sin corromper cadenas literales', () => {
      const proj = createEmptyProject();
      proj.sheets[0].body = [
        createNode('ASIGNACION', {
          assignments: [{ target: 'msg', expr: "'Texto con = y AND y MOD adentro'" }]
        }),
        createNode('DECISION', {
          condition: 'a = 1 AND b <> 2',
          yesLeft: true,
          yesBranch: [createNode('IMPRESION', { text: 'msg' })],
          noBranch: []
        })
      ];

      const py = generateCode(proj, 'python');
      // El literal debe conservar intacto 'Texto con = y AND y MOD adentro'
      assertEqual(py.includes('"Texto con = y AND y MOD adentro"'), true);
      // Y la condición fuera de comillas sí debe traducirse a Python
      assertEqual(py.includes('if a == 1 and b != 2:'), true);

      const pseudo = generateCode(proj, 'pseudocode');
      assertEqual(pseudo.includes('Algoritmo Principal'), true);
    });

    it('Genera código con paso por referencia y retorno para subprogramas anidados (Caso Compra)', () => {
      const proj = createEmptyProject();
      const main = proj.sheets[0];
      main.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'total', expr: '0' }] }),
        createNode('LLAMADA', { subName: 'ProcesarProducto', args: 'importe' }),
        createNode('ASIGNACION', { assignments: [{ target: 'total', expr: 'total + importe' }] })
      ];

      const s1 = createSubprogramSheet('ProcesarProducto', 'importe', '');
      s1.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'subtotal', expr: '500' }] }),
        createNode('LLAMADA', { subName: 'CalcularDescuento', args: 'subtotal, descuento' }),
        createNode('ASIGNACION', { assignments: [{ target: 'importe', expr: 'subtotal - descuento' }] })
      ];
      proj.sheets.push(s1);

      const s2 = createSubprogramSheet('CalcularDescuento', 'subtotal, descuento', '');
      s2.body = [
        createNode('ASIGNACION', { assignments: [{ target: 'descuento', expr: 'subtotal * 0.20' }] })
      ];
      proj.sheets.push(s2);

      const pseudo = generateCode(proj, 'pseudocode');
      assertEqual(pseudo.includes('SubProceso ProcesarProducto(importe Por Referencia)'), true);
      assertEqual(pseudo.includes('SubProceso CalcularDescuento(subtotal, descuento Por Referencia)'), true);

      const py = generateCode(proj, 'python');
      assertEqual(py.includes('importe = ProcesarProducto(importe)'), true);
      assertEqual(py.includes('descuento = CalcularDescuento(subtotal, descuento)'), true);
      assertEqual(py.includes('return importe'), true);
      assertEqual(py.includes('return descuento'), true);

      const js = generateCode(proj, 'javascript');
      assertEqual(js.includes('importe = ProcesarProducto(importe);'), true);
      assertEqual(js.includes('descuento = CalcularDescuento(subtotal, descuento);'), true);
      assertEqual(js.includes('return importe;'), true);
      assertEqual(js.includes('return descuento;'), true);

      const cpp = generateCode(proj, 'cpp');
      assertEqual(cpp.includes('void ProcesarProducto(double &importe)'), true);
      assertEqual(cpp.includes('void CalcularDescuento(double subtotal, double &descuento)'), true);
      assertEqual(cpp.includes('void ProcesarProducto(double &importe);'), true);
    });

    it('Traduce correctamente potenciación (^) y acceso a vectores/arreglos en JS, Python y C++', () => {
      const proj = createEmptyProject();
      proj.sheets[0].body = [
        createNode('ASIGNACION', {
          assignments: [
            { target: 'P1', expr: '2' },
            { target: 'P2', expr: '3' },
            { target: 'RP', expr: 'P1 ^ P2' },
            { target: 'V(1)', expr: '42' },
            { target: 'V(2)', expr: 'V(1) + 8' }
          ]
        })
      ];

      const js = generateCode(proj, 'javascript');
      assertEqual(js.includes('RP = P1 ** P2;'), true, 'JS potencia con **');
      assertEqual(js.includes('V[0] = 42;'), true, 'JS arreglo 0-indexed');
      assertEqual(js.includes('V[1] = V[0] + 8;'), true, 'JS lectura arreglo');

      const cpp = generateCode(proj, 'cpp');
      assertEqual(cpp.includes('RP = pow(P1, P2);'), true, 'C++ potencia con pow');
      assertEqual(cpp.includes('vector<double> V('), true, 'C++ vector declarado');
      assertEqual(cpp.includes('V[0] = 42;'), true, 'C++ arreglo 0-indexed');

      const py = generateCode(proj, 'python');
      assertEqual(py.includes('RP = P1 ** P2'), true, 'Python potencia con **');
      assertEqual(py.includes('V = [0.0] *'), true, 'Python arreglo inicializado');
      assertEqual(py.includes('V[0] = 42'), true, 'Python arreglo 0-indexed');
      assertEqual(!py.includes('import math'), true, 'Python no importa math innecesariamente');
    });

    it('Traduce operadores lógicos extendidos, funciones nativas (DEG/RAD, SUBSTRING, LN) y matrices 2D', () => {
      const proj = createEmptyProject();
      proj.anglesInDegrees = true;
      proj.sheets[0].body = [
        createNode('ASIGNACION', {
          assignments: [
            { target: 'b1', expr: '.V. XOR .F.' },
            { target: 'b2', expr: '.V. NAND .F.' },
            { target: 'ang', expr: 'SIN(90) + ASIN(1)' },
            { target: 'sub', expr: "SUBSTRING('DECODE', 2, 3)" },
            { target: 'M(2, 3)', expr: 'LN(10) + RANDOM(5)' }
          ]
        })
      ];

      const py = generateCode(proj, 'python');
      assertEqual(py.includes('import math'), true);
      assertEqual(py.includes('import random'), true);
      assertEqual(py.includes('bool(True) != bool(False)'), true, 'Python XOR');
      assertEqual(py.includes('not (True and False)'), true, 'Python NAND');
      assertEqual(py.includes('math.sin(math.radians(90))'), true, 'Python SIN en grados');
      assertEqual(py.includes('math.degrees(math.asin(1))'), true, 'Python ASIN en grados');
      assertEqual(py.includes('M = [[0.0] *'), true, 'Python matriz 2D');
      assertEqual(py.includes('M[1][2] = math.log(10)'), true, 'Python acceso matriz 2D y LN');

      const js = generateCode(proj, 'javascript');
      assertEqual(js.includes('Boolean(true) !== Boolean(false)'), true, 'JS XOR');
      assertEqual(js.includes('Array.from({ length:'), true, 'JS matriz 2D');
      assertEqual(js.includes('String("DECODE").substr('), true, 'JS SUBSTRING');

      const cpp = generateCode(proj, 'cpp');
      assertEqual(cpp.includes('#include <cstdlib>'), true, 'C++ incluye cstdlib para RANDOM');
      assertEqual(cpp.includes('vector<vector<double>> M('), true, 'C++ matriz 2D');
      assertEqual(cpp.includes('!(true && false)'), true, 'C++ NAND');
    });

    it('Calcula métricas de layout recursivo sin dimensiones negativas ni NaN', () => {
      for (const ex of EXAMPLES) {
        const proj = ex.build();
        const layout = measureSequence(proj.sheets[0].body);
        assertEqual(layout.leftW >= 80, true);
        assertEqual(layout.rightW >= 80, true);
        assertEqual(layout.height > 0 && !Number.isNaN(layout.height), true);
      }
    });

    it('Calcula límites asimétricos y centrado correcto para decisiones anidadas en rama No', () => {
      const proj = createEmptyProject();
      const sheet = proj.sheets[0];
      const nLectura = createNode('LECTURA', { text: 'A, B, C' });
      insertNodeAt(sheet, 'ROOT', 0, nLectura);
      const nDec1 = createNode('DECISION', { condition: 'A>=B AND A>=C', yesLeft: false });
      insertNodeAt(sheet, 'ROOT', 1, nDec1);
      const nDec2 = createNode('DECISION', { condition: 'B>=C', yesLeft: false });
      insertNodeAt(sheet, nDec1.id + ':NO', 0, nDec2);

      const m = measureSequence(sheet.body);
      const padLeft = Math.max(m.leftW, 100);
      const padRight = Math.max(m.rightW, 100);
      assertEqual(padLeft > padRight, true, 'La rama No tiene mayor extensión izquierda que derecha');

      // Simular centrado de viewport (600x500)
      const viewportW = 600;
      const bounds = { minX: -padLeft, maxX: padRight, width: padLeft + padRight, height: m.height };
      const midX = (bounds.minX + bounds.maxX) / 2;
      const fitW = (viewportW - 70) / bounds.width;
      const zoom = Math.max(0.35, Math.min(1.2, Number(fitW.toFixed(2))));
      const panX = -midX * zoom;
      const leftScreenX = (viewportW / 2 + panX) + bounds.minX * zoom;
      const rightScreenX = (viewportW / 2 + panX) + bounds.maxX * zoom;

      assertEqual(leftScreenX >= 0, true, 'El borde izquierdo de la decisión anidada no se corta');
      assertEqual(rightScreenX <= viewportW, true, 'El borde derecho no se corta');
    });
  });

  // =========================================================================
  // SUITE 8: ENLACES COMPARTIBLES (#dfx=...) Y AUTOGUARDADO LOCAL
  // =========================================================================
  describe('8. Enlaces Compartibles (#dfx=...) y Autoguardado Local', () => {
    it('Codifica y decodifica un proyecto con acentos y subprogramas en un enlace URL (#dfx=...) y retrocompatible (#dfdx=...)', () => {
      const proj = EXAMPLES[2].build(); // Factorial recursivo con tildes en descripción
      const shareUrl = buildShareableURL(proj, 'Factorial_Recursivo.dfx', 'https://midominio.com/index.html');
      assertEqual(shareUrl.startsWith('https://midominio.com/index.html#dfx='), true);

      const hashPart = '#' + shareUrl.split('#')[1];
      const extracted = extractProjectFromHash(hashPart);
      assertEqual(extracted.fileName, 'Factorial_Recursivo.dfx');
      assertEqual(extracted.project.sheets.length, 2);
      assertEqual(extracted.project.sheets[1].name, 'Fact');
      assertEqual(extracted.project.sheets[0].description.includes('número'), true);

      // Compatibilidad con enlaces antiguos #dfdx=...
      const legacyHash = '#dfdx=' + shareUrl.split('#dfx=')[1];
      const legacyExtracted = extractProjectFromHash(legacyHash);
      assertEqual(legacyExtracted.fileName, 'Factorial_Recursivo.dfx');
      assertEqual(legacyExtracted.project.sheets.length, 2);
    });

    it('Guarda y recupera automáticamente la sesión desde localStorage', () => {
      // En Node.js simulamos un localStorage en memoria si no existe
      if (!global.localStorage) {
        const store = {};
        global.localStorage = {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; }
        };
      }
      clearAutosave();
      const proj = EXAMPLES[3].build(); // Fibonacci
      const ok = saveAutosave(proj, 'Mi_Fibonacci.dfx', 'retro-classic');
      assertEqual(ok, true);

      const restored = loadAutosave();
      assertEqual(restored.fileName, 'Mi_Fibonacci.dfx');
      assertEqual(restored.theme, 'retro-classic');
      assertEqual(restored.project.sheets[0].body.length, proj.sheets[0].body.length);
    });
  });

  // =========================================================================
  // EJECUTOR DE LA SUITE DE PRUEBAS
  // =========================================================================
  async function runAllTests() {
    const results = [];
    let passed = 0;
    let failed = 0;

    for (const suite of suites) {
      const suiteRes = { name: suite.name, tests: [] };
      results.push(suiteRes);

      for (const test of suite.tests) {
        const t0 = Date.now();
        try {
          await test.fn();
          passed++;
          suiteRes.tests.push({
            name: test.name,
            status: 'PASS',
            durationMs: Date.now() - t0
          });
        } catch (err) {
          failed++;
          suiteRes.tests.push({
            name: test.name,
            status: 'FAIL',
            error: err.message || String(err),
            durationMs: Date.now() - t0
          });
        }
      }
    }

    return { passed, failed, total: passed + failed, results };
  }

  global.DFDTestRunner = { runAllTests };

  // Si se ejecuta directamente en Node.js, correr y mostrar reporte en consola
  if (isNode && require.main === module) {
    runAllTests().then(summary => {
      console.log('\n======================================================');
      console.log('DF-DECODE v1.0 — REPORTE DE PRUEBAS UNITARIAS');
      console.log('======================================================\n');
      for (const s of summary.results) {
        console.log(`[SUITE] ${s.name}`);
        for (const t of s.tests) {
          if (t.status === 'PASS') {
            console.log(`  [PASS] ${t.name} (${t.durationMs}ms)`);
          } else {
            console.log(`  [FAIL] ${t.name}`);
            console.log(`     -> ${t.error}`);
          }
        }
        console.log('');
      }
      console.log('------------------------------------------------------');
      console.log(`Total: ${summary.total} | Pasaron: ${summary.passed} | Fallaron: ${summary.failed}`);
      console.log('------------------------------------------------------\n');
      process.exit(summary.failed > 0 ? 1 : 0);
    });
  }
})(typeof window !== 'undefined' ? window : global);
