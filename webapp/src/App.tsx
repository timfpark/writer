import { useEffect, useState } from "react";
import { client, type Health, type Problem } from "./api/client";

type HealthCheck =
  | { kind: "checking" }
  | { kind: "healthy"; status: Health["status"] }
  | { kind: "problem"; problem: Problem }
  | { kind: "unreachable"; httpStatus?: number };

async function checkHealth(signal: AbortSignal): Promise<HealthCheck> {
  try {
    const { data, error, response } = await client.GET("/api/v1/health", {
      signal,
    });
    if (data) {
      return { kind: "healthy", status: data.status };
    }
    // A proxy or network failure answers without a problem details body, so
    // only a body the service labels as one is read as a Problem.
    const contentType = response.headers.get("Content-Type") ?? "";
    if (error && contentType.startsWith("application/problem+json")) {
      return { kind: "problem", problem: error };
    }
    return { kind: "unreachable", httpStatus: response.status };
  } catch {
    return { kind: "unreachable" };
  }
}

function describe(check: HealthCheck): string {
  switch (check.kind) {
    case "checking":
      return "Checking the service…";
    case "healthy":
      return `Service status: ${check.status}`;
    case "problem":
      return `Service status: error ${check.problem.status} ${check.problem.title}. ${check.problem.detail}`;
  }
  const http =
    check.httpStatus === undefined ? "" : ` (HTTP ${check.httpStatus})`;
  return `Service status: unreachable${http}. Start the service, then reload this page.`;
}

export function App() {
  const [check, setCheck] = useState<HealthCheck>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setCheck(result);
      }
    });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main>
      <h1>Writer</h1>
      <output>{describe(check)}</output>
    </main>
  );
}
