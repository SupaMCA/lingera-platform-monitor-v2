import { test, expect } from '@playwright/test';

test.describe('Platform Health Checks', () => {
  test('ChatGPT - basic load check', async ({ page }) => {
    await page.goto('https://chatgpt.com');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
    console.log('✅ ChatGPT loaded successfully');
  });
});
