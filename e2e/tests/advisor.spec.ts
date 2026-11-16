import { test, expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true,
});

const BASE_URL = 'https://d18xd5tkas019v.cloudfront.net';

async function loginAdvisor(page: Page) {
  const email = process.env.MOTORMATE_ADVISOR_EMAIL;
  const password = process.env.MOTORMATE_ADVISOR_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing Advisor credentials in .env');
  }

  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' })
    .fill(email);

  await page.getByLabel('Password')
    .fill(password);

  await page.getByRole('button', { name: 'Sign in' })
    .click();

  await expect(page).toHaveURL(/\/app(?:\/|\?|$)/, {
    timeout: 15000,
  });

  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).not.toBeVisible();
}

test('TC27 - Advisor can log in', async ({ page }) => {
  await loginAdvisor(page);

  await expect(page.locator('nav')).toBeVisible();
});

const advisorCases = [
  { id: 'TC28', name: 'Dashboard', route: '/app' },
  { id: 'TC29', name: 'Appointments', route: '/app/appointments' },
  { id: 'TC30', name: 'Work Orders', route: '/app/work-orders' },
  { id: 'TC31', name: 'Invoices', route: '/app/invoices' },
];

for (const item of advisorCases) {
  test(`${item.id} - Advisor can access ${item.name}`, async ({ page }) => {
    await loginAdvisor(page);

    const link = page.locator(
      `nav a[href="${item.route}"]`
    );

    await expect(link).toBeVisible();

    await link.click();

    await expect(page).toHaveURL(
      new RegExp(`${item.route.replace(/\//g, '\\/')}/?$`)
    );

    await expect(page.locator('body')).toBeVisible();

    await expect(
      page.getByText("You don't have access to this page")
    ).not.toBeVisible();
  });
}
