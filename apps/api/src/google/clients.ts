/**
 * Google client stubs (Stage 2+).
 *
 * use when: wiring Gemini, Speech-to-Text, and Firestore. Keep ALL Google credentials here —
 * never expose keys to the web client. On Cloud Run, prefer Application Default Credentials /
 * the runtime service account over inline API keys.
 *
 * Placeholders only for now so the server compiles without the SDKs installed.
 */

export interface GoogleConfig {
  /** GCP project id (from env on Cloud Run). */
  projectId?: string;
  /** Gemini model id, e.g. 'gemini-2.0-flash'. */
  geminiModel?: string;
}

export function loadGoogleConfig(): GoogleConfig {
  return {
    projectId: process.env['GOOGLE_CLOUD_PROJECT'],
    geminiModel: process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash',
  };
}

// Stage 2: export getGeminiClient(), getSpeechClient(), getFirestore() here.
