/**
 * Gemini verbatim filler recovery.
 *
 * use when: a clip is being transcribed and we want the "um/uh"s that STT (`latest_long`) drops.
 *
 * STT normalizes away disfluencies (the Stage-1 risk, docs/Problems.md), so a phrase-boost lexicon
 * misses most fillers. This runs a parallel Gemini audio pass over the SAME bytes, instructed to
 * transcribe verbatim and return ONLY the fillers with clip-relative timing. The caller merges them
 * into the transcript as `isDisfluency` words (see `transcribeWithFillers`), so they ride the
 * existing `audio.filler` channel with no schema change. Degrades to `[]` when Gemini is
 * unavailable/disabled (`GEMINI_MOCK=1`) — the request still returns the STT-only transcript.
 *
 * NOTE: Gemini only accepts wav/mp3/ogg/flac/aac/aiff audio — NOT webm. The web client converts
 * clips to 16 kHz WAV before upload so both STT and this pass get an accepted container.
 */

import type { TranscriptWord } from '@quack/shared';
import { GoogleGenAI, Type } from '@google/genai';
import { getGeminiClient, loadGoogleConfig } from '../google/clients.js';
import {
  GEMINI_MODEL_DEFAULT,
  GEMINI_FILLER_INSTRUCTION,
  GEMINI_FILLER_TEMPERATURE,
} from '../config.js';

/** Response schema: only fillers + clip-relative ms timing. Mirrors the tone schema. */
const FILLER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fillers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          tStartMs: { type: Type.NUMBER },
          tEndMs: { type: Type.NUMBER },
        },
        required: ['word', 'tStartMs', 'tEndMs'],
      },
    },
  },
  required: ['fillers'],
};

interface GeminiFiller {
  word: string;
  tStartMs: number;
  tEndMs: number;
}

/**
 * Transcribe `audio` with Gemini to recover dropped fillers. Returns `isDisfluency` TranscriptWords
 * (clip-clock ms, matching STT word offsets), or `[]` when Gemini is unavailable. Entries with
 * invalid/out-of-order timestamps are dropped so a hallucinated span can't poison the timeline.
 */
export async function detectFillersFromAudio(
  audio: Uint8Array,
  mimeType: string,
): Promise<TranscriptWord[]> {
  const client = getGeminiClient();
  if (!client) return [];

  const model = loadGoogleConfig().geminiModel ?? GEMINI_MODEL_DEFAULT;
  const fillers = await requestFillers(client, model, audio, mimeType);

  return fillers
    .filter((f) => f.word && Number.isFinite(f.tStartMs) && Number.isFinite(f.tEndMs))
    .filter((f) => f.tStartMs >= 0 && f.tEndMs > f.tStartMs)
    .map((f) => ({
      text: f.word.trim(),
      tStartMs: Math.round(f.tStartMs),
      tEndMs: Math.round(f.tEndMs),
      isDisfluency: true,
    }));
}

async function requestFillers(
  client: GoogleGenAI,
  model: string,
  audio: Uint8Array,
  mimeType: string,
): Promise<GeminiFiller[]> {
  const res = await client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Recover the filler words spoken in this clip.' },
          { inlineData: { data: Buffer.from(audio).toString('base64'), mimeType } },
        ],
      },
    ],
    config: {
      systemInstruction: GEMINI_FILLER_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: FILLER_SCHEMA,
      temperature: GEMINI_FILLER_TEMPERATURE,
    },
  });
  const text = res.text;
  if (!text) throw new Error('empty Gemini filler response');
  const parsed = JSON.parse(text) as { fillers?: GeminiFiller[] };
  return parsed.fillers ?? [];
}
