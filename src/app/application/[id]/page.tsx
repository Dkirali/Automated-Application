import { redirect } from "next/navigation";
import { getApplication } from "@/lib/db";
import DetailClient from "./DetailClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DetailPage({ params }: PageProps) {
  const { id } = await params;
  const app = getApplication(Number(id));
  if (!app) redirect("/");
  return <DetailClient application={app} />;
}
