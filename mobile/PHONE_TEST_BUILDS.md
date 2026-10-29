# Standalone phone test builds

The phone test app uses only local synthetic cases, matrix entries, and demo slots. It has no backend URL, Google account connection, or push delivery. The current workflow covers one session phase at a time; separate group theory and individual practice still need the full connected phase plan.

## Android APK on this Mac

Use JDK 17 and the installed Android SDK. From `mobile/`:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/Users/Matt/Library/Android/sdk
npm ci
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease --no-daemon
```

The file is `android/app/build/outputs/apk/release/app-release.apk`. This local Gradle template signs its release variant with the Android debug key, so it is an **internal test APK**, not a production-signed build. Do not use it for Play Store delivery. Install it with `adb install -r .../app-release.apk`, or download the APK link on an Android phone and allow installation from that source. The JavaScript bundle is embedded: Metro and the laptop are not needed after installation. The package ID is `com.mattbang.cosanumtrainingdemo`.

The verified 28 October 2026 test build is available as a [direct APK download](https://github.com/mattbang/cosanum-automation/releases/download/mobile-test-sdk58-2026-10-28/cosanum-training-demo-sdk58-android-test.apk), with its [SHA-256 checksum file](https://github.com/mattbang/cosanum-automation/releases/download/mobile-test-sdk58-2026-10-28/SHA256SUMS.txt). SHA-256: `f750bde24ec228794d6989d716e3b22f5bcacf9522c07d47d911ad4ab06e84f2`.

For the 29 October presentation, use the newer [build 2 Android test APK](https://github.com/mattbang/cosanum-automation/releases/download/mobile-presentation-build2-2026-10-29/cosanum-training-demo-build2-android-test.apk) and its [checksum file](https://github.com/mattbang/cosanum-automation/releases/download/mobile-presentation-build2-2026-10-29/cosanum-training-demo-build2-SHA256SUMS.txt). APK SHA-256: `698d4bfe17003b52a5c34dd98455f1e9f5504fe69f0b87d337f893ad8bdb4818`. It was built from source `de02de5`, has Android versionCode 2 and versionName 1.0.1, and installed in place over versionCode 1 on the Android 37 emulator. Its embedded bundle cold-started with Metro stopped; the four-step tour opened the seeded trainer-action case. A physical Android phone has not been checked. For an iPhone browser presentation, use the [synthetic phone demo](https://mattbang.github.io/cosanum-automation/phone-demo/); this is a web fallback, not an iPhone device build.

Build 3 is a **local candidate, not a published download**. Its APK is at `/private/tmp/cosanum-training-demo-build3-android-test.apk`; SHA-256: `b537f3c184cd7684ac70ced94c129197d4e23f2e2c7ea8216d23265f8f79ef8e`. It has versionCode 3 and versionName 1.0.2. On the Android 37 emulator it installed over build 2, cold-started from the embedded bundle, displayed the prominent shared-demo launch and hosted materials/source links, and handed the primary link to Chrome. Chrome then showed its first-run screen, so a completed shared session on Android is not established. The shared demo homepage, `/materials/index.html`, and `/api/sources` responded HTTP 200 from this Mac after the site v6 deployment. This build changes only local presentation and external-browser links; it does not add a connected native workflow or push delivery.

The same build 3 source exported an iOS JavaScript bundle with `npx expo export --platform ios` on this Mac. A native iOS simulator build was not attempted because CocoaPods (`pod`) is not installed; there is still no signed iPhone device build. The separate shared demo can be opened in iPhone Safari after its website deployment, subject to its own sign-in and room-access checks.

The standalone app accepts `cosanum-training-demo://participant/CASE-S-1` as a local demo link. It selects a synthetic case; it does not authenticate a participant or authorize a real response. A phone can open the link after the app is installed. The **Hinweise** screen offers an opt-in, device-local reminder for visible attention items about 30 seconds later. It requests notification permission on tap, schedules no remote push, and includes no person details in the notification.

## iPhone device build handoff

`eas.json` defines an internal `preview` build with an embedded JavaScript bundle and an iOS device target. An authorized operator can use:

```sh
cd mobile
npm ci
npm install -g eas-cli
eas login
eas build:configure
eas device:create
eas build --platform ios --profile preview
```

The gate is Apple signing, not Expo SDK compatibility: a paid Apple Developer Program team with permission to create certificates, identifiers, and provisioning profiles must sign `com.mattbang.cosanumtrainingdemo`. Each test iPhone UDID must be in the Ad Hoc provisioning profile used for the build. EAS can manage the certificate/profile after an authorized operator signs in, or use credentials uploaded by that operator. An iPhone on iOS 16+ must enable Developer Mode to run an internal build. This Mac has Xcode 27.1, but currently has **zero valid code-signing identities**; no iPhone device `.ipa` was produced. No account login or signing consent was attempted here.

For an updated iPhone tester, register the device before building or re-sign the existing build with a refreshed profile. An internal distribution link can then be shared from the EAS build page. A simulator export or Expo Go preview does not establish device-install acceptance.
