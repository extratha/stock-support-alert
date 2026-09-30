import { hardNavigate } from "./hardNavigate";

/**
 * fetch() for the browser that sends the user to the login page when the session has
 * expired (401), instead of showing a confusing error in the middle of a page.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    hardNavigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("เซสชันหมดอายุ กำลังพาไปหน้า login");
  }
  return response;
}
