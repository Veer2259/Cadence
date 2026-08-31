import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await isAuthenticated()) redirect("/today");

  const sp = await searchParams;
  const fromRaw = sp.from;
  const from =
    typeof fromRaw === "string" && fromRaw.startsWith("/") && !fromRaw.startsWith("//")
      ? fromRaw
      : "/today";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-mono text-lg tracking-tight text-ink">Cadence</h1>
        <p className="judgment mt-1 mb-8 text-ink-muted">
          A day planner that can count.
        </p>
        <LoginForm from={from} />
      </div>
    </main>
  );
}
