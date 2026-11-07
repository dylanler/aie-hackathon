import { RunView } from "@/components/run/RunView";
import { ToastProvider } from "@/components/ui/Toast";
import type { StepKey } from "@/components/data/types";

export default function RunPage({ params, searchParams }: { params: { id: string }; searchParams: { view?: string } }) {
  const v = searchParams.view as StepKey | undefined;
  return (
    <ToastProvider>
      <RunView id={decodeURIComponent(params.id)} initialView={v && ["diagnose", "design", "verify", "train", "make"].includes(v) ? v : undefined} />
    </ToastProvider>
  );
}
