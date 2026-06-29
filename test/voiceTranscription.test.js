import test from "node:test";
import assert from "node:assert/strict";
import { transcribeAudioUrl, firstAudioAttachmentUrl } from "../src/voiceTranscription.js";

function audioResponse(bytes = Buffer.from([1, 2, 3, 4]), contentType = "audio/ogg") {
  return {
    ok: true,
    headers: { get: name => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function deepgramResponse(transcript) {
  return {
    ok: true,
    json: async () => ({ results: { channels: [{ alternatives: [{ transcript }] }] } })
  };
}

function mockFetch(steps) {
  let call = 0;
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const step = steps[call++];
    if (typeof step === "function") return step(String(url), opts);
    return step;
  };
  impl.calls = calls;
  return impl;
}

test("transcribeAudioUrl returns the Deepgram transcript on success", async () => {
  const fetchImpl = mockFetch([audioResponse(), deepgramResponse("عايز اعرف موعد الدورة")]);
  const result = await transcribeAudioUrl("https://chat.example.com/audio.oga", {
    enabled: true,
    apiKey: "dg-key",
    baseUrl: "https://api.deepgram.test/v1/listen",
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.transcript, "عايز اعرف موعد الدورة");
  // First call downloads the audio, second hits Deepgram with the key + language.
  assert.equal(fetchImpl.calls[0].url, "https://chat.example.com/audio.oga");
  assert.match(fetchImpl.calls[1].url, /api\.deepgram\.test/);
  assert.match(fetchImpl.calls[1].url, /language=ar/);
  assert.equal(fetchImpl.calls[1].opts.headers.Authorization, "Token dg-key");
});

test("transcribeAudioUrl is inert when disabled or missing a key", async () => {
  const disabled = await transcribeAudioUrl("https://x/a.oga", { enabled: false, apiKey: "k", fetchImpl: mockFetch([]) });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "disabled");

  const noKey = await transcribeAudioUrl("https://x/a.oga", { enabled: true, apiKey: "", fetchImpl: mockFetch([]) });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.reason, "no_api_key");
});

test("transcribeAudioUrl reports an empty transcript instead of throwing", async () => {
  const fetchImpl = mockFetch([audioResponse(), deepgramResponse("")]);
  const result = await transcribeAudioUrl("https://x/a.oga", {
    enabled: true, apiKey: "k", baseUrl: "https://api.deepgram.test/v1/listen", fetchImpl
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty");
  assert.equal(result.transcript, "");
});

test("transcribeAudioUrl surfaces a Deepgram error status without throwing", async () => {
  const fetchImpl = mockFetch([audioResponse(), { ok: false, status: 500, json: async () => ({}) }]);
  const result = await transcribeAudioUrl("https://x/a.oga", {
    enabled: true, apiKey: "k", baseUrl: "https://api.deepgram.test/v1/listen", fetchImpl
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "deepgram_500");
});

test("firstAudioAttachmentUrl picks the audio attachment only", async () => {
  assert.equal(
    firstAudioAttachmentUrl({ attachments: [{ file_type: "audio", data_url: "https://x/voice.oga" }] }),
    "https://x/voice.oga"
  );
  assert.equal(firstAudioAttachmentUrl({ attachments: [{ file_type: "image", data_url: "https://x/pic.jpg" }] }), "");
  assert.equal(firstAudioAttachmentUrl({ attachments: [] }), "");
  assert.equal(firstAudioAttachmentUrl({}), "");
});
