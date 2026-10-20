import { formatThaiPhone } from "@motormate/types";

const TIME_ZONE = "Asia/Bangkok";

export { formatThaiPhone };

/** 19 Sep 2026 */
export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(
    new Date(value),
  );
}

/** Sep 2026 */
export function formatMonth(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: TIME_ZONE }).format(new Date(value));
}

/** 42,000 km */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-US")} km`;
}

/** ฿1,926.00 */
export function formatTHB(amount: number): string {
  return `฿${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

/** "…000001" — enough of a VIN to tell vehicles apart in a card. */
export function shortVin(vin: string): string {
  return `…${vin.slice(-6)}`;
}

/** 20 Oct 14:02 (Bangkok time) */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}
