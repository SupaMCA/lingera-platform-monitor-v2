import { test, expect } from '@playwright/test';

test.describe('Platform Health Checks', () => {

  test('ChatGPT - basic load check', async ({ page }) => {
    await page.goto('https://chatgpt.com');
    await page.waitForLoadState('domcontentloaded');

    try {
      await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
      console.log('✅ ChatGPT: Seite erfolgreich geladen');
    } catch (error) {
      await page.screenshot({ path: `test-results/chatgpt-failure.png`, fullPage: true });
      throw error;
    }
  });

  test('Claude - basic load check', async ({ page }) => {
    await page.goto('https://claude.ai');
    await page.waitForLoadState('domcontentloaded');

    try {
      await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
      console.log('✅ Claude: Seite erfolgreich geladen');
    } catch (error) {
      await page.screenshot({ path: `test-results/claude-failure.png`, fullPage: true });
      throw error;
    }
  });

});
