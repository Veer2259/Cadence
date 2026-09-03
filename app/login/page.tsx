import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { StarMark } from "@/components/more/streak-banner";
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
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center text-primary">
          <StarMark size={44} />
        </span>
        <h1 className="text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink">
          Cadence
        </h1>
        <p className="mt-2 mb-7 text-[14.5px] font-medium text-ink-muted">
          A day planner that can count.
        </p>
        <LoginForm from={from} />
      </div>
    </main>
  );
}
