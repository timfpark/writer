import createClient from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type Health = components["schemas"]["Health"];
export type Problem = components["schemas"]["Problem"];
export type WorkspaceItem = components["schemas"]["WorkspaceItem"];
export type ItemKind = components["schemas"]["ItemKind"];
export type Folder = components["schemas"]["Folder"];
export type Document = components["schemas"]["Document"];

// The only way components reach the service. Paths are same-origin, so the
// development server's /api/ proxy, or any host that routes /api/ to the
// service, serves them. fetch is looked up on every call, rather than captured
// when the client is created, so tests can replace it.
export const client = createClient<paths>({
  baseUrl: globalThis.location.origin,
  fetch: (request) => globalThis.fetch(request),
});
