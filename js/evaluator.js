/**
 * df-decode — Evaluador de Expresiones y Tabla de Símbolos (Compatible con DFD)
 *
 * Soporta:
 * - Tipos de datos: REAL (Number), STRING (Cadena con comillas simples '...'), LOGICO (.V. / .F.)
 * - Arreglos / Vectores y Matrices N-dimensionales: V(i), M(i, j), A(i, j, k)
 * - Operadores Aritméticos: ^, *, /, MOD, +, - (binario y unario)
 * - Operadores Relacionales: =, !=, <>, <, >, <=, >=
 * - Operadores Lógicos: NOT, AND, NAND, OR, NOR, XOR, XNOR
 * - Funciones Nativas DFD: SIN, COS, TAN, SINH, COSH, TANH, ASIN, ACOS, ATAN,
 *   TRUNC, ROUND, ABS, SQRT, RANDOM, LEN, LN, LOG, EXP, SUBSTRING(cad, ini, lon)
 */

(function (global) {
  'use strict';

  const UNARY_FUNCTIONS = new Set([
    'SIN', 'COS', 'TAN',
    'SINH', 'COSH', 'TANH',
    'ASIN', 'ACOS', 'ATAN',
    'TRUNC', 'ROUND', 'ABS',
    'SQRT', 'RANDOM', 'LEN',
    'LN', 'LOG', 'EXP'
  ]);

  const MULTI_FUNCTIONS = new Set([
    'SUBSTRING'
  ]);

  const WORD_OPERATORS = new Set([
    'MOD', 'NOT', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'
  ]);

  /**
   * Convierte un valor interno de JS a su representación clásica DFD
   */
  function formatDFDValue(val) {
    if (val === null || val === undefined) return 'indefinido';
    if (typeof val === 'boolean') return val ? '.V.' : '.F.';
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return 'Desbordamiento';
      // Evitar imprecisiones de coma flotante como 0.30000000000000004
      return Number(val.toPrecision(12)).toString();
    }
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val.__isArray) {
      const entries = Object.keys(val.items)
        .sort((a, b) => {
          const pa = a.split(',').map(Number);
          const pb = b.split(',').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
          }
          return 0;
        })
        .map(k => `[${k}]=${formatDFDValueForWatch(val.items[k])}`);
      return `{ ${entries.join(', ')} }`;
    }
    return String(val);
  }

  function formatDFDValueForWatch(val) {
    if (typeof val === 'string') return `'${val}'`;
    return formatDFDValue(val);
  }

  function getDFDTypeName(val) {
    if (typeof val === 'number') return 'Real';
    if (typeof val === 'string') return 'Cadena';
    if (typeof val === 'boolean') return 'Lógico';
    if (val && val.__isArray) return 'Arreglo';
    return 'Desconocido';
  }

  /**
   * Tokenizador léxico para sintaxis DFD
   */
  function tokenize(expr) {
    if (typeof expr !== 'string') {
      throw new Error('La expresión debe ser una cadena de texto.');
    }
    const tokens = [];
    let i = 0;
    const len = expr.length;

    while (i < len) {
      const ch = expr[i];

      // Ignorar espacios
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // Literales lógicos DFD: .V. o .F. (también acepta .T.)
      if (ch === '.') {
        const sub3 = expr.substr(i, 3).toUpperCase();
        if (sub3 === '.V.' || sub3 === '.T.') {
          tokens.push({ type: 'BOOLEAN', value: true });
          i += 3;
          continue;
        }
        if (sub3 === '.F.') {
          tokens.push({ type: 'BOOLEAN', value: false });
          i += 3;
          continue;
        }
      }

      // Cadenas con comillas simples ('...') o dobles ("...")
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let str = '';
        i++; // saltar comilla inicial
        let closed = false;
        while (i < len) {
          if (expr[i] === quote) {
            // Comilla escapada doble ''
            if (i + 1 < len && expr[i + 1] === quote) {
              str += quote;
              i += 2;
              continue;
            }
            closed = true;
            i++;
            break;
          }
          str += expr[i];
          i++;
        }
        if (!closed) {
          throw new Error(`Cadena literal sin cerrar: falta comilla (${quote}).`);
        }
        tokens.push({ type: 'STRING', value: str });
        continue;
      }

      // Números (enteros, decimales, notación científica)
      if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(expr[i + 1]))) {
        let numStr = '';
        while (i < len && /[0-9.]/.test(expr[i])) {
          numStr += expr[i++];
        }
        if (i < len && (expr[i] === 'e' || expr[i] === 'E')) {
          numStr += expr[i++];
          if (i < len && (expr[i] === '+' || expr[i] === '-')) {
            numStr += expr[i++];
          }
          while (i < len && /[0-9]/.test(expr[i])) {
            numStr += expr[i++];
          }
        }
        const num = Number(numStr);
        if (Number.isNaN(num)) {
          throw new Error(`Número inválido: ${numStr}`);
        }
        tokens.push({ type: 'NUMBER', value: num });
        continue;
      }

      // Operadores relacionales de 2 caracteres
      const twoChar = expr.substr(i, 2);
      if (twoChar === '<=' || twoChar === '>=' || twoChar === '!=' || twoChar === '<>') {
        tokens.push({ type: 'OP', value: twoChar === '<>' ? '!=' : twoChar });
        i += 2;
        continue;
      }

      // Operadores de 1 carácter y signos de puntuación
      if ('+-*/^=<>(),[]'.includes(ch)) {
        if (ch === '(' || ch === '[') {
          tokens.push({ type: 'LPAREN', value: '(' });
        } else if (ch === ')' || ch === ']') {
          tokens.push({ type: 'RPAREN', value: ')' });
        } else if (ch === ',') {
          tokens.push({ type: 'COMMA', value: ',' });
        } else {
          tokens.push({ type: 'OP', value: ch });
        }
        i++;
        continue;
      }

      // Identificadores, funciones u operadores de palabra (MOD, AND, OR, NOT, etc.)
      if (/[a-zA-Z_áéíóúÁÉÍÓÚñÑ]/.test(ch)) {
        let id = '';
        while (i < len && /[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]/.test(expr[i])) {
          id += expr[i++];
        }
        const upper = id.toUpperCase();
        if (upper === 'VERDADERO' || upper === 'TRUE') {
          tokens.push({ type: 'BOOLEAN', value: true });
        } else if (upper === 'FALSO' || upper === 'FALSE') {
          tokens.push({ type: 'BOOLEAN', value: false });
        } else if (WORD_OPERATORS.has(upper)) {
          tokens.push({ type: 'OP', value: upper });
        } else if (UNARY_FUNCTIONS.has(upper) || MULTI_FUNCTIONS.has(upper)) {
          tokens.push({ type: 'FUNC', value: upper });
        } else {
          tokens.push({ type: 'IDENT', value: id, key: upper });
        }
        continue;
      }

      throw new Error(`Carácter ilegal "${ch}" en la expresión: ${expr}`);
    }

    return tokens;
  }

  /**
   * Separa una lista de expresiones separadas por comas en el nivel superior
   * (respetando paréntesis y comillas), útil para Lectura, Impresión y Llamadas.
   */
  function splitTopLevelCommas(str) {
    const items = [];
    let current = '';
    let depth = 0;
    let inQuote = null;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote) {
          if (i + 1 < str.length && str[i + 1] === inQuote) {
            current += str[++i];
          } else {
            inQuote = null;
          }
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        inQuote = ch;
        current += ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
        current += ch;
      } else if (ch === ')' || ch === ']') {
        depth = Math.max(0, depth - 1);
        current += ch;
      } else if (ch === ',' && depth === 0) {
        items.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim().length > 0) {
      items.push(current.trim());
    }
    return items;
  }

  /**
   * Tabla de Símbolos con soporte para variables escalares y vectores/matrices
   * Insensible a mayúsculas/minúsculas como en DFD original.
   */
  class SymbolTable {
    constructor(parent = null) {
      this.vars = new Map(); // key (UPPERCASE) -> { name, value }
      this.parent = parent;
    }

    has(name) {
      const key = name.toUpperCase();
      return this.vars.has(key);
    }

    getScalar(name) {
      const key = name.toUpperCase();
      if (!this.vars.has(key)) {
        throw new Error(`Variable no inicializada: "${name}"`);
      }
      const entry = this.vars.get(key);
      if (entry.value && entry.value.__isArray) {
        throw new Error(`"${name}" es un arreglo/matriz y requiere índices, ej: ${name}(1)`);
      }
      return entry.value;
    }

    setScalar(name, value) {
      const key = name.toUpperCase();
      this.vars.set(key, { name, value });
    }

    getArrayElement(name, indices) {
      const key = name.toUpperCase();
      if (!this.vars.has(key)) {
        throw new Error(`El arreglo "${name}" no ha sido inicializado.`);
      }
      const entry = this.vars.get(key);
      if (!entry.value || !entry.value.__isArray) {
        throw new Error(`"${name}" no es un arreglo.`);
      }
      const idxKey = indices.map(idx => {
        if (typeof idx !== 'number' || !Number.isInteger(idx)) {
          throw new Error(`Los subíndices del arreglo "${name}" deben ser números enteros.`);
        }
        return idx;
      }).join(',');

      if (!(idxKey in entry.value.items)) {
        throw new Error(`Posición no inicializada en el arreglo: ${name}(${idxKey})`);
      }
      return entry.value.items[idxKey];
    }

    setArrayElement(name, indices, value) {
      const key = name.toUpperCase();
      let entry = this.vars.get(key);
      if (!entry || !entry.value || !entry.value.__isArray) {
        entry = {
          name,
          value: { __isArray: true, items: {} }
        };
        this.vars.set(key, entry);
      }
      const idxKey = indices.map(idx => {
        if (typeof idx !== 'number' || !Number.isInteger(idx)) {
          throw new Error(`Los subíndices del arreglo "${name}" deben ser números enteros.`);
        }
        return idx;
      }).join(',');
      entry.value.items[idxKey] = value;
    }

    getAllEntries() {
      const result = [];
      for (const [, entry] of this.vars.entries()) {
        result.push({
          name: entry.name,
          type: getDFDTypeName(entry.value),
          rawValue: entry.value,
          formatted: formatDFDValueForWatch(entry.value)
        });
      }
      return result;
    }
  }

  /**
   * Parser Descendente Recursivo y Evaluador de Expresiones DFD
   * Respeta la jerarquía clásica de precedencia de operadores DFD:
   * 1. Paréntesis ()
   * 2. ^, Funciones unarias (SIN, COS, TRUNC, SQRT, NOT, etc.), signo unario +/-
   * 3. *, /, MOD
   * 4. +, -
   * 5. <, >, <=, >=
   * 6. =, !=
   * 7. AND, NAND, NOR
   * 8. OR, XOR, XNOR
   */
  function evaluateExpression(exprStr, symbolTable, options = { anglesInDegrees: true }) {
    const trimmed = (exprStr || '').trim();
    if (!trimmed) {
      throw new Error('Expresión vacía.');
    }

    const tokens = tokenize(trimmed);
    let pos = 0;

    function peek() {
      return pos < tokens.length ? tokens[pos] : null;
    }

    function consume() {
      return tokens[pos++];
    }

    function expect(type, msg) {
      const tok = peek();
      if (!tok || tok.type !== type) {
        throw new Error(msg || `Se esperaba ${type}`);
      }
      return consume();
    }

    // Nivel 1 (más bajo): OR, XOR, XNOR
    function parseOrLevel() {
      let left = parseAndLevel();
      while (peek() && peek().type === 'OP' && ['OR', 'XOR', 'XNOR'].includes(peek().value)) {
        const op = consume().value;
        const right = parseAndLevel();
        ensureBoolean(left, op);
        ensureBoolean(right, op);
        if (op === 'OR') left = left || right;
        else if (op === 'XOR') left = Boolean(left !== right);
        else if (op === 'XNOR') left = Boolean(left === right);
      }
      return left;
    }

    // Nivel 2: AND, NAND, NOR
    function parseAndLevel() {
      let left = parseEqualityLevel();
      while (peek() && peek().type === 'OP' && ['AND', 'NAND', 'NOR'].includes(peek().value)) {
        const op = consume().value;
        const right = parseEqualityLevel();
        ensureBoolean(left, op);
        ensureBoolean(right, op);
        if (op === 'AND') left = left && right;
        else if (op === 'NAND') left = !(left && right);
        else if (op === 'NOR') left = !(left || right);
      }
      return left;
    }

    // Nivel 3: =, !=
    function parseEqualityLevel() {
      let left = parseRelationalLevel();
      while (peek() && peek().type === 'OP' && ['=', '!='].includes(peek().value)) {
        const op = consume().value;
        const right = parseRelationalLevel();
        if (typeof left !== typeof right) {
          throw new Error(`No se pueden comparar tipos incompatibles (${getDFDTypeName(left)} y ${getDFDTypeName(right)}) con "${op}".`);
        }
        if (op === '=') left = (left === right);
        else left = (left !== right);
      }
      return left;
    }

    // Nivel 4: <, >, <=, >=
    function parseRelationalLevel() {
      let left = parseAdditiveLevel();
      while (peek() && peek().type === 'OP' && ['<', '>', '<=', '>='].includes(peek().value)) {
        const op = consume().value;
        const right = parseAdditiveLevel();
        if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) {
          throw new Error(`El operador "${op}" requiere dos números o dos cadenas.`);
        }
        if (op === '<') left = left < right;
        else if (op === '>') left = left > right;
        else if (op === '<=') left = left <= right;
        else if (op === '>=') left = left >= right;
      }
      return left;
    }

    // Nivel 5: +, -
    function parseAdditiveLevel() {
      let left = parseMultiplicativeLevel();
      while (peek() && peek().type === 'OP' && ['+', '-'].includes(peek().value)) {
        const op = consume().value;
        const right = parseMultiplicativeLevel();
        if (op === '+') {
          // En DFD '+' suma reales o concatena cadenas estrictamente del mismo tipo
          if (typeof left === 'number' && typeof right === 'number') {
            left = left + right;
          } else if (typeof left === 'string' && typeof right === 'string') {
            left = left + right;
          } else {
            throw new Error(`Tipos incompatibles para el operador "+": no se puede sumar ${getDFDTypeName(left)} con ${getDFDTypeName(right)}.`);
          }
        } else {
          ensureNumber(left, '-');
          ensureNumber(right, '-');
          left = left - right;
        }
      }
      return left;
    }

    // Nivel 6: *, /, MOD
    function parseMultiplicativeLevel() {
      let left = parsePowerAndUnaryLevel();
      while (peek() && peek().type === 'OP' && ['*', '/', 'MOD'].includes(peek().value)) {
        const op = consume().value;
        const right = parsePowerAndUnaryLevel();
        ensureNumber(left, op);
        ensureNumber(right, op);
        if (op === '*') {
          left = left * right;
        } else if (op === '/') {
          if (right === 0) throw new Error('Error matemático: División por cero (0).');
          left = left / right;
        } else if (op === 'MOD') {
          if (right === 0) throw new Error('Error matemático: Módulo por cero (0).');
          left = left % right;
        }
      }
      return left;
    }

    // Nivel 7: ^ (asociativo por derecha), operadores unarios (+, -, NOT) y funciones DFD
    function parsePowerAndUnaryLevel() {
      const tok = peek();
      if (!tok) throw new Error('Expresión incompleta.');

      // Operadores unarios +, -, NOT
      if (tok.type === 'OP' && (tok.value === '+' || tok.value === '-' || tok.value === 'NOT')) {
        const op = consume().value;
        const operand = parsePowerAndUnaryLevel();
        if (op === '+') {
          ensureNumber(operand, '+ unario');
          return +operand;
        }
        if (op === '-') {
          ensureNumber(operand, '- unario');
          return -operand;
        }
        if (op === 'NOT') {
          ensureBoolean(operand, 'NOT');
          return !operand;
        }
      }

      // Funciones nativas DFD
      if (tok.type === 'FUNC') {
        const fnName = consume().value;
        if (MULTI_FUNCTIONS.has(fnName)) {
          expect('LPAREN', `La función ${fnName} requiere paréntesis: ${fnName}(cadena, inicio, longitud)`);
          const arg1 = parseOrLevel();
          expect('COMMA', `Falta coma en ${fnName}`);
          const arg2 = parseOrLevel();
          expect('COMMA', `Falta segunda coma en ${fnName}`);
          const arg3 = parseOrLevel();
          expect('RPAREN', `Falta cerrar paréntesis en ${fnName}`);
          return execMultiFunction(fnName, [arg1, arg2, arg3]);
        } else {
          // En DFD las funciones unarias suelen llevar paréntesis SQRT(x) pero son operadores unarios de precedencia 80/81
          let arg;
          if (peek() && peek().type === 'LPAREN') {
            consume();
            arg = parseOrLevel();
            expect('RPAREN', `Falta cerrar paréntesis ")" en la función ${fnName}`);
          } else {
            arg = parsePowerAndUnaryLevel();
          }
          return execUnaryFunction(fnName, arg, options);
        }
      }

      let base = parsePrimary();

      // Exponenciación ^
      if (peek() && peek().type === 'OP' && peek().value === '^') {
        consume();
        const exponent = parsePowerAndUnaryLevel();
        ensureNumber(base, '^');
        ensureNumber(exponent, '^');
        const res = Math.pow(base, exponent);
        if (Number.isNaN(res)) {
          throw new Error('Error matemático en exponenciación (^).');
        }
        return res;
      }

      return base;
    }

    function parsePrimary() {
      const tok = peek();
      if (!tok) throw new Error('Expresión incompleta.');

      if (tok.type === 'NUMBER' || tok.type === 'STRING' || tok.type === 'BOOLEAN') {
        consume();
        return tok.value;
      }

      if (tok.type === 'LPAREN') {
        consume();
        const val = parseOrLevel();
        expect('RPAREN', 'Paréntesis desbalanceados: falta ")".');
        return val;
      }

      if (tok.type === 'IDENT') {
        const idTok = consume();
        // Verificar si es acceso a vector/matriz: V(i) o M(i, j)
        if (peek() && peek().type === 'LPAREN') {
          consume(); // '('
          const indices = [];
          indices.push(parseOrLevel());
          while (peek() && peek().type === 'COMMA') {
            consume();
            indices.push(parseOrLevel());
          }
          expect('RPAREN', `Falta cerrar paréntesis ")" en el subíndice de ${idTok.value}`);
          if (!symbolTable || !symbolTable.vars.has(idTok.key)) {
            throw new Error(`Función desconocida: "${idTok.value}"`);
          }
          return symbolTable.getArrayElement(idTok.value, indices);
        }

        if (!symbolTable) {
          throw new Error(`Variable "${idTok.value}" no definida en este contexto.`);
        }
        return symbolTable.getScalar(idTok.value);
      }

      throw new Error(`Token inesperado "${tok.value}" en la expresión.`);
    }

    const result = parseOrLevel();
    if (pos < tokens.length) {
      throw new Error(`Expresión inválida cerca de "${tokens[pos].value}".`);
    }
    return result;
  }

  function ensureNumber(val, opName) {
    if (typeof val !== 'number' || Number.isNaN(val)) {
      throw new Error(`El operador/función "${opName}" requiere un valor numérico (Real), pero recibió ${getDFDTypeName(val)}.`);
    }
  }

  function ensureBoolean(val, opName) {
    if (typeof val !== 'boolean') {
      throw new Error(`El operador lógico "${opName}" requiere un valor lógico (.V. o .F.), pero recibió ${getDFDTypeName(val)}.`);
    }
  }

  function execUnaryFunction(fn, arg, options) {
    const deg = options && options.anglesInDegrees !== false;
    const toRad = x => (deg ? (x * Math.PI) / 180 : x);
    const fromRad = x => (deg ? (x * 180) / Math.PI : x);

    if (fn === 'LEN') {
      if (typeof arg === 'string') return arg.length;
      if (typeof arg === 'number') return String(arg).length;
      throw new Error('La función LEN(x) requiere una cadena de caracteres o un número.');
    }

    ensureNumber(arg, fn);

    switch (fn) {
      case 'SIN': {
        if (deg && (arg % 180 === 0)) return 0;
        if (deg && (arg % 360 === 90 || arg % 360 === -270)) return 1;
        if (deg && (arg % 360 === 270 || arg % 360 === -90)) return -1;
        return Math.sin(toRad(arg));
      }
      case 'COS': {
        if (deg && Math.abs(arg % 180) === 90) return 0;
        if (deg && (arg % 360 === 0)) return 1;
        if (deg && (Math.abs(arg % 360) === 180)) return -1;
        return Math.cos(toRad(arg));
      }
      case 'TAN': {
        if (deg && Math.abs(arg % 180) === 90) {
          throw new Error(`Error matemático: Tangente (TAN) indefinida para ${arg}° (división por cero).`);
        }
        if (deg && (arg % 180 === 0)) return 0;
        return Math.tan(toRad(arg));
      }
      case 'SINH': return Math.sinh(arg);
      case 'COSH': return Math.cosh(arg);
      case 'TANH': return Math.tanh(arg);
      case 'ASIN':
        if (arg < -1 || arg > 1) throw new Error('Error matemático: ASIN fuera de dominio [-1, 1].');
        return fromRad(Math.asin(arg));
      case 'ACOS':
        if (arg < -1 || arg > 1) throw new Error('Error matemático: ACOS fuera de dominio [-1, 1].');
        return fromRad(Math.acos(arg));
      case 'ATAN': return fromRad(Math.atan(arg));
      case 'TRUNC': return Math.trunc(arg);
      case 'ROUND': return arg < 0 ? -Math.round(-arg) : Math.round(arg);
      case 'ABS': return Math.abs(arg);
      case 'SQRT':
        if (arg < 0) throw new Error('Error matemático: Raíz cuadrada (SQRT) de un número negativo.');
        return Math.sqrt(arg);
      case 'RANDOM':
        if (arg <= 0) return 0;
        return Math.floor(Math.random() * Math.trunc(arg));
      case 'LN':
        if (arg <= 0) throw new Error('Error matemático: Logaritmo natural (LN) de número <= 0.');
        return Math.log(arg);
      case 'LOG':
        if (arg <= 0) throw new Error('Error matemático: Logaritmo base 10 (LOG) de número <= 0.');
        return Math.log10(arg);
      case 'EXP': return Math.exp(arg);
      default:
        throw new Error(`Función desconocida: ${fn}`);
    }
  }

  function execMultiFunction(fn, args) {
    if (fn === 'SUBSTRING') {
      const [str, start, len] = args;
      if (typeof str !== 'string') {
        throw new Error('SUBSTRING: el primer argumento debe ser una cadena.');
      }
      ensureNumber(start, 'SUBSTRING (inicio)');
      ensureNumber(len, 'SUBSTRING (longitud)');
      // En DFD los índices de SUBSTRING empiezan en 1
      const idx = Math.max(0, Math.trunc(start) - 1);
      const count = Math.max(0, Math.trunc(len));
      return str.substr(idx, count);
    }
    throw new Error(`Función desconocida: ${fn}`);
  }

  /**
   * Analiza un destino de asignación o lectura (L-Value), como `x`, `V(i)` o `M(i+1, j)`
   * Retorna { name, indices: [val1, val2...] | null }
   */
  function parseTargetLValue(targetStr, symbolTable, options) {
    const trimmed = (targetStr || '').trim();
    if (!trimmed) {
      throw new Error('Nombre de variable destino vacío.');
    }
    const match = trimmed.match(/^([a-zA-Z_áéíóúÁÉÍÓÚñÑ][a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]*)\s*(?:\((.*)\)|\[(.*)\])?$/);
    if (!match) {
      throw new Error(`Identificador de variable inválido: "${trimmed}"`);
    }
    const name = match[1];
    const upper = name.toUpperCase();
    if (
      UNARY_FUNCTIONS.has(upper) ||
      MULTI_FUNCTIONS.has(upper) ||
      WORD_OPERATORS.has(upper) ||
      ['VERDADERO', 'FALSO', 'TRUE', 'FALSE'].includes(upper)
    ) {
      throw new Error(`"${name}" es una palabra reservada de DFD y no puede usarse como variable.`);
    }
    const insideParens = match[2] !== undefined ? match[2] : match[3];
    if (insideParens === undefined) {
      return { name, indices: null };
    }
    const idxExprs = splitTopLevelCommas(insideParens);
    if (idxExprs.length === 0) {
      throw new Error(`Faltan subíndices en el arreglo "${name}()".`);
    }
    const indices = idxExprs.map(e => evaluateExpression(e, symbolTable, options));
    for (const idx of indices) {
      if (typeof idx !== 'number' || !Number.isInteger(idx)) {
        throw new Error(`Los subíndices del arreglo "${name}" deben ser números enteros.`);
      }
    }
    return { name, indices };
  }

  /**
   * Asigna un valor a un L-Value en la tabla de símbolos
   */
  function assignToTarget(targetStr, value, symbolTable, options) {
    const { name, indices } = parseTargetLValue(targetStr, symbolTable, options);
    if (indices === null) {
      symbolTable.setScalar(name, value);
      return `${name} <- ${formatDFDValueForWatch(value)}`;
    } else {
      symbolTable.setArrayElement(name, indices, value);
      return `${name}(${indices.join(',')}) <- ${formatDFDValueForWatch(value)}`;
    }
  }

  /**
   * Convierte una entrada de usuario (en modal de Lectura) al tipo DFD correspondiente
   */
  function parseUserInputValue(rawInput) {
    const trimmed = String(rawInput).trim();
    if (trimmed === '') {
      throw new Error('Debe ingresar un valor.');
    }
    const upper = trimmed.toUpperCase();
    if (upper === '.V.' || upper === '.T.') return true;
    if (upper === '.F.') return false;

    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }

    const num = Number(trimmed);
    if (!Number.isNaN(num)) {
      return num;
    }

    // Si el usuario escribe texto sin comillas en Lectura, lo tratamos amigablemente como cadena
    return trimmed;
  }

  global.DFDEvaluator = {
    SymbolTable,
    tokenize,
    splitTopLevelCommas,
    evaluateExpression,
    parseTargetLValue,
    assignToTarget,
    parseUserInputValue,
    formatDFDValue,
    formatDFDValueForWatch,
    getDFDTypeName
  };
})(window);
