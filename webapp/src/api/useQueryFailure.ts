import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

type QueryFailure = Pick<
  UseQueryResult,
  "isSuccess" | "error" | "failureReason"
>;

// A query's failure, held until it succeeds. A refetch of a query without
// data clears its error while it runs, so without this a message about the
// failure, and the button that retries it, would vanish for every retry.
export function useQueryFailure(query: QueryFailure): unknown {
  const [remembered, setRemembered] = useState<unknown>(null);
  const current = query.error ?? query.failureReason;
  const next = query.isSuccess ? null : (current ?? remembered);
  if (next !== remembered) {
    setRemembered(next);
  }
  return next;
}
