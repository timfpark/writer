// Minimal server-sent events (SSE) parser for ADR 0004's framed streams.
// Uses the Fetch ReadableStream returned by openapi-fetch's `parseAs: "stream"`,
// keeping every API request behind src/api/client.ts without adding a package.

export interface SseEvent {
  event: string;
  data: string;
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r\n|\n|\r/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

// Yields each SSE event from a response body stream. Ignores comment keep-alive
// lines as ADR 0004 specifies.
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r\n\r\n|\n\n|\r\r/);
      buffer = parts.pop() ?? "";
      for (const block of parts) {
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
