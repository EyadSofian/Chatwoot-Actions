// Speech-to-text for WhatsApp voice notes via Deepgram.
//
// A customer voice note arrives in Chatwoot as a message with empty `content`
// and an audio attachment. On its own the Botpress bridge skips it ("missing"),
// so the bot never engages and the chat stalls. This module downloads the audio
// and transcribes it with Deepgram so the bridge can forward the text to Fahd
// like any normal message. It is opt-in: inert unless VOICE_TRANSCRIBE_ENABLED
// is on and DEEPGRAM_API_KEY is set, so existing behavior is unchanged by default.

const DEFAULT_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

export function buildTranscriptionConfig(options = {}) {
  return {
    enabled: parseBool(options.enabled ?? process.env.VOICE_TRANSCRIBE_ENABLED, false),
    apiKey: String(options.apiKey ?? process.env.DEEPGRAM_API_KEY ?? "").trim(),
    model: String(options.model ?? process.env.DEEPGRAM_MODEL ?? "nova-3"),
    language: String(options.language ?? process.env.DEEPGRAM_LANGUAGE ?? "ar"),
    baseUrl: String(options.baseUrl ?? process.env.DEEPGRAM_URL ?? DEFAULT_DEEPGRAM_URL),
    fetchImpl: options.fetchImpl || globalThis.fetch
  };
}

// True only when transcription is both switched on and has an API key. The
// bridge uses this so a voice note is left to the existing "missing" skip while
// the feature is off — keeping it fully inert by default.
export function voiceTranscriptionEnabled(options = {}) {
  const config = buildTranscriptionConfig(options);
  return config.enabled && Boolean(config.apiKey);
}

// Returns { ok, transcript, reason }. Never throws: a transcription failure must
// not break the webhook, the caller falls back to a placeholder.
export async function transcribeAudioUrl(audioUrl, options = {}) {
  const config = buildTranscriptionConfig(options);
  if (!config.enabled) return { ok: false, transcript: "", reason: "disabled" };
  if (!config.apiKey) return { ok: false, transcript: "", reason: "no_api_key" };
  if (!audioUrl) return { ok: false, transcript: "", reason: "no_url" };
  if (typeof config.fetchImpl !== "function") return { ok: false, transcript: "", reason: "no_fetch" };

  try {
    // Download the audio ourselves rather than handing Deepgram the Chatwoot URL,
    // so it works even when the attachment URL is not publicly reachable.
    const audioRes = await config.fetchImpl(audioUrl);
    if (!audioRes.ok) return { ok: false, transcript: "", reason: `audio_fetch_${audioRes.status}` };
    const contentType = audioRes.headers?.get?.("content-type") || "audio/ogg";
    const bytes = Buffer.from(await audioRes.arrayBuffer());
    if (!bytes.length) return { ok: false, transcript: "", reason: "empty_audio" };

    const params = new URLSearchParams({
      model: config.model,
      smart_format: "true"
    });
    if (config.language) params.set("language", config.language);

    const res = await config.fetchImpl(`${config.baseUrl}?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Token ${config.apiKey}`, "Content-Type": contentType },
      body: bytes
    });
    if (!res.ok) return { ok: false, transcript: "", reason: `deepgram_${res.status}` };

    const data = await res.json();
    const transcript = String(
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""
    ).trim();
    return { ok: Boolean(transcript), transcript, reason: transcript ? "ok" : "empty" };
  } catch (error) {
    return { ok: false, transcript: "", reason: "error", error: error.message };
  }
}

// Pull the first audio attachment URL from a Chatwoot message webhook body.
export function firstAudioAttachmentUrl(body = {}) {
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  // Only audio/voice attachments are transcribed. Images, files, etc. are left
  // alone (they fall back to the bridge's existing "missing" skip).
  const audio = attachments.find(item => /audio|voice/i.test(String(item?.file_type || item?.fileType || "")));
  return String(audio?.data_url || audio?.dataUrl || audio?.url || "").trim();
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}
