/**
 * Sign-in page — `/login`.
 *
 * Renders the existing provider buttons (`SignInButtons`) and, once a session
 * exists (or auth is disabled and the dev user is active), redirects to `/`.
 * `useCurrentUserState()` waits out the pending state first so a signed-in
 * visitor hard-reloading `/login` never sees a signed-out flash.
 */
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { SignInButtons } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return null;
  if (user) return <Navigate to="/" />;
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-lg font-semibold tracking-tight">
        Sign in to Property Pricer
      </h1>
      <p className="text-sm leading-snug text-ink-2">
        Sign in to connect AI clients (MCP, ChatGPT, Claude) and manage OAuth
        clients for your workspace.
      </p>
      <SignInButtons />
    </main>
  );
}
