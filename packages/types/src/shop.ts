/**
 * The shop's details printed on invoices — the web page and the PDF both use these.
 * Placeholder values for the course demo; one shop only (multi-branch is out of scope), so
 * a constant is enough.
 */
export const SHOP = {
  name: "MotorMate Auto Service",
  address: ["99 Phahonyothin Road", "Khlong Luang, Pathum Thani 12120"],
  phone: "02-000-0000",
  taxId: "0-0000-00000-00-0",
  /** Bookable hours, Bangkok time. Weekdays: 0 = Sunday … 6 = Saturday. */
  hours: { weekdays: [1, 2, 3, 4, 5, 6], open: "08:00", close: "17:00", label: "Mon–Sat, 08:00–17:00" },
} as const;
