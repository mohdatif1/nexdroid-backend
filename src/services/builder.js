// Generates all files needed for a Capacitor Android build
// Supports both APK (assembleRelease) and AAB (bundleRelease)

function generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions) {
  const permLines = permissions
    .map(p => `    <uses-permission android:name="android.permission.${p}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageName}"
    android:versionCode="${versionCode}"
    android:versionName="${versionName}">

    <uses-sdk
        android:minSdkVersion="${minSdk}"
        android:targetSdkVersion="34" />

${permLines ? permLines + '\n' : ''}
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${appName}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="false"
        android:networkSecurityConfig="@xml/network_security_config"
        android:hardwareAccelerated="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="${orientation}"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:hardwareAccelerated="true"
            android:windowSoftInputMode="adjustResize">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

    </application>

</manifest>`;
}

function generateBuildGradle(packageName, versionCode, versionName, minSdk) {
  return `apply plugin: 'com.android.application'

android {
    namespace "${packageName}"
    compileSdkVersion 34
    defaultConfig {
        applicationId "${packageName}"
        minSdkVersion ${minSdk}
        targetSdkVersion 34
        versionCode ${versionCode}
        versionName "${versionName}"
    }
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("KEY_ALIAS") ?: ""
            keyPassword System.getenv("KEY_PASSWORD") ?: ""
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            signingConfig signingConfigs.release
        }
    }
    bundle {
        language { enableSplit = true }
        density  { enableSplit = true }
        abi      { enableSplit = true }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.webkit:webkit:1.9.0'
}`;
}

function generateMainActivity(packageName) {
  return `package ${packageName};

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}`;
}

function generateActivityLayout() {
  return `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <WebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</RelativeLayout>`;
}

function generateNetworkSecurityConfig() {
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>`;
}

function generateAppTheme() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="colorPrimary">#3b7eff</item>
        <item name="colorPrimaryDark">#07090f</item>
        <item name="colorAccent">#6366f1</item>
        <item name="android:windowBackground">#07090f</item>
        <item name="android:statusBarColor">#07090f</item>
        <item name="android:navigationBarColor">#07090f</item>
    </style>
</resources>`;
}

function generateRootGradle() {
  return `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}`;
}

function generateGradleWrapper() {
  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`;
}

function generateGradleProperties() {
  return `# Project-wide Gradle settings.
android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true`;
}

function generateSettingsGradle(appName) {
  return `rootProject.name = "${appName}"
include ':app'`;
}

// ─── Generate GitHub Actions workflow ────────────────────
// buildType: 'apk' | 'aab'
function generateWorkflow(buildType = 'apk') {
  const isAAB = buildType === 'aab';
  const gradleTask   = isAAB ? 'bundleRelease'   : 'assembleRelease';
  const artifactName = isAAB ? 'release-aab'     : 'release-apk';
  const outputPath   = isAAB
    ? 'app/build/outputs/bundle/release/app-release.aab'
    : 'app/build/outputs/apk/release/app-release.apk';
  const fileExt = isAAB ? 'aab' : 'apk';

  return `name: Build Signed ${isAAB ? 'AAB' : 'APK'}

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: gradle

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v3
        with:
          gradle-version: '8.2'

      - name: Generate Gradle Wrapper JAR
        run: |
          gradle wrapper --gradle-version 8.2 --distribution-type bin
          chmod +x ./gradlew
          echo "=== gradlew ===" && ls -la gradlew
          echo "=== wrapper dir ===" && ls -la gradle/wrapper/

      - name: Decode Keystore
        env:
          KEYSTORE_BASE64: \${{ secrets.KEYSTORE_BASE64 }}
        run: |
          echo "\$KEYSTORE_BASE64" | base64 --decode > release.keystore
          ls -lh release.keystore
          echo "Keystore decoded successfully"

      - name: Build Signed ${isAAB ? 'AAB (App Bundle)' : 'APK'}
        env:
          KEYSTORE_PATH: \${{ github.workspace }}/release.keystore
          KEYSTORE_PASSWORD: \${{ secrets.KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.KEY_ALIAS }}
          KEY_PASSWORD: \${{ secrets.KEY_PASSWORD }}
        run: |
          ./gradlew ${gradleTask} --no-daemon --stacktrace
          echo "Build completed successfully"

      - name: Verify output file
        run: |
          if [ -f "${outputPath}" ]; then
            echo "Output file found: ${outputPath}"
            ls -lh "${outputPath}"
          else
            echo "ERROR: Output file not found!"
            find app/build/outputs -name "*.${fileExt}" 2>/dev/null || echo "No ${fileExt} files found"
            exit 1
          fi

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${artifactName}
          path: ${outputPath}
          retention-days: 7
          if-no-files-found: error
`;
}

// ─── Build full project file list ────────────────────────
function generateProjectFiles(config, htmlCode) {
  const {
    appName, packageName, versionCode, versionName,
    minSdk, orientation, permissions,
    buildType = 'apk'   // 'apk' | 'aab'
  } = config;

  const pkgPath = packageName.replace(/\./g, '/');

  return [
    // HTML app source
    { path: 'app/src/main/assets/www/index.html', content: htmlCode },

    // AndroidManifest
    {
      path: 'app/src/main/AndroidManifest.xml',
      content: generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions)
    },

    // app/build.gradle
    {
      path: 'app/build.gradle',
      content: generateBuildGradle(packageName, versionCode, versionName, minSdk)
    },

    // Root build.gradle
    { path: 'build.gradle', content: generateRootGradle() },

    // settings.gradle
    { path: 'settings.gradle', content: generateSettingsGradle(appName) },

    // gradle.properties — AndroidX + performance flags (REQUIRED)
    { path: 'gradle.properties', content: generateGradleProperties() },

    // Gradle wrapper properties (JAR is generated in CI via `gradle wrapper`)
    { path: 'gradle/wrapper/gradle-wrapper.properties', content: generateGradleWrapper() },

    // MainActivity.java
    {
      path: `app/src/main/java/${pkgPath}/MainActivity.java`,
      content: generateMainActivity(packageName)
    },

    // Layout
    {
      path: 'app/src/main/res/layout/activity_main.xml',
      content: generateActivityLayout()
    },

    // Network security config
    {
      path: 'app/src/main/res/xml/network_security_config.xml',
      content: generateNetworkSecurityConfig()
    },

    // App theme
    {
      path: 'app/src/main/res/values/styles.xml',
      content: generateAppTheme()
    },

    // GitHub Actions workflow
    {
      path: '.github/workflows/build.yml',
      content: generateWorkflow(buildType)
    },
  ];
}

module.exports = { generateProjectFiles, generateWorkflow };
