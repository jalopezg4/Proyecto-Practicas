'use strict';

/**
 * Genera sugerencias de corrección analizando el AST real del código.
 * Reemplaza la lógica template-based de generateContextualFix.
 *
 * Usa @babel/parser para construir el árbol sintáctico y @babel/traverse
 * para navegar los nodos y entender el contexto real de cada hallazgo.
 */

const parser  = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Parsea el contenido de un archivo .spec.ts a AST.
 */
function parseToAST(content) {
  return parser.parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
    errorRecovery: true,
  });
}

// ─── Helpers de extracción de código ─────────────────────────────────────────

/**
 * Reconstruye el código fuente de un nodo a partir del contenido original.
 */
function nodeSource(content, node) {
  return content.slice(node.start, node.end);
}

/**
 * Extrae el texto del primer argumento de una CallExpression si es un literal.
 */
function firstStringArg(node) {
  const arg = node.arguments?.[0];
  if (!arg) return null;
  if (arg.type === 'StringLiteral') return arg.value;
  if (arg.type === 'TemplateLiteral' && arg.quasis.length === 1)
    return arg.quasis[0].value.cooked;
  return null;
}

/**
 * Extrae el primer argumento de una llamada como texto de código fuente.
 */
function firstArgSource(content, node) {
  const arg = node.arguments?.[0];
  return arg ? nodeSource(content, arg) : null;
}

/**
 * Dado un nodo CallExpression como `page.locator('#id').fill(...)`,
 * devuelve el locator raíz como string de código, ej: `page.locator('#id')`.
 */
function extractLocatorExpr(content, callNode) {
  const callee = callNode.callee;
  if (callee.type !== 'MemberExpression') return null;
  const obj = callee.object;
  // Puede ser page.locator(...) o page.locator(...).nth(0) etc.
  if (obj.type === 'CallExpression') return nodeSource(content, obj);
  if (obj.type === 'MemberExpression') return nodeSource(content, obj.object);
  return nodeSource(content, obj);
}

/**
 * Intenta extraer el selector de un page.locator('sel') o getBy*('sel').
 */
function extractSelector(content, node) {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return null;
  const method = callee.property.name;
  if (!['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId'].includes(method))
    return null;
  const sel = firstStringArg(node);
  return sel ? { method, selector: sel } : null;
}

/**
 * Dado un bloque de sentencias y un índice, devuelve las sentencias
 * anterior y siguientes como nodos AST.
 */
function getSiblings(block, idx) {
  return {
    prev: idx > 0 ? block[idx - 1] : null,
    next: idx < block.length - 1 ? block[idx + 1] : null,
    nextTwo: idx < block.length - 2 ? block[idx + 2] : null,
  };
}

/**
 * Extrae el CallExpression más profundo de una ExpressionStatement que contiene `await`.
 */
function unwrapAwait(stmt) {
  if (!stmt || stmt.type !== 'ExpressionStatement') return null;
  const expr = stmt.expression;
  if (expr.type === 'AwaitExpression') return expr.argument;
  return null;
}

/**
 * Dado un nodo VariableDeclaration, devuelve { varName, callNode } si es
 * `const varName = await locator.innerText()` / `.textContent()` / `.count()`.
 */
function extractFP005Decl(stmt) {
  if (!stmt || stmt.type !== 'VariableDeclaration') return null;
  const decl = stmt.declarations?.[0];
  if (!decl || decl.init?.type !== 'AwaitExpression') return null;
  const callNode = decl.init.argument;
  if (callNode.type !== 'CallExpression') return null;
  const callee = callNode.callee;
  if (callee.type !== 'MemberExpression') return null;
  const method = callee.property.name;
  if (!['innerText', 'textContent', 'count', 'inputValue', 'getAttribute'].includes(method)) return null;
  return { varName: decl.id.name, callNode };
}

/**
 * Dado un ExpressionStatement, detecta `expect(varName).toBe/toContain/toMatch('val')`.
 */
function extractExpectCall(stmt, varName) {
  if (!stmt || stmt.type !== 'ExpressionStatement') return null;
  const expr = stmt.expression;
  if (expr.type !== 'CallExpression') return null;
  const callee = expr.callee;
  if (callee.type !== 'MemberExpression') return null;
  const matcher = callee.property.name;
  if (!['toBe', 'toContain', 'toMatch', 'toEqual'].includes(matcher)) return null;
  const obj = callee.object;
  if (obj.type !== 'CallExpression') return null;
  if (obj.callee.name !== 'expect') return null;
  const arg = obj.arguments?.[0];
  if (!arg) return null;
  // expect(varName) o expect(parseInt(varName))
  const isVar = arg.type === 'Identifier' && arg.name === varName;
  const isIntParsed = arg.type === 'CallExpression' &&
    arg.callee.name === 'parseInt' &&
    arg.arguments?.[0]?.name === varName;
  if (!isVar && !isIntParsed) return null;
  // firstStringArg ya devuelve el valor string, no el nodo
  const strVal = firstStringArg(expr);
  const numArg = expr.arguments?.[0];
  const valStr = strVal ?? (numArg?.type === 'NumericLiteral' ? String(numArg.value) : null);
  return { matcher, value: valStr };
}

// ─── Generadores por patrón ───────────────────────────────────────────────────

/**
 * FP-001: waitForTimeout → espera orientada a condición.
 * Analiza la sentencia anterior y posterior para sugerir el reemplazo exacto.
 */
function fixFP001(content, stmtNode, siblings) {
  const bad = nodeSource(content, stmtNode).trim();
  const prevCall = unwrapAwait(siblings.prev);
  const nextCall = unwrapAwait(siblings.next);

  // Caso: después de page.goto(url) → waitForURL(url) o waitForLoadState
  if (prevCall) {
    const prevCallee = prevCall.callee;
    if (prevCallee?.type === 'MemberExpression' && prevCallee.property.name === 'goto') {
      const url = firstStringArg(prevCall);
      const path = url ? url.replace(/^https?:\/\/[^/]+/, '**') : null;
      return {
        bad,
        good: path && path !== '**'
          ? `await page.waitForURL('${path}');`
          : `await page.waitForLoadState('networkidle');`,
      };
    }

    // Caso: después de .click() → buscar qué viene después
    if (prevCallee?.type === 'MemberExpression' && prevCallee.property.name === 'click') {
      if (nextCall) {
        // ¿viene waitForURL en la siguiente?
        if (nextCall.callee?.property?.name === 'waitForURL') {
          const urlArg = firstArgSource(content, nextCall);
          return { bad, good: `await page.waitForURL(${urlArg});` };
        }
        // ¿viene un locator que podemos esperar?
        const sel = extractSelector(content, nextCall);
        if (sel) {
          return {
            bad,
            good: `await expect(page.${sel.method}('${sel.selector}')).toBeVisible();`,
          };
        }
      }
      return { bad, good: `await page.waitForURL('**/<ruta-destino>');` };
    }

    // Caso: después de .reload()
    if (prevCallee?.type === 'MemberExpression' && prevCallee.property.name === 'reload') {
      return { bad, good: `await page.waitForLoadState('networkidle');` };
    }
  }

  // Caso genérico: mirar la siguiente sentencia para saber qué locator se usa
  if (nextCall) {
    const sel = extractSelector(content, nextCall);
    if (sel) {
      return {
        bad,
        good: `await expect(page.${sel.method}('${sel.selector}')).toBeVisible();`,
      };
    }
    // ¿es un locator anidado? eg: page.locator(...).fill(...)
    const callee = nextCall.callee;
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'CallExpression') {
      const sel2 = extractSelector(content, callee.object);
      if (sel2) {
        return {
          bad,
          good: `await expect(page.${sel2.method}('${sel2.selector}')).toBeVisible();`,
        };
      }
    }
  }

  return { bad, good: `await page.waitForLoadState('networkidle');` };
}

/**
 * FP-002: nth-child / nth-of-type → filter({ hasText }) o locator semántico.
 * Extrae el selector base limpio y busca texto asociado en aserciones cercanas.
 */
function fixFP002(content, stmtNode, allStmts, idx) {
  const bad = nodeSource(content, stmtNode).trim();

  // Extraer selector base quitando :nth-child, :nth-of-type, .nth()
  const selectorMatch = bad.match(/(?:locator|filter)\s*\(\s*['"`]([^'"`]+)['"`]/);
  let base = selectorMatch ? selectorMatch[1] : null;
  if (base) {
    base = base
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/:nth-of-type\(\d+\)/g, '')
      .replace(/\s*>\s*button$/, '')
      .replace(/\s+button$/, '')
      .trim();
  }

  // Buscar texto asociado en aserciones que involucren el mismo locator base
  let associatedText = null;
  for (let i = idx + 1; i < Math.min(allStmts.length, idx + 7); i++) {
    const s = allStmts[i];
    const src = nodeSource(content, s);
    const involvesSameLocator = base && src.includes(base.replace(/ /g, ''));
    if (!involvesSameLocator) continue;

    const m = src.match(/(?:toHaveText|toContainText|toContain|toBe)\s*\(\s*['"`]([^'"`]{2,})['"`]/);
    if (m && !/^\d+$/.test(m[1])) { associatedText = m[1]; break; }

    const decl = extractFP005Decl(s);
    if (decl) {
      const next = allStmts[i + 1];
      const expCall = next ? extractExpectCall(next, decl.varName) : null;
      if (expCall?.value && !/^\d+$/.test(expCall.value)) { associatedText = expCall.value; break; }
    }
  }

  const filterPart = associatedText
    ? `.filter({ hasText: '${associatedText}' })`
    : `.filter({ hasText: '<texto visible del elemento>' })`;

  if (base) {
    return {
      bad,
      good: `page.locator('${base}')${filterPart}`,
    };
  }
  return {
    bad,
    good: `page.locator('<selector-base>')${filterPart}`,
  };
}

/**
 * FP-005: innerText/count sin auto-wait → expect().toHaveText() / toHaveCount().
 * Fusiona la declaración de variable + el expect siguiente en una sola línea.
 */
function fixFP005(content, stmtNode, siblings) {
  const bad = nodeSource(content, stmtNode).trim();
  const decl = extractFP005Decl(stmtNode);
  if (!decl) return { bad, good: `await expect(locator).toHaveText('<valor esperado>');` };

  const { varName, callNode } = decl;
  const locatorExpr = nodeSource(content, callNode.callee.object);
  const method = callNode.callee.property.name;

  // Mirar la siguiente sentencia para extraer el valor esperado
  const expCall = siblings.next ? extractExpectCall(siblings.next, varName) : null;

  if (expCall?.value !== null && expCall?.value !== undefined) {
    const matcher = expCall.matcher === 'toContain' ? 'toContainText' : 'toHaveText';
    const nextBad = nodeSource(content, siblings.next).trim();
    return {
      bad:  `${bad}\n    ${nextBad}`,
      good: `await expect(${locatorExpr}).${matcher}('${expCall.value}');`,
    };
  }

  // count() → toHaveCount
  if (method === 'count') {
    return { bad, good: `await expect(${locatorExpr}).toHaveCount(<n esperado>);` };
  }

  // inputValue → toHaveValue
  if (method === 'inputValue') {
    return { bad, good: `await expect(${locatorExpr}).toHaveValue('<valor esperado>');` };
  }

  return { bad, good: `await expect(${locatorExpr}).toHaveText('<valor esperado>');` };
}

/**
 * FP-007: Date.now() → verificar resultado, no tiempo.
 * Busca la acción que se está midiendo y el locator que se verifica después.
 */
function fixFP007(content, stmtNode, allStmts, idx) {
  const bad = nodeSource(content, stmtNode).trim();

  // Buscar hacia adelante: la acción medida y el locator verificado
  let actionLocator = null;
  for (let i = idx + 1; i < Math.min(allStmts.length, idx + 10); i++) {
    const s = allStmts[i];
    const call = unwrapAwait(s);
    if (!call) continue;
    const callee = call.callee;
    if (!callee || callee.type !== 'MemberExpression') continue;
    const methodName = callee.property.name;
    if (['click', 'fill', 'goto', 'press'].includes(methodName)) {
      // Buscar el locator que se usa después de la acción
      for (let j = i + 1; j < Math.min(allStmts.length, i + 5); j++) {
        const nextCall = unwrapAwait(allStmts[j]);
        if (!nextCall) continue;
        const sel = extractSelector(content, nextCall);
        if (sel) {
          actionLocator = `page.${sel.method}('${sel.selector}')`;
          break;
        }
        // locator anidado
        const nc = nextCall.callee;
        if (nc?.type === 'MemberExpression' && nc.object?.type === 'CallExpression') {
          const s2 = extractSelector(content, nc.object);
          if (s2) { actionLocator = `page.${s2.method}('${s2.selector}')`; break; }
        }
      }
      if (actionLocator) break;
    }
  }

  // Buscar la línea toBeLessThan para incluirla en el bad
  let badFull = bad;
  let lessThanStmt = null;
  for (let i = idx + 1; i < Math.min(allStmts.length, idx + 8); i++) {
    const src = nodeSource(content, allStmts[i]);
    if (src.includes('toBeLessThan') || src.includes('elapsed') || src.includes('Date.now')) {
      lessThanStmt = src.trim();
      break;
    }
  }
  if (lessThanStmt) {
    badFull = `${bad}\n    // ...\n    ${lessThanStmt}`;
  }

  const good = actionLocator
    ? `await expect(${actionLocator}).toBeVisible(); // verifica el resultado, no el tiempo`
    : `await expect(page.locator('<elemento-resultado>')).toBeVisible(); // verifica el resultado, no el tiempo`;

  return { bad: badFull, good };
}

/**
 * FP-004 / FP-006: variable mutable de módulo → mover dentro del test.
 */
function fixFP004(content, stmtNode) {
  const bad = nodeSource(content, stmtNode).trim();
  const match = bad.match(/^(?:let|var|const)\s+(\w+)/);
  const varName = match ? match[1] : 'variable';
  return {
    bad,
    good: `// Mover dentro del test o beforeEach:\ntest('...', async ({ page }) => {\n  let ${varName} = ...; // scope local al test\n});`,
  };
}

/**
 * FP-003: click sin waitForURL → agregar espera de navegación.
 */
function fixFP003(content, stmtNode, allStmts, idx) {
  const bad = nodeSource(content, stmtNode).trim();

  // Buscar hacia atrás el goto para conocer la URL base
  for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
    const call = unwrapAwait(allStmts[i]);
    if (!call) continue;
    if (call.callee?.property?.name === 'goto') {
      const url = firstStringArg(call);
      const path = url ? url.replace(/^https?:\/\/[^/]+/, '**') : null;
      if (path && path !== '**') {
        return { bad, good: `await page.waitForURL('${path}');` };
      }
    }
  }

  // Buscar hacia adelante si hay alguna URL conocida
  for (let i = idx + 1; i < Math.min(allStmts.length, idx + 5); i++) {
    const call = unwrapAwait(allStmts[i]);
    if (!call) continue;
    if (call.callee?.property?.name === 'waitForURL') {
      const urlArg = firstArgSource(content, call);
      return { bad, good: `await page.waitForURL(${urlArg});` };
    }
    const sel = extractSelector(content, call);
    if (sel) {
      return {
        bad,
        good: `await expect(page.${sel.method}('${sel.selector}')).toBeVisible();`,
      };
    }
  }

  return { bad, good: `await page.waitForURL('**/<ruta-destino>');` };
}

/**
 * Devuelve true si el statement es un contenedor de test (test(), describe(), beforeEach()...).
 * Estos no deben ser analizados como patrones en sí mismos — su código anidado
 * se analiza al visitar sus propios BlockStatements.
 */
function isTestContainer(stmt) {
  if (stmt.type !== 'ExpressionStatement') return false;
  const expr = stmt.expression;
  if (expr.type !== 'CallExpression') return false;
  const callee = expr.callee;
  if (callee.type === 'Identifier' && ['test', 'describe', 'it'].includes(callee.name)) return true;
  if (callee.type === 'MemberExpression') {
    const root = callee.object?.type === 'Identifier' ? callee.object.name
      : callee.object?.object?.name;
    if (['test', 'describe', 'it'].includes(root)) return true;
  }
  return false;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Para un archivo dado, devuelve un Map<lineNumber, fix> con sugerencias
 * generadas por análisis AST real, sin templates predeterminados.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {Map<number, {bad: string, good: string}>}
 */
function generateASTFixes(filePath, content) {
  const fixes = new Map();

  let ast;
  try {
    ast = parseToAST(content);
  } catch {
    return fixes; // Si el parser falla, no hay fixes AST
  }

  // Recolectar todos los bloques de sentencias del archivo
  // (cuerpos de funciones, test callbacks, beforeEach, etc.)
  const blocks = [];
  traverse(ast, {
    BlockStatement(path) {
      if (path.node.body.length > 0) {
        blocks.push(path.node.body);
      }
    },
    Program(path) {
      if (path.node.body.length > 0) {
        blocks.push(path.node.body);
      }
    },
  });

  for (const block of blocks) {
    for (let idx = 0; idx < block.length; idx++) {
      const stmt = block[idx];
      const line = stmt.loc?.start?.line;
      if (!line) continue;

      // Saltar contenedores — su código interno se analiza en sus propios bloques
      if (isTestContainer(stmt)) continue;

      const siblings = getSiblings(block, idx);

      // ── FP-001: waitForTimeout ──────────────────────────────────────────────
      const awaitCall = unwrapAwait(stmt);
      if (awaitCall?.callee?.type === 'MemberExpression' &&
          awaitCall.callee.property.name === 'waitForTimeout') {
        fixes.set(line, fixFP001(content, stmt, siblings));
        continue;
      }

      // ── FP-002: nth-child / nth-of-type en locator ─────────────────────────
      const stmtSrc = nodeSource(content, stmt);
      if (/nth-child|nth-of-type|\.nth\s*\(/.test(stmtSrc) &&
          !stmt.type.includes('Comment')) {
        fixes.set(line, fixFP002(content, stmt, block, idx));
        continue;
      }

      // ── FP-005: innerText / textContent / count sin auto-wait ──────────────
      const decl = extractFP005Decl(stmt);
      if (decl) {
        fixes.set(line, fixFP005(content, stmt, siblings));
        continue;
      }

      // ── FP-007: Date.now() ─────────────────────────────────────────────────
      if (/Date\.now\s*\(\s*\)/.test(stmtSrc) && !stmtSrc.trim().startsWith('//')) {
        fixes.set(line, fixFP007(content, stmt, block, idx));
        continue;
      }

      // ── FP-004 / FP-006: variable mutable de módulo ────────────────────────
      if (stmt.type === 'VariableDeclaration' &&
          ['let', 'var'].includes(stmt.kind)) {
        // Solo si está a nivel de módulo (no dentro de una función/test)
        // Lo detectamos comprobando que su padre sea Program o un describe callback
        fixes.set(line, fixFP004(content, stmt));
        continue;
      }

      // ── FP-003: click sin waitForURL ───────────────────────────────────────
      if (awaitCall?.callee?.type === 'MemberExpression' &&
          awaitCall.callee.property.name === 'click') {
        const next = siblings.next;
        const nextCall = next ? unwrapAwait(next) : null;
        const nextMethod = nextCall?.callee?.property?.name;
        // Solo sugerir si la siguiente sentencia NO es ya una espera
        const alreadyWaits = ['waitForURL', 'waitForLoadState', 'waitForSelector',
                              'waitForResponse', 'waitForNavigation'].includes(nextMethod);
        if (!alreadyWaits && next?.type !== 'ExpressionStatement'
            ?.toString().includes('expect')) {
          fixes.set(line, fixFP003(content, stmt, block, idx));
        }
      }
    }
  }

  return fixes;
}

module.exports = { generateASTFixes };
