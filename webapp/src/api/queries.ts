import { QueryClient, queryOptions } from "@tanstack/react-query";
import { client, type Problem } from "./client";

// A failed request. `problem` is set only when the service answered with a
// problem details body; a proxy or network failure leaves it undefined, and
// a request that never got a response also leaves `httpStatus` undefined.
export class ServiceError extends Error {
  readonly problem: Problem | undefined;
  readonly httpStatus: number | undefined;

  constructor(problem?: Problem, httpStatus?: number) {
    super(
      problem
        ? `${problem.code}: ${problem.detail}`
        : `service unreachable${httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`}`,
    );
    this.name = "ServiceError";
    this.problem = problem;
    this.httpStatus = httpStatus;
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ServiceError && error.problem?.code === "notFound";
}

type ApiResult<T> = {
  data?: T;
  error?: Problem;
  response: Response;
};

function failure(error: Problem | undefined, response: Response): ServiceError {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (error && contentType.startsWith("application/problem+json")) {
    return new ServiceError(error, response.status);
  }
  return new ServiceError(undefined, response.status);
}

// Turns an openapi-fetch result into its data or a ServiceError.
export async function read<T>(request: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await request;
  } catch {
    throw new ServiceError();
  }
  const { data, error, response } = result;
  if (data !== undefined) {
    return data;
  }
  throw failure(error, response);
}

// Like read, for a request whose success has no body, such as a delete.
export async function send(
  request: Promise<ApiResult<unknown>>,
): Promise<void> {
  let result: ApiResult<unknown>;
  try {
    result = await request;
  } catch {
    throw new ServiceError();
  }
  if (!result.response.ok) {
    throw failure(result.error, result.response);
  }
}

// Queries retry network failures and 5xx responses up to three times and
// never retry a 4xx response.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) {
    return false;
  }
  if (!(error instanceof ServiceError)) {
    return false;
  }
  return error.httpStatus === undefined || error.httpStatus >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

export const healthQueryOptions = queryOptions({
  queryKey: ["health"],
  queryFn: ({ signal }) => read(client.GET("/api/v1/health", { signal })),
});

// The whole tree, which refetches when the window regains focus so changes
// made in another tab or outside Writer appear.
export const workspaceQueryOptions = queryOptions({
  queryKey: ["workspace"],
  refetchOnWindowFocus: true,
  queryFn: ({ signal }) => read(client.GET("/api/v1/workspace", { signal })),
});

// ADR 0005's identifiers are lowercase UUIDs; any other value names no
// document, so it is never requested.
export function isDocumentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

export function documentQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: ["documents", documentId],
    enabled: isDocumentId(documentId),
    queryFn: ({ signal }) =>
      read(
        client.GET("/api/v1/documents/{documentId}", {
          params: { path: { documentId } },
          signal,
        }),
      ),
  });
}

// A document's content, read from the service every time the document
// opens. After that read the editor owns the text, so the query never
// refetches, and nothing is kept once the document closes.
export function documentContentQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: ["documents", documentId, "content"],
    enabled: isDocumentId(documentId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      read(
        client.GET("/api/v1/documents/{documentId}/content", {
          params: { path: { documentId } },
          signal,
        }),
      ),
  });
}
