import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db";
import { isLinkedinConnected } from "@/lib/linkedin";
import LinkedinStepClient from "./LinkedinStepClient";

export const dynamic = "force-dynamic";

export default function LinkedinSetupPage() {
  // Step 1 (profile/key/resume) must be done before this step exists
  if (!isSetupComplete()) {
    redirect("/setup");
  }
  return <LinkedinStepClient initialConnected={isLinkedinConnected()} />;
}
