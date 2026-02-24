import { expect, test } from '@playwright/test';

test('renders liveability dashboard from static JSON', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'How painful is London right now?' })).toBeVisible();
  await expect(page.getByTestId('liveability-score')).toBeVisible();
  await expect(page.getByRole('heading', { name: '24h Liveability Trend' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What changed?' })).toBeVisible();
  await expect(page.getByText('Transit disruption')).toBeVisible();
});
