#!/usr/bin/env node
'use strict';

/**
 * CLI principal del sistema de análisis de flakiness.
 *
 * Comandos disponibles:
 *   analyze      — Analiza los resultados más recientes (results-latest.json)
 *   metrics      — Alias de analyze
 *   detect       — Escaneo estático de código de tests
 *   fix-suggest  — Detecta patrones y genera sugerencias de fix
 *   compare      — Compara results-before.json vs results-after.json
 *   help         — Muestra esta ayuda
 */

const path = require('path');
const fs   = require('fs');

const { analyzeResults, compareMetrics } = require('./analyzer.js');
const { scanDirectory, generateFixes }   = require('./detector.js');
const { printMetrics, printComparison, printDetectionReport } = require('./reporter.js');

const ROOT    = path.resolve(__dirname, '../..');
const METRICS = path.join(ROOT, 'flakiness-metrics');
const TESTS   = path.join(ROOT, 'tests');

const FILES = {
  latest: path.join(METRICS, 'results-latest.json'),
  before: path.join(METRICS, 'results-before.json'),
  after:  path.join(METRICS, 'results-after.json'),
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Comandos ────────────────────────────────────────────────────────────────

function cmdAnalyze() {
  if (!fs.existsSync(FILES.latest)) {
    console.error('\n✗ No se encontró flakiness-metrics/results-latest.json');
    console.error('  Ejecuta primero: npm run test:flaky  o  npm run test:all\n');
    process.exit(1);
  }
  const metrics = analyzeResults(FILES.latest);
  printMetrics(metrics, 'ANÁLISIS DE EJECUCIÓN MÁS RECIENTE');
}

function cmdDetect() {
  console.log(`\nEscaneando tests en: ${TESTS}`);
  const result = scanDirectory(TESTS);
  printDetectionReport(result);

  // Guardar reporte JSON para integración CI
  ensureDir(METRICS);
  const outFile = path.join(METRICS, 'static-analysis.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Reporte guardado: flakiness-metrics/static-analysis.json\n`);
}

function cmdFixSuggest() {
  const { findSpecFiles, scanFile } = require('./detector.js');
  const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m',
  };
  const SEV_COLOR = { HIGH: C.red, MEDIUM: C.yellow, LOW: C.cyan };

  const specs = findSpecFiles(TESTS);

  if (specs.length === 0) {
    console.log('\nNo se encontraron archivos .spec.ts\n');
    return;
  }

  let total = 0;

  for (const file of specs) {
    const { findings } = scanFile(file);
    if (findings.length === 0) continue;

    // Solo archivos flaky tienen sugerencias de fix
    if (!file.includes('flaky')) continue;

    total += findings.length;
    console.log('\n' + '─'.repeat(70));
    console.log(`\x1b[1m  ${file}\x1b[0m`);
    console.log('─'.repeat(70));

    for (const f of findings) {
      const sevColor = SEV_COLOR[f.severity] || C.gray;
      const lineStr  = String(f.line);
      const pad      = lineStr.length + 1;

      // Link clickeable Ctrl+Click
      console.log(`\n  ${C.cyan}${file}:${f.line}:${f.col}${C.reset}`);
      console.log(`  ${sevColor}${f.severity.padEnd(7)}${C.reset} ${sevColor}${f.patternId}${C.reset}  ${f.patternName}`);
      console.log('');

      // Contexto de código
      if (f.contextBefore !== null) {
        console.log(`  ${C.gray}${String(f.line - 1).padStart(pad)} │ ${f.contextBefore}${C.reset}`);
      }
      console.log(`  ${C.red}${lineStr.padStart(pad)} │ ${f.snippet}${C.reset}`);

      const indent  = f.snippet.length - f.snippet.trimStart().length;
      const matchLen = f.matchText ? Math.min(f.matchText.length, f.snippet.length - indent) : f.snippet.trimStart().length;
      console.log(`  ${' '.repeat(pad)} │ ${' '.repeat(indent)}${C.red}${'~'.repeat(matchLen)}${C.reset}`);

      if (f.contextAfter !== null) {
        console.log(`  ${C.gray}${String(f.line + 1).padStart(pad)} │ ${f.contextAfter}${C.reset}`);
      }

      // Diff sugerido — contextual si está disponible
      const fix = f.contextualFix || f.example;
      if (fix) {
        console.log('');
        console.log(`  ${C.gray}Cambio sugerido:${C.reset}`);
        for (const l of fix.bad.split('\n'))  console.log(`  ${C.red}  - ${l}${C.reset}`);
        for (const l of fix.good.split('\n')) console.log(`  ${C.green}  + ${l}${C.reset}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(70));
  if (total === 0) {
    console.log('\x1b[32m  ✓ Sin patrones detectados en archivos flaky.\x1b[0m');
  } else {
    console.log(`\x1b[1m  ${total} hallazgo${total !== 1 ? 's' : ''} — edita las líneas marcadas para corregirlos.\x1b[0m`);
  }
  console.log('═'.repeat(70) + '\n');
}

/**
 * Mapea el mensaje de error de un test al patrón de flakiness más probable.
 * Devuelve un array de patternIds relevantes, o null si no se puede determinar.
 */
function errorToPatterns(errors) {
  if (!errors || errors.length === 0) return null;
  const txt = errors.join(' ').toLowerCase();
  const ids  = new Set();

  if (txt.match(/timeout|ms exceeded|waiting for locator|locator\.innertext|locator\.textcontent/))
    ids.add('FP-001'), ids.add('FP-005');
  if (txt.match(/nth-child|nth-of-type|strict mode violation|resolved to \d+ element/))
    ids.add('FP-002');
  if (txt.match(/net::err|err_cert|navigation failed|page\.goto/))
    ids.add('FP-003');
  if (txt.match(/expected.*greater|received.*0\b|array.*empty|undefined.*length/))
    ids.add('FP-004'), ids.add('FP-006');
  if (txt.match(/less than|tobelessthan|elapsed|date\.now/))
    ids.add('FP-007');

  return ids.size > 0 ? [...ids] : null;
}

/**
 * Lee results-latest.json, encuentra qué archivos tuvieron tests flaky/fallidos,
 * cruza el error real con el patrón que lo causó y muestra solo esos hallazgos.
 */
function cmdAnalyzeResults() {
  if (!fs.existsSync(FILES.latest)) {
    console.error('\n✗ No hay resultados aún. Ejecuta primero: npm run test:all\n');
    process.exit(1);
  }

  const raw    = JSON.parse(fs.readFileSync(FILES.latest, 'utf-8'));
  const suites = raw.suites || [];

  // Map<absFilePath, Map<testTitle, string[]>> — errores por test
  const problematicFiles = new Map();

  function walkSuite(suite) {
    for (const spec of (suite.specs || [])) {
      const badTests = (spec.tests || []).filter(t => t.status === 'flaky');
      if (badTests.length === 0 || !spec.file) continue;

      // Recolectar mensajes de error de todos los intentos fallidos
      const errors = [];
      for (const t of badTests) {
        for (const r of (t.results || [])) {
          if (r.status === 'failed' || r.status === 'timedOut') {
            for (const e of (r.errors || [])) {
              if (e.message) errors.push(e.message);
            }
          }
        }
      }

      const candidates = [
        path.join(ROOT, spec.file),
        path.join(ROOT, 'tests', spec.file),
        path.join(ROOT, 'tests', 'specs', spec.file),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          if (!problematicFiles.has(c)) problematicFiles.set(c, new Map());
          problematicFiles.get(c).set(spec.title, errors);
          break;
        }
      }
    }
    for (const child of (suite.suites || [])) walkSuite(child);
  }

  for (const s of suites) walkSuite(s);

  if (problematicFiles.size === 0) {
    console.log('\n\x1b[32m✓ Ningún test flaky o fallido en la última ejecución.\x1b[0m\n');
    return;
  }

  console.log(`\n\x1b[1mTests problemáticos detectados en ${problematicFiles.size} archivo(s)\x1b[0m`);

  const { scanFile, getTestLineRanges } = require('./detector.js');
  const { printDetectionReport } = require('./reporter.js');

  for (const [filePath, testMap] of problematicFiles) {
    const result  = scanFile(filePath);
    if (result.findings.length === 0) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const ranges  = getTestLineRanges(content, [...testMap.keys()]);

    // Para cada hallazgo: debe estar dentro del rango del test flaky
    // Y el patrón debe coincidir con el error que provocó la falla
    const filtered = result.findings.filter(f => {
      const range = ranges.find(r => f.line >= r.start && f.line <= r.end);
      if (!range) return false;

      const errors          = testMap.get(range.title) || [];
      const relevantPatterns = errorToPatterns(errors);
      // Si no podemos determinar el patrón del error, mostramos todos los del test
      return !relevantPatterns || relevantPatterns.includes(f.patternId);
    });

    if (filtered.length === 0) {
      console.log(`\n  \x1b[90m${filePath}\x1b[0m`);
      console.log(`  \x1b[33mTests problemáticos sin anti-patrones de código detectables.\x1b[0m`);
      console.log(`  \x1b[90m(La causa puede ser externa: red, datos de entorno, servidor)\x1b[0m\n`);
      continue;
    }

    // Agrupar hallazgos por test
    const byTest = new Map();
    for (const f of filtered) {
      const range = ranges.find(r => f.line >= r.start && f.line <= r.end);
      const key   = range ? range.title : '(fuera de test)';
      if (!byTest.has(key)) byTest.set(key, []);
      byTest.get(key).push(f);
    }

    const C = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m',
                yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
    const SEV = { HIGH: C.red, MEDIUM: C.yellow, LOW: C.cyan };

    console.log(`\n${C.bold}  ${filePath}${C.reset}`);

    for (const [testTitle, findings] of byTest) {
      console.log(`\n  ${'─'.repeat(66)}`);
      console.log(`  ${C.yellow}${C.bold}[FLAKY]${C.reset} ${C.bold}${testTitle}${C.reset}  ${C.gray}(${findings.length} hallazgo${findings.length !== 1 ? 's' : ''})${C.reset}`);
      console.log(`  ${'─'.repeat(66)}`);

      for (const f of findings) {
        const sevColor = SEV[f.severity] || C.gray;
        const lineStr  = String(f.line);
        const pad      = lineStr.length + 1;

        console.log(`\n  ${C.cyan}${filePath}:${f.line}:${f.col}${C.reset}`);
        console.log(`  ${sevColor}${f.severity.padEnd(7)}${C.reset} ${sevColor}${f.patternId}${C.reset}  ${f.patternName}`);
        console.log('');

        if (f.contextBefore !== null)
          console.log(`  ${C.gray}${String(f.line-1).padStart(pad)} │ ${f.contextBefore}${C.reset}`);
        console.log(`  ${C.red}${lineStr.padStart(pad)} │ ${f.snippet}${C.reset}`);
        const indent   = f.snippet.length - f.snippet.trimStart().length;
        const matchLen = f.matchText ? Math.min(f.matchText.length, f.snippet.length - indent) : f.snippet.trimStart().length;
        console.log(`  ${' '.repeat(pad)} │ ${' '.repeat(indent)}${C.red}${'~'.repeat(matchLen)}${C.reset}`);
        if (f.contextAfter !== null)
          console.log(`  ${C.gray}${String(f.line+1).padStart(pad)} │ ${f.contextAfter}${C.reset}`);

        const fix = f.contextualFix || f.example;
        if (fix) {
          console.log(`\n  ${C.gray}Cambio sugerido:${C.reset}`);
          for (const l of fix.bad.split('\n'))  console.log(`  ${C.red}  - ${l}${C.reset}`);
          for (const l of fix.good.split('\n')) console.log(`  ${C.green}  + ${l}${C.reset}`);
        }
      }
    }
    console.log('');
  }
}

function cmdAnalyzeFile() {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error('\n✗ Uso: node cli.js analyze:file <ruta-al-archivo.spec.ts>\n');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`\n✗ Archivo no encontrado: ${absPath}\n`);
    process.exit(1);
  }

  const { scanFile } = require('./detector.js');
  const { printDetectionReport } = require('./reporter.js');

  const result  = scanFile(absPath);
  const summary = {
    filesScanned:    1,
    filesWithIssues: result.findings.length > 0 ? 1 : 0,
    totalFindings:   result.findings.length,
    byPattern:       {},
    bySeverity:      { HIGH: 0, MEDIUM: 0, LOW: 0 },
  };
  for (const f of result.findings) {
    summary.byPattern[f.patternId] = (summary.byPattern[f.patternId] || 0) + 1;
    summary.bySeverity[f.severity] = (summary.bySeverity[f.severity] || 0) + 1;
  }

  printDetectionReport({ summary, files: [result] });
}

function cmdCompare() {
  const missingFiles = [FILES.before, FILES.after].filter(f => !fs.existsSync(f));

  if (missingFiles.length > 0) {
    console.error('\n✗ Faltan archivos para comparar:');
    missingFiles.forEach(f => console.error(`  ${f.replace(ROOT + '/', '')}`));
    console.error('\nFlujo de trabajo:');
    console.error('  1. npm run test:flaky    # ejecutar tests inestables');
    console.error('  2. npm run save-before   # guardar baseline ANTES');
    console.error('  3. npm run test:stable   # ejecutar tests estables');
    console.error('  4. npm run save-after    # guardar baseline DESPUÉS');
    console.error('  5. npm run compare       # comparar\n');
    process.exit(1);
  }

  const before = analyzeResults(FILES.before);
  const after  = analyzeResults(FILES.after);

  printMetrics(before, 'MÉTRICAS ANTES (tests inestables)');
  printMetrics(after,  'MÉTRICAS DESPUÉS (tests estables)');

  const comparison = compareMetrics(before, after);
  printComparison(comparison);

  // Guardar comparación en JSON
  ensureDir(METRICS);
  const outFile = path.join(METRICS, 'comparison.json');
  fs.writeFileSync(outFile, JSON.stringify({ before, after, comparison }, null, 2));
  console.log(`Comparación guardada: flakiness-metrics/comparison.json\n`);
}

function cmdHelp() {
  console.log(`
Flakiness Analysis CLI — Uso:

  node utils/flakiness/cli.js <comando>

Comandos:
  analyze       Analiza flakiness-metrics/results-latest.json
  metrics       Alias de analyze
  detect        Escaneo estático de código (.spec.ts) en busca de anti-patrones
  fix-suggest   Sugiere correcciones para los patrones detectados
  compare       Compara results-before.json vs results-after.json

Scripts npm equivalentes:
  npm run analyze
  npm run detect
  npm run fix:suggest
  npm run compare

Flujo de trabajo completo:
  npm run test:flaky    → npm run save-before
  npm run test:stable   → npm run save-after
  npm run compare
`);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'help';

const COMMANDS = {
  analyze:           cmdAnalyze,
  metrics:           cmdAnalyze,
  detect:            cmdDetect,
  'fix-suggest':     cmdFixSuggest,
  'analyze:file':    cmdAnalyzeFile,
  'analyze:results': cmdAnalyzeResults,
  compare:           cmdCompare,
  help:              cmdHelp,
};

const handler = COMMANDS[cmd];
if (!handler) {
  console.error(`\n✗ Comando desconocido: "${cmd}". Usa "help" para ver opciones.\n`);
  process.exit(1);
}

handler();
