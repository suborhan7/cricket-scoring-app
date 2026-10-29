# Android app

The Android app is a small Capacitor shell around the web app. It opens the live site
(`server.url` in `capacitor.config.json`), so every update to `main` reaches phones
without a new install. The service worker keeps scoring working offline after the first
launch, and `android-assets/offline.html` shows if the very first launch has no internet.

## Friends' test build (APK)

Every push to `main` runs `.github/workflows/android.yml`, which builds a debug APK and
puts it on the **android-latest** release:

https://github.com/suborhan7/cricket-scoring-app/releases/download/android-latest/cricpulse.apk

To install it, open the link on an Android phone, open the downloaded file, and allow
"Install unknown apps" when asked.

## Before the Play Store

1. Check `server.url` in `capacitor.config.json` (and `APP_URL` in
   `android-assets/offline.html`) is the Vercel production URL.
2. Create an upload key once, on your computer:
   `keytool -genkey -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Keep the file and passwords safe, and never commit them.
3. Add four repository secrets in GitHub (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`. A release-bundle (AAB) step
   will then be added to the workflow.
4. In Play Console: create the app, turn on Play App Signing, and upload the AAB to
   Internal testing first.
5. Store listing needs: the 512×512 icon (`icons/icon-512.png`), a 1024×500 feature
   graphic, at least 2 phone screenshots, the privacy policy URL
   (`<site>/privacy.html`), and the Data safety form (email, name, photos; no ads; account
   deletion in the app under Account → Delete my account).

## Google sign-in

Google blocks its sign-in page inside app web views, so the button only shows in the
browser. To turn it on: create an OAuth client in Google Cloud, add it under Supabase →
Authentication → Sign In / Providers → Google, then set `googleLogin: true` in
`js/config.js`.
