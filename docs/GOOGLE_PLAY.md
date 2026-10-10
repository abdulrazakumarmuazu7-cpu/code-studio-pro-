# Google Play Release Guide

## What is already done
- `capacitor.config.json` (appId `com.codestudio.pro`, standalone web runtime)
- Real release keystore generated: RSA 4096, 30-yr validity (see
  `secrets-do-not-commit/README.txt`) — CHANGE its placeholder password and back it up.
- Store listing text, data-safety draft, and release notes below.

## Build the .aab (needs Android SDK + Gradle — NOT available in this sandbox)
On a machine (or CI) with JDK 17 + Android Studio:
```bash
npm install                 # pulls @capacitor/*
npx cap add android         # generates android/ (gitignored)
# place keystore at $KEYSTORE_PATH, set env vars from .env.example
npx cap sync android
cd android
./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
jarsigner -keystore $KEYSTORE_PATH -storepass $KEYSTORE_PASSWORD   app/build/outputs/bundle/release/app-release.aab code-studio
```
Play App Signing (recommended): upload the generated .aab; Play re-signs with
Google's key, and this keystore becomes your upload key.

## Play Console (requires your account — $25 one-time, identity verified)
Create app → answers pre-filled for you:
- Name: **Code Studio Pro** · Category: **Productivity** · Free
- Short description: "Build websites & mobile apps in your browser — offline."
- Full description: see `docs/store-listing.md`.
- Data safety: no data collected by the app itself; all data stays on-device
  (IndexedDB). State "Data is not shared" and "Data is not collected".
- Content rating: answer the questionnaire (no violence/UGC → Everyone).
- Target audience: 18+ (avoids Families policy complexity).
- Privacy policy URL: REQUIRED before production — host one (template below).
- App access: fully functional without login → "All functionality available".

## Release track order
Internal testing (add your Gmail) → Closed testing (≥12 testers for 14 days
if targeting production without prior app) → Production. Run the §15 test
matrix from your master prompt on a physical device before promoting each track.

## Minimum privacy policy skeleton (host at https://yourdomain.com/privacy)
"We do not collect, transmit, or sell personal data. Projects are stored locally
on your device. Contact: support@yourdomain.com."
