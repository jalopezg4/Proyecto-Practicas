'use strict';

/**
 * Analizador estático de código de tests.
 * Detecta patrones de flakiness en archivos .spec.ts sin ejecutarlos.
 */

const fs   = require('fs');
const path = require('path');
const { PATTERNS }        = require('./patterns.js');
const { generateASTFixes } = require('./ast-analyzer.js');

/**
 * Encuentra todos los archivos .spec.ts bajo un directorio.
 * @param {string} dir
 * @returns {string[]}
 */
function findSpecFiles(dir) {
  const results = [];

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(full);
      } else if (entry.isFile() && /\.spec\.(ts|js)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Escanea un único archivo en busca de patrones de flakiness.
 * @param {string} filePath
 * @returns {{ file: string, findings: Array }}
 */
function scanFile(filePath) {
  const content  = fs.readFileSync(filePath, 'utf-8');
  const lines    = content.split('\n');
  const findings = [];

  // Generar fixes por análisis AST real antes de iterar patrones
  const astFixes = generateASTFixes(filePath, content);

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
    let match;

    while ((match = re.exec(content)) !== null) {
      const lineNumber  = content.slice(0, match.index).split('\n').length;
      const lineContent = lines[lineNumber - 1]?.trim() || '';

      // Ignorar matches dentro de líneas de comentario
      if (lineContent.startsWith('//') || lineContent.startsWith('*')) continue;

      // Evitar duplicados en la misma línea para el mismo patrón
      if (findings.find(f => f.patternId === pattern.id && f.line === lineNumber)) continue;

      const colNumber = match.index - content.lastIndexOf('\n', match.index);

      findings.push({
        patternId:     pattern.id,
        patternName:   pattern.name,
        severity:      pattern.severity,
        line:          lineNumber,
        col:           colNumber,
        snippet:       lineContent,
        matchText:     match[0],
        contextBefore: lines[lineNumber - 2]?.trimEnd() ?? null,
        contextAfter:  lines[lineNumber]?.trimEnd()     ?? null,
        fix:           pattern.fix,
        // Fix generado por AST real; si el analizador no pudo, usa el example como último recurso
        contextualFix: astFixes.get(lineNumber) ?? pattern.example,
      });
    }
  }

  return {
    file: filePath,
    findings: findings.sort((a, b) => a.line - b.line),
  };
}

/**
 * Escanea todos los archivos de test bajo un directorio.
 * @param {string} testDir
 * @returns {{ summary: Object, files: Array }}
 */
function scanDirectory(testDir) {
  const specFiles = findSpecFiles(testDir);
  const fileResults = specFiles.map(f => scanFile(f));

  const summary = {
    filesScanned:  specFiles.length,
    filesWithIssues: fileResults.filter(r => r.findings.length > 0).length,
    totalFindings: fileResults.reduce((n, r) => n + r.findings.length, 0),
    byPattern: {},
    bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 },
  };

  for (const result of fileResults) {
    for (const f of result.findings) {
      summary.byPattern[f.patternId] = (summary.byPattern[f.patternId] || 0) + 1;
      summary.bySeverity[f.severity] = (summary.bySeverity[f.severity] || 0) + 1;
    }
  }

  return { summary, files: fileResults };
}

/**
 * Genera sugerencias de corrección automática para un archivo.
 * Devuelve el contenido modificado con los cambios aplicados.
 * @param {string} filePath
 * @returns {{ original: string, patched: string, changes: number }}
 */
function generateFixes(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;
  let changes = 0;

  // FP-001: Reemplazar waitForTimeout con comentario de advertencia
  const fp001re = /(\s*)await\s+page\.waitForTimeout\s*\(\s*\d+\s*\)\s*;/g;
  content = content.replace(fp001re, (match, indent) => {
    changes++;
    return `${indent}// TODO [FP-001]: Reemplazar por espera orientada a condición\n` +
           `${indent}// await expect(locator).toBeVisible();\n` +
           `${indent}// await page.waitForURL('...');\n` +
           `${indent}/* REMOVIDO: ${match.trim()} */`;
  });

  // FP-004: Marcar variables mutables de módulo
  const fp004re = /^((?:let|var)\s+\w+\s*=\s*(?:\[\]|\{\}|0|'|")\s*;)/gm;
  content = content.replace(fp004re, (match) => {
    changes++;
    return `// TODO [FP-004]: Mover dentro del scope de beforeEach o del test\n// ${match}`;
  });

  return { original, patched: content, changes };
}

/**
 * Dado el contenido de un archivo y una lista de títulos de tests,
 * devuelve los rangos de línea (1-indexed) de cada uno.
 * Sirve para filtrar hallazgos a solo los tests problemáticos.
 *
 * @param {string} content
 * @param {string[]} testTitles
 * @returns {Array<{start: number, end: number, title: string}>}
 */
function getTestLineRanges(content, testTitles) {
  const lines  = content.split('\n');
  const ranges = [];

  for (const title of testTitles) {
    // Buscar la línea donde se define este test
    const escaped   = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testRegex = new RegExp(`test\\s*\\(\\s*['"\`]${escaped}['"\`]`);
    const startIdx  = lines.findIndex(l => testRegex.test(l));
    if (startIdx === -1) continue;

    // Encontrar el cierre contando llaves
    let depth   = 0;
    let started = false;
    let endIdx  = startIdx;

    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') { depth--; }
      }
      if (started && depth === 0) { endIdx = i; break; }
    }

    ranges.push({ title, start: startIdx + 1, end: endIdx + 1 });
  }

  return ranges;
}

module.exports = { scanDirectory, scanFile, findSpecFiles, generateFixes, getTestLineRanges };
