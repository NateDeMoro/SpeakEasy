
I want to introduce SpeakEasy, a real-time speech practice tool that listens while you rehearse and tells you exactly how you sound. It runs entirely in the browser, powered by Google's Speech-to-Text and Gemini, with everything stored in Firebase.

We built it for the everyone but specifically for people with stage anxiety who want a private, judgment-free place to practice.

The problem we want to address is that practicing alone gives you zero feedback. You finish, you — uh — feel okay, and you have no idea whether you rushed, rambled, or leaned on filler words the entire time.

Our project fixes that. As I speak, it tracks my pace, flags every uhh filler word, and measures whether my tone actually matches what I'm saying. It turns a vague gut feeling into real metrics you can actually act on. Behind the scenes, my audio streams to Google Cloud Run, Speech-to-Text then transcribes it, and Gemini reads both my words and my delivery to score the gap between them.


And this next part is genuinely the most exciting breakthrough of the entire project — the thing I have been dreaming about for years.


Did you catch that? My words were exciting, but my tone was not. That's exactly the mismatch our project is built to catch, because your content and your delivery have to agree for an audience to believe you.


In just ninety seconds of talking, I've handed SpeakEasy plenty to grade — pace, fillers, tone, and timing, all measured live. Now comes the best part: instead of guessing how that went, we hit stop and let the report tell us the truth.


And if you ever want to practice on your own time, SpeakEasy saves every session.

