import { PasswordForm } from "../password-form";

export const metadata = { title: "Set a new password", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <PasswordForm
      endpoint="/api/auth/password/reset"
      doneUrl="/login?reset=1"
      heading="Set a new password"
      button="Set new password"
      retryHref="/forgot-password"
      retryText="Request a new reset link"
    />
  );
}
