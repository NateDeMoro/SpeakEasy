Google Cloud project setup (one person, shared project)
    - Create/confirm a GCP project and link billing.
    - Enable APIs: Vertex AI / Gemini API, Cloud Speech-to-Text, Cloud Run, Firestore (Native mode),
    Artifact Registry (for container images).
    - Create a Firestore database (Native mode), pick a region.
    - Generate a Gemini API key (AI Studio) or set up a service account for Vertex — decide which. Keys go
    in apps/api env only, never the web app.
    
    Accounts/access
    - Everyone added as IAM members on the GCP project (roles: Cloud Run Admin, Firestore User, Service
    Account User for whoever deploys).
    - Shared Firebase project (can wrap the same GCP project) for Hosting.

    Editor
    - VS Code + ESLint + Prettier + the TypeScript workspace extensions, so the shared strict tsconfig and
    lint rules apply uniformly.