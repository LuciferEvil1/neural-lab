# Neural Lab

An Android app running an on-device "failure-learning" AI — the **Trinity** lifecycle
(**Ghost → Molecule → Black Hole**) — inside a live 3D terrarium.

Built by Ahkeem Barros (**Team Annihilus**) for the Meta Global AI Developer Hackathon
(Indie Dev track, theme: Push the Frontier).

## What it does

- A small neural brain (24 → 16 → 16 → 8, 808 parameters) lives in a 3D terrarium,
  sensing gravity, objectives, and its own prediction error.
- When it fails at an objective, the failure is **sealed as a Ghost**: a deterministic
  FNV-1a hash of the objective and the action trace. Inside the seal step, a Meta AI
  model (`muse-spark-1.3`, via the Meta Model API) **judges the sealed failure**; the
  short verdict is stored with the ghost and shown in the app's thought log. The seal
  itself is local and authoritative — the judge call is fire-and-forget and never
  blocks the loop. The verdict also carries a machine-readable tail naming the
  blamed action and a severity; when it parses, the brain mints **one bounded
  molecule fragment from the verdict** — same caps, mass ladder and black-hole
  overflow as ghost fragments — so the judge's words steer future decisions. A
  **Judge's Review** card (Instruments) bundles the recent ghost history into one
  further call and renders the judge's paragraph review of the brain's habits.
- A later run at the same objective is the ghost's **appeal**. Success redeems it.
  Failure breaks it into **Molecules** — steering fragments (mass + bias) that bias
  future decisions away from the failed run's action pattern.
- Overflow collapses into **Black Hole** gravity wells instead of being discarded.
- Capacities are not hand-set: they derive from a **substrate probe** of the host
  device (ceiling = 26000 × core × memory × benchmark factors), and the network grows
  by function-preserving Net2Net widening up to that ceiling.
- **Dish instruments** (Events / Seals / Molecules / Gravity) expose the live brain
  state, and a fullscreen demo view presents it. The trained brain can also be
  exported to C (`neural_lab_infer.h` / `.c`) and runs bit-exact in a virtual MCU
  simulator in the app.

## Layout

- `www/` — the entire app UI and brain in plain JavaScript: `terrarium-core.js`
  (Trinity lifecycle), `terrarium.js` (3D dish), `meta-judge.js` (Meta Model API
  judge), `app.js` plus feature modules, `index.html`.
- `src/` — the Android host: `MainActivity` and the native bridges (HTTP bridge used
  by the judge call, Drive bridge, gym/observer features).
- `terrarium_tests.js` — the brain-core test suite (97 tests, run with Node).
- `build.sh` — the APK build used for the current build (aapt2 + javac + d8 +
  apksigner; Android SDK build-tools 36.1.0, JDK 21).

## New vs pre-existing (hackathon window: Oct 26 – Nov 4, 2026)

**Pre-existing base:** the Trinity lifecycle, the terrarium brain, training/gym
features, and the C export of the trained brain.

**Built during the hackathon:** the Meta AI judge loop inside the Ghost seal step,
the judge fragment (verdicts minting steering molecules) and the Judge's Review
card, the Dish instruments, the fullscreen demo view with its swipe deck, and the
demo/submission packaging.

## Build notes

- The signing keystore is **not** in this repo. `build.sh` expects a PKCS12 keystore
  you supply yourself.
- The Meta Model API key is **never** in this repo: it is entered in the app
  on-device and kept in the app's local storage only.
- `libs/zxing-core-3.5.3.jar` (ZXing, Apache-2.0) is included for the QR feature.
- The full APK build also transplants a Chaquopy runtime from a previous APK
  (see `build.sh`); the app source in `www/` + `src/` is complete as-is.
