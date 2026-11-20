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

// Turns an openapi-fetch result into its data or a ServiceError.
async function read<T>(request: Promise<ApiResult<T>>): Promise<T> {
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
  const contentType = response.headers.get("Content-Type") ?? "";
  if (error && contentType.startsWith("application/problem+json")) {
    throw new ServiceError(error, response.status);
  }
  throw new ServiceError(undefined, response.status);
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
