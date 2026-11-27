import { describe, expect, it } from "vitest";
import { readSseStream } from "./sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("readSseStream", () => {
  it("parses split chunks, ignores comment keep-alives, and preserves event order", async () => {
    const stream = streamFromChunks([
      ": keep-alive\n\n",
      "event: delta\nda",
      'ta: {"text":"Hello "}\n\nevent: delta\r\ndata: {"text":"world"}\r\n\r\n',
      'event: done\ndata: {"model":"scripted"}\n\n',
    ]);

    const events = [];
    for await (const event of readSseStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "delta", data: '{"text":"Hello "}' },
      { event: "delta", data: '{"text":"world"}' },
      { event: "done", data: '{"model":"scripted"}' },
    ]);
  });

  it("stops reading when aborted", async () => {
    const controller = new AbortController();
    const stream = streamFromChunks([
      'event: delta\ndata: {"text":"first"}\n\n',
      'event: delta\ndata: {"text":"second"}\n\n',
    ]);

    const seen = [];
    for await (const event of readSseStream(stream, controller.signal)) {
      seen.push(event);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });
});
