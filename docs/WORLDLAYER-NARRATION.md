# Worldlayer narration providers

Worldlayer supports prerecorded `/audio/*.wav` or `/audio/*.mp3` files, deterministic mock narration for development and CI, and OpenAI speech generation for production. The visual renderer and final media assembly consume the prepared audio file. Final MP4 audio remains AAC.

## Production setup

Set `OPENAI_API_KEY` in the process environment or in the project's ignored `.env` file before running `npm run worldlayer:render -- public/jobs/<job>.json`. The existing `.env.example` lists this variable. The provider uses the process environment first, then the project's `.env` file through the repository's Vite-compatible environment reader. In PowerShell, you can set it for the current terminal session without placing it in a job file:

```powershell
$env:OPENAI_API_KEY = '<your key>'
npm run worldlayer:render -- public/jobs/<job>.json
```

Do not commit or paste the key. The provider does not print it or include it in artifact metadata.

Example job narration:

```json
"narration": {
  "scriptFile": "/scripts/example.txt",
  "provider": "openai",
  "voice": "marin"
}
```

The OpenAI provider uses `gpt-4o-mini-tts` and WAV output. Supported built-in voices are `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`. The mock provider uses `provider: "mock"` and `voice: "default"` and produces diagnostic tones, not speech. Production jobs never fall back to mock on an error. Disclose AI-generated speech to viewers as required by the [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

Long input is split at paragraph and sentence boundaries, then at word boundaries when needed. Each request stays below the Speech API input limit; WAV chunks are validated and concatenated in order. A rate limit, transient server error, or network failure gets at most two retries. Authentication errors, rejected voices, empty responses, and malformed WAV fail directly. Generated files go to `renders/audio/<output-filename>-narration.wav`. The provider prints character and chunk counts before requesting audio; it does not invent a cost estimate.

If generation fails, check the environment variable, selected voice, API access, and network connectivity. `ffprobe` and `ffmpeg` must also be available for duration probing and MP4 assembly. Automated tests use mocked responses and never call the paid API.

## Azure Speech

Azure is a separate production narration provider. Create an Azure AI Speech resource, then set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the ignored local `.env` file or process environment. The region is the resource region name, such as `canadacentral`; Worldlayer constructs the regional Speech REST endpoint from it. Never place credentials in a job file. `WORLDLAYER_TTS_PROVIDER=azure` optionally supplies a default provider for jobs that omit `narration.provider`; `WORLDLAYER_TTS_VOICE` optionally supplies a default voice. Explicit job values take precedence.

```json
"narration": {
  "scriptFile": "/scripts/example.txt",
  "provider": "azure"
}
```

The current Worldlayer default is `en-GB-RyanNeural` (English, United Kingdom), selected through the Phase 11.3 blind voice comparison. It applies only when neither `narration.voice` nor `WORLDLAYER_TTS_VOICE` is set. A voice specified in the job takes precedence over the environment setting; the environment setting takes precedence over this default. Azure sends escaped SSML to the regional Azure Speech REST endpoint and requests 24 kHz, 16-bit mono PCM WAV. Long scripts are split on paragraph, sentence, and word boundaries; chunks are requested in order, validated for compatible audio format, and joined into one WAV. The existing FFmpeg assembly encodes final MP4 narration as AAC. Azure returns the selected voice, duration, chunk count, character count, sample rate, and channel count as local metadata.

The mock provider produces diagnostic tones without network access. OpenAI and Azure produce speech using their own credentials; neither falls back to mock after failure. Azure retries transient network, server, and rate-limit responses at most twice. Authentication, invalid voice/request, and clear quota errors fail without retry. For errors, check the key, matching region, configured voice, quota, and network access. Offline tests mock the Azure REST response. The short fixture is `public/jobs/video-job-azure-dev.json`.
