# Sistema de Análisis de Flakiness — Playwright

## Contexto y objetivo

Este proyecto fue desarrollado como práctica de QA. El objetivo es demostrar cómo identificar, medir y corregir la **flakiness** (inestabilidad) en suites de tests automatizados con Playwright.

Un test **flaky** es aquel que a veces pasa y a veces falla sin que el código de la aplicación haya cambiado. En CI/CD esto es especialmente dañino porque genera ruido, fuerza reruns innecesarios y puede enmascarar bugs reales.

**Lo que resuelve este proyecto:**

- Ejecutar tests intencionalmente inestables y medir cuántos fallan, cuántos necesitan retry y cuál es la tasa de flakiness.
- Analizar estáticamente el código de tests para detectar anti-patrones que causan inestabilidad.
- Generar sugerencias de corrección contextuales usando análisis AST real.
- Ejecutar la versión corregida y comparar métricas antes/después para demostrar la mejora.

---

## Estructura del proyecto

```
proyecto/
├── tests/
│   ├── specs/
│   │   ├── flaky/
│   │   │   └── 03-ecommerce-flaky.spec.ts    # Tests CON anti-patrones (inestables)
│   │   └── stable/
│   │       └── 03-ecommerce-stable.spec.ts   # Mismos tests pero corregidos (estables)
│   ├── external/
│   │   └── herokuapp-login.spec.ts           # Tests externos con anti-patrones para demo de detección
│   └── fixtures/
│       └── base.ts                           # Fixtures extendidos con helpers reutilizables
│
├── utils/flakiness/
│   ├── cli.js            # Punto de entrada de todos los comandos del analizador
│   ├── analyzer.js       # Lee el JSON de Playwright y calcula métricas de flakiness
│   ├── detector.js       # Escaneo estático de archivos .spec.ts con regex + AST
│   ├── ast-analyzer.js   # Análisis AST real con @babel/parser para generar fixes contextuales
│   ├── reporter.js       # Formatea la salida en terminal (colores, links Ctrl+Click, diffs)
│   ├── patterns.js       # Catálogo de los 7 anti-patrones detectables (FP-001 a FP-007)
│   └── run.sh            # Wrapper bash que invoca cli.js
│
├── flakiness-metrics/
│   ├── results-latest.json   # JSON generado por Playwright en cada ejecución
│   ├── results-before.json   # Snapshot guardado antes de aplicar correcciones
│   ├── results-after.json    # Snapshot guardado después de aplicar correcciones
│   ├── comparison.json       # Resultado de la comparativa antes/después
│   └── static-analysis.json  # Reporte JSON del escaneo estático (para CI)
│
├── playwright.config.ts
├── package.json
└── tsconfig.json
```

---

## Requisitos previos

- Node.js 18 o superior
- npm
- Acceso a internet (los tests apuntan a sitios externos: saucedemo.com, herokuapp.com)

### Instalación

```bash
# Instalar dependencias del proyecto
npm install

# Instalar los navegadores de Playwright
npx playwright install chromium
```

---

## Anti-patrones detectados

El sistema detecta 7 patrones de flakiness catalogados como FP-001 a FP-007:

| ID     | Nombre                             | Severidad | Descripción |
|--------|------------------------------------|-----------|-------------|
| FP-001 | Hard-coded timeout                 | HIGH      | `waitForTimeout(n)` — espera fija que puede ser muy corta en CI o red lenta |
| FP-002 | Locator frágil posicional          | HIGH      | `nth-child(n)`, `nth-of-type(n)`, `.nth(n)` — falla si el orden del DOM cambia |
| FP-003 | Sin espera de red / navegación     | MEDIUM    | Click seguido de lectura del DOM sin `waitForURL` o `waitForLoadState` |
| FP-004 | Estado compartido entre tests      | HIGH      | Variables `let`/`var` de módulo que múltiples tests comparten y mutan |
| FP-005 | Aserción sin auto-wait             | MEDIUM    | `innerText()`, `count()`, `textContent()` sin `expect()` — no tiene retry automático |
| FP-006 | Contador/lista global de módulo    | HIGH      | Variables tipo `itemCount`, `cartItems` en scope de módulo — no thread-safe |
| FP-007 | Lógica sensible al tiempo          | MEDIUM    | `Date.now()` + `toBeLessThan(umbral)` — frágil bajo carga o en máquinas lentas |

---

## Comandos disponibles

```bash
# Ejecutar tests
npm run test:flaky       # Solo los tests inestables (flaky/)
npm run test:stable      # Solo los tests corregidos (stable/)
npm run test:all         # Todos los tests

# Guardar snapshots de métricas
npm run save-before      # Copia results-latest.json → results-before.json
npm run save-after       # Copia results-latest.json → results-after.json

# Análisis
npm run analyze          # Métricas de la última ejecución (results-latest.json)
npm run analyze:results  # Tests flaky de la última ejecución + anti-patrones detectados
npm run detect           # Escaneo estático de TODOS los .spec.ts del proyecto
npm run fix:suggest      # Muestra diffs de corrección sugeridos para archivos flaky/
npm run compare          # Comparativa before vs after con tabla de mejoras
npm run metrics          # Alias de analyze

# Análisis de un archivo específico
npm run analyze:file -- tests/external/herokuapp-login.spec.ts

# Workflows automáticos (encadenan varios pasos)
npm run workflow:before  # test:flaky + save-before
npm run workflow:after   # test:stable + save-after + compare
npm run workflow:full    # workflow:before + workflow:after completo
```

---

## Paso a paso

### Paso 1: Ejecutar los tests inestables y guardar baseline

```bash
npm run test:flaky
npm run save-before
```

**Qué hace:**
- Ejecuta los 6 tests en `tests/specs/flaky/03-ecommerce-flaky.spec.ts`.
- Playwright guarda los resultados en `flakiness-metrics/results-latest.json`, incluyendo si cada test pasó, falló o necesitó retry (flaky).
- `save-before` copia ese JSON como `results-before.json`, que es el punto de comparación.

**Qué esperar:** Algunos tests pasarán, otros serán marcados como **flaky** (fallaron en el primer intento pero pasaron con retry) o **failed** (fallaron todos los intentos). Esto es intencional — los tests tienen anti-patrones a propósito.

---

### Paso 2: Ver las métricas de la ejecución inestable

```bash
npm run analyze
```

**Qué hace:**
- Lee `results-latest.json` y calcula:
  - Cuántos tests pasaron, cuántos son flaky, cuántos fallaron.
  - Flakiness rate, retry rate, failure rate (%).
  - Top tests inestables ordenados por cantidad de retries.

**Ejemplo de salida:**
```
══════════════════════════════════════════════════════════════════════
  ANÁLISIS DE EJECUCIÓN MÁS RECIENTE
══════════════════════════════════════════════════════════════════════
  Total de tests  : 6
  Pasaron (1° run): 2
  Flaky (retry OK): 2
  Fallaron todos  : 2
  Flakiness rate  : 33.3%
  Retry rate      : 66.7%
```

---

### Paso 3: Detectar los anti-patrones en el código

```bash
npm run detect
```

**Qué hace:**
- Recorre todos los archivos `.spec.ts` del proyecto con análisis estático (regex).
- Reporta cada ocurrencia de los 7 patrones con:
  - Ruta del archivo y número de línea (link Ctrl+Click en terminal).
  - Severidad (HIGH / MEDIUM / LOW).
  - El fragmento de código problemático subrayado.
  - El contexto (línea anterior y posterior).

**Cuándo usarlo:** Antes de hacer correcciones, para tener un mapa de todos los problemas.

---

### Paso 4: Ver sugerencias de corrección con análisis AST

```bash
npm run fix:suggest
```

**Qué hace:**
- Igual que `detect` pero solo para archivos en `tests/specs/flaky/`.
- Para cada hallazgo, muestra un **diff contextual** generado por análisis AST real:

```
  - await page.waitForTimeout(500);
  + await page.waitForURL('**/inventory.html');
```

El fix no es un template genérico: el analizador AST lee el código que viene antes y después de cada línea problemática para proponer el reemplazo más apropiado. Por ejemplo:
- Si `waitForTimeout` viene después de un `click()`, busca hacia adelante qué URL se espera o qué locator se usa y sugiere `waitForURL(...)` o `expect(locator).toBeVisible()`.
- Si detecta `innerText()` seguido de `expect(variable).toBe('texto')`, fusiona ambas líneas en `expect(locator).toHaveText('texto')`.

---

### Paso 5: Ver anti-patrones solo en los tests que fallaron

```bash
npm run analyze:results
```

**Qué hace:**
- Cruza los resultados de la última ejecución con el análisis estático.
- Muestra únicamente los anti-patrones de los tests que fueron **flaky** en esa ejecución.
- Agrupa los hallazgos bajo el nombre del test que falló con la etiqueta `[FLAKY]`.
- Intenta correlacionar el mensaje de error real del test con el patrón más probable que lo causó.

**Es el comando más útil del ciclo de debugging:** en lugar de ver todos los anti-patrones del proyecto, te muestra exactamente qué falló y qué lo está causando.

---

### Paso 6: Ejecutar los tests corregidos y guardar resultados

```bash
npm run test:stable
npm run save-after
```

**Qué hace:**
- Ejecuta los 6 tests en `tests/specs/stable/03-ecommerce-stable.spec.ts`.
- Estos son exactamente los mismos tests con los mismos nombres, pero con las correcciones aplicadas:
  - `waitForTimeout` → `waitForURL` o `waitForLoadState('networkidle')`
  - `nth-child` → `.filter({ hasText: 'nombre visible' })`
  - `innerText()` → `expect(locator).toHaveText(...)`
  - Variables de módulo → variables locales dentro de cada test
- `save-after` guarda los nuevos resultados como `results-after.json`.

---

### Paso 7: Comparar antes vs después

```bash
npm run compare
```

**Qué hace:**
- Compara `results-before.json` vs `results-after.json`.
- Muestra una tabla con los deltas de todas las métricas (flakiness rate, retry rate, failure rate, total retries).
- Lista los tests que pasaron de flaky/failed a passed (**TESTS SOLUCIONADOS**).
- Detecta si algún test nuevo empezó a fallar (**REGRESIONES**).
- Calcula un score de mejora neta en puntos porcentuales.

**Ejemplo de salida:**
```
  Métrica               Antes    Después  Variación
  ──────────────────────────────────────────────────
  Flakiness rate        33.3%      0.0%   ↓ 33.3 (100%)
  Retry rate            66.7%      0.0%   ↓ 66.7 (100%)
  Failure rate          33.3%      0.0%   ↓ 33.3 (100%)

  TESTS SOLUCIONADOS (4)
  ✓ FP-001 + FP-003 | login sin esperar redirect a inventory
  ✓ FP-002 | agregar producto al carrito por posición en el DOM
  ...

  RESULTADO: MEJORA NETA: 99.9 puntos porcentuales
```

---

### Workflow completo de una sola vez

Si quieres ejecutar todo el ciclo sin parar:

```bash
npm run workflow:full
```

Esto encadena: `test:flaky` → `save-before` → `test:stable` → `save-after` → `compare`.

---

## Analizar un archivo externo al proyecto

El analizador funciona sobre cualquier archivo `.spec.ts`, no solo los del proyecto:

```bash
npm run analyze:file -- tests/external/herokuapp-login.spec.ts
```

Esto es útil para integrar el sistema en proyectos existentes: apunta a cualquier archivo de tests y obtendrás el mismo reporte de anti-patrones y sugerencias de corrección.

---

## Cómo funciona el análisis AST

El módulo `utils/flakiness/ast-analyzer.js` usa `@babel/parser` y `@babel/traverse` para construir el árbol de sintaxis abstracta (AST) del archivo y navegar sus nodos.

En lugar de devolver sugerencias predeterminadas por tipo de patrón, el analizador:

1. Parsea el archivo a AST con soporte TypeScript.
2. Recorre todos los `BlockStatement` del árbol (cuerpos de tests, callbacks de `describe`, etc.).
3. Para cada sentencia problemática, mira las sentencias vecinas (anterior y posterior) para entender el contexto real.
4. Genera el fix usando los valores concretos del código — la URL real del `goto()`, el selector real del locator, el valor real del `expect()`.

Por ejemplo, si encuentra `waitForTimeout(500)` después de `page.goto('https://saucedemo.com/inventory.html')`, no devuelve el genérico `await page.waitForLoadState(...)` sino `await page.waitForURL('**/inventory.html')` con la ruta extraída del `goto` real.

---

## Configuración de Playwright

El archivo `playwright.config.ts` tiene configuraciones que afectan directamente la detección de flakiness:

| Configuración | Valor local | Valor CI | Por qué |
|--------------|-------------|----------|---------|
| `retries`    | 1           | 2        | Con retries habilitados Playwright puede marcar tests como `flaky` (fallo + retry = pass) |
| `workers`    | 2           | 4        | Paralelismo controlado; más workers aumenta la probabilidad de flakiness por estado compartido |
| `timeout`    | 30s         | 30s      | Tiempo máximo por test |
| `expect.timeout` | 10s    | 10s      | Tiempo de auto-wait para aserciones `expect()` |

Los retries son fundamentales para la demo: sin `retries: 1`, Playwright no marca tests como `flaky` — simplemente los marca como fallidos directamente.
