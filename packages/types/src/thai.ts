import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

/**
 * Thailand-only helpers for now. Phones are stored as E.164 and plates carry a province,
 * so supporting other countries later means adding a country field, not migrating data.
 */

/** Returns the E.164 form (+66812345678) of a Thai phone number, or null if invalid. */
export function normalizeThaiPhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "TH");
  if (!parsed || parsed.country !== "TH" || !parsed.isValid()) return null;
  return parsed.number;
}

/** Formats a stored E.164 Thai number for display: 081-234-5678 (mobile) or 02-123-4567. */
export function formatThaiPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164, "TH");
  if (!parsed) return e164;
  const local = `0${parsed.nationalNumber}`;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return local;
}

/** Accepts any common Thai phone format and outputs E.164. */
export const ThaiPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .transform((value, ctx) => {
    const normalized = normalizeThaiPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Thai phone number" });
      return z.NEVER;
    }
    return normalized;
  });

/** Strips spaces and dashes so "กข 1234", "กข-1234" and "กข1234" compare equal. */
export function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]/g, "");
}

/**
 * Deliberately loose: Thai consonants, digits, spaces and dashes, with at least one digit.
 * Covers private (กข 1234, 1กข 1234), commercial (70-1234), motorcycle and red plates.
 */
export const ThaiPlateSchema = z
  .string()
  .trim()
  .min(2, "Plate is required")
  .max(10, "Plate is too long")
  .regex(/^[0-9ก-ฮ\s-]+$/, "Use Thai letters, digits, spaces or dashes only")
  .regex(/\d/, "A plate must contain at least one digit");

export const THAI_PROVINCES = [
  "กรุงเทพมหานคร",
  "กระบี่",
  "กาญจนบุรี",
  "กาฬสินธุ์",
  "กำแพงเพชร",
  "ขอนแก่น",
  "จันทบุรี",
  "ฉะเชิงเทรา",
  "ชลบุรี",
  "ชัยนาท",
  "ชัยภูมิ",
  "ชุมพร",
  "เชียงราย",
  "เชียงใหม่",
  "ตรัง",
  "ตราด",
  "ตาก",
  "นครนายก",
  "นครปฐม",
  "นครพนม",
  "นครราชสีมา",
  "นครศรีธรรมราช",
  "นครสวรรค์",
  "นนทบุรี",
  "นราธิวาส",
  "น่าน",
  "บึงกาฬ",
  "บุรีรัมย์",
  "ปทุมธานี",
  "ประจวบคีรีขันธ์",
  "ปราจีนบุรี",
  "ปัตตานี",
  "พระนครศรีอยุธยา",
  "พะเยา",
  "พังงา",
  "พัทลุง",
  "พิจิตร",
  "พิษณุโลก",
  "เพชรบุรี",
  "เพชรบูรณ์",
  "แพร่",
  "ภูเก็ต",
  "มหาสารคาม",
  "มุกดาหาร",
  "แม่ฮ่องสอน",
  "ยโสธร",
  "ยะลา",
  "ร้อยเอ็ด",
  "ระนอง",
  "ระยอง",
  "ราชบุรี",
  "ลพบุรี",
  "ลำปาง",
  "ลำพูน",
  "เลย",
  "ศรีสะเกษ",
  "สกลนคร",
  "สงขลา",
  "สตูล",
  "สมุทรปราการ",
  "สมุทรสงคราม",
  "สมุทรสาคร",
  "สระแก้ว",
  "สระบุรี",
  "สิงห์บุรี",
  "สุโขทัย",
  "สุพรรณบุรี",
  "สุราษฎร์ธานี",
  "สุรินทร์",
  "หนองคาย",
  "หนองบัวลำภู",
  "อ่างทอง",
  "อำนาจเจริญ",
  "อุดรธานี",
  "อุตรดิตถ์",
  "อุทัยธานี",
  "อุบลราชธานี",
] as const;

export const ThaiProvinceSchema = z.enum(THAI_PROVINCES, {
  errorMap: () => ({ message: "Choose a province" }),
});

export type ThaiProvince = z.infer<typeof ThaiProvinceSchema>;
