import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
