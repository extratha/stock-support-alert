import { cookies } from "next/headers";
import { loadAuthSetup } from "./auth";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/**
 * Is the person looking at this page the logged-in owner? Everyone else is a visitor of the public portfolio: they see
 * every page but no controls, and data about other people (LINE friends) is masked before it leaves the server.
 * Local development without ADMIN_PASSWORD counts as the owner (no login there).
 */
export async function isOwner(): Promise<boolean> {
  const setup = loadAuthSetup();
  if (!setup.ok) return setup.reason === "disabled";
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token !== undefined && verifySessionToken(token, setup.config);
}
