/**
 * Fixtures extendidos con helpers para estabilidad y trazabilidad de flakiness.
 * Usar en lugar de '@playwright/test' en tests que requieran estas utilidades.
 */

import { test as base, expect, Page } from '@playwright/test';

export type FlakinessHelpers = {
  waitForStableDOM: (selector: string, timeout?: number) => Promise<void>;
  retryAction: <T>(action: () => Promise<T>, maxAttempts?: number) => Promise<T>;
  setupTodoApp: () => Promise<void>;
  addTodo: (text: string) => Promise<void>;
};

export const test = base.extend<{ helpers: FlakinessHelpers }>({
  helpers: async ({ page }, use) => {
    const helpers: FlakinessHelpers = {

      // Espera hasta que el conteo de nodos bajo el selector sea estable
      waitForStableDOM: async (selector: string, timeout = 5000) => {
        const deadline = Date.now() + timeout;
        let prevCount = -1;

        while (Date.now() < deadline) {
          const current = await page.locator(selector).count();
          if (current === prevCount) return;
          prevCount = current;
          await page.waitForTimeout(150);
        }
        throw new Error(`DOM no se estabilizó para selector: ${selector} en ${timeout}ms`);
      },

      // Reintentar una acción N veces antes de fallar (para operaciones externas)
      retryAction: async <T>(action: () => Promise<T>, maxAttempts = 3): Promise<T> => {
        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await action();
          } catch (err) {
            lastError = err as Error;
            if (attempt < maxAttempts) {
              await page.waitForTimeout(200 * attempt); // backoff exponencial
            }
          }
        }
        throw lastError;
      },

      // Setup estándar de TodoMVC con verificación
      setupTodoApp: async () => {
        await page.goto('/todomvc');
        await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
      },

      // Agregar un todo verificando que aparece en la lista
      addTodo: async (text: string) => {
        const input = page.getByPlaceholder('What needs to be done?');
        await input.fill(text);
        await input.press('Enter');
        await expect(page.getByRole('listitem').filter({ hasText: text })).toBeVisible();
      },
    };

    await use(helpers);
  },
});

export { expect };
