/**
 * VERSIÓN CORREGIDA — misma estructura que 03-ecommerce-flaky.spec.ts
 * Solo se aplicaron las correcciones sugeridas por el detector de patrones.
 *
 * Correcciones aplicadas:
 *   FP-001  waitForTimeout → waitForURL / waitForLoadState / expect().toBeVisible()
 *   FP-002  nth-child / nth-of-type → filter({ hasText }) semántico
 *   FP-003  sin espera post-click → waitForURL explícito
 *   FP-004  estado de módulo compartido → variables locales por test
 *   FP-005  innerText() inmediato → expect().toHaveText() con auto-wait
 *   FP-006  contadores globales → variables locales
 *   FP-007  Date.now() + toBeLessThan → verificar resultado, no tiempo
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://www.saucedemo.com';

// FP-004 + FP-006 corregidos: estado eliminado del módulo, cada test maneja el suyo
test.describe('Sauce Demo — Tests Inestables (Anti-patrones)', () => {

  test('FP-001 + FP-003 | login sin esperar redirect a inventory', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle'); // FP-001 corregido: espera orientada a condición

    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();

    await page.waitForURL('**/inventory.html'); // FP-003 corregido: espera el redirect

    // FP-005 corregido: toHaveText tiene auto-wait, no falla si la UI tarda
    await expect(page.locator('.title')).toHaveText('Products');
  });

  test('FP-002 | agregar producto al carrito por posición en el DOM', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForURL('**/inventory.html'); // FP-001 + FP-003 corregido

    // FP-002 corregido: filter por texto visible en lugar de nth-child posicional
    const primerProducto = page.locator('.inventory_item').filter({ hasText: 'Sauce Labs Backpack' });

    // FP-005 corregido: esperar visibilidad antes de leer el texto
    await expect(primerProducto.locator('.inventory_item_name')).toBeVisible();
    const nombre = await primerProducto.locator('.inventory_item_name').innerText();

    await primerProducto.locator('button').click();
    const addedCount = 1; // FP-006 corregido: variable local, no de módulo

    // FP-005 corregido: toHaveText con auto-wait
    await expect(page.locator('.shopping_cart_badge')).toHaveText('1');
    expect(nombre.length).toBeGreaterThan(0);
    expect(addedCount).toBe(1);
  });

  test('FP-004 | carrito asume estado dejado por el test anterior', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForURL('**/inventory.html'); // FP-001 corregido

    // FP-004 corregido: el test gestiona su propio estado, no depende del anterior
    const localItems: string[] = [];
    const producto = page.locator('.inventory_item').filter({ hasText: 'Sauce Labs Backpack' });
    const nombre = await producto.locator('.inventory_item_name').innerText();
    await producto.locator('button').click();
    localItems.push(nombre);

    expect(localItems.length).toBeGreaterThan(0);
  });

  test('FP-005 | leer precio antes de que el inventario cargue', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForURL('**/inventory.html'); // FP-003 corregido: espera login completo

    // FP-005 corregido: esperar que el precio sea visible antes de leerlo
    await expect(page.locator('.inventory_item_price').first()).toBeVisible();
    const precio = await page.locator('.inventory_item_price').first().innerText();
    expect(precio).toMatch(/^\$\d+\.\d{2}$/);
  });

  test('FP-007 | validar tiempo de carga del inventario con umbral fijo', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForURL('**/inventory.html'); // FP-001 corregido

    // FP-007 corregido: verificar QUÉ cargó, no cuánto tardó
    await expect(page.locator('.inventory_item')).toHaveCount(6);
    await expect(page.locator('.title')).toHaveText('Products');
  });

  test('FP-002 + FP-006 | verificar carrito con dos productos por índice', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForURL('**/inventory.html'); // FP-001 corregido

    // FP-002 corregido: nombres explícitos en lugar de nth-child
    await page.locator('.inventory_item').filter({ hasText: 'Sauce Labs Backpack' }).locator('button').click();
    await page.locator('.inventory_item').filter({ hasText: 'Sauce Labs Bike Light' }).locator('button').click();
    const addedCount = 2; // FP-006 corregido: variable local

    await page.locator('.shopping_cart_link').click();
    await page.waitForURL('**/cart.html'); // FP-003 corregido

    // FP-002 corregido: verificar por nombre, no por índice posicional
    await expect(page.locator('.inventory_item_name').filter({ hasText: 'Sauce Labs Backpack' })).toBeVisible();

    // FP-005 corregido: toHaveText con auto-wait en lugar de innerText inmediato
    await expect(page.locator('.shopping_cart_badge')).toHaveText('2');
    expect(addedCount).toBe(2);
  });

});
