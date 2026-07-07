import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db";
import ResumeClient from "./ResumeClient";

export const dynamic = "force-dynamic";

export default function ResumePage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }
  return <ResumeClient />;
}
