/**
 * TESTS INTENCIONALMENTE INESTABLES — E-commerce con autenticación
 *
 * Sitio: https://www.saucedemo.com (Sauce Labs demo store)
 * Patrones presentes:
 *   FP-001  Hard-coded waitForTimeout tras login y navegación
 *   FP-002  Locators por posición (nth-child, índices)
 *   FP-003  No esperar redirect/URL change tras login
 *   FP-004  Estado del carrito compartido entre tests
 *   FP-005  innerText sin esperar visibilidad del elemento
 *   FP-006  Contador global de productos — no thread-safe con workers paralelos
 *   FP-007  Validación de tiempo de carga con umbral fijo
 *
 * Ver tests/specs/stable/03-ecommerce-stable.spec.ts para las versiones corregidas.
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://www.saucedemo.com';

// FP-004 + FP-006: Estado mutable compartido entre todos los tests del módulo
const cart = { items: [] as string[] };
let addedCount = 0;

test.describe('Sauce Demo — Tests Inestables (Anti-patrones)', () => {

  test('FP-001 + FP-003 | login sin esperar redirect a inventory', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500); // FP-001: espera fija en lugar de esperar el campo

    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();

    // FP-003: clic en login y verificación inmediata sin waitForURL
    await page.waitForTimeout(500); // FP-001: puede ser insuficiente en red lenta

    // FP-005: innerText puede devolver "" si el elemento no cargó aún
    const title = await page.locator('.title').innerText();
    expect(title).toBe('Products');
  });

  test('FP-002 | agregar producto al carrito por posición en el DOM', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForTimeout(800); // FP-001

    // FP-002: nth-child rompe si Sauce Labs reordena los productos
    const primerProducto = page.locator('.inventory_item:nth-child(1)');
    // FP-005: innerText sin esperar visibilidad
    const nombre = await primerProducto.locator('.inventory_item_name').innerText();

    await primerProducto.locator('button').click();
    addedCount++; // FP-006: no es thread-safe con workers paralelos

    cart.items.push(nombre); // FP-004: estado global que persiste entre tests

    // FP-005: leer badge sin esperar que se actualice
    const badge = await page.locator('.shopping_cart_badge').innerText();
    expect(parseInt(badge)).toBe(1);
  });

  test('FP-004 | carrito asume estado dejado por el test anterior', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForTimeout(600); // FP-001

    // FP-004: este test asume que cart.items fue llenado por el test anterior.
    // Si los tests corren en distinto orden o en paralelo, cart.items puede ser [].
    expect(cart.items.length).toBeGreaterThan(0);
  });

  test('FP-005 | leer precio antes de que el inventario cargue', async ({ page }) => {
    // FP-003: navegar directo a inventory sin pasar por login → puede redirigir a /
    await page.goto(`${BASE}/inventory.html`);
    await page.waitForTimeout(300); // FP-001: tiempo insuficiente si hay redirect

    // FP-005: innerText en el primer precio sin verificar que sea visible
    const precio = await page.locator('.inventory_item_price').first().innerText();
    expect(precio).toMatch(/^\$\d+\.\d{2}$/);
  });

  test('FP-007 | validar tiempo de carga del inventario con umbral fijo', async ({ page }) => {
    const start = Date.now();

    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForTimeout(200); // FP-001

    const elapsed = Date.now() - start;
    // FP-007: 1500ms es demasiado ajustado en CI o redes con latencia
    expect(elapsed).toBeLessThan(1500);
  });

  test('FP-002 + FP-006 | verificar carrito con dos productos por índice', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#user-name').fill('standard_user');
    await page.locator('#password').fill('secret_sauce');
    await page.locator('#login-button').click();
    await page.waitForTimeout(700); // FP-001

    // FP-002: nth-child — falla si el catálogo cambia de orden
    await page.locator('.inventory_item:nth-child(1) button').click();
    addedCount++; // FP-006
    await page.locator('.inventory_item:nth-child(2) button').click();
    addedCount++; // FP-006

    await page.locator('.shopping_cart_link').click();
    await page.waitForTimeout(400); // FP-001

    // FP-002: verifica primer ítem del carrito por índice posicional
    const primerNombre = await page.locator('.cart_item:nth-child(1) .inventory_item_name').innerText(); // FP-005
    expect(primerNombre.length).toBeGreaterThan(0);

    // FP-006: addedCount no es determinista con múltiples workers
    expect(addedCount).toBeGreaterThanOrEqual(2);
  });
});
