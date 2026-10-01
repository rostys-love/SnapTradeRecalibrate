import { redirect } from "next/navigation";
import { passwordGateEnabled } from "@/lib/session";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // No built-in password configured: access is handled by Vercel Authentication
  if (!passwordGateEnabled()) redirect("/");
  return <LoginForm />;
}
