import { CircleCheck } from "lucide-react";
import { ServiceError } from "../api/queries";
import type { SaveStatus } from "../saving/documentSaver";
import styles from "./SaveIndicator.module.css";

const statusLabels: Record<SaveStatus["state"], string> = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Retrying…",
  conflict: "Conflict",
  failed: "Not saved",
};

// What a screen reader hears, only when saving needs the writer's attention.
function statusMessage(status: SaveStatus): string {
  const problem =
    status.problem instanceof ServiceError ? status.problem.problem : undefined;
  switch (status.state) {
    case "retrying":
      return "Writer can't reach the service and keeps retrying. Your text is kept in this browser.";
    case "conflict":
      if (problem?.code === "validationFailed") {
        return "This document changed elsewhere, and Writer can't keep both versions because the workspace is full. Your text is kept in this browser.";
      }
      return "This document changed elsewhere. Writer is keeping both versions.";
    case "failed":
      if (
        problem?.code === "payloadTooLarge" ||
        problem?.code === "validationFailed"
      ) {
        return "This document is over 1 MiB, the most Writer saves. Your text is kept in this browser until it is shorter.";
      }
      return "The service refused to save this document. Your text is kept in this browser.";
    default:
      return "";
  }
}

// The open document's save status beside its title: a green badge with a
// check once saved, and quiet text while saving or when saving needs the
// writer's attention.
export function SaveIndicator({ status }: { status: SaveStatus }) {
  const message = statusMessage(status);
  return (
    <>
      <span
        className={styles.status}
        data-state={status.state}
        {...(message ? { title: message } : {})}
      >
        {status.state === "saved" ? (
          <CircleCheck aria-hidden size={14} strokeWidth={2.25} />
        ) : null}
        {statusLabels[status.state]}
      </span>
      <output className={styles.visuallyHidden}>{message}</output>
    </>
  );
}
