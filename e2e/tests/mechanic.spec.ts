
import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true,
});

const BASE_URL = 'https://d18xd5tkas019v.cloudfront.net';

async function login(page: any) {
  const email = process.env.MOTORMATE_EMAIL;
  const password = process.env.MOTORMATE_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing credentials in .env');
  }

  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' })
    .fill(email);

  await page.getByLabel('Password')
    .fill(password);

  await page.getByRole('button', { name: 'Sign in' })
    .click();

  await expect(page).not.toHaveURL(/\/login\/?$/, {
    timeout: 15000,
  });
}

// TC06 - Mechanic can access authenticated area
test('TC06 - Mechanic login and dashboard access', async ({ page }) => {
  await login(page);

  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).not.toBeVisible();

  await expect(page.locator('body')).toBeVisible();
});

// TC07 - Dashboard remains available after reload
test('TC07 - Dashboard reload retains session', async ({ page }) => {
  await login(page);

  const dashboardUrl = page.url();

  await page.reload();

  await expect(page).toHaveURL(dashboardUrl);
  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).not.toBeVisible();
});

// TC08 - Discover navigation without changing data
test('TC08 - Inspect authenticated navigation', async ({ page }) => {
  await login(page);

  const links = await page.locator('nav a').evaluateAll(
    elements => elements.map(el => ({
      name: (el.textContent || '').trim(),
      href: el.getAttribute('href'),
    }))
  );

  console.log('Navigation links:', JSON.stringify(links));

  await expect(page.locator('body')).toBeVisible();
});



const navigationCases = [
  { id: 'TC09', name: 'Dashboard', path: '/app' },
  { id: 'TC10', name: 'Work Orders', path: '/app/work-orders' },
  { id: 'TC11', name: 'Vehicles', path: '/app/vehicles' },
  { id: 'TC12', name: 'Inventory', path: '/app/inventory' },
];

for (const item of navigationCases) {
  test(`${item.id} - Navigate to ${item.name}`, async ({ page }) => {
    await login(page);

    const navigation = page.getByRole('navigation');

    await navigation.getByRole('link', {
      name: item.name,
      exact: true,
    }).click();

    await expect(page).toHaveURL(
      new RegExp(`${item.path.replace(/\//g, '\\/')}/?$`)
    );

    await expect(page.locator('body')).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Sign in' })
    ).not.toBeVisible();
  });
}
