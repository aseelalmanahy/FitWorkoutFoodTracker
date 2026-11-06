import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { registrationIsClosed } from "@/lib/server/production-config";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <RegisterForm />
      {registrationIsClosed() && <p className="mt-4 text-center text-sm text-muted">Sign-up is by invitation.</p>}
    </>
  );
}
