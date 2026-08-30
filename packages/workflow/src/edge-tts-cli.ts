import { EdgeTTS } from 'node-edge-tts';

const [text, voice, outputFile] = process.argv.slice(2);
if (!text || !voice || !outputFile) {
  console.error('Usage: edge-tts-cli <text> <voice> <output-file>');
  process.exitCode = 2;
} else {
  try {
    const tts = new EdgeTTS({ voice, lang: voice.slice(0, 5), timeout: 120_000 });
    await tts.ttsPromise(text, outputFile);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Edge TTS failed');
    process.exitCode = 1;
  }
}
