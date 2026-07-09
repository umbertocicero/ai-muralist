const { test, expect } = require('@playwright/test');

test('wall slots: alley walls kept, every approach reachable', async ({ page }) => {
  await page.goto('/index.html?debugcam');
  await page.waitForFunction(() => window.__app && window.__app.city && window.__app.city.wallSlots, null, { timeout: 20000 });

  const stats = await page.evaluate(() => {
    const c = window.__app.city;
    const s = c.wallSlots;
    let colliding = 0, close = 0, far = 0, leftover = 0;
    for (const w of s) {
      if (c.isColliding(w.ax, w.az)) colliding++;              // every stand point must be free
      if (w._half !== undefined || w._k !== undefined) leftover++;  // scratch cleaned up
      const d = Math.hypot(w.ax - w.px, w.az - w.pz);
      if (d < 1.4) close++; else far++;
    }
    return { total: s.length, colliding, close, far, leftover };
  });

  console.log('WALLSLOT STATS', JSON.stringify(stats));
  expect(stats.colliding).toBe(0);      // no wall points into a building
  expect(stats.leftover).toBe(0);       // scratch fields removed
  expect(stats.close).toBeGreaterThan(0); // alley walls (stepped-in approach) now kept
});
