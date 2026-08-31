/**
 * db/confirm.ts — the shared "are you sure" guard for destructive scripts.
 * Prints a manifest, then requires the operator to type exactly "yes" at an
 * interactive prompt. Refuses (returns false) when stdin is not a TTY, so piped
 * / CI / agent invocations can never confirm a wipe on their own.
 */

import { createInterface } from "node:readline";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

export async function confirmDestructive(
  manifest: string[],
  question = 'Type exactly "yes" to proceed: ',
): Promise<boolean> {
  console.log("\n" + manifest.join("\n") + "\n");

  if (!process.stdin.isTTY) {
    console.error(
      "Refusing: this needs an interactive terminal so you can confirm. " +
        "Aborting — nothing was changed.",
    );
    return false;
  }

  const answer = await ask(question);
  if (answer.trim() !== "yes") {
    console.log("Not confirmed — nothing was changed.");
    return false;
  }
  return true;
}
