import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const params = await searchParams;
  // Fixed text only: no parameter is ever echoed.
  const notice =
    params.created === "1" ? "Your account is ready. Log in to continue."
    : params.reset === "1" ? "Your password was changed. Log in with the new one."
    : undefined;
  return <AuthForm notice={notice} />;
}
