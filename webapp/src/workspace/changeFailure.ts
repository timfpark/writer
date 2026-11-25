import { ServiceError } from "../api/queries";
import type { TreeChange } from "../api/workspaceTree";

const verbs: Record<TreeChange["type"], string> = {
  create: "create",
  rename: "rename",
  setLanguage: "change the language of",
  move: "move",
  delete: "delete",
};

// Why a change failed, chosen by the problem's code and field pointers,
// never by its title or detail text.
function reason(change: TreeChange, error: unknown): string {
  const problem = error instanceof ServiceError ? error.problem : undefined;
  if (!problem) {
    return "Writer can't reach the service. The navigator shows the tree as it was.";
  }
  switch (problem.code) {
    case "notFound":
      return "It no longer exists.";
    case "conflict":
      return change.type === "move"
        ? "Its destination no longer exists or is inside it, so the navigator now shows the latest tree."
        : "The workspace changed elsewhere, so the navigator now shows the latest tree.";
    case "validationFailed": {
      const pointers = problem.errors.map((field) => field.pointer);
      if (pointers.includes("/title")) {
        return "A title needs 1 to 200 characters, without line breaks or tabs.";
      }
      if (pointers.includes("/language")) {
        return "Writer supports English and Spanish.";
      }
      if (pointers.includes("/parentId")) {
        return "Folders nest at most 16 levels deep.";
      }
      if (pointers.includes("")) {
        return "The workspace holds at most 10,000 items.";
      }
      return "The service could not accept it.";
    }
    default:
      return `The service reported a problem (HTTP ${problem.status}).`;
  }
}

export function failureMessage(change: TreeChange, error: unknown): string {
  return `Couldn't ${verbs[change.type]} the ${change.kind}. ${reason(change, error)}`;
}
