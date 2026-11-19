
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

  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/app\/?$/, {
    timeout: 15000,
  });
}

// TC20 - Appointment form UI
test('TC20 - Customer can open appointment form', async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto(`${BASE_URL}/app/appointments/new`);

  await expect(
    page.getByRole('heading', {
      name: 'Book an appointment',
      exact: true,
    })
  ).toBeVisible();

  await expect(page.getByText('Vehicle', { exact: true }))
    .toBeVisible();

  await expect(page.getByText('Date', { exact: true }))
    .toBeVisible();

  await expect(page.getByText('Time', { exact: true }))
    .toBeVisible();

  await expect(page.getByText('Services', { exact: true }))
    .toBeVisible();

  await expect(page.getByRole('button', {
    name: 'Request appointment',
  })).toBeVisible();

 await expect(
  page.getByRole('link', {
    name: 'Back',
    exact: true
  })
).toHaveAttribute('href', '/app/appointments');
});



test('TC21 - Appointment rejects empty required fields', async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto(`${BASE_URL}/app/appointments/new`);

  await expect(
    page.getByRole('heading', { name: 'Book an appointment' })
  ).toBeVisible();

  // Attempt to submit with required fields empty
  await page.getByRole('button', {
    name: 'Request appointment'
  }).click();

  // The form should remain open, not navigate to a success page
  await expect(page).toHaveURL(/\/app\/appointments\/new\/?$/);

  // Required fields should still be empty
  await expect(
    page.getByRole('combobox', { name: 'Vehicle' })
  ).toHaveValue('');

  await expect(
    page.getByRole('textbox', { name: 'Date' })
  ).toHaveValue('');
});



test('TC22 - Customer can open Add Vehicle form', async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto(`${BASE_URL}/app/vehicles/new`);

  await expect(page).toHaveURL(/\/app\/vehicles\/new\/?$/);

  await expect(
    page.getByRole('main')
  ).toBeVisible();

  await expect(
    page.getByRole('heading', { name: /add.*vehicle/i })
  ).toBeVisible();
});



test('TC23 - Add Vehicle rejects empty required fields', async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto(`${BASE_URL}/app/vehicles/new`);

  await expect(
    page.getByRole('heading', { name: 'Add my vehicle' })
  ).toBeVisible();

  // Submit the completely empty form
  await page.getByRole('button', {
    name: 'Save vehicle',
    exact: true,
  }).click();

  // The user should remain on the form
  await expect(page).toHaveURL(/\/app\/vehicles\/new\/?$/);

  // Check the required fields remain empty
  await expect(
    page.getByPlaceholder('1กข 1234')
  ).toHaveValue('');

  await expect(
    page.getByPlaceholder('Honda')
  ).toHaveValue('');
});



test('TC24 - Customer can open invoice details', async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto(`${BASE_URL}/app/invoices`);

  await expect(
    page.getByRole('heading', { name: 'My invoices' })
  ).toBeVisible();

  // Select an existing invoice without depending on its ID
  const invoiceLink = page.getByRole('main')
    .getByRole('link', { name: /^INV-/ })
    .first();

  await expect(invoiceLink).toBeVisible();

  await invoiceLink.click();

  // Check navigation to an invoice details page
  await expect(page).toHaveURL(
    /\/app\/invoices\/[^/]+\/?$/
  );

  // Verify the invoice detail page rendered
  await expect(page.getByRole('main')).toBeVisible();
});
