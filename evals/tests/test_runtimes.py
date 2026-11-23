import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from writer_evals.runtimes import (GenerationFailed, OllamaRuntime, RuntimeUnavailable,
                                   ollama_url_from_env)


class FakeOllama(BaseHTTPRequestHandler):
    chunks = []
    tags = []

    def log_message(self, *args):
        pass

    def _send(self, body, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())

    def do_GET(self):
        if self.path == "/api/tags":
            self._send({"models": self.tags})
        elif self.path == "/api/version":
            self._send({"version": "0.0.1"})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.server.requests.append((self.path, json.loads(self.rfile.read(length) or b"{}")))
        if self.path == "/api/chat":
            self._send(b"".join(json.dumps(c).encode() + b"\n" for c in self.chunks))
        elif self.path == "/api/show":
            self._send({"details": {"family": "gemma", "parameter_size": "31B", "quantization_level": "Q8_0"},
                        "model_info": {"gemma.context_length": 131072}, "license": "Apache  License\n2.0"})
        else:
            self._send({"error": "not found"}, 404)


class OllamaRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), FakeOllama)
        self.server.requests = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.runtime = OllamaRuntime(f"http://127.0.0.1:{self.server.server_port}")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_chat_folds_stream_into_text_and_timings(self):
        FakeOllama.chunks = [
            {"message": {"thinking": "hmm"}, "done": False},
            {"message": {"content": "Hello "}, "done": False},
            {"message": {"content": "writer."}, "done": True, "done_reason": "stop",
             "prompt_eval_count": 200, "prompt_eval_duration": 500_000_000,
             "eval_count": 40, "eval_duration": 2_000_000_000, "load_duration": 0},
        ]
        gen = self.runtime.chat("m", [{"role": "user", "content": "hi"}], {"num_ctx": 8192},
                                think=False, fmt={"type": "object"})
        self.assertEqual(gen.text, "Hello writer.")
        self.assertEqual(gen.thinking, "hmm")
        self.assertEqual(gen.tokens_per_s, 20.0)
        self.assertEqual(gen.prompt_tokens_per_s, 400.0)
        self.assertLessEqual(gen.first_token_s, gen.ttft_s)
        path, body = self.server.requests[-1]
        self.assertEqual((path, body["think"], body["format"], body["options"]["num_ctx"]),
                         ("/api/chat", False, {"type": "object"}, 8192))

    def test_error_chunk_raises_generation_failed(self):
        FakeOllama.chunks = [{"error": "model ran out of memory"}]
        with self.assertRaisesRegex(GenerationFailed, "out of memory"):
            self.runtime.chat("m", [])

    def test_info_names_a_model_that_is_not_pulled(self):
        FakeOllama.tags = [{"name": "other:1b", "digest": "abc"}]
        with self.assertRaisesRegex(RuntimeUnavailable, "ollama pull gemma4:31b"):
            self.runtime.info("gemma4:31b")

    def test_info_reads_quantization_context_and_license(self):
        FakeOllama.tags = [{"name": "gemma4:31b", "digest": "abc123"}]
        info = self.runtime.info("gemma4:31b")
        self.assertEqual((info.digest, info.quantization, info.context_length, info.license_head),
                         ("abc123", "Q8_0", 131072, "Apache License 2.0"))

    def test_unreachable_server_is_unavailable(self):
        runtime = OllamaRuntime("http://127.0.0.1:9", timeout_s=2)
        with self.assertRaisesRegex(RuntimeUnavailable, "not reachable"):
            runtime.version()


class OllamaUrlTest(unittest.TestCase):
    def test_reads_ollama_host_convention(self):
        cases = {
            "": "http://127.0.0.1:11434",
            "0.0.0.0": "http://127.0.0.1:11434",
            "host.docker.internal:11434": "http://host.docker.internal:11434",
            "https://example.test/": "https://example.test:11434",
        }
        for value, expected in cases.items():
            self.assertEqual(ollama_url_from_env({"OLLAMA_HOST": value}), expected, value)


if __name__ == "__main__":
    unittest.main()
