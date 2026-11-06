import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { noticeGateOpen, registrationIsClosed } from "@/lib/server/production-config";
import { LegalLinks } from "@/components/legal-links";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <RegisterForm />
      {!noticeGateOpen() ? (
        <p className="mt-4 text-center text-sm text-muted">Sign-up isn&apos;t open yet.</p>
      ) : (
        <>
          {registrationIsClosed() && <p className="mt-4 text-center text-sm text-muted">Sign-up is by invitation.</p>}
          <p className="mx-auto mt-4 max-w-sm px-5 text-center text-sm text-muted">Your address is used to send the sign-up link, and is stored with it. See the privacy notice for how long.</p>
        </>
      )}
      <LegalLinks className="mt-3 pb-8" />
    </>
  );
}
