# Product Brief: Real-Time Speech Practice Coach
### Handoff document for next-stage planning (revision 2)

## One-line summary
A browser-based practice tool for ordinary people prepping a specific talk in the short term. It listens to a rehearsal, gives light real-time audio feedback, and produces a detailed after-the-fact report tuned to the speaker's actual speech material and audience, including whether they emphasized the words that matter and whether their tone matched their message.

## Decisions locked in this revision
- Platform: browser web app, laptop-first, with smartphone support as a later possibility.
- The core MVP is audio-only. Webcam-based gaze and facial expression move to Stage 4 as an add-on. The signal and analysis interfaces are designed to be modality-agnostic so the visual channel can be added later without rework.
- Real-time output stays general (standard delivery metrics plus a single nudge). The aggregate report carries the differentiators.
- Context capture has two parts: the speech material (an uploaded or pasted slideshow, script, or notes) and an open-ended set of optional setting fields (audience, audience size, audience background, location, presentation type, and so on). The user provides whatever they want.

## The problem and the user
Target user: a normal person (a student, a professional, someone giving a wedding toast) who has a specific presentation coming up soon and wants to rehearse and improve it. They are not aspiring professional speakers and are not committing to months of skill-building. The job to be done is "get this one talk ready," not "become a great speaker over time."

This task orientation is the positioning wedge. Existing tools are framed as ongoing skill-development platforms. This product is framed around a single upcoming talk, which changes it: advice is about this speech ("cut your intro, slow down on the key point") rather than abstract skill scores, and progress means improvement across a handful of rehearsals this week rather than long-term tracking.

## Competitive context and where differentiation now sits
This is a crowded, well-funded category. Yoodli (Google-backed, Toastmasters-integrated, $13.7M raised) and Orai already cover the standard set: filler words, pace, pitch and tone, clarity, eye contact, body language, real-time prompts, progress tracking, and AI roleplay. Simulated audiences and hostile-Q&A roleplay exist elsewhere too. The standard metrics are table stakes.

With the facial channel deferred to Stage 4, the core MVP differentiation rests on three things:

1. Emphasis-versus-meaning. Checking whether the words the speaker vocally stressed are the words that actually carry the point. Audio plus content only, so it is fully intact in the audio-only build. This is the flagship novelty and is absent from the incumbents.
2. Context-aware advice, now stronger. Because the user uploads the actual slideshow, script, or notes plus open-ended audience and setting details, the aggregate coaching can judge delivery against the real talk and room ("too much jargon for this audience," "you skipped your second main point," "too flat for a celebratory toast"). Incumbents mostly grade delivery in the abstract.
3. Audio tone-content mismatch. Comparing what is being said (Gemini sentiment and intent) against how it is said (prosody), surfacing contradictions like an exciting result delivered flat.

Honest note: an audio-only core sits closer to the most crowded sub-segment (Orai, Yoodli, Poised, Ummo, Speeko all do audio coaching, and the first two also offer the visual layer being deferred here). So in the MVP, emphasis-versus-meaning and the depth of the script-aware context advice carry most of the differentiation weight. The full face-inclusive congruence story and the computer-vision flex return as a Stage 4 upgrade.

## Feature inventory
Real-time, general, audio-only in the MVP: volume and variation, speaking pace, pauses and dead air, pitch and pitch variation, filler words.

Aggregate differentiators, post-talk: emphasis-versus-meaning, audio tone-content mismatch, and context-aware coaching that reads every metric through the uploaded speech material and the stated audience and setting.

Context inputs: speech material (slideshow, script, or notes) plus open-ended audience and setting fields.

Deferred to Stage 4: gaze (notes versus audience), facial expression, the facial half of congruence, and gesture synchrony.

Two output surfaces: a light real-time dashboard plus single nudge, and a rich aggregate report.

## Technical approach and feasibility
The architecture is two paths over one capture (audio in the MVP, audio plus video once Stage 4 lands).

Fast path (real-time, on-device, cheap): Web Audio API for volume, pause, and pitch; the `pitchy` library for fundamental frequency; Google Speech-to-Text streaming for fillers and pace. A thin rule layer drives the dashboard and the nudge. Signals stream into a session buffer.

Context ingestion: accept or parse the slideshow, script, or notes. Gemini reads PDFs, images, and text natively, so slides and notes need little custom parsing.

Slow path (aggregate, post-talk, heavy): the buffered audio signal time-series, the full transcript, the parsed speech material, and the audience and setting fields go to Gemini, which returns context-aware advice, emphasis-versus-meaning (important words, informed by the script, aligned against the acoustically stressed words), and audio tone-content mismatch (content sentiment against prosody). Optional Firebase storage enables cross-rehearsal comparison.

Modality-agnostic interfaces (the future-proofing requirement): store the session record as per-channel time-series keyed by channel type; have the aggregate Gemini step accept an extensible set of channel summaries; build the congruence analysis to treat any visual channel as an optional added signal. This lets the Stage 4 video layer slot in as another channel rather than forcing a rewrite of the recording schema, the aggregate pipeline, or the report format.

Feasibility: the real-time audio side is cheap and well-trodden, with STT the one dependency (it must be configured to preserve disfluencies, since most engines strip "um" by default). The aggregate side is easier post-hoc than it would be live, with no latency pressure. The single real engineering task is aligning word timestamps to acoustic stress for emphasis detection, which is moderate and tractable offline. Speech-material ingestion is easy because Gemini reads the formats directly. Suggested stack: Web Audio API, `pitchy`, Google Speech-to-Text, Gemini, Firebase, plus MediaPipe added at Stage 4.

## Staged implementation plan

### Stage 0: capture and bones (audio)
A browser app, laptop-first, that captures the mic and shows the simplest live audio signals: volume, pace from the energy envelope, and pause detection. No STT, no network for signals. Delivers a working live-dashboard skeleton. Feasibility is very high, roughly a day for a capable team.

### Stage 1: full real-time dashboard (audio) plus context capture
Add pitch and pitch variation, streaming STT for filler words and accurate pace, and the single calm nudge. Begin recording each session's signals and transcript into the modality-agnostic, per-channel schema. Build the context-capture UI: upload or paste the slideshow, script, or notes, plus the open-ended audience and setting fields. Delivers the complete general real-time experience and the context inputs. Feasibility is high; STT is the main new dependency.

### Stage 2: aggregate base
On session end, send the transcript, the audio-metric summary, the parsed speech material, and the audience and setting fields to Gemini, which returns a prioritized, context-aware delivery report. This can also compare what was said against what was planned (points covered, deviations, running long). Add lightweight session storage for cross-rehearsal comparison. Delivers context-aware advice (a core differentiator) and the after-the-fact report. Feasibility is high; mostly prompt design, UI, and light content parsing.

### Stage 3: differentiator layer (audio)
Add emphasis-versus-meaning (align the words Gemini judges important, informed by the uploaded script and slides, against the acoustically stressed words) and audio tone-content mismatch (content sentiment against prosody) to the aggregate report. This is the novel core and the reason the product is distinct. Feasibility is moderate; the word-stress alignment is the one piece of real engineering, made tractable by running post-hoc.

### Stage 4: add-ons and stretch (now including video)
Optional, in rough priority order:
- Video layer: webcam via MediaPipe Face Landmarker for gaze (notes versus audience) and facial expression. This restores eye-contact advice and completes the congruence story by adding the facial channel to tone-content mismatch. Because the Stage 1 schema and Stage 3 analysis were built modality-agnostic, video slots in as an added channel rather than a rewrite. This is the strongest demo add-on because it also restores the computer-vision flex.
- Live freeze-recovery (script-rescue): natural now that the script or notes are already ingested. Align the live transcript to the loaded material, and surface the next line when a pause runs long.
- Delivery tuner: show a target emphasis contour for a key line and let the user match it.
- Gesture-speech synchrony via MediaPipe pose, once the video layer exists.
- Smart-glasses delivery, much later (the Meta toolkit is in preview and partner-gated).

## Scope guidance and risks
Keep the real-time side deliberately thin and spend build time on the aggregate analysis that differentiates the product. Main risks: the STT disfluency-preservation configuration, and the word-stress alignment in Stage 3. One quality note: emphasis-versus-meaning is much stronger when the user uploads the script or slides, since otherwise Gemini infers importance from the transcript alone, so the UI should actively encourage uploading the material. Avoid gold-plating the dashboard.

## Out of scope (for now)
- Smart-glasses hardware dependency for the MVP. The Meta Wearables toolkit exists but is in preview and partner-gated, so it cannot be relied on for a demo.
- A standalone numeric "confidence score." It is not validatable; decompose perceived confidence into measurable acoustic proxies (pitch variation, volume steadiness, pace consistency, filler rate) instead.
- Long-term skill-tracking framing. The product is task-oriented.

## Open questions for next-stage planning
- Smartphone support in the MVP, or deferred (laptop-first is recommended).
- Which context fields are required versus optional, and whether to prompt the user to upload the script or slides, given emphasis-versus-meaning works much better with them.
- Whether cross-rehearsal storage is in the MVP or deferred.
- Which Stage 4 add-on to pre-commit for the hackathon demo (the video layer is the strongest candidate, since it restores both the eye-contact advice and the computer-vision flex).
- STT vendor confirmation and the disfluency-preservation configuration.
