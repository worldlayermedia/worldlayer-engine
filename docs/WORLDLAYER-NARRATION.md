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
