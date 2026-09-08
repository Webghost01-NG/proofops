import { test, expect } from '@playwright/test';

test('local workspace: navigate, save a blocked case, rerun, and export real stored evidence', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Follow the proof.' })).toBeVisible();
  await expect(page.getByText('Connect your source network when you’re ready')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Network setup', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Know your environment.' })).toBeVisible();
  await expect(page.getByText('One endpoint to get started.')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  // Synthetic input intentionally exercises missing configuration, without claiming a chain transaction exists.
  const sourceHash = `0x${testInfo.project.name === 'desktop' ? 'ab'.repeat(32) : 'cd'.repeat(32)}`;
  await page.getByLabel('Source transaction hash', { exact: true }).fill(sourceHash);
  await page.getByRole('button', { name: 'Inspect transaction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transaction inspector.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source RPC is not configured' })).toBeVisible();
  await expect(page.getByText('Needs setup', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rerun checks', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Latest (2)' })).toBeAttached();
  await page.getByLabel('Attempt', { exact: true }).selectOption('0');
  await expect(page.getByRole('heading', { name: 'Source RPC is not configured' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('case.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export evidence' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^proofops-.*\.json$/);
  await page.getByRole('button', { name: 'All cases', exact: false }).click();
  await page.getByLabel('Search cases').fill(sourceHash);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /^Cases/ }).click();
  await page.getByLabel('Search cases').fill(sourceHash);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  expect(errors).toEqual([]);
});
