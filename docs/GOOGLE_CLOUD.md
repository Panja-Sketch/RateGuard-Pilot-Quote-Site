# Google Cloud stack, local-first (nothing is deployed)

> **No cloud resource has been created and no deployment was performed.** Everything runs locally with no cloud account. This document maps the pilot onto the same *general* stack used by RateGuard Enhanced (read-only reference: Firebase Hosting + Auth, Cloud Run, Firestore accessed only by the API, Cloud Storage, optional Pub/Sub / BigQuery / Vertex AI) and gives **separate deployment instructions to run only with your approval**.

## Required vs optional

| Service | Role in the pilot | Required? | Cost posture |
| --- | --- | --- | --- |
| **Cloud Run** | the Node API + rating engine (`Dockerfile`) | **Required** for a hosted demo | scale-to-zero, 1 small instance; effectively cents/month at demo traffic |
| **Firebase Hosting** | static frontend (`public/`), rewrites `/api/**` to Cloud Run | Recommended | free tier sufficient |
| **Firebase Authentication** | demo identity & roles in the cloud (`AUTH_MODE=firebase`) | Recommended for a shared demo (otherwise demo passwords on a public URL are weak) | free tier |
| **Firestore** | products, versions, submissions, quotes, feedback, audit | Required for a *multi-instance* cloud deployment (the local JSON file is single-process) | Native mode, tiny data → near-free |
| **Cloud Storage** | uploaded synthetic XLSX, future report artifacts | Required if workbook upload is used in the cloud (Cloud Run disk is ephemeral) | pennies |
| **Pub/Sub** | long batch jobs | **Not needed** now (batch ≤ 200 is synchronous) | — |
| **BigQuery** | synthetic portfolio analytics | **Optional**, not built | keep disabled |
| **Vertex AI** | ticket summarisation / mapping suggestions | **Optional**, not built; must stay out of premium calculation | keep disabled |

Budget sense (≈ $290 credit): Cloud Run (min-instances 0) + Hosting + Firestore + GCS at demo scale should be a few dollars per month; **leave BigQuery/Vertex/Pub/Sub off**. Set a budget alert before enabling anything (see below).

## Local development (the default, and all the tests)

```bash
npm install && npm start     # file store in ./data, local demo auth, no cloud calls
```

### Local emulators (optional, for the cloud code paths)

The repo ships `firebase.json` with emulator ports (Auth 9099, Firestore 8086, Hosting 5002 — chosen to avoid RateGuard Enhanced's Firestore emulator port 8085).

```bash
npm i -g firebase-tools
firebase emulators:start --only auth,firestore --project demo-pilot-quote   # "demo-" project ids never touch real cloud
# in another shell (UNTESTED adapters; see below):
npm i @google-cloud/firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8086 GOOGLE_CLOUD_PROJECT=demo-pilot-quote PILOT_STORE=firestore PILOT_FIRESTORE_PREFIX=pilot_ npm start
```

**Honest status of the cloud adapters:** `server/store/firestore.js` and `server/store/gcs.js` are small skeletons behind the same repository interface the local stores implement. They have **never been executed against Firestore, the emulator or Cloud Storage** in this repository, and are not covered by tests. `AUTH_MODE=firebase` (ID-token verification with `firebase-admin`, role from custom claim `pilotRole`) is likewise written but unexercised. Before relying on any of them: run the backend test-suite against the Firestore emulator by pointing `makeContext` at the adapter, and fix what breaks.

### Firestore data model (collections, prefix `pilot_`)

`products`, `documents` (product + rating versions; `id` = `HO-NAT-v2`), `submissions`, `quotes` (immutable), `workbooks` (metadata; bytes in GCS keyed by SHA-256), `feedback`, `hints`, `scenarioRuns`, `audit` (append-only, hash-chained; `meta/audit-head` holds the chain head), `meta` (sequence counters). Documents stay well under Firestore's 1 MiB limit at current sizes (largest: a national rate book ≈ 150–250 KB). Rules deny all client access (`firestore.rules`); only the API (server library, bypassing rules) reads/writes — the same pattern as RateGuard Enhanced.

Known cloud gaps: audit-head sequencing assumes a single writer (use a Firestore transaction in the adapter before running multiple instances); sequence counters (`submission-seq`, `quote-seq`) likewise; the in-memory login throttle is per-instance.

## Deployment instructions (for later — run only after explicit approval)

Placeholders: `PROJECT_ID`, `REGION=us-central1`. Review each command; none have been run.

```bash
# 0) safety: a dedicated project and a budget alert FIRST
gcloud projects create $PROJECT_ID                         # or reuse a dedicated sandbox project
gcloud billing budgets create --billing-account=<ID> --display-name="pilot-quote" --budget-amount=25USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# 1) Firestore (Native mode) + rules (deny-all)
gcloud firestore databases create --location=nam5
firebase deploy --only firestore:rules --project $PROJECT_ID

# 2) Cloud Storage bucket for workbooks (uniform access, no public access)
gcloud storage buckets create gs://$PROJECT_ID-pilot-artifacts --location=us-central1 --uniform-bucket-level-access --public-access-prevention

# 3) Service account with least privilege (no keys are ever created)
gcloud iam service-accounts create pilot-api
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:pilot-api@$PROJECT_ID.iam.gserviceaccount.com --role=roles/datastore.user
gcloud storage buckets add-iam-policy-binding gs://$PROJECT_ID-pilot-artifacts --member=serviceAccount:pilot-api@$PROJECT_ID.iam.gserviceaccount.com --role=roles/storage.objectUser

# 4) install the optional adapters into the image build (add to package.json first):
#    @google-cloud/firestore  @google-cloud/storage  firebase-admin

# 5) build + deploy the API (private by default)
gcloud run deploy pilot-quote-api --source . --region us-central1 --service-account pilot-api@$PROJECT_ID.iam.gserviceaccount.com \
  --no-allow-unauthenticated --min-instances 0 --max-instances 2 --memory 512Mi \
  --set-env-vars PILOT_STORE=firestore,PILOT_BLOBS=gcs,PILOT_GCS_BUCKET=$PROJECT_ID-pilot-artifacts,AUTH_MODE=firebase,PILOT_CORS_ORIGINS=https://$PROJECT_ID.web.app

# 6) frontend: Firebase Hosting rewrites /api/** to the Cloud Run service (firebase.json)
firebase deploy --only hosting --project $PROJECT_ID
```

For a future verifier, grant its service account `roles/run.invoker` on `pilot-quote-api` and have it send a Google-signed ID token (audience = service URL). Keep the service private and the Hosting rewrite as the only public path if a browser demo is needed (Hosting → Cloud Run invocation requires the service to allow that path; decide deliberately).

**Rollback:** `gcloud run services update-traffic pilot-quote-api --to-revisions <previous>=100`; Firestore data is not migrated by deploys.
**Teardown:** `gcloud run services delete pilot-quote-api`, delete the bucket and Firestore collections, delete the project.

## Vertex AI / BigQuery guidance (if ever added)

Keep both **out of premium calculation**. Vertex only for *bounded assistance* (summarising a pasted ticket, suggesting workbook mappings) with output shown as a suggestion that a person confirms — the same contract as reviewed feedback hints. Use the runtime service account, no API keys, and cap tokens. BigQuery only for exported synthetic quote batches; no real data.
