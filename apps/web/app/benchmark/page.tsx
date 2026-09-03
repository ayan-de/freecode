import type { Metadata } from "next";
import { AgentBenchmark } from "../components/AgentBenchmark";
import { PageWrapper } from "../components/PageWrapper";

export const metadata: Metadata = {
  title: "Agent benchmark — FreeCode",
  description:
    "freecode against other coding agents on SWE-bench Lite: same tasks, same model, same key.",
};

export default function BenchmarkPage() {
  return (
    <PageWrapper>
      <AgentBenchmark />
    </PageWrapper>
  );
}
