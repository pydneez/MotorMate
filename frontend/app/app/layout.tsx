import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // Middleware already guards /app/*; this also covers an expired backend token.
  if (!session || session.expired) redirect("/login");
  return <AppShell user={session.user}>{children}</AppShell>;
}
