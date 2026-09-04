import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MotorMate",
  description: "Car Maintenance & Service Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
