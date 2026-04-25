/**
 * TESTS EXTERNOS — The Internet (Herokuapp)
 *
 * Sitio: https://the-internet.herokuapp.com
 * Propósito: demostrar que el analizador funciona sobre CUALQUIER archivo .spec.ts,
 * sin importar en qué carpeta esté ni si pertenece al proyecto principal.
 *
 * Todos los tests pasan en ejecución, pero el analizador estático detecta
 * los anti-patrones presentes (FP-001, FP-002, FP-005, FP-007) que harían
 * estos tests frágiles en entornos lentos, bajo carga o en CI.
 *
 * Cómo analizarlo:
 *   npm run analyze:file -- tests/external/herokuapp-login.spec.ts
 */

import { test, expect } from '@playwright/test';

const URL = 'https://the-internet.herokuapp.com';


test.describe('The Internet — Login y navegación', () => {

  test('login exitoso con credenciales válidas', async ({ page }) => {
    await page.goto(`${URL}/login`);
    await page.waitForLoadState('networkidle');

    await page.locator('#username').fill('tomsmith');
    await page.locator('#password').fill('SuperSecretPassword!');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.flash.success')).toBeVisible();
    await expect(page.locator('.flash.success')).toContainText('You logged into a secure area!');
    await expect(page.locator('a[href="/logout"]')).toBeVisible();
  });

  test('logout después de login exitoso', async ({ page }) => {
    await page.goto(`${URL}/login`);
    await page.waitForLoadState('networkidle');

    await page.locator('#username').fill('tomsmith');
    await page.locator('#password').fill('SuperSecretPassword!');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/secure');

    await page.locator('a[href="/logout"]').click();
    await expect(page.locator('.flash.success')).toBeVisible();
    await expect(page.locator('.flash.success')).toContainText('You logged out');
  });

  test('login con credenciales inválidas muestra error', async ({ page }) => {
    await page.goto(`${URL}/login`);
    await page.waitForLoadState('networkidle');

    await page.locator('#username').fill('usuario_malo');
    await page.locator('#password').fill('clave_incorrecta');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.flash.error')).toBeVisible();
    await expect(page.locator('.flash.error')).toContainText('Your username is invalid!');
  });

  // FP-007: Date.now() para medir rendimiento — frágil en CI o red lenta
  // FP-001: waitForTimeout fijo entre acción y medición
  test('session fue reciente', async ({ page }) => {
    const start = Date.now();

    await page.goto(`${URL}/login`);
    await page.locator('#username').fill('tomsmith');
    await page.locator('#password').fill('SuperSecretPassword!');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(300); // FP-001

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20000); // umbral generoso para que pase — pero FP-007 sigue presente
  });

  // FP-001: waitForTimeout en lugar de waitForLoadState('domcontentloaded')
  // FP-002: nth-child y nth-of-type — frágil si el DOM cambia
  test('navegar a la sección de checkboxes', async ({ page }) => {
    await page.goto(`${URL}/checkboxes`);
    await page.waitForTimeout(1500); // FP-001

    const primero = page.locator('form#checkboxes input:nth-child(1)');   // FP-002
    const segundo = page.locator('form#checkboxes input:nth-of-type(2)'); // FP-002

    const estadoPrimero = await primero.isChecked();
    await segundo.click();

    expect(estadoPrimero).toBe(false);
    expect(await segundo.isChecked()).toBe(true);
  });

  // FP-001: waitForTimeout en lugar de waitForLoadState
  // FP-005: count() e innerText() sin auto-wait
  test('lista de elementos dinámica carga correctamente', async ({ page }) => {
    await page.goto(`${URL}/dynamic_content`);
    await page.waitForTimeout(1500); // FP-001

    const filas = page.locator('.row .large-10');
    const count = await filas.count();                  // FP-005
    const primerTexto = await filas.nth(0).innerText(); // FP-005

    expect(count).toBeGreaterThan(0);
    expect(primerTexto.length).toBeGreaterThan(10);
  });

  // FP-001: waitForTimeout en lugar de espera orientada al elemento
  test('formulario de inputs acepta texto', async ({ page }) => {
    await page.goto(`${URL}/inputs`);
    await page.waitForTimeout(1500); // FP-001

    const valor = await page.locator('input[type="number"]').inputValue();
    await page.locator('input[type="number"]').fill('42');

    expect(valor).toBe('');
    expect(await page.locator('input[type="number"]').inputValue()).toBe('42');
  });

  // FP-001: waitForTimeout en lugar de waitForLoadState
  // FP-002: nth-child para leer opciones del select
  test('página de dropdown tiene opciones', async ({ page }) => {
    await page.goto(`${URL}/dropdown`);
    await page.waitForTimeout(1500); // FP-001

    const opcion1 = await page.locator('#dropdown option:nth-child(2)').innerText(); // FP-002
    const opcion2 = await page.locator('#dropdown option:nth-child(3)').innerText(); // FP-002

    expect(opcion1).toBe('Option 1');
    expect(opcion2).toBe('Option 2');
  });

});
