

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true,
});

const BASE_URL = 'https://d18xd5tkas019v.cloudfront.net';

test('TC05 - Login with valid credentials', async ({ page }) => {
  const EMAIL = process.env.MOTORMATE_EMAIL;
  const PASSWORD = process.env.MOTORMATE_PASSWORD;

  if (!EMAIL || !PASSWORD) {
    throw new Error('Missing credentials in .env');
  }

  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' })
    .fill(EMAIL);

  await page.getByLabel('Password')
    .fill(PASSWORD);

  await page.getByRole('button', { name: 'Sign in' })
    .click();

  // Give the app time to complete the login flow
  try {
    await expect(page).not.toHaveURL(/\/login\/?$/, {
      timeout: 15000,
    });
  } catch {
    // Record the visible error without exposing credentials
   
const alerts = await page
  .getByRole('alert')
  .allTextContents({ timeout: 3000 });

console.log('Login alerts:', alerts);
console.log('Current URL:', page.url());


    console.log('Login alerts:', alerts);

    throw new Error(
      'Login did not navigate away from /login. Check login alerts and credentials.'
    );
  }

  // Confirm the login form is no longer displayed
  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).not.toBeVisible();
});



 // TC01 - Verify login page
test('TC01 - Login page displays correctly', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);

  await expect(page).toHaveURL(/\/login\/?$/);

  await expect(page.getByText('🔧 MotorMate')).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).toBeVisible();

  await expect(
    page.getByRole('textbox', { name: 'Email' })
  ).toBeVisible();

  await expect(page.getByLabel('Password')).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Sign in' })
  ).toBeVisible();

  await expect(
    page.getByRole('link', { name: /Create an account/i })
  ).toBeVisible();

  await expect(
    page.getByRole('link', { name: /Register your shop/i })
  ).toBeVisible();
});

// TC02 - Empty login
test('TC02 - Cannot sign in with empty fields', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/login\/?$/);

  await expect(
    page.getByRole('heading', { name: 'Sign in' })
  ).toBeVisible();
});

// TC03 - Invalid email
test('TC03 - Invalid email cannot sign in', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('textbox', { name: 'Email' })
    .fill('invalid-email');

  await page.getByLabel('Password')
    .fill('InvalidTestPassword123!');

  await page.getByRole('button', { name: 'Sign in' })
    .click();

  await expect(page).toHaveURL(/\/login\/?$/);
});

// TC04 - Registration navigation
test('TC04 - Navigate to registration page', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);

  await page.getByRole('link', {
    name: /Create an account/i
  }).click();

  await expect(page).toHaveURL(/\/register\/?$/);
});
