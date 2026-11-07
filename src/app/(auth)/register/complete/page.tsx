import { NOTICE } from "@/lib/legal/notice";
import { PasswordForm } from "../../password-form";

export const metadata = { title: "Finish creating your account", referrer: "no-referrer" };

/** Public on purpose: never redirects on a session, so the link works whoever is signed in. */
export default function CompleteRegistrationPage() {
  return (
    <PasswordForm
      endpoint="/api/auth/register/complete"
      doneUrl="/login?created=1"
      heading="Choose a password"
      button="Create account"
      note="For adults 18 and over."
      retryHref="/register"
      retryText="Request a new sign-up link"
      acceptVersion={NOTICE.version}
    />
  );
}
