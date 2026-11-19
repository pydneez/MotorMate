
import { test, expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true,
});

const BASE_URL = 'https://d18xd5tkas019v.cloudfront.net';

async function loginAsCustomer(page: Page) {
  const email = process.env.MOTORMATE_CUSTOMER_EMAIL;
  const password = process.env.MOTORMATE_CUSTOMER_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing Customer credentials in .env');
  }

  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' })
    .fill(email);

  await page.getByLabel('Password')
    .fill(password);

  await page.getByRole('button', { name: 'Sign in' })
    .click();

  await expect(page).toHaveURL(/\/app\/?$/, {
    timeout: 15000,
  });
}

// TC13 - Customer dashboard
test('TC13 - Customer dashboard displays correctly', async ({ page }) => {
  await loginAsCustomer(page);

  await expect(page.getByText(/Welcome to your garage/i))
    .toBeVisible();

  await expect(page.getByRole('link', { name: 'My Vehicles' }))
    .toBeVisible();

  await expect(page.getByRole('link', { name: 'Appointments' }))
    .toBeVisible();

await expect(
  page.getByRole('link', {
    name: 'Book an appointment',
    exact: true
  })
).toHaveAttribute('href', '/app/appointments');
});

// TC14 - My Vehicles
test('TC14 - Customer can view vehicles', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('link', { name: 'My Vehicles' })
    .click();

  await expect(page).toHaveURL(/\/app\/vehicles\/?$/);

  await expect(page.getByRole('heading', {
    name: /My vehicles/i
  })).toBeVisible();

 await expect(
  page.getByRole('link', {
    name: 'Add my vehicle',
    exact: true
  })
).toHaveAttribute('href', '/app/vehicles/new');
});

// TC15 - Appointments
test('TC15 - Customer can view appointments', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('link', { name: 'Appointments' })
    .click();

  await expect(page).toHaveURL(/\/app\/appointments\/?$/);

  await expect(page.getByRole('heading', {
    name: /My appointments/i
  })).toBeVisible();

await expect(
  page.getByRole('heading', {
    name: 'My appointments',
    exact: true
  })
).toBeVisible();
});

// TC16 - Invoices
test('TC16 - Customer can view invoices', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('link', { name: 'My Invoices' })
    .click();

  await expect(page).toHaveURL(/\/app\/invoices\/?$/);

  await expect(page.getByRole('heading', {
    name: /My invoices/i
  })).toBeVisible();

 await expect(
  page.getByRole('columnheader', {
    name: 'Invoice',
    exact: true
  })
).toBeVisible();

await expect(
  page.getByRole('columnheader', { name: 'Status' })
).toBeVisible();
});

// TC17 - Shops
test('TC17 - Customer can view linked shops', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('link', { name: 'My Shops' })
    .click();

  await expect(page).toHaveURL(/\/app\/shops\/?$/);

  await expect(page.getByRole('heading', {
    name: /My Shops/i
  })).toBeVisible();

  await expect(page.getByText('Linked to your account'))
    .toBeVisible();
});



 // TC18 - Book an appointment navigation
test('TC18 - Customer can open appointment booking', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('link', {
    name: 'Book a visit'
  }).click();

  await expect(page).toHaveURL(/\/app\/appointments\/new\/?$/);
});

// TC19 - View all vehicles navigation
test('TC19 - Customer can open all vehicles from dashboard', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('main')
    .getByRole('link', { name: 'View all' })
    .click();

  await expect(page).toHaveURL(/\/app\/vehicles\/?$/);

  await expect(page.getByRole('heading', {
    name: 'My vehicles',
    exact: true
  })).toBeVisible();
});
