/**
 * The shop's details printed on invoices (the web page and the PDF) and in email signatures.
 * Placeholder values for the course demo; one shop only (multi-branch is out of scope), so
 * a constant is enough.
 */
export const SHOP = {
  name: "MotorMate Auto Service",
  address: ["99 Soi Car Won't Start, Road to Nowhere", "Khlong Luang, Pathum Thani 12120"],
  phone: "02-676-7676",
  taxId: "0-0000-00000-00-0",
  /**
   * Opening hours, Bangkok time (weekdays: 0 = Sunday … 6 = Saturday). Bookable slots run until
   * half an hour before closing; the end-of-day job (18:30) runs after it.
   */
  hours: { weekdays: [1, 2, 3, 4, 5, 6], open: "08:00", close: "18:00", label: "Mon–Sat: 8:00 AM – 6:00 PM" },
} as const;
