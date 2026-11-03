import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
