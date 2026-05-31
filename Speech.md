
I want to introduce Speech Practice Coach, a real-time speech practice tool that listens while you rehearse and tells you exactly how you sound. It runs entirely in the browser, powered by Google's Speech-to-Text and Gemini, with everything stored in Firebase.

So, um, the problem we kept running into was, that practicing alone gives you zero feedback. You finish, you — uh — feel okay, and you have no idea whether you rushed, rambled, or leaned on filler words the entire time.


Our project fixes that. As I speak, it tracks my pace, flags every filler word, and measures whether my tone actually matches what I'm saying. It turns a vague gut feeling into real numbers you can actually act on. Behind the scenes, my audio streams to Google Cloud Run,
Speech-to-Text transcribes it, and Gemini reads both my words and my delivery to score the gap between them.


And this next part is genuinely the most exciting breakthrough of the entire project — the thing I have been dreaming about for years.


Did you catch that? My words said thrilling, but my voice said absolutely nothing. That's exactly the mismatch our project is built to catch, because your content and your delivery have
to agree for an audience to believe you.

**[Close — hand off to the results]**
In just ninety seconds of talking, I've handed Coach plenty to grade — pace, fillers, tone,
and timing, all measured live. Now comes the best part: instead of guessing how that went,
we hit stop and let the report tell us the truth.

---

## The 15 skipped words (do NOT say these)

> And if you ever want to practice on your own time, Coach saves every session.

---

## How it maps to the demo

| Section | Triggers | Payoff in the report |
|---|---|---|
| "um / like / uh" cluster | Filler-word detector | 3 hits flagged in one passage |
| Flat "most exciting breakthrough" line | Tone/content mismatch (Gemini emphasis) | Words rate high-energy, delivery rates flat |
| Whole speech ~90s | Pacing / delivery metrics | WPM lands in a sane range |
| 15 skipped words | Transcript reflects actual delivery, not the script | Report ends where you stopped |

**Timing:** 250 words ≈ 90s at ~165 wpm. The flat line and filler pauses add a few seconds —
good buffer. If it runs long, cut the "Behind the scenes" sentence (28 words).
