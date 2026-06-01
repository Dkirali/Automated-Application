import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getProfilePath } from "./scraper";

export function isLinkedinConnected(): boolean {
  return existsSync(join(getProfilePath(), "Default", "Cookies"));
}

export function disconnectLinkedin(): void {
  rmSync(getProfilePath(), { recursive: true, force: true });
}
