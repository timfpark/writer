import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

type QueryFailure = Pick<
  UseQueryResult,
  "isSuccess" | "error" | "failureReason" | "data"
>;

// A query's failure to load, held until it succeeds. A refetch of a query
// without data clears its error while it runs, so without this a message
// about the failure, and the button that retries it, would vanish for every
// retry. A failed refetch of data already shown, such as one when the window
// regains focus while the service is down, is not a failure to load: the
// data stays, and so does an open document's editor.
export function useQueryFailure(query: QueryFailure): unknown {
  const [remembered, setRemembered] = useState<unknown>(null);
  const current = query.error ?? query.failureReason;
  const loaded = query.isSuccess || query.data !== undefined;
  const next = loaded ? null : (current ?? remembered);
  if (next !== remembered) {
    setRemembered(next);
  }
  return next;
}
