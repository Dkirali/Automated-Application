import { getConfig } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const resumePath = getConfig("master_resume_path");
  return (
    <SettingsClient
      name={getConfig("name") || ""}
      email={getConfig("email") || ""}
      phone={getConfig("phone") || ""}
      currentResume={resumePath ? resumePath.split("/").pop() || null : null}
    />
  );
}
