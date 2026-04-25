'use strict';

/**
 * Genera reportes formateados para terminal con métricas de flakiness.
 * Soporta reporte de una ejecución y comparativa antes/después.
 */

// Colores ANSI para terminal
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  bgRed:  '\x1b[41m',
  bgGreen:'\x1b[42m',
};

const SEVERITY_COLOR = { HIGH: C.red, MEDIUM: C.yellow, LOW: C.cyan };

function bold(s)  { return `${C.bold}${s}${C.reset}`; }
function color(c, s) { return `${c}${s}${C.reset}`; }

function line(char = '─', len = 70) {
  return char.repeat(len);
}

function badge(value, thresholds = { warn: 10, error: 25 }) {
  if (value >= thresholds.error) return color(C.red, `${value}%`);
  if (value >= thresholds.warn)  return color(C.yellow, `${value}%`);
  return color(C.green, `${value}%`);
}

function deltaStr(delta) {
  const { diff, pct } = delta;
  if (diff === 0) return color(C.gray, '  sin cambio');
  const arrow = diff < 0 ? '↓' : '↑';
  const c = diff < 0 ? C.green : C.red;
  return color(c, `${arrow} ${Math.abs(diff)} (${Math.abs(pct)}%)`);
}

/**
 * Imprime el reporte de métricas de una sola ejecución.
 */
function printMetrics(metrics, label = 'REPORTE DE FLAKINESS') {
  console.log('\n' + line('═'));
  console.log(bold(`  ${label}`));
  console.log(line('═'));

  const d = new Date(metrics.runAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  console.log(`  Ejecutado: ${color(C.gray, d)}`);
  console.log(`  Duración:  ${color(C.gray, (metrics.durationMs / 1000).toFixed(1) + 's')}`);
  console.log('');

  console.log(bold('  RESUMEN DE RESULTADOS'));
  console.log(line());
  console.log(`  Total de tests  : ${bold(metrics.total)}`);
  console.log(`  Pasaron (1° run): ${color(C.green, metrics.passed)}`);
  console.log(`  Flaky (retry OK): ${color(C.yellow, metrics.flaky)}`);
  console.log(`  Fallaron todos  : ${color(C.red, metrics.failed)}`);
  console.log(`  Omitidos        : ${color(C.gray, metrics.skipped)}`);
  console.log('');

  console.log(bold('  MÉTRICAS DE ESTABILIDAD'));
  console.log(line());
  console.log(`  Flakiness rate  : ${badge(metrics.flakinessRate)}`);
  console.log(`  Failure rate    : ${badge(metrics.failureRate)}`);
  console.log(`  Retry rate      : ${badge(metrics.retryRate, { warn: 15, error: 40 })}`);
  console.log(`  Total retries   : ${metrics.totalRetries}`);
  console.log('');

  if (metrics.topFlaky && metrics.topFlaky.length > 0) {
    console.log(bold('  TOP TESTS INESTABLES (mayor cantidad de retries)'));
    console.log(line());
    for (const t of metrics.topFlaky) {
      const statusC = t.status === 'flaky' ? C.yellow : C.red;
      console.log(`  [${color(statusC, t.status.padEnd(6))}] retries: ${t.retries}  →  ${t.title.slice(0, 55)}`);
      if (t.errors.length > 0) {
        console.log(`           ${color(C.gray, t.errors[0].slice(0, 70))}`);
      }
    }
    console.log('');
  }
}

/**
 * Imprime el reporte comparativo antes/después.
 */
function printComparison(comparison) {
  console.log('\n' + line('═'));
  console.log(bold('  COMPARATIVA ANTES → DESPUÉS'));
  console.log(line('═'));

  const rows = [
    { label: 'Flakiness rate',  delta: comparison.flakinessRate,  unit: '%' },
    { label: 'Failure rate',    delta: comparison.failureRate,     unit: '%' },
    { label: 'Retry rate',      delta: comparison.retryRate,       unit: '%' },
    { label: 'Total retries',   delta: comparison.totalRetries,    unit: ''  },
    { label: 'Tests flaky',     delta: comparison.flaky,           unit: ''  },
    { label: 'Tests fallidos',  delta: comparison.failed,          unit: ''  },
  ];

  const padLabel = 18;
  const padNum   = 8;

  console.log(`  ${'Métrica'.padEnd(padLabel)}  ${'Antes'.padStart(padNum)}  ${'Después'.padStart(padNum)}  Variación`);
  console.log(line());

  for (const row of rows) {
    const { before, after } = row.delta;
    const bStr = `${before}${row.unit}`.padStart(padNum);
    const aStr = `${after}${row.unit}`.padStart(padNum);
    const dStr = deltaStr(row.delta);
    console.log(`  ${row.label.padEnd(padLabel)}  ${bStr}  ${aStr}  ${dStr}`);
  }

  console.log('');

  if (comparison.resolved.length > 0) {
    console.log(bold(`  TESTS SOLUCIONADOS (${comparison.resolved.length})`));
    console.log(line());
    for (const t of comparison.resolved) {
      console.log(`  ${color(C.green, '✓')} ${t.slice(0, 65)}`);
    }
    console.log('');
  }

  if (comparison.regressions.length > 0) {
    console.log(bold(`  REGRESIONES NUEVAS (${comparison.regressions.length})`));
    console.log(line());
    for (const t of comparison.regressions) {
      console.log(`  ${color(C.red, '✗')} ${t.slice(0, 65)}`);
    }
    console.log('');
  }

  // Score de mejora global
  const improvementScore = [
    comparison.flakinessRate.diff,
    comparison.retryRate.diff,
    comparison.failureRate.diff,
  ].reduce((sum, d) => sum + d, 0);

  const scoreLabel = improvementScore < 0
    ? color(C.green, `MEJORA NETA: ${Math.abs(improvementScore).toFixed(1)} puntos porcentuales`)
    : color(C.red,   `DEGRADACIÓN NETA: ${improvementScore.toFixed(1)} puntos porcentuales`);

  console.log(line('─'));
  console.log(`  ${bold('RESULTADO:')} ${scoreLabel}`);
  console.log(line('═') + '\n');
}

/**
 * Imprime un hallazgo individual en formato linter con link Ctrl+Click,
 * contexto de código y diff de corrección sugerida.
 */
function printFinding(filePath, f) {
  const sevColor = SEVERITY_COLOR[f.severity] || C.gray;
  const lineStr  = String(f.line);
  const prevStr  = String(f.line - 1);
  const nextStr  = String(f.line + 1);
  const pad      = Math.max(lineStr.length, nextStr.length) + 1;

  // Link clickeable — Ctrl+Click en VSCode abre el archivo en la línea exacta
  console.log(`\n  ${color(C.cyan, `${filePath}:${f.line}:${f.col}`)}`);
  console.log(`  ${color(sevColor, f.severity.padEnd(7))} ${color(sevColor, f.patternId)}  ${f.patternName}`);
  console.log('');

  // Bloque de código con contexto
  if (f.contextBefore !== null) {
    console.log(`  ${color(C.gray, prevStr.padStart(pad))} │ ${color(C.gray, f.contextBefore)}`);
  }
  console.log(`  ${color(C.red, lineStr.padStart(pad))} │ ${color(C.red, f.snippet)}`);

  // Subrayado bajo el fragmento problemático
  const indentLen  = f.snippet.length - f.snippet.trimStart().length;
  const matchLen   = f.matchText ? Math.min(f.matchText.length, f.snippet.length - indentLen) : f.snippet.trimStart().length;
  const underline  = ' '.repeat(indentLen) + color(C.red, '~'.repeat(matchLen));
  console.log(`  ${' '.repeat(pad)} │ ${underline}`);

  if (f.contextAfter !== null) {
    console.log(`  ${color(C.gray, nextStr.padStart(pad))} │ ${color(C.gray, f.contextAfter)}`);
  }

  // Diff de corrección sugerida — usa el fix contextual si está disponible
  const fix = f.contextualFix || f.example;
  if (fix) {
    console.log('');
    console.log(`  ${color(C.gray, 'Cambio sugerido:')}`);
    for (const badLine of fix.bad.split('\n')) {
      console.log(`  ${color(C.red,   `  - ${badLine}`)}`);
    }
    for (const goodLine of fix.good.split('\n')) {
      console.log(`  ${color(C.green, `  + ${goodLine}`)}`);
    }
  }
}

/**
 * Imprime el reporte de detección estática en formato linter.
 */
function printDetectionReport(scanResult) {
  const { summary, files } = scanResult;

  console.log('\n' + line('═'));
  console.log(bold('  ANÁLISIS ESTÁTICO — PATRONES DE FLAKINESS'));
  console.log(line('═'));
  console.log(`  Archivos escaneados : ${summary.filesScanned}`);
  console.log(`  Archivos con issues : ${summary.filesWithIssues}`);
  console.log(`  Hallazgos totales   : ${bold(summary.totalFindings)}`);
  console.log(`  Por severidad       : ` +
    `${color(C.red, 'HIGH ' + summary.bySeverity.HIGH)}  ` +
    `${color(C.yellow, 'MEDIUM ' + summary.bySeverity.MEDIUM)}  ` +
    `${color(C.cyan, 'LOW ' + (summary.bySeverity.LOW || 0))}`);

  for (const fileResult of files) {
    if (fileResult.findings.length === 0) continue;

    console.log('\n' + line('─'));
    console.log(bold(`  ${fileResult.file}`) + color(C.gray, `  (${fileResult.findings.length} hallazgo${fileResult.findings.length !== 1 ? 's' : ''})`));
    console.log(line('─'));

    for (const f of fileResult.findings) {
      printFinding(fileResult.file, f);
    }
  }

  console.log('\n' + line('═') + '\n');
}

module.exports = { printMetrics, printComparison, printDetectionReport };
