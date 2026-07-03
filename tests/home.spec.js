const { test, expect } = require('@playwright/test');

test('home page loads and shows boot UI', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/AI Muralist/i);
  await expect(page.locator('#boot')).toBeVisible();
  await expect(page.locator('#title')).toContainText(/AI Muralist/i);
});
