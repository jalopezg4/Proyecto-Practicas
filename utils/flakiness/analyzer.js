'use strict';

/**
 * Analiza los resultados JSON de Playwright para calcular métricas de flakiness.
 * Lee el archivo producido por el reporter JSON de Playwright.
 */

const fs = require('fs');
const path = require('path');

/**
 * Recorre recursivamente el árbol de suites y recolecta todos los specs.
 * @param {Object} suite
 * @param {Array} acc
 * @returns {Array}
 */
function collectSpecs(suite, acc = []) {
  if (suite.specs) {
    for (const spec of suite.specs) {
      acc.push(spec);
    }
  }
  if (suite.suites) {
    for (const child of suite.suites) {
      collectSpecs(child, acc);
    }
  }
  return acc;
}

/**
 * Determina el estado consolidado de un spec (puede tener múltiples proyectos).
 * @param {Object} spec
 * @returns {'passed'|'flaky'|'failed'|'skipped'}
 */
function resolveSpecStatus(spec) {
  const statuses = (spec.tests || []).map(t => t.status);
  if (statuses.includes('flaky'))      return 'flaky';
  if (statuses.includes('unexpected')) return 'failed'; // Playwright usa 'unexpected' para siempre-fallido
  if (statuses.includes('failed'))     return 'failed';
  if (statuses.includes('skipped'))    return 'skipped';
  return 'passed';
}

/**
 * Cuenta el total de retries realizados en un spec.
 * @param {Object} spec
 * @returns {number}
 */
function countRetries(spec) {
  let total = 0;
  for (const t of (spec.tests || [])) {
    const results = t.results || [];
    // results con retry > 0 son intentos adicionales
    total += results.filter(r => r.retry > 0).length;
  }
  return total;
}

/**
 * Extrae los mensajes de error únicos de un spec.
 * @param {Object} spec
 * @returns {string[]}
 */
function extractErrors(spec) {
  const msgs = new Set();
  for (const t of (spec.tests || [])) {
    for (const r of (t.results || [])) {
      for (const e of (r.errors || [])) {
        if (e.message) msgs.add(e.message.slice(0, 120).replace(/\n/g, ' '));
      }
    }
  }
  return Array.from(msgs);
}

/**
 * Carga y analiza un archivo JSON de resultados de Playwright.
 * @param {string} filePath
 * @returns {Object} métricas calculadas
 */
function analyzeResults(filePath) {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Archivo de resultados no encontrado: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw);

  // Recolectar todos los specs del árbol de suites
  const allSpecs = [];
  for (const suite of (data.suites || [])) {
    collectSpecs(suite, allSpecs);
  }

  const metrics = {
    runAt: data.stats?.startTime || new Date().toISOString(),
    durationMs: data.stats?.duration || 0,
    total: 0,
    passed: 0,
    flaky: 0,
    failed: 0,
    skipped: 0,
    totalRetries: 0,
    retryRate: 0,
    flakinessRate: 0,
    tests: [],
  };

  for (const spec of allSpecs) {
    metrics.total++;
    const status = resolveSpecStatus(spec);
    const retries = countRetries(spec);
    const errors = extractErrors(spec);

    metrics[status]++;
    metrics.totalRetries += retries;

    metrics.tests.push({
      title: spec.title,
      status,
      retries,
      errors,
      line: spec.line,
    });
  }

  // Tasas
  if (metrics.total > 0) {
    metrics.retryRate    = +((metrics.totalRetries / metrics.total) * 100).toFixed(1);
    metrics.flakinessRate = +((metrics.flaky / metrics.total) * 100).toFixed(1);
    metrics.failureRate   = +(((metrics.failed) / metrics.total) * 100).toFixed(1);
  }

  // Top flaky (más retries primero)
  metrics.topFlaky = metrics.tests
    .filter(t => t.status === 'flaky' || t.retries > 0)
    .sort((a, b) => b.retries - a.retries)
    .slice(0, 10);

  return metrics;
}

/**
 * Compara dos conjuntos de métricas (antes vs después) y calcula mejoras.
 * @param {Object} before
 * @param {Object} after
 * @returns {Object} comparación con deltas
 */
function compareMetrics(before, after) {
  const delta = (b, a) => {
    const diff = a - b;
    const pct  = b !== 0 ? +((diff / b) * 100).toFixed(1) : (a === 0 ? 0 : -100);
    return { before: b, after: a, diff, pct };
  };

  return {
    flakinessRate:  delta(before.flakinessRate,  after.flakinessRate),
    retryRate:      delta(before.retryRate,       after.retryRate),
    failureRate:    delta(before.failureRate,     after.failureRate),
    totalRetries:   delta(before.totalRetries,    after.totalRetries),
    flaky:          delta(before.flaky,           after.flaky),
    failed:         delta(before.failed,          after.failed),
    // Tests resueltos = los que eran flaky/failed antes y ahora son passed
    resolved: before.tests.filter(bt => {
      const at = after.tests.find(t => t.title === bt.title);
      return (bt.status === 'flaky' || bt.status === 'failed') && at?.status === 'passed';
    }).map(t => t.title),
    // Regresiones = tests que EXISTÍAN antes como passed y ahora son flaky/failed
    regressions: after.tests.filter(at => {
      const bt = before.tests.find(t => t.title === at.title);
      return (at.status === 'flaky' || at.status === 'failed') && bt && bt.status === 'passed';
    }).map(t => t.title),
  };
}

module.exports = { analyzeResults, compareMetrics, collectSpecs };
