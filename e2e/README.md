# MotorMate Automated Testing

## Test Results
24/24 tests passed on Chromium.

## Tools
- Playwright
- TypeScript
- Node.js

## Test Suites
- login.spec.ts: Login and basic validation
- mechanic.spec.ts: Mechanic dashboard and navigation
- customer.spec.ts: Customer dashboard and navigation
- customer-functional.spec.ts: Appointment form, vehicle form, basic validation, invoice navigation

## Setup
1. Install Node.js.
2. Run: npm ci
3. Run: npx playwright install chromium
4. Create a .env file in the project root.
5. Add your authorized test-account credentials:

MOTORMATE_EMAIL=your_mechanic_email
MOTORMATE_PASSWORD=your_mechanic_password
MOTORMATE_CUSTOMER_EMAIL=your_customer_email
MOTORMATE_CUSTOMER_PASSWORD=your_customer_password

## Run Tests
npx playwright test --project=chromium

## HTML Report
Open playwright-report/index.html in a browser.

## Scope
These tests cover selected authentication, navigation,
form display, basic empty-form validation, and invoice
detail navigation scenarios.

They do not establish complete system coverage.
