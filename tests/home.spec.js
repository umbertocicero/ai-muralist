const { test, expect } = require('@playwright/test');

test('home page loads and shows boot UI', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/GraffitAI/i);
  await expect(page.locator('#boot')).toBeVisible();
  await expect(page.locator('#title')).toContainText(/GraffitAI/i);
});
