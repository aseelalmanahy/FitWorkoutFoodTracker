import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <AuthForm mode="register" />;
}
