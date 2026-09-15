/**
 * Sign-in page — `/login`.
 *
 * Renders local email/password auth and, once a session exists (or auth is
 * disabled and the dev user is active), redirects to `/`.
 * `useCurrentUserState()` waits out the pending state first so a signed-in
 * visitor hard-reloading `/login` never sees a signed-out flash.
 */
import { useState, type FormEvent } from "react";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Raphael");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (result.error) throw new Error(result.error.message ?? "Authentication failed");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return null;
  if (user) return <Navigate to="/" />;
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="font-display text-lg font-semibold tracking-tight">
        Sign in to Property Pricer
      </h1>
      <p className="text-center text-sm leading-snug text-ink-2">
        Sign in to connect AI clients (MCP, ChatGPT, Claude) and manage OAuth
        clients for your workspace.
      </p>
      <form className="flex w-full flex-col gap-3" onSubmit={submit}>
        {mode === "sign-up" && (
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              className="rounded-md border border-line bg-panel px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            className="rounded-md border border-line bg-panel px-3 py-2"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            className="rounded-md border border-line bg-panel px-3 py-2"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </label>
        {error && <p className="rounded-md border border-danger/30 bg-danger/10 p-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
        }}
        className="text-sm underline-offset-4 hover:underline"
      >
        {mode === "sign-in" ? "Create a local account" : "I already have an account"}
      </button>
    </main>
  );
}
