export const WORKFLOW_PATH = '.github/workflows/build-apk.yml';

export const WORKFLOW = String.raw`name: Rafiki Smart APK Builder

run-name: "APK • __GH_EXPR__ inputs.build_id }} • __GH_EXPR__ inputs.engine_id }}"

on:
  workflow_dispatch:
    inputs:
      build_id:
        required: true
        type: string
      engine_id:
        required: true
        type: string
      app_name:
        required: true
        type: string
      package_name:
        required: true
        type: string
      input_manifest:
        required: true
        type: string

permissions:
  contents: write
  actions: write

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Setup Java
        uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '17'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install required Android SDK packages
        shell: bash
        run: |
          set -euo pipefail
          yes | sdkmanager --licenses >/dev/null || true
          sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v6
        with:
          gradle-version: '9.8.0'

      - name: Install tools
        shell: bash
        run: |
          sudo apt-get update
          sudo apt-get install -y unzip zip jq rsync

      - name: Read exact build manifest
        id: input
        shell: bash
        env:
          BUILD_ID: __GH_EXPR__ inputs.build_id }}
        run: |
          set -euo pipefail
          MANIFEST="build-input/manifests/__SH_VAR__BUILD_ID}.json"
          test -f "$MANIFEST"
          cat "$MANIFEST"
          echo "MANIFEST=$MANIFEST" >> "$GITHUB_OUTPUT"

      - name: Reassemble project ZIP from stored chunks
        shell: bash
        env:
          BUILD_ID: __GH_EXPR__ inputs.build_id }}
        run: |
          set -euo pipefail
          mkdir -p workspace/input
          ZIP="workspace/project.zip"
          : > "$ZIP"
          count=$(find "build-input/chunks/__SH_VAR__BUILD_ID}" -maxdepth 1 -type f -name '*.part' | sort | wc -l)
          test "$count" -gt 0
          expected=$(jq -r '.total_chunks' "build-input/manifests/__SH_VAR__BUILD_ID}.json")
          test "$count" -eq "$expected"
          find "build-input/chunks/__SH_VAR__BUILD_ID}" -maxdepth 1 -type f -name '*.part' -print0 | sort -zV | xargs -0 cat >> "$ZIP"
          unzip -t "$ZIP"
          unzip -o "$ZIP" -d workspace/project

      - name: Analyze files that actually exist
        id: detect
        shell: bash
        env:
          BUILD_ID: __GH_EXPR__ inputs.build_id }}
        run: |
          set -euo pipefail
          cd workspace/project
          : > ../file-list.txt
          find . -type f -print | sed 's#^./##' | sort | tee ../file-list.txt
          TYPE="unknown"
          ROOT="."
          if find . -type f -name 'pubspec.yaml' -print -quit | grep -q .; then
            TYPE='flutter'
          elif find . -type f \( -name 'capacitor.config.json' -o -name 'capacitor.config.ts' \) -print -quit | grep -q .; then
            TYPE='capacitor'
          elif find . -type f \( -name 'settings.gradle' -o -name 'settings.gradle.kts' -o -name 'build.gradle' -o -name 'build.gradle.kts' -o -name 'gradlew' \) -print -quit | grep -q . && find . -type f -name 'AndroidManifest.xml' -print -quit | grep -q .; then
            TYPE='android'
          elif find . -type f -name 'package.json' -print -quit | grep -q .; then
            TYPE='web'
          elif find . -type f -name 'index.html' -print -quit | grep -q .; then
            TYPE='html'
          fi
          echo "Detected: $TYPE"
          echo "TYPE=$TYPE" >> "$GITHUB_OUTPUT"

      - name: Prepare selected custom engine from stored chunks
        if: >-
          inputs.engine_id != 'android-native' &&
          inputs.engine_id != 'flutter' &&
          inputs.engine_id != 'capacitor' &&
          inputs.engine_id != 'webview'
        shell: bash
        env:
          ENGINE_ID: __GH_EXPR__ inputs.engine_id }}
        run: |
          set -euo pipefail
          test -d "engines/$ENGINE_ID/chunks"
          mkdir -p workspace/custom-engine workspace/custom-output
          find "engines/$ENGINE_ID/chunks" -maxdepth 1 -type f -name '*.part' -print0 | sort -zV | xargs -0 cat > workspace/custom-engine/engine.zip
          unzip -t workspace/custom-engine/engine.zip
          unzip -o workspace/custom-engine/engine.zip -d workspace/custom-engine/files
          test -f workspace/custom-engine/files/engine.json
          test -f workspace/custom-engine/files/build.sh
          chmod +x workspace/custom-engine/files/build.sh
          echo "Custom engine prepared: $ENGINE_ID"

      - name: Run selected custom engine
        if: >-
          inputs.engine_id != 'android-native' &&
          inputs.engine_id != 'flutter' &&
          inputs.engine_id != 'capacitor' &&
          inputs.engine_id != 'webview'
        shell: bash
        env:
          ENGINE_ID: __GH_EXPR__ inputs.engine_id }}
          APP_NAME: __GH_EXPR__ inputs.app_name }}
          PACKAGE_NAME: __GH_EXPR__ inputs.package_name }}
          PROJECT_DIR: __GH_EXPR__ github.workspace }}/workspace/project
          OUTPUT_DIR: __GH_EXPR__ github.workspace }}/workspace/custom-output
        run: |
          set -euo pipefail
          cd workspace/custom-engine/files
          ./build.sh "$PROJECT_DIR" "$OUTPUT_DIR"

      - name: Setup Flutter only when Flutter files exist
        if: steps.detect.outputs.TYPE == 'flutter' && inputs.engine_id == 'flutter'
        uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true

      - name: Build Flutter project
        if: steps.detect.outputs.TYPE == 'flutter' && inputs.engine_id == 'flutter'
        shell: bash
        run: |
          set -euo pipefail
          cd workspace/project
          flutter pub get
          flutter build apk --debug

      - name: Build existing Android project
        if: steps.detect.outputs.TYPE == 'android' && inputs.engine_id == 'android-native'
        shell: bash
        run: |
          set -euo pipefail
          cd workspace/project
          WRAPPER=$(find . -type f -name gradlew -print -quit)
          if [ -n "$WRAPPER" ]; then
            chmod +x "$WRAPPER"
            dirname "$WRAPPER" | xargs -I{} bash -c 'cd "{}" && ./gradlew assembleDebug --no-daemon --stacktrace'
          else
            echo "No Gradle wrapper was present; using current Gradle tool only because Android build files were actually found."
            gradle assembleDebug --no-daemon --stacktrace
          fi

      - name: Install Node only when web/Capacitor project exists
        if: steps.detect.outputs.TYPE == 'web' || steps.detect.outputs.TYPE == 'capacitor'
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: 'npm'

      - name: Build Capacitor project
        if: steps.detect.outputs.TYPE == 'capacitor' && inputs.engine_id == 'capacitor'
        shell: bash
        run: |
          set -euo pipefail
          cd workspace/project
          if [ -f package-lock.json ]; then npm ci; else npm install; fi
          if [ ! -d android ]; then npx cap add android; fi
          npx cap sync android
          cd android
          if [ -f gradlew ]; then chmod +x gradlew; ./gradlew assembleDebug --no-daemon --stacktrace; else gradle assembleDebug --no-daemon --stacktrace; fi

      - name: Build web project and wrap as Android when web files actually exist
        if: (steps.detect.outputs.TYPE == 'web' || steps.detect.outputs.TYPE == 'html') && inputs.engine_id == 'webview'
        shell: bash
        run: |
          set -euo pipefail
          cd workspace/project
          if [ -f package.json ]; then
            if [ -f package-lock.json ]; then npm ci; else npm install; fi
            if node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)"; then npm run build; fi
          fi
          WEB_DIR=""
          for d in dist build out public; do
            if [ -d "$d" ]; then
              candidate=$(find "$d" -type f -name 'index.html' -print -quit)
              if [ -n "$candidate" ]; then WEB_DIR=$(dirname "$candidate"); break; fi
            fi
          done
          if [ -z "$WEB_DIR" ] && [ -f index.html ]; then WEB_DIR='.'; fi
          if [ -z "$WEB_DIR" ]; then
            echo "No web output was detected from the files that actually exist."
            exit 1
          fi
          cd ..
          rm -rf web2apk
          mkdir -p web2apk/app/src/main/java/com/rafiki/web2apk
          mkdir -p web2apk/app/src/main/assets/site
          cp -r "project/$WEB_DIR/." web2apk/app/src/main/assets/site/
          cat > web2apk/settings.gradle.kts <<'EOF2'
          import org.gradle.api.initialization.resolve.RepositoriesMode
          pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
          dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
          rootProject.name = "RafikiWeb2Apk"
          include(":app")
          EOF2
          cat > web2apk/build.gradle.kts <<'EOF2'
          plugins {
            id("com.android.application") version "9.4.0" apply false
          }
          EOF2
          cat > web2apk/gradle.properties <<'EOF2'
          org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
          android.useAndroidX=true
          EOF2
          cat > web2apk/app/build.gradle.kts <<EOF2
          plugins { id("com.android.application") }
          
          android { namespace = "__GH_EXPR__ inputs.package_name }}"; compileSdk = 36
            defaultConfig { applicationId = "__GH_EXPR__ inputs.package_name }}"; minSdk = 23; targetSdk = 36; versionCode = 1; versionName = "1.0" }
          }
          EOF2
          APP_LABEL=$(APP_NAME="__GH_EXPR__ inputs.app_name }}" python3 -c 'import os,html; print(html.escape(os.environ["APP_NAME"], quote=True))')
          cat > web2apk/app/src/main/AndroidManifest.xml <<EOF2
          <manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:theme="@style/AppTheme" android:label="$APP_LABEL"><activity android:name="com.rafiki.web2apk.MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>
          EOF2
          mkdir -p web2apk/app/src/main/res/values
          cat > web2apk/app/src/main/res/values/styles.xml <<'EOF2'
          <resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:windowActionModeOverlay">true</item></style></resources>
          EOF2
          cat > web2apk/app/src/main/java/com/rafiki/web2apk/MainActivity.java <<'EOF2'
          package com.rafiki.web2apk;
          import android.app.Activity;
          import android.os.Bundle;
          import android.webkit.WebView;
          import android.webkit.WebViewClient;
          
          public class MainActivity extends Activity {
            @Override public void onCreate(Bundle state) {
              super.onCreate(state);
              WebView w = new WebView(this);
              w.setWebViewClient(new WebViewClient());
              w.getSettings().setJavaScriptEnabled(true);
              w.getSettings().setDomStorageEnabled(true);
              w.loadUrl("file:///android_asset/site/index.html");
              setContentView(w);
            }
          }
          EOF2
          cd web2apk
          gradle --version
          gradle assembleDebug --no-daemon --stacktrace
          cd ..
          cp web2apk/app/build/outputs/apk/debug/app-debug.apk web2apk-debug.apk

      - name: Locate only APK files that were actually produced
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p output
          find workspace -type f -name '*.apk' -print
          find workspace -type f -name '*.apk' -exec cp {} output/ \;
          APK_COUNT=$(find output -maxdepth 1 -type f -name '*.apk' | wc -l)
          if [ "$APK_COUNT" -eq 0 ]; then
            echo "ERROR: no APK was produced by the selected engine. No missing-file assumption was used."
            exit 1
          fi

      - name: Upload debug APK artifact
        uses: actions/upload-artifact@v7
        with:
          name: apk-result
          path: output/*.apk
          if-no-files-found: error
          retention-days: 90
          compression-level: 0

      - name: Publish permanent GitHub Release asset
        env:
          GH_TOKEN: __GH_EXPR__ github.token }}
          BUILD_ID: __GH_EXPR__ inputs.build_id }}
          APP_NAME: __GH_EXPR__ inputs.app_name }}
        shell: bash
        run: |
          set -euo pipefail
          TAG="build-__SH_VAR__BUILD_ID}"
          APK=$(find output -maxdepth 1 -type f -name '*.apk' | head -1)
          gh release create "$TAG" "$APK" --title "__SH_VAR__APP_NAME} • __SH_VAR__BUILD_ID}" --notes "Rafiki Smart APK Builder build."
`.replaceAll('__GH_EXPR__','${{').replaceAll('__SH_VAR__','${');
