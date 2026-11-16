import { test, expect } from '@playwright/test';
import 'dotenv/config';

const BASE_URL =
  process.env.MOTORMATE_BASE_URL ||
  'https://d18xd5tkas019v.cloudfront.net';

test('TC25 - Guest is redirected to login from protected page', async ({ page }) => {
  await page.goto(`${BASE_URL}/app/customers`);

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test('TC26 - Mechanic cannot access Customers page', async ({ page }) => {
  const email = process.env.MOTORMATE_EMAIL;
  const password = process.env.MOTORMATE_PASSWORD;

  if (!email || !password) {
    throw new Error('Mechanic credentials are missing from .env');
  }

  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/app(?:\/|\?|$)/);

  await page.goto(`${BASE_URL}/app/customers`);

  await expect(
    page.getByText("You don't have access to this page")
  ).toBeVisible();
});
