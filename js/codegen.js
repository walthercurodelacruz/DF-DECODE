/**
 * df-decode — Generador de Código en Tiempo Real
 * Traduce el diagrama de flujo completo (Principal + Subprogramas) a:
 * - Pseudocódigo (estilo PSeInt / Académico en Español)
 * - Python 3
 * - JavaScript (ES6)
 * - C++
 */

(function (global) {
  'use strict';

  function indent(level, spaces = 4) {
    return ' '.repeat(level * spaces);
  }

  const IDENT_RE = /^[A-Za-z_áéíóúÁÉÍÓÚñÑ][A-Za-z_0-9áéíóúÁÉÍÓÚñÑ]*$/;
  const ARRAY_TARGET_RE = /^([A-Za-z_áéíóúÁÉÍÓÚñÑ][A-Za-z_0-9áéíóúÁÉÍÓÚñÑ]*)\s*\((.*)\)$/;

  function splitCommas(str) {
    const text = String(str || '').trim();
    if (!text) return [];
    return global.DFDEvaluator.splitTopLevelCommas(text).map(x => x.trim());
  }

  function walkNodes(nodes, visit) {
    for (const n of nodes || []) {
      visit(n);
      walkNodes(n.body, visit);
      walkNodes(n.yesBranch, visit);
      walkNodes(n.noBranch, visit);
    }
  }

  function parseExprTree(tokens) {
    let pos = 0;
    function peek() { return tokens[pos]; }
    function consume() { return tokens[pos++]; }

    function parsePrimary() {
      const t = peek();
      if (!t) return null;
      if (t.type === 'NUMBER') { consume(); return { type: 'NUMBER', value: t.value }; }
      if (t.type === 'STRING') { consume(); return { type: 'STRING', value: t.value }; }
      if (t.type === 'BOOLEAN') { consume(); return { type: 'BOOLEAN', value: t.value }; }
      if (t.type === 'IDENT') {
        consume();
        if (peek() && peek().type === 'LPAREN') {
          consume();
          const args = [];
          while (peek() && peek().type !== 'RPAREN') {
            args.push(parseOr());
            if (peek() && peek().type === 'COMMA') consume();
          }
          if (peek() && peek().type === 'RPAREN') consume();
          return { type: 'CALL_OR_ARRAY', name: t.value, args };
        }
        return { type: 'IDENT', name: t.value };
      }
      if (t.type === 'FUNC') {
        consume();
        if (peek() && peek().type === 'LPAREN') {
          consume();
          const args = [];
          while (peek() && peek().type !== 'RPAREN') {
            args.push(parseOr());
            if (peek() && peek().type === 'COMMA') consume();
          }
          if (peek() && peek().type === 'RPAREN') consume();
          return { type: 'FUNC_CALL', name: t.value, args };
        }
        return { type: 'FUNC_CALL', name: t.value, args: [] };
      }
      if (t.type === 'LPAREN') {
        consume();
        const node = parseOr();
        if (peek() && peek().type === 'RPAREN') consume();
        return { type: 'PAREN', expr: node };
      }
      return null;
    }

    function parsePowerAndUnary() {
      const t = peek();
      if (t && t.type === 'OP' && (t.value === '+' || t.value === '-' || t.value.toUpperCase() === 'NOT')) {
        consume();
        const right = parsePowerAndUnary();
        return { type: 'UNARY', op: t.value, right };
      }
      let left = parsePrimary();
      while (peek() && peek().type === 'OP' && peek().value === '^') {
        const op = consume().value;
        const right = parsePowerAndUnary();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    function parseMultiplicative() {
      let left = parsePowerAndUnary();
      while (peek() && peek().type === 'OP' && (peek().value === '*' || peek().value === '/' || peek().value.toUpperCase() === 'MOD')) {
        const op = consume().value.toUpperCase();
        const right = parsePowerAndUnary();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    function parseAdditive() {
      let left = parseMultiplicative();
      while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseMultiplicative();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    function parseRelational() {
      let left = parseAdditive();
      while (peek() && peek().type === 'OP' && ['<', '>', '<=', '>=', '=', '!=', '<>'].includes(peek().value)) {
        const op = consume().value;
        const right = parseAdditive();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    function parseAnd() {
      let left = parseRelational();
      while (peek() && peek().type === 'OP' && ['AND', 'NAND', 'NOR'].includes(peek().value.toUpperCase())) {
        const op = consume().value.toUpperCase();
        const right = parseRelational();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    function parseOr() {
      let left = parseAnd();
      while (peek() && peek().type === 'OP' && ['OR', 'XOR', 'XNOR'].includes(peek().value.toUpperCase())) {
        const op = consume().value.toUpperCase();
        const right = parseAnd();
        left = { type: 'BINARY', op, left, right };
      }
      return left;
    }

    return parseOr();
  }

  function generateExprFromAst(node, lang, arrayNames, options = { anglesInDegrees: true }) {
    if (!node) return '';
    const deg = !options || options.anglesInDegrees !== false;
    switch (node.type) {
      case 'NUMBER': return String(node.value);
      case 'STRING': {
        const s = String(node.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return lang === 'pseudocode' ? `'${node.value.replace(/'/g, "''")}'` : `"${s}"`;
      }
      case 'BOOLEAN': {
        if (lang === 'pseudocode') return node.value ? 'Verdadero' : 'Falso';
        if (lang === 'python') return node.value ? 'True' : 'False';
        return node.value ? 'true' : 'false';
      }
      case 'IDENT': return node.name;
      case 'PAREN': return `(${generateExprFromAst(node.expr, lang, arrayNames, options)})`;
      case 'UNARY': {
        let op = node.op;
        if (op.toUpperCase() === 'NOT') {
          if (lang === 'pseudocode') op = 'NO ';
          else if (lang === 'python') op = 'not ';
          else op = '!';
        }
        return `${op}${generateExprFromAst(node.right, lang, arrayNames, options)}`;
      }
      case 'BINARY': {
        const op = node.op.toUpperCase();
        const leftCode = generateExprFromAst(node.left, lang, arrayNames, options);
        const rightCode = generateExprFromAst(node.right, lang, arrayNames, options);
        if (op === '^') {
          if (lang === 'pseudocode') return `${leftCode} ^ ${rightCode}`;
          if (lang === 'python' || lang === 'javascript') return `${leftCode} ** ${rightCode}`;
          if (lang === 'cpp') return `pow(${leftCode}, ${rightCode})`;
        }
        if (op === 'MOD') {
          if (lang === 'pseudocode') return `${leftCode} MOD ${rightCode}`;
          if (lang === 'python' || lang === 'javascript') return `${leftCode} % ${rightCode}`;
          if (lang === 'cpp') return `fmod(${leftCode}, ${rightCode})`;
        }
        if (op === 'NAND') {
          if (lang === 'pseudocode') return `NO (${leftCode} Y ${rightCode})`;
          if (lang === 'python') return `not (${leftCode} and ${rightCode})`;
          return `!(${leftCode} && ${rightCode})`;
        }
        if (op === 'NOR') {
          if (lang === 'pseudocode') return `NO (${leftCode} O ${rightCode})`;
          if (lang === 'python') return `not (${leftCode} or ${rightCode})`;
          return `!(${leftCode} || ${rightCode})`;
        }
        if (op === 'XOR') {
          if (lang === 'pseudocode') return `((${leftCode} Y NO ${rightCode}) O (NO ${leftCode} Y ${rightCode}))`;
          if (lang === 'python') return `(bool(${leftCode}) != bool(${rightCode}))`;
          if (lang === 'javascript') return `(Boolean(${leftCode}) !== Boolean(${rightCode}))`;
          return `(bool(${leftCode}) != bool(${rightCode}))`;
        }
        if (op === 'XNOR') {
          if (lang === 'pseudocode') return `((${leftCode} Y ${rightCode}) O (NO ${leftCode} Y NO ${rightCode}))`;
          if (lang === 'python') return `(bool(${leftCode}) == bool(${rightCode}))`;
          if (lang === 'javascript') return `(Boolean(${leftCode}) === Boolean(${rightCode}))`;
          return `(bool(${leftCode}) == bool(${rightCode}))`;
        }
        let sym = node.op;
        if (node.op === '=') sym = (lang === 'cpp') ? '==' : ((lang === 'javascript') ? '===' : (lang === 'python' ? '==' : '='));
        else if (node.op === '<>' || node.op === '!=') sym = (lang === 'cpp') ? '!=' : ((lang === 'javascript') ? '!==' : (lang === 'python' ? '!=' : '<>'));
        else if (op === 'AND') sym = (lang === 'pseudocode') ? 'Y' : (lang === 'python' ? 'and' : '&&');
        else if (op === 'OR') sym = (lang === 'pseudocode') ? 'O' : (lang === 'python' ? 'or' : '||');
        return `${leftCode} ${sym} ${rightCode}`;
      }
      case 'CALL_OR_ARRAY': {
        const isArr = arrayNames && arrayNames.has(node.name.toUpperCase());
        if (isArr && lang !== 'pseudocode') {
          const idxParts = node.args.map(a => {
            if (a.type === 'NUMBER') return `[${Math.max(0, a.value - 1)}]`;
            const inner = generateExprFromAst(a, lang, arrayNames, options);
            if (lang === 'python') return `[int(${inner}) - 1]`;
            if (lang === 'javascript') return `[Math.trunc(${inner}) - 1]`;
            if (lang === 'cpp') return `[(int)(${inner}) - 1]`;
            return `[${inner} - 1]`;
          }).join('');
          return `${node.name}${idxParts}`;
        }
        const argsCode = node.args.map(a => generateExprFromAst(a, lang, arrayNames, options)).join(', ');
        return `${node.name}(${argsCode})`;
      }
      case 'FUNC_CALL': {
        const fn = node.name.toUpperCase();
        const args = node.args.map(a => generateExprFromAst(a, lang, arrayNames, options));
        if (fn === 'TRUNC') {
          if (lang === 'python') return `int(${args[0]})`;
          if (lang === 'javascript') return `Math.trunc(${args[0]})`;
          if (lang === 'cpp') return `trunc(${args[0]})`;
        }
        if (fn === 'ROUND') {
          if (lang === 'python') return `round(${args[0]})`;
          if (lang === 'javascript') return `Math.round(${args[0]})`;
          if (lang === 'cpp') return `round(${args[0]})`;
        }
        if (fn === 'ABS') {
          if (lang === 'python') return `abs(${args[0]})`;
          if (lang === 'javascript') return `Math.abs(${args[0]})`;
          if (lang === 'cpp') return `abs(${args[0]})`;
        }
        if (fn === 'SQRT') {
          if (lang === 'python') return `math.sqrt(${args[0]})`;
          if (lang === 'javascript') return `Math.sqrt(${args[0]})`;
          if (lang === 'cpp') return `sqrt(${args[0]})`;
        }
        if (fn === 'LEN') {
          if (lang === 'python') return `len(${args[0]})`;
          if (lang === 'javascript') return `String(${args[0]}).length`;
          if (lang === 'cpp') return `${args[0]}.length()`;
        }
        if (fn === 'SIN' || fn === 'COS' || fn === 'TAN') {
          const low = fn.toLowerCase();
          if (lang === 'python') return `math.${low}(${deg ? `math.radians(${args[0]})` : args[0]})`;
          if (lang === 'javascript') return `Math.${low}(${deg ? `(${args[0]}) * Math.PI / 180` : args[0]})`;
          if (lang === 'cpp') return `${low}(${deg ? `(${args[0]}) * 3.14159265358979323846 / 180.0` : args[0]})`;
        }
        if (fn === 'ASIN' || fn === 'ACOS' || fn === 'ATAN') {
          const low = fn.toLowerCase();
          if (lang === 'python') return deg ? `math.degrees(math.${low}(${args[0]}))` : `math.${low}(${args[0]})`;
          if (lang === 'javascript') return deg ? `(Math.${low}(${args[0]}) * 180 / Math.PI)` : `Math.${low}(${args[0]})`;
          if (lang === 'cpp') return deg ? `(${low}(${args[0]}) * 180.0 / 3.14159265358979323846)` : `${low}(${args[0]})`;
        }
        if (fn === 'SINH' || fn === 'COSH' || fn === 'TANH') {
          const low = fn.toLowerCase();
          if (lang === 'python') return `math.${low}(${args[0]})`;
          if (lang === 'javascript') return `Math.${low}(${args[0]})`;
          if (lang === 'cpp') return `${low}(${args[0]})`;
        }
        if (fn === 'LN') {
          if (lang === 'python') return `math.log(${args[0]})`;
          if (lang === 'javascript') return `Math.log(${args[0]})`;
          if (lang === 'cpp') return `log(${args[0]})`;
        }
        if (fn === 'LOG') {
          if (lang === 'python') return `math.log10(${args[0]})`;
          if (lang === 'javascript') return `Math.log10(${args[0]})`;
          if (lang === 'cpp') return `log10(${args[0]})`;
        }
        if (fn === 'EXP') {
          if (lang === 'python') return `math.exp(${args[0]})`;
          if (lang === 'javascript') return `Math.exp(${args[0]})`;
          if (lang === 'cpp') return `exp(${args[0]})`;
        }
        if (fn === 'RANDOM') {
          if (lang === 'python') return `(random.randrange(int(${args[0]})) if int(${args[0]}) > 0 else 0)`;
          if (lang === 'javascript') return `(${args[0]} > 0 ? Math.floor(Math.random() * Math.trunc(${args[0]})) : 0)`;
          if (lang === 'cpp') return `((int)(${args[0]}) > 0 ? rand() % (int)(${args[0]}) : 0)`;
        }
        if (fn === 'SUBSTRING') {
          if (lang === 'python') return `str(${args[0]})[max(0, int(${args[1]}) - 1) : max(0, int(${args[1]}) - 1) + max(0, int(${args[2]}))]`;
          if (lang === 'javascript') return `String(${args[0]}).substr(Math.max(0, Math.trunc(${args[1]}) - 1), Math.max(0, Math.trunc(${args[2]})))`;
          if (lang === 'cpp') return `string(${args[0]}).substr(max(0, (int)(${args[1]}) - 1), max(0, (int)(${args[2]})))`;
        }
        return `${node.name}(${args.join(', ')})`;
      }
    }
    return '';
  }

  function translateExpr(expr, lang, arrayNames = new Set(), options = { anglesInDegrees: true }) {
    if (!expr) return '';
    try {
      const tokens = global.DFDEvaluator.tokenize(expr);
      const ast = parseExprTree(tokens);
      if (ast) return generateExprFromAst(ast, lang, arrayNames, options);
    } catch (_) {}

    // Fallback por expresiones no estándar
    const parts = expr.split(/('(?:''|[^'])*'|"(?:""|[^"])*")/g);
    return parts.map((segment, idx) => {
      if (idx % 2 === 1) {
        if (lang !== 'pseudocode' && segment.startsWith("'") && segment.endsWith("'")) {
          const inner = segment.slice(1, -1).replace(/''/g, "'").replace(/"/g, '\\"');
          return `"${inner}"`;
        }
        return segment;
      }
      let s = segment;
      if (lang === 'pseudocode') {
        return s.replace(/\.V\./gi, 'Verdadero').replace(/\.F\./gi, 'Falso')
          .replace(/\bAND\b/gi, 'Y').replace(/\bOR\b/gi, 'O').replace(/\bNOT\b/gi, 'NO');
      }
      if (lang === 'python') {
        return s.replace(/\.V\./gi, 'True').replace(/\.F\./gi, 'False')
          .replace(/(?<![<>!])=(?!=)/g, '==').replace(/<>/g, '!=')
          .replace(/\^/g, '**').replace(/\bMOD\b/gi, '%')
          .replace(/\bAND\b/gi, 'and').replace(/\bOR\b/gi, 'or').replace(/\bNOT\b/gi, 'not')
          .replace(/\bTRUNC\s*\(/gi, 'int(').replace(/\bROUND\s*\(/gi, 'round(')
          .replace(/\bABS\s*\(/gi, 'abs(').replace(/\bLEN\s*\(/gi, 'len(')
          .replace(/\bSQRT\s*\(/gi, 'math.sqrt(');
      }
      if (lang === 'javascript' || lang === 'cpp') {
        return s.replace(/\.V\./gi, 'true').replace(/\.F\./gi, 'false')
          .replace(/(?<![<>!])=(?!=)/g, lang === 'cpp' ? '==' : '===')
          .replace(/<>/g, lang === 'cpp' ? '!=' : '!==')
          .replace(lang === 'cpp' ? /([\w.]+|\([^()]*\))\s*\bMOD\b\s*([\w.]+|\([^()]*\))/gi : /\bMOD\b/gi,
            lang === 'cpp' ? 'fmod($1, $2)' : '%')
          .replace(/\^/g, lang === 'cpp' ? '^' : '**')
          .replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!')
          .replace(/\bTRUNC\s*\(/gi, lang === 'cpp' ? 'trunc(' : 'Math.trunc(')
          .replace(/\bROUND\s*\(/gi, lang === 'cpp' ? 'round(' : 'Math.round(')
          .replace(/\bABS\s*\(/gi, lang === 'cpp' ? 'abs(' : 'Math.abs(')
          .replace(/\bSQRT\s*\(/gi, lang === 'cpp' ? 'sqrt(' : 'Math.sqrt(');
      }
      return s;
    }).join('');
  }

  function translateTarget(target, lang, arrayNames = new Set(), options = { anglesInDegrees: true }) {
    const trimmed = (target || '').trim();
    const m = trimmed.match(ARRAY_TARGET_RE);
    if (m && arrayNames.has(m[1].toUpperCase()) && lang !== 'pseudocode') {
      const name = m[1];
      const indices = splitCommas(m[2]);
      const idxParts = indices.map(idxStr => {
        const num = Number(idxStr);
        if (!isNaN(num) && Number.isInteger(num)) {
          return `[${Math.max(0, num - 1)}]`;
        }
        const inner = translateExpr(idxStr, lang, arrayNames, options);
        if (lang === 'python') return `[int(${inner}) - 1]`;
        if (lang === 'javascript') return `[Math.trunc(${inner}) - 1]`;
        if (lang === 'cpp') return `[(int)(${inner}) - 1]`;
        return `[${inner} - 1]`;
      }).join('');
      return `${name}${idxParts}`;
    }
    return trimmed;
  }

  function analyzeProject(project) {
    const subs = new Map();
    for (const s of project.sheets) {
      if (!s.isMain) {
        subs.set(String(s.name).toUpperCase(), {
          sheet: s,
          formals: splitCommas(s.params),
          outs: new Set()
        });
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const info of subs.values()) {
        const formalsUp = new Set(info.formals.map(f => f.toUpperCase()));
        const mark = (name) => {
          const up = String(name).toUpperCase();
          if (formalsUp.has(up) && !info.outs.has(up)) {
            info.outs.add(up);
            changed = true;
          }
        };
        walkNodes(info.sheet.body, (n) => {
          if (n.type === 'ASIGNACION') {
            for (const a of n.assignments || []) {
              const t = (a.target || '').trim();
              if (IDENT_RE.test(t)) mark(t);
              const m = t.match(ARRAY_TARGET_RE);
              if (m) mark(m[1]);
            }
          } else if (n.type === 'LECTURA') {
            for (const v of splitCommas(n.text)) {
              if (IDENT_RE.test(v)) mark(v);
              const m = v.match(ARRAY_TARGET_RE);
              if (m) mark(m[1]);
            }
          } else if (n.type === 'LLAMADA') {
            const callee = subs.get(String(n.subName || '').trim().toUpperCase());
            if (!callee) return;
            const actuals = splitCommas(n.args);
            callee.formals.forEach((f, i) => {
              if (callee.outs.has(f.toUpperCase()) && actuals[i]) {
                if (IDENT_RE.test(actuals[i])) mark(actuals[i]);
                const m = actuals[i].match(ARRAY_TARGET_RE);
                if (m) mark(m[1]);
              }
            });
          }
        });
      }
    }
    return subs;
  }

  function collectLocals(sheet, subs) {
    const formalsUp = new Set(splitCommas(sheet.params).map(f => f.toUpperCase()));
    const used = new Map();
    const arrays = new Map(); // NAME_UP -> { name, maxIdx: 0 }

    const touch = (name, extra) => {
      if (!IDENT_RE.test(name) || formalsUp.has(name.toUpperCase())) return;
      const cur = used.get(name) || { callArg: false, isString: false };
      if (extra && extra.callArg) cur.callArg = true;
      if (extra && extra.isString) cur.isString = true;
      used.set(name, cur);
    };

    const registerArray = (name, indexExpr) => {
      const up = name.toUpperCase();
      const idxParts = splitCommas(indexExpr);
      const dims = Math.max(1, idxParts.length);
      const cur = arrays.get(up) || { name, dims, maxDims: new Array(dims).fill(10) };
      if (dims > cur.dims) {
        while (cur.maxDims.length < dims) cur.maxDims.push(10);
        cur.dims = dims;
      }
      idxParts.forEach((p, idx) => {
        const num = parseInt(p, 10);
        if (!isNaN(num) && num > cur.maxDims[idx]) cur.maxDims[idx] = num;
      });
      arrays.set(up, cur);
    };

    walkNodes(sheet.body, (n) => {
      if (n.type === 'ASIGNACION') {
        for (const a of n.assignments || []) {
          const t = (a.target || '').trim();
          const m = t.match(ARRAY_TARGET_RE);
          if (m) {
            registerArray(m[1], m[2]);
          } else {
            touch(t, { isString: /['"]/.test(a.expr || '') });
          }
        }
      } else if (n.type === 'LECTURA') {
        for (const v of splitCommas(n.text)) {
          const m = v.match(ARRAY_TARGET_RE);
          if (m) registerArray(m[1], m[2]);
          else touch(v);
        }
      } else if (n.type === 'LLAMADA') {
        for (const act of splitCommas(n.args)) {
          const m = act.match(ARRAY_TARGET_RE);
          if (m) registerArray(m[1], m[2]);
          else touch(act, { callArg: true });
        }
      }
    });

    // Remover arreglos del conjunto de escalares simples
    for (const arrUp of arrays.keys()) {
      for (const k of Array.from(used.keys())) {
        if (k.toUpperCase() === arrUp) used.delete(k);
      }
    }

    const names = [];
    for (const [name, info] of used) names.push({ name, callArg: info.callArg, isString: info.isString });
    return { locals: names, arrays: Array.from(arrays.values()), arraySet: new Set(arrays.keys()) };
  }

  function scanNeeds(project) {
    let needsMath = false;
    let needsRandom = false;
    function scanText(str) {
      if (!str) return;
      const up = str.toUpperCase();
      if (/\b(SQRT|SIN|COS|TAN|SINH|COSH|TANH|ASIN|ACOS|ATAN|LN|LOG|EXP)\b/.test(up)) needsMath = true;
      if (/\b(RANDOM|ALEATORIO)\b/.test(up)) needsRandom = true;
    }
    walkNodes(project.sheets.flatMap(s => s.body), (n) => {
      if (n.type === 'ASIGNACION') for (const a of n.assignments || []) scanText(a.expr);
      else if (n.type === 'DECISION' || n.type === 'CICLOMIENTRAS') scanText(n.condition);
      else if (n.type === 'CICLOPARA') { scanText(n.start); scanText(n.end); scanText(n.step); }
      else if (n.type === 'IMPRESION') scanText(n.text);
      else if (n.type === 'LLAMADA') scanText(n.args);
    });
    return { needsMath, needsRandom };
  }

  function isNegativeStep(step) {
    return /^\s*-/.test(String(step || '1'));
  }

  function callInfo(n, subs) {
    const callee = subs.get(String(n.subName || '').trim().toUpperCase());
    const actuals = splitCommas(n.args);
    const outIdx = [];
    if (callee) {
      callee.formals.forEach((f, i) => {
        if (callee.outs.has(f.toUpperCase())) outIdx.push(i);
      });
    }
    return { callee, actuals, outIdx };
  }

  function formatPythonPrint(text, arraySet, options) {
    const items = global.DFDEvaluator.splitTopLevelCommas(text || "''");
    const cleaned = items.map((it, idx) => {
      const trimmed = it.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        let str = trimmed.slice(1, -1);
        if (idx < items.length - 1 && str.endsWith(' ')) str = str.slice(0, -1);
        if (idx > 0 && str.startsWith(' ')) str = str.slice(1);
        return `"${str}"`;
      }
      return translateExpr(trimmed, 'python', arraySet, options);
    });
    return `print(${cleaned.join(', ')})`;
  }

  function buildPythonArrayInit(maxDims) {
    if (maxDims.length === 1) {
      return `[0.0] * ${Math.max(10, maxDims[0] + 1)}`;
    }
    let expr = '0.0';
    for (let i = maxDims.length - 1; i >= 0; i--) {
      const size = Math.max(10, maxDims[i] + 1);
      expr = i === maxDims.length - 1 ? `[0.0] * ${size}` : `[${expr} for _ in range(${size})]`;
    }
    return expr;
  }

  function buildJSArrayInit(maxDims) {
    if (maxDims.length === 1) {
      return `new Array(${Math.max(10, maxDims[0] + 1)}).fill(0)`;
    }
    function build(idx) {
      const size = Math.max(10, maxDims[idx] + 1);
      if (idx === maxDims.length - 1) return `new Array(${size}).fill(0)`;
      return `Array.from({ length: ${size} }, () => ${build(idx + 1)})`;
    }
    return build(0);
  }

  function cppVectorType(dims) {
    let t = 'double';
    for (let i = 0; i < dims; i++) t = `vector<${t}>`;
    return t;
  }

  function buildCppArrayInit(name, maxDims) {
    if (maxDims.length === 1) {
      return `vector<double> ${name}(${Math.max(10, maxDims[0] + 1)}, 0.0);`;
    }
    function build(idx) {
      const size = Math.max(10, maxDims[idx] + 1);
      const t = cppVectorType(maxDims.length - idx);
      if (idx === maxDims.length - 1) return `${t}(${size}, 0.0)`;
      return `${t}(${size}, ${build(idx + 1)})`;
    }
    return `${cppVectorType(maxDims.length)} ${name}${build(0).slice(cppVectorType(maxDims.length).length)};`;
  }

  function generatePseudocode(project) {
    const out = [];
    const subs = analyzeProject(project);

    function emitNodes(nodes, lvl) {
      for (const n of nodes) {
        switch (n.type) {
          case 'ASIGNACION':
            for (const a of n.assignments || []) {
              if (a.target || a.expr) {
                out.push(`${indent(lvl)}${a.target || 'var'} <- ${translateExpr(a.expr || '0', 'pseudocode')};`);
              }
            }
            break;
          case 'LECTURA':
            out.push(`${indent(lvl)}Leer ${n.text || 'variable'};`);
            break;
          case 'IMPRESION': {
            const items = global.DFDEvaluator.splitTopLevelCommas(n.text || "''");
            const joined = items.map(it => translateExpr(it.trim(), 'pseudocode')).join(', ');
            out.push(`${indent(lvl)}Escribir ${joined};`);
            break;
          }
          case 'DECISION':
            out.push(`${indent(lvl)}Si (${translateExpr(n.condition || 'condicion', 'pseudocode')}) Entonces`);
            emitNodes(n.yesBranch || [], lvl + 1);
            if (n.noBranch && n.noBranch.length > 0) {
              out.push(`${indent(lvl)}SiNo`);
              emitNodes(n.noBranch, lvl + 1);
            }
            out.push(`${indent(lvl)}FinSi`);
            break;
          case 'CICLOMIENTRAS':
            out.push(`${indent(lvl)}Mientras (${translateExpr(n.condition || 'condicion', 'pseudocode')}) Hacer`);
            emitNodes(n.body || [], lvl + 1);
            out.push(`${indent(lvl)}FinMientras`);
            break;
          case 'CICLOPARA':
            out.push(`${indent(lvl)}Para ${n.counter || 'i'} <- ${translateExpr(n.start || '1', 'pseudocode')} Hasta ${translateExpr(n.end || '10', 'pseudocode')} Con Paso ${translateExpr(n.step || '1', 'pseudocode')} Hacer`);
            emitNodes(n.body || [], lvl + 1);
            out.push(`${indent(lvl)}FinPara`);
            break;
          case 'LLAMADA':
            out.push(`${indent(lvl)}${n.subName || 'Subprograma'}(${n.args || ''});`);
            break;
        }
      }
    }

    for (const s of project.sheets) {
      if (!s.isMain) {
        const info = subs.get(String(s.name).toUpperCase());
        const header = info.formals
          .map(f => (info.outs.has(f.toUpperCase()) ? `${f} Por Referencia` : f))
          .join(', ');
        if (s.description) out.push(`// ${s.description}`);
        out.push(`SubProceso ${s.name}(${header})`);
        emitNodes(s.body || [], 1);
        out.push('FinSubProceso\n');
      }
    }

    const main = project.sheets[0];
    if (main) {
      if (main.description) out.push(`// ${main.description}`);
      out.push('Algoritmo Principal');
      emitNodes(main.body || [], 1);
      out.push('FinAlgoritmo');
    }

    return out.join('\n');
  }

  function generatePython(project) {
    const out = [];
    const options = { anglesInDegrees: project.anglesInDegrees !== false };
    const { needsMath, needsRandom } = scanNeeds(project);
    if (needsMath) out.push('import math');
    if (needsRandom) out.push('import random');
    if (needsMath || needsRandom) out.push('');

    const subs = analyzeProject(project);

    function emitSheet(sheet, isMain) {
      const { locals, arrays, arraySet } = collectLocals(sheet, subs);

      function emitNodes(nodes, lvl) {
        if (!nodes || nodes.length === 0) {
          out.push(`${indent(lvl)}pass`);
          return;
        }
        for (const n of nodes) {
          switch (n.type) {
            case 'ASIGNACION':
              for (const a of n.assignments || []) {
                if (a.target || a.expr) {
                  const targetStr = translateTarget(a.target || 'var', 'python', arraySet, options);
                  out.push(`${indent(lvl)}${targetStr} = ${translateExpr(a.expr || '0', 'python', arraySet, options)}`);
                }
              }
              break;
            case 'LECTURA': {
              const vars = splitCommas(n.text || 'x');
              for (const v of vars) {
                const targetStr = translateTarget(v, 'python', arraySet, options);
                out.push(`${indent(lvl)}${targetStr} = float(input("Ingrese ${v}: "))`);
              }
              break;
            }
            case 'IMPRESION':
              out.push(`${indent(lvl)}${formatPythonPrint(n.text || "''", arraySet, options)}`);
              break;
            case 'DECISION':
              out.push(`${indent(lvl)}if ${translateExpr(n.condition || 'True', 'python', arraySet, options)}:`);
              emitNodes(n.yesBranch || [], lvl + 1);
              if (n.noBranch && n.noBranch.length > 0) {
                out.push(`${indent(lvl)}else:`);
                emitNodes(n.noBranch, lvl + 1);
              }
              break;
            case 'CICLOMIENTRAS':
              out.push(`${indent(lvl)}while ${translateExpr(n.condition || 'False', 'python', arraySet, options)}:`);
              emitNodes(n.body || [], lvl + 1);
              break;
            case 'CICLOPARA': {
              const c = n.counter || 'i';
              const st = translateExpr(n.start || '1', 'python', arraySet, options);
              const en = translateExpr(n.end || '10', 'python', arraySet, options);
              const sp = translateExpr(n.step || '1', 'python', arraySet, options);
              const adj = isNegativeStep(n.step) ? '- 1' : (/^\s*\d+(\.\d+)?\s*$/.test(n.step || '1') ? '+ 1' : `+ (1 if int(${sp}) > 0 else -1)`);
              out.push(`${indent(lvl)}for ${c} in range(int(${st}), int(${en}) ${adj}, int(${sp})):`);
              emitNodes(n.body || [], lvl + 1);
              break;
            }
            case 'LLAMADA': {
              const { callee, actuals, outIdx } = callInfo(n, subs);
              const name = callee ? callee.sheet.name : (n.subName || 'subprograma');
              const args = actuals.map(a => translateExpr(a, 'python', arraySet, options)).join(', ');
              if (outIdx.length === 0) {
                out.push(`${indent(lvl)}${name}(${args})`);
              } else {
                const targets = outIdx.map(i => {
                  const act = actuals[i] || '';
                  return (IDENT_RE.test(act) || ARRAY_TARGET_RE.test(act)) ? translateTarget(act, 'python', arraySet, options) : '_';
                });
                if (targets.every(t => t === '_')) out.push(`${indent(lvl)}${name}(${args})`);
                else out.push(`${indent(lvl)}${targets.join(', ')} = ${name}(${args})`);
              }
              break;
            }
          }
        }
      }

      for (const arr of arrays) {
        out.push(`${indent(1)}${arr.name} = ${buildPythonArrayInit(arr.maxDims)}`);
      }
      for (const v of locals.filter(v => v.callArg)) {
        out.push(`${indent(1)}${v.name} = 0`);
      }
      emitNodes(sheet.body || [], 1);
    }

    for (const s of project.sheets) {
      if (!s.isMain) {
        const info = subs.get(String(s.name).toUpperCase());
        out.push(`def ${s.name}(${s.params || ''}):`);
        if (s.description) out.push(`${indent(1)}"""${s.description}"""`);
        emitSheet(s, false);
        const rets = info.formals.filter(f => info.outs.has(f.toUpperCase()));
        if (rets.length) out.push(`${indent(1)}return ${rets.join(', ')}`);
        out.push('');
      }
    }

    const main = project.sheets[0];
    if (main) {
      out.push('def main():');
      if (main.description) out.push(`${indent(1)}# ${main.description}`);
      emitSheet(main, true);
      out.push('\nif __name__ == "__main__":');
      out.push('    main()');
    }

    return out.join('\n');
  }

  function generateJavaScript(project) {
    const out = ['// Generado automáticamente por df-decode', ''];
    const options = { anglesInDegrees: project.anglesInDegrees !== false };
    const subs = analyzeProject(project);

    function emitSheet(sheet, isMain) {
      const { locals, arrays, arraySet } = collectLocals(sheet, subs);

      function emitNodes(nodes, lvl) {
        for (const n of nodes) {
          switch (n.type) {
            case 'ASIGNACION':
              for (const a of n.assignments || []) {
                if (a.target || a.expr) {
                  const targetStr = translateTarget(a.target || 'x', 'javascript', arraySet, options);
                  out.push(`${indent(lvl, 2)}${targetStr} = ${translateExpr(a.expr || '0', 'javascript', arraySet, options)};`);
                }
              }
              break;
            case 'LECTURA': {
              const vars = splitCommas(n.text || 'x');
              for (const v of vars) {
                const targetStr = translateTarget(v, 'javascript', arraySet, options);
                out.push(`${indent(lvl, 2)}${targetStr} = Number(prompt("Ingrese ${v}:"));`);
              }
              break;
            }
            case 'IMPRESION':
              const items = global.DFDEvaluator.splitTopLevelCommas(n.text || "''");
              const joined = items.map(it => translateExpr(it.trim(), 'javascript', arraySet, options)).join(', ');
              out.push(`${indent(lvl, 2)}console.log(${joined});`);
              break;
            case 'DECISION':
              out.push(`${indent(lvl, 2)}if (${translateExpr(n.condition || 'true', 'javascript', arraySet, options)}) {`);
              emitNodes(n.yesBranch || [], lvl + 1);
              if (n.noBranch && n.noBranch.length > 0) {
                out.push(`${indent(lvl, 2)}} else {`);
                emitNodes(n.noBranch, lvl + 1);
              }
              out.push(`${indent(lvl, 2)}}`);
              break;
            case 'CICLOMIENTRAS':
              out.push(`${indent(lvl, 2)}while (${translateExpr(n.condition || 'false', 'javascript', arraySet, options)}) {`);
              emitNodes(n.body || [], lvl + 1);
              out.push(`${indent(lvl, 2)}}`);
              break;
            case 'CICLOPARA': {
              const c = n.counter || 'i';
              const st = translateExpr(n.start || '1', 'javascript', arraySet, options);
              const en = translateExpr(n.end || '10', 'javascript', arraySet, options);
              const sp = translateExpr(n.step || '1', 'javascript', arraySet, options);
              const cmp = isNegativeStep(n.step) ? '>=' : '<=';
              out.push(`${indent(lvl, 2)}for (let ${c} = ${st}; ${c} ${cmp} ${en}; ${c} += ${sp}) {`);
              emitNodes(n.body || [], lvl + 1);
              out.push(`${indent(lvl, 2)}}`);
              break;
            }
            case 'LLAMADA': {
              const { callee, actuals, outIdx } = callInfo(n, subs);
              const name = callee ? callee.sheet.name : (n.subName || 'subprograma');
              const args = actuals.map(a => translateExpr(a, 'javascript', arraySet, options)).join(', ');
              const targets = outIdx.map(i => {
                const act = actuals[i] || '';
                return (IDENT_RE.test(act) || ARRAY_TARGET_RE.test(act)) ? translateTarget(act, 'javascript', arraySet, options) : null;
              });
              const pad = indent(lvl, 2);
              if (outIdx.length === 0 || targets.every(t => t === null)) {
                out.push(`${pad}${name}(${args});`);
              } else if (outIdx.length === 1) {
                out.push(`${pad}${targets[0]} = ${name}(${args});`);
              } else {
                out.push(`${pad}{ const _r = ${name}(${args});`);
                targets.forEach((t, k) => { if (t) out.push(`${pad}  ${t} = _r[${k}];`); });
                out.push(`${pad}}`);
              }
              break;
            }
          }
        }
      }

      for (const arr of arrays) {
        out.push(`${indent(1, 2)}let ${arr.name} = ${buildJSArrayInit(arr.maxDims)};`);
      }
      for (const v of locals) {
        out.push(`${indent(1, 2)}let ${v.name}${v.callArg ? ' = 0' : ''};`);
      }
      emitNodes(sheet.body || [], 1);
    }

    for (const s of project.sheets) {
      if (!s.isMain) {
        const info = subs.get(String(s.name).toUpperCase());
        out.push(`function ${s.name}(${s.params || ''}) {`);
        emitSheet(s, false);
        const rets = info.formals.filter(f => info.outs.has(f.toUpperCase()));
        if (rets.length === 1) out.push(`${indent(1, 2)}return ${rets[0]};`);
        else if (rets.length > 1) out.push(`${indent(1, 2)}return [${rets.join(', ')}];`);
        out.push('}\n');
      }
    }

    const main = project.sheets[0];
    if (main) {
      out.push('function principal() {');
      emitSheet(main, true);
      out.push('}\n\nprincipal();');
    }

    return out.join('\n');
  }

  function generateCpp(project) {
    const options = { anglesInDegrees: project.anglesInDegrees !== false };
    const { needsRandom } = scanNeeds(project);
    const out = [
      '#include <iostream>',
      '#include <cmath>',
      '#include <string>',
      '#include <vector>',
      ...(needsRandom ? ['#include <cstdlib>', '#include <ctime>'] : []),
      'using namespace std;',
      ''
    ];
    const subs = analyzeProject(project);

    function emitSheet(sheet, isMain) {
      const { locals, arrays, arraySet } = collectLocals(sheet, subs);

      function emitNodes(nodes, lvl) {
        for (const n of nodes) {
          const pad = indent(lvl, 2);
          switch (n.type) {
            case 'ASIGNACION':
              for (const a of n.assignments || []) {
                if (a.target || a.expr) {
                  const targetStr = translateTarget(a.target || 'x', 'cpp', arraySet, options);
                  out.push(`${pad}${targetStr} = ${translateExpr(a.expr || '0', 'cpp', arraySet, options)};`);
                }
              }
              break;
            case 'LECTURA': {
              const vars = splitCommas(n.text || 'x');
              for (const v of vars) {
                const targetStr = translateTarget(v, 'cpp', arraySet, options);
                out.push(`${pad}cin >> ${targetStr};`);
              }
              break;
            }
            case 'IMPRESION': {
              const items = global.DFDEvaluator.splitTopLevelCommas(n.text || "''");
              const joined = items.map(it => translateExpr(it.trim(), 'cpp', arraySet, options)).join(' << ');
              out.push(`${pad}cout << ${joined} << endl;`);
              break;
            }
            case 'DECISION':
              out.push(`${pad}if (${translateExpr(n.condition || 'true', 'cpp', arraySet, options)}) {`);
              emitNodes(n.yesBranch || [], lvl + 1);
              if (n.noBranch && n.noBranch.length > 0) {
                out.push(`${pad}} else {`);
                emitNodes(n.noBranch, lvl + 1);
              }
              out.push(`${pad}}`);
              break;
            case 'CICLOMIENTRAS':
              out.push(`${pad}while (${translateExpr(n.condition || 'false', 'cpp', arraySet, options)}) {`);
              emitNodes(n.body || [], lvl + 1);
              out.push(`${pad}}`);
              break;
            case 'CICLOPARA': {
              const c = n.counter || 'i';
              const cmp = isNegativeStep(n.step) ? '>=' : '<=';
              out.push(`${pad}for (double ${c} = ${translateExpr(n.start || '1', 'cpp', arraySet, options)}; ${c} ${cmp} ${translateExpr(n.end || '10', 'cpp', arraySet, options)}; ${c} += ${translateExpr(n.step || '1', 'cpp', arraySet, options)}) {`);
              emitNodes(n.body || [], lvl + 1);
              out.push(`${pad}}`);
              break;
            }
            case 'LLAMADA': {
              const { callee, actuals, outIdx } = callInfo(n, subs);
              const name = callee ? callee.sheet.name : (n.subName || 'subprograma');
              const temps = [];
              const args = actuals.map((a, i) => {
                if (outIdx.includes(i) && !IDENT_RE.test(a) && !ARRAY_TARGET_RE.test(a)) {
                  const t = `_arg${i}`;
                  temps.push(`${indent(lvl + 1, 2)}double ${t} = ${translateExpr(a, 'cpp', arraySet, options)};`);
                  return t;
                }
                return translateTarget(a, 'cpp', arraySet, options);
              }).join(', ');
              if (temps.length) {
                out.push(`${pad}{`);
                out.push(...temps);
                out.push(`${indent(lvl + 1, 2)}${name}(${args});`);
                out.push(`${pad}}`);
              } else {
                out.push(`${pad}${name}(${args});`);
              }
              break;
            }
          }
        }
      }

      for (const arr of arrays) {
        out.push(`${indent(1, 2)}${buildCppArrayInit(arr.name, arr.maxDims)}`);
      }
      for (const v of locals) {
        if (v.isString) out.push(`${indent(1, 2)}string ${v.name};`);
        else out.push(`${indent(1, 2)}double ${v.name} = 0;`);
      }
      emitNodes(sheet.body || [], 1);
    }

    function signature(s) {
      const info = subs.get(String(s.name).toUpperCase());
      const { arrays } = collectLocals(s, subs);
      const arrMap = new Map(arrays.map(a => [a.name.toUpperCase(), a]));
      const params = info.formals.map(f => {
        const arrInfo = arrMap.get(f.toUpperCase());
        if (arrInfo) return `${cppVectorType(arrInfo.dims)} &${f}`;
        return `double${info.outs.has(f.toUpperCase()) ? ' &' : ' '}${f}`;
      }).join(', ');
      return `void ${s.name}(${params})`;
    }

    const subSheets = project.sheets.filter(s => !s.isMain);
    for (const s of subSheets) out.push(`${signature(s)};`);
    if (subSheets.length) out.push('');

    for (const s of subSheets) {
      out.push(`${signature(s)} {`);
      emitSheet(s, false);
      out.push('}\n');
    }

    const main = project.sheets[0];
    if (main) {
      out.push('int main() {');
      if (needsRandom) out.push(`${indent(1, 2)}srand((unsigned)time(nullptr));`);
      emitSheet(main, true);
      out.push('  return 0;\n}');
    }

    return out.join('\n');
  }

  function generateCode(project, lang = 'pseudocode') {
    switch (lang) {
      case 'python': return generatePython(project);
      case 'javascript': return generateJavaScript(project);
      case 'cpp': return generateCpp(project);
      default: return generatePseudocode(project);
    }
  }

  global.DFDCodeGen = {
    generateCode
  };
})(window);
