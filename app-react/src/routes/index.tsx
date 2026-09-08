import { createFileRoute } from "@tanstack/react-router";
import { App } from "@/components/app";

type Search = {
  selftest?: boolean;
};

export const Route = createFileRoute("/")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const on = raw.selftest === "1" || raw.selftest === 1 || raw.selftest === true;
    return on ? { selftest: true } : {};
  },
  component: Home,
});

function Home() {
  const { selftest } = Route.useSearch();
  return <App autoSelfTest={Boolean(selftest)} />;
}
