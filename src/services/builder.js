// Generates all files needed for a Capacitor Android build
// Supports both APK (assembleRelease) and AAB (bundleRelease)

function generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions, targetSdk = '34') {
  // Deduplicate permissions
  const uniquePerms = [...new Set(permissions)];
  const permLines = uniquePerms
    .map(p => {
      // Support full permission name (android.permission.X) or short (X)
      const fullPerm = p.includes('.') ? p : `android.permission.${p}`;
      return `    <uses-permission android:name="${fullPerm}" />`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageName}"
    android:versionCode="${versionCode}"
    android:versionName="${versionName}">

    <uses-sdk
        android:minSdkVersion="${minSdk}"
        android:targetSdkVersion="${targetSdk}" />

${permLines ? permLines + '\n' : ''}
    <!-- Download ke liye required permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />

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

        <!-- FileProvider — Android 10+ pe downloads ke liye -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${packageName}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

    </application>

</manifest>`;
}

function generateBuildGradle(packageName, versionCode, versionName, minSdk, targetSdk = '34') {
  const compileSdk = Math.max(parseInt(targetSdk) || 34, 34);
  return `apply plugin: 'com.android.application'

android {
    namespace "${packageName}"
    compileSdkVersion ${compileSdk}
    defaultConfig {
        applicationId "${packageName}"
        minSdkVersion ${minSdk}
        targetSdkVersion ${parseInt(targetSdk) || 34}
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

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
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
        settings.setUserAgentString(settings.getUserAgentString());

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // ── Download Listener — har type ki file support ──────────────────
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                // File name nikalo — original extension preserve karo
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

                // Agar extension nahi mili toh mimeType se dhundho
                if (!fileName.contains(".")) {
                    String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                    if (ext != null && !ext.isEmpty()) {
                        fileName = fileName + "." + ext;
                    }
                }

                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);

                // Cookies add karo (authenticated downloads ke liye)
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) {
                    request.addRequestHeader("cookie", cookies);
                }
                request.addRequestHeader("User-Agent", userAgent);

                request.setDescription("Downloading file...");
                request.setTitle(fileName);

                // Downloads folder mein save karo (file manager mein dikhega)
                request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS, fileName
                );

                // Download complete hone pe notification dikhao
                request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                );

                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(request);

                Toast.makeText(
                    getApplicationContext(),
                    "Downloading: " + fileName,
                    Toast.LENGTH_SHORT
                ).show();

            } catch (Exception e) {
                Toast.makeText(
                    getApplicationContext(),
                    "Download failed: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show();
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
        maven { url 'https://maven.google.com' }
        maven { url 'https://jitpack.io' }
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        maven { url 'https://maven.google.com' }
        maven { url 'https://jitpack.io' }
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
org.gradle.caching=true
org.gradle.daemon=false
systemProp.http.connectionTimeout=120000
systemProp.http.socketTimeout=120000
systemProp.https.connectionTimeout=120000
systemProp.https.socketTimeout=120000`;
}

function generateSettingsGradle(appName) {
  return `rootProject.name = "${appName}"
include ':app'`;
}

// ─── Generate GitHub Actions workflow ────────────────────
// buildType: 'apk' | 'aab'
// keystoreConfig: { alias, storePassword, keyPassword, cn, org, country }
// keystoreConfig now also accepts keystoreBase64 (pre-generated, stored in Firestore)
function generateWorkflow(buildType = 'apk', keystoreConfig = {}) {
  const isAAB = buildType === 'aab';
  const gradleTask   = isAAB ? 'bundleRelease'   : 'assembleRelease';
  const artifactName = isAAB ? 'release-aab'     : 'release-apk';
  const outputPath   = isAAB
    ? 'app/build/outputs/bundle/release/app-release.aab'
    : 'app/build/outputs/apk/release/app-release.apk';
  const fileExt = isAAB ? 'aab' : 'apk';

  const ksAlias        = (keystoreConfig.alias         || 'release').replace(/'/g, '');
  const ksStorePass    = (keystoreConfig.storePassword || '').replace(/'/g, '');
  const ksKeyPass      = (keystoreConfig.keyPassword   || '').replace(/'/g, '');
  const ksCN           = (keystoreConfig.cn            || 'Unknown').replace(/'/g, '');
  const ksOrg          = (keystoreConfig.org           || 'Unknown').replace(/'/g, '');
  const ksCountry      = (keystoreConfig.country       || 'IN').replace(/'/g, '');
  const keystoreBase64 = keystoreConfig.keystoreBase64 || '';

  // Existing keystore: restore from base64 | New app: generate + upload as artifact
  const keystoreStep = keystoreBase64
    ? `      - name: Restore Keystore
        run: |
          echo '${keystoreBase64}' | base64 -d > release.keystore
          echo "Keystore restored from saved copy"
          ls -lh release.keystore`
    : `      - name: Generate Keystore
        run: |
          keytool -genkey -v -keystore release.keystore -alias '${ksAlias}' -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS -storepass '${ksStorePass}' -keypass '${ksKeyPass}' -dname "CN=${ksCN}, O=${ksOrg}, L=Unknown, ST=Unknown, C=${ksCountry}"
          echo "Keystore generated"
          ls -lh release.keystore

      - name: Upload Keystore Artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-keystore
          path: release.keystore
          retention-days: 30`;

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

      - name: Configure Gradle network settings
        run: |
          mkdir -p ~/.gradle
          cat >> ~/.gradle/gradle.properties << 'EOF'
          systemProp.http.connectionTimeout=120000
          systemProp.http.socketTimeout=120000
          systemProp.https.connectionTimeout=120000
          systemProp.https.socketTimeout=120000
          org.gradle.daemon=false
          EOF

${keystoreStep}

      - name: Build Signed ${isAAB ? 'AAB (App Bundle)' : 'APK'}
        env:
          KEYSTORE_PATH: \${{ github.workspace }}/release.keystore
          KEYSTORE_PASSWORD: '${ksStorePass}'
          KEY_ALIAS: '${ksAlias}'
          KEY_PASSWORD: '${ksKeyPass}'
        run: |
          ./gradlew ${gradleTask} --no-daemon --stacktrace --max-workers=2 \
            || (echo "Retrying build..." && sleep 15 && ./gradlew ${gradleTask} --no-daemon --stacktrace --max-workers=2)
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

// ─── Icon helper ─────────────────────────────────────────
// iconBase64: pure base64 string of PNG (no data: prefix)
// Returns array of {path, content, encoding} for all mipmap densities
function generateIconFiles(iconBase64) {
  if (!iconBase64) return [];

  // Strip data URI prefix if present
  const base64 = iconBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  // Android mipmap density folders and their icon sizes
  const densities = [
    { folder: 'mipmap-mdpi',    size: 48  },
    { folder: 'mipmap-hdpi',    size: 72  },
    { folder: 'mipmap-xhdpi',   size: 96  },
    { folder: 'mipmap-xxhdpi',  size: 144 },
    { folder: 'mipmap-xxxhdpi', size: 192 },
  ];

  const files = [];
  for (const { folder } of densities) {
    // Same icon for all densities (GitHub Actions will use as-is)
    files.push({
      path: `app/src/main/res/${folder}/ic_launcher.png`,
      content: base64,
      encoding: 'base64',
    });
    files.push({
      path: `app/src/main/res/${folder}/ic_launcher_round.png`,
      content: base64,
      encoding: 'base64',
    });
  }
  return files;
}


// ─── AdMob Injection ─────────────────────────────────────
// Injects AdMob SDK + ad unit into the HTML content
function injectAdmob(htmlCode, admob) {
  if (!admob || !admob.enabled || !admob.appId) return htmlCode;

  const position  = admob.position  || 'bottom';
  const bannerId  = admob.bannerId  || '';
  const interId   = admob.interId   || '';

  // AdMob meta tag for app ID
  const metaTag = `<meta name="admob-app-id" content="${admob.appId}">`;

  // Banner ad HTML
  const bannerStyle = position === 'top'
    ? 'position:fixed;top:0;left:0;width:100%;z-index:9999;'
    : 'position:fixed;bottom:0;left:0;width:100%;z-index:9999;';

  const bannerHtml = bannerId ? `
  <!-- AdMob Banner Ad -->
  <div id="admob-banner" style="${bannerStyle}background:#f1f1f1;min-height:50px;display:flex;align-items:center;justify-content:center;">
    <ins class="adsbygoogle"
      style="display:inline-block;width:320px;height:50px"
      data-ad-client="${admob.appId}"
      data-ad-slot="${bannerId.split('/').pop()}"></ins>
  </div>` : '';

  // Body padding so content is not hidden behind banner
  const bodyPadding = position === 'top'
    ? 'body { padding-top: 60px !important; }'
    : 'body { padding-bottom: 60px !important; }';

  // Interstitial JS
  const interJs = interId ? `
  <script>
    // AdMob Interstitial
    var admobInterstitialId = '${interId}';
    var admobInterCount = 0;
    function checkAdmobInter() {
      admobInterCount++;
      if (admobInterCount % 5 === 0 && window.admob) {
        try { window.admob.showInterstitial(); } catch(e) {}
      }
    }
    document.addEventListener('click', checkAdmobInter);
  </script>` : '';

  // Inject into HTML
  let result = htmlCode;

  // Add meta tag in <head>
  result = result.replace(/<head>/i, `<head>
  ${metaTag}`);

  // Add body padding style
  result = result.replace(/<\/head>/i, `  <style>${bodyPadding}</style>
</head>`);

  // Add banner before </body>
  result = result.replace(/<\/body>/i, `${bannerHtml}${interJs}
</body>`);

  return result;
}

// ─── Build full project file list ────────────────────────
function generateProjectFiles(config, htmlCode) {
  const {
    appName, packageName, versionCode, versionName,
    minSdk      = '23',
    targetSdk   = '34',
    orientation, permissions,
    buildType   = 'apk',
    iconBase64  = null,
    keystoreConfig = {},
    admob       = null,
  } = config;

  const pkgPath = packageName.replace(/\./g, '/');

  // Inject AdMob into HTML if configured
  const finalHtmlCode = admob && admob.enabled ? injectAdmob(htmlCode, admob) : htmlCode;

  return [
    // HTML app source (with optional AdMob injection)
    { path: 'app/src/main/assets/www/index.html', content: finalHtmlCode },

    // AndroidManifest
    {
      path: 'app/src/main/AndroidManifest.xml',
      content: generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions, targetSdk)
    },

    // app/build.gradle
    {
      path: 'app/build.gradle',
      content: generateBuildGradle(packageName, versionCode, versionName, minSdk, targetSdk)
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

    // FileProvider paths — downloads ke liye
    {
      path: 'app/src/main/res/xml/file_paths.xml',
      content: generateFilePaths()
    },

    // App theme
    {
      path: 'app/src/main/res/values/styles.xml',
      content: generateAppTheme()
    },

    // GitHub Actions workflow
    {
      path: '.github/workflows/build.yml',
      content: generateWorkflow(buildType, keystoreConfig)
    },

    // App icon — all mipmap densities
    // If no icon provided, a default placeholder is used so build never fails
    ...generateIconFiles(iconBase64 || _defaultIconBase64()),
  ];
}

// Minimal valid PNG (48x48 blue square) as fallback icon
function _defaultIconBase64() {
  // Blue #3b7eff 48x48 PNG
  return 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQUlEQVR4nO3OQQ0AIAwAsfnCG9bBBcejSQV01j5fmXwgJCQkVA+EhISE6oGQkJBQPRASEhKqB0JCQkL1QEhI6LELyaR44svvHicAAAAASUVORK5CYII=';
}

function generateFilePaths() {
  return `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <!-- Downloads folder — har type ki file yahan save hogi -->
    <external-path name="downloads" path="Download/" />
    <external-files-path name="external_files" path="." />
    <files-path name="files" path="." />
    <cache-path name="cache" path="." />
    <external-cache-path name="external_cache" path="." />
</paths>`;
}

module.exports = { generateProjectFiles, generateWorkflow, injectAdmob, generateFilePaths };
