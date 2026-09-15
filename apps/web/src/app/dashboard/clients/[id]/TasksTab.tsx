import { ChecklistSection } from "./ChecklistSection";

export function TasksTab({ clientId }: { clientId: string }) {
  return <ChecklistSection clientId={clientId} />;
}
