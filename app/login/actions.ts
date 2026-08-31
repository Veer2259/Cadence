"use server";

import { redirect } from "next/navigation";
import { checkPassphrase, startSession } from "@/lib/auth";

export type LoginState = { error: string | null };

/** Only allow same-origin, non-protocol-relative redirect targets. */
function safeFrom(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return "/today";
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const passphrase = String(formData.get("passphrase") ?? "");
  const from = safeFrom(formData.get("from"));

  // Small constant-ish delay to blunt brute-force timing.
  await new Promise((r) => setTimeout(r, 250));

  if (!checkPassphrase(passphrase)) {
    return { error: "That passphrase is not right." };
  }

  await startSession();
  redirect(from);
}
