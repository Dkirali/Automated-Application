import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db";
import SetupClient from "./SetupClient";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (isSetupComplete()) {
    redirect("/");
  }
  return <SetupClient />;
}
