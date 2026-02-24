import { expect, test } from '@playwright/test';

test('renders liveability dashboard from static JSON', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'How painful is London right now?' })).toBeVisible();
  await expect(page.getByTestId('liveability-score')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data Provenance' })).toBeVisible();
  await expect(page.getByTestId('freshness-badge')).toBeVisible();
  await expect(page.getByRole('heading', { name: '24h Liveability Trend' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What changed?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transit disruption' })).toBeVisible();

  await page.getByTestId('lineage-trigger-transit').hover();
  const transitLineage = page.getByLabel('Transit disruption data lineage');
  await expect(transitLineage.getByText('API query')).toBeVisible();
  await expect(transitLineage.getByText('Calculation')).toBeVisible();
  const tflLineStatusQuery = transitLineage.getByText(/GET https:\/\/api\.tfl\.gov\.uk\/line\/mode\/.*\/status/).first();
  await expect(tflLineStatusQuery).toBeVisible();
});
