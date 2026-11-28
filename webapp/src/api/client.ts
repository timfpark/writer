import createClient from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type Health = components["schemas"]["Health"];
export type Problem = components["schemas"]["Problem"];
export type WorkspaceItem = components["schemas"]["WorkspaceItem"];
export type ItemKind = components["schemas"]["ItemKind"];
export type Folder = components["schemas"]["Folder"];
export type Document = components["schemas"]["Document"];
export type DocumentContent = components["schemas"]["DocumentContent"];
export type PairWriterStatus = components["schemas"]["PairWriterStatus"];
export type PairWriterIssue = components["schemas"]["PairWriterIssue"];
export type CreatePairWriterReplyRequest =
  components["schemas"]["CreatePairWriterReplyRequest"];
export type ChatDocumentInput = components["schemas"]["ChatDocumentInput"];
export type ChatSelectionInput = components["schemas"]["ChatSelectionInput"];
export type ChatFindingInput = components["schemas"]["ChatFindingInput"];
export type ChatContextDocument = components["schemas"]["ChatContextDocument"];
export type ChatHistoryMessage = components["schemas"]["ChatHistoryMessage"];
export type ChatHistoryRole = components["schemas"]["ChatHistoryRole"];
export type ChatReplyDelta = components["schemas"]["ChatReplyDelta"];
export type ChatReplyDone = components["schemas"]["ChatReplyDone"];
export type ChatReplyMetrics = components["schemas"]["ChatReplyMetrics"];
export type ChatReadSource = components["schemas"]["ChatReadSource"];
export type ChatSourceKind = components["schemas"]["ChatSourceKind"];
export type ReadingScope = components["schemas"]["ReadingScope"];
export type CreatePairWriterReviewRequest =
  components["schemas"]["CreatePairWriterReviewRequest"];
export type ReviewPassageInput = components["schemas"]["ReviewPassageInput"];
export type PairWriterReviewResponse =
  components["schemas"]["PairWriterReviewResponse"];
export type ReviewFinding = components["schemas"]["ReviewFinding"];
export type ReviewAgentKind = components["schemas"]["ReviewAgentKind"];
export type FindingCategory = components["schemas"]["FindingCategory"];
export type FindingAnchor = components["schemas"]["FindingAnchor"];
export type FindingAudit = components["schemas"]["FindingAudit"];

// The only way components reach the service. Paths are same-origin, so the
// development server's /api/ proxy, or any host that routes /api/ to the
// service, serves them. fetch is looked up on every call, rather than captured
// when the client is created, so tests can replace it.
export const client = createClient<paths>({
  baseUrl: globalThis.location.origin,
  fetch: (request) => globalThis.fetch(request),
});
