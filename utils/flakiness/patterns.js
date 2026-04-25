'use strict';

/**
 * Catálogo de patrones de flakiness detectables estáticamente en archivos de test.
 * Cada patrón define: cómo detectarlo (regex), severidad, descripción y corrección.
 */

const PATTERNS = [
  {
    id: 'FP-001',
    name: 'Hard-coded timeout',
    severity: 'HIGH',
    regex: /waitForTimeout\s*\(\s*\d+\s*\)/g,
    description: 'Espera fija arbitraria. Demasiado corta en máquinas lentas, innecesariamente larga en las rápidas.',
    fix: 'Reemplazar por espera orientada a condición:\n' +
         '  await expect(locator).toBeVisible()\n' +
         '  await page.waitForURL(...)\n' +
         '  await page.waitForLoadState("networkidle")',
    example: {
      bad:  "await page.waitForTimeout(1000);",
      good: "await expect(page.getByRole('button')).toBeVisible();"
    }
  },
  {
    id: 'FP-002',
    name: 'Locator frágil (posicional)',
    severity: 'HIGH',
    regex: /(?:nth-child\s*\(\d+\)|nth-of-type\s*\(\d+\)|\.nth\s*\(\d+\)|xpath=.*\/li\[\d+\]|xpath=.*\[\d+\])/g,
    description: 'Selector basado en posición. Falla si el orden del DOM cambia por cualquier motivo.',
    fix: 'Usar locators semánticos:\n' +
         '  page.getByRole("listitem").filter({ hasText: "texto" })\n' +
         '  page.getByLabel("label")\n' +
         '  page.getByTestId("data-testid")',
    example: {
      bad:  'page.locator(".list li:nth-child(2)")',
      good: 'page.getByRole("listitem").filter({ hasText: "esperado" })'
    }
  },
  {
    id: 'FP-003',
    name: 'Sin espera de red / navegación',
    severity: 'MEDIUM',
    regex: /\.click\([^)]*\)\s*;[\s\n]*(?:const|let|var|await\s+(?!page\.waitFor|expect))/g,
    description: 'Click seguido de lectura del DOM sin esperar a que la red o la navegación completen.',
    fix: 'Agregar espera explícita después del click:\n' +
         '  await page.waitForURL("**/ruta")\n' +
         '  await page.waitForLoadState("networkidle")\n' +
         '  await page.waitForResponse("**/api/endpoint")',
    example: {
      bad:  'await page.click("a"); const text = await page.title();',
      good: 'await page.click("a"); await page.waitForURL("**/destino"); const text = await page.title();'
    }
  },
  {
    id: 'FP-004',
    name: 'Estado compartido entre tests',
    severity: 'HIGH',
    regex: /^(?:let|var)\s+\w+\s*[:=]/gm,
    description: 'Variable mutable de módulo. En ejecución paralela múltiples workers compiten por el mismo estado.',
    fix: 'Mover el estado dentro del scope del test o del beforeEach:\n' +
         '  test("mi test", async ({ page }) => {\n' +
         '    const localState = [];\n' +
         '    // ...\n' +
         '  });',
    example: {
      bad:  'let count = 0;\ntest("test A", () => { count++; })',
      good: 'test("test A", () => {\n  let count = 0;\n  count++;\n})'
    }
  },
  {
    id: 'FP-005',
    name: 'Aserción sin auto-wait (innerText/count inmediatos)',
    severity: 'MEDIUM',
    regex: /await\s+page\.(?:locator|)\s*\(.*?\)\.(?:innerText|textContent|count|getAttribute)\s*\(\s*\)\s*;/g,
    description: 'Leer propiedades del DOM directamente no tiene retry automático. La UI puede no estar actualizada.',
    fix: 'Usar expect() que tiene retry automático:\n' +
         '  await expect(locator).toHaveText("texto")\n' +
         '  await expect(locator).toHaveCount(n)\n' +
         '  await expect(locator).toHaveAttribute("attr", "val")',
    example: {
      bad:  'const text = await page.locator(".msg").innerText();\nexpect(text).toBe("Listo");',
      good: 'await expect(page.locator(".msg")).toHaveText("Listo");'
    }
  },
  {
    id: 'FP-006',
    name: 'Estado global de módulo mutable',
    severity: 'HIGH',
    regex: /^(?:let|var)\s+\w+(?:Count|Total|Index|State|Flag|List|Items|Data)\s*[:=]/gim,
    description: 'Variables con nombres que sugieren contadores/listas compartidos entre tests.',
    fix: 'Encapsular en beforeEach con scope local al describe o al test.',
    example: {
      bad:  'let itemCount = 0;',
      good: '// Dentro de beforeEach o del test:\nlet itemCount = 0;'
    }
  },
  {
    id: 'FP-007',
    name: 'Lógica sensible al tiempo',
    severity: 'MEDIUM',
    regex: /Date\.now\s*\(\s*\)|new Date\s*\(\s*\)|performance\.now\s*\(\s*\)/g,
    description: 'Comparaciones de timestamps sin tolerancia suficiente fallan en CI o máquinas bajo carga.',
    fix: 'Evitar comparar tiempos absolutos. Verificar el RESULTADO esperado, no el tiempo que tardó.',
    example: {
      bad:  'expect(Date.now() - start).toBeLessThan(100);',
      good: 'await expect(page.locator(".result")).toBeVisible(); // verifica el estado, no el tiempo'
    }
  },
];

module.exports = { PATTERNS };
