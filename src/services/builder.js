// Generates all files needed for a Capacitor Android build
// Supports both APK (assembleRelease) and AAB (bundleRelease)

const { getFeaturesByIds } = require('../data/featureCatalog');

function generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions, targetSdk = '34', manifestExtras = []) {
  // Base permissions jo hamesha chahiye — INTERNET + storage (with maxSdkVersion guards)
  const BASE_PERMS = [
    { name: 'android.permission.INTERNET',              extra: '' },
    { name: 'android.permission.WRITE_EXTERNAL_STORAGE', extra: ' android:maxSdkVersion="28"' },
    { name: 'android.permission.READ_EXTERNAL_STORAGE',  extra: ' android:maxSdkVersion="32"' },
  ];

  // User permissions ko full form mein convert karo
  const userPerms = [...new Set(permissions)].map(p =>
    p.includes('.') ? p : `android.permission.${p}`
  );

  // Base permission names — inhe user list se hata do taaki duplicate na ho
  const basePermNames = BASE_PERMS.map(b => b.name);
  const extraPerms = userPerms.filter(p => !basePermNames.includes(p));

  // Sab lines banao
  const permLines = [
    ...BASE_PERMS.map(b => `    <uses-permission android:name="${b.name}"${b.extra} />`),
    ...extraPerms.map(p => `    <uses-permission android:name="${p}" />`),
  ].join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${permLines}

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
${manifestExtras.length ? '\n' + manifestExtras.join('\n') + '\n' : ''}
    </application>

</manifest>`;
}

function generateBuildGradle(packageName, versionCode, versionName, minSdk, targetSdk = '34', extraDependencies = []) {
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
${extraDependencies.length ? extraDependencies.map(d => `    ${d}`).join('\n') + '\n' : ''}}`;
}

function generateMainActivity(packageName, permissions = [], features = [], appName = 'App') {
  // Folder path ke liye safe app name (spaces allowed, lekin path-breaking characters hata do)
  const safeAppFolder = String(appName).replace(/[\\/:*?"<>|]/g, '').trim() || 'App';
  // ─── Feature injections — sab features se code collect karo ─────
  const extraImports = [...new Set(features.flatMap(f => f.javaImports || []))];
  const extraFields   = features.flatMap(f => f.javaFields || []);
  const extraOnCreateBlocks = features.flatMap(f => f.javaOnCreateCode || []);
  const extraMethods  = features.flatMap(f => f.javaMethods || []);
  // Agar multiple features onBackPressed ke "else" branch ko override karna chahein,
  // pehla wala jeetega — is se conflict clearly resolve ho jaata hai
  const backPressedOverride = features.map(f => f.backPressedElse).find(Boolean) || null;
  const skipDefaultLoadUrl  = features.some(f => f.skipDefaultLoadUrl === true);

  const extraImportsBlock = extraImports.length ? '\n' + extraImports.join('\n') : '';
  const extraFieldsBlock  = extraFields.length ? '\n' + extraFields.map(f => '    ' + f).join('\n') : '';
  const extraOnCreateBlock = extraOnCreateBlocks.length ? '\n' + extraOnCreateBlocks.join('\n\n') + '\n' : '';
  const extraMethodsBlock = extraMethods.length ? '\n' + extraMethods.join('\n\n') + '\n' : '';
  const backPressedElseCode = backPressedOverride || 'super.onBackPressed();';
  // Default loadUrl call — skip agar koi feature (jaise biometric lock) khud loadUrl call karta hai
  const finalLoadUrlLine = skipDefaultLoadUrl
    ? ''
    : '\n        webView.loadUrl("file:///android_asset/www/index.html");';

  // Sirf runtime (dangerous) permissions filter karo
  const RUNTIME_PERMS = [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_CALL_LOG',
    'android.permission.CALL_PHONE',
    'android.permission.SEND_SMS',
    'android.permission.RECEIVE_SMS',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.NFC',
    'android.permission.BODY_SENSORS',
    'android.permission.ACTIVITY_RECOGNITION',
  ];

  // User permissions ko full form mein convert karo
  const fullPerms = (permissions || []).map(p =>
    p.includes('.') ? p : 'android.permission.' + p
  );

  // Sirf dangerous runtime permissions filter karo
  const runtimeNeeded = fullPerms.filter(p => RUNTIME_PERMS.includes(p));

  // Java Manifest.permission.XXX constants banao
  const permConstants = runtimeNeeded.map(p =>
    'android.Manifest.permission.' + p.replace('android.permission.', '')
  );

  // Java String array literal banao
  const permArrayItems = permConstants.map(c => '\n            ' + c).join(',');
  const permArrayLiteral = permConstants.length > 0
    ? 'new String[]{' + permArrayItems + '\n        }'
    : 'new String[]{}';

  const hasRuntimePerms = permConstants.length > 0;

  // Permission request in onCreate
  const permRequestBlock = hasRuntimePerms
    ? '\n        // Runtime permissions — 1st open pe maango\n        requestAppPermissions();\n'
    : '';

  // Permission methods
  const permMethodBlock = hasRuntimePerms ? `
    private static final int PERM_REQUEST_CODE = 1001;

    private void requestAppPermissions() {
        String[] required = ${permArrayLiteral};
        java.util.List<String> toRequest = new java.util.ArrayList<>();
        for (String perm : required) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, perm)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                toRequest.add(perm);
            }
        }
        if (!toRequest.isEmpty()) {
            androidx.core.app.ActivityCompat.requestPermissions(
                this, toRequest.toArray(new String[0]), PERM_REQUEST_CODE
            );
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_REQUEST_CODE && webView != null) {
            // POST_NOTIFICATIONS ke alawa koi permission thi tabhi reload karo —
            // notification permission ka WebView content se koi lena dena nahi, reload se
            // agar us waqt media/audio chal raha ho to woh interrupt ho jaata
            boolean needsReload = false;
            for (String p : permissions) {
                if (!p.equals(android.Manifest.permission.POST_NOTIFICATIONS)) {
                    needsReload = true;
                    break;
                }
            }
            if (needsReload) webView.reload();
        }
    }
` : '';

  return `package ${packageName};

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
${extraImportsBlock}
public class MainActivity extends AppCompatActivity {
    private WebView webView;${extraFieldsBlock}

    // File chooser (gallery/camera picker) ke liye
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        // Chrome se "chrome://inspect" khol ke phone ko USB se connect karo — WebView ke
        // console errors/logs seedhe dekh sakte ho. Debugging ke baad chaho to yeh line hata sakte ho.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
${permRequestBlock}
        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString());

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {

            // WebView permission requests (camera/mic in-browser)
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            // ── File chooser — gallery/camera picker ──────────────────────
            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                // Pehle se pending callback cancel karo
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                boolean captureEnabled = fileChooserParams.isCaptureEnabled();

                Intent intent;
                if (captureEnabled) {
                    // Camera se directly photo lene ke liye
                    intent = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                } else {
                    // Gallery / file picker
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    if (acceptTypes != null && acceptTypes.length > 0 && !acceptTypes[0].isEmpty()) {
                        intent.setType(acceptTypes[0]);
                    } else {
                        intent.setType("*/*");
                    }
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    // Multiple select support
                    if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                }

                try {
                    startActivityForResult(
                        Intent.createChooser(intent, "Select File"),
                        FILE_CHOOSER_REQUEST_CODE
                    );
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    Toast.makeText(getApplicationContext(),
                        "File picker error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            // Website ki JS console errors Logcat mein bhejta hai — "adb logcat" mein
            // "NexDroidWeb" tag search karke dekha ja sakta hai (jaise AndroidMedia call fail ho to yahin dikhega)
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                android.util.Log.d("NexDroidWeb", cm.message() + " -- From line "
                    + cm.lineNumber() + " of " + cm.sourceId());
                return true;
            }
        });

        // ── Download Listener — HTTP/HTTPS + blob URL dono handle karo ────
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    // Blob/data URL — JavaScript se download trigger karo
                    String js =
                        "javascript:(function(){" +
                        "var x=document.createElement('a');" +
                        "x.href='" + url.replace("'", "\'") + "';" +
                        "x.download='';" +
                        "document.body.appendChild(x);" +
                        "x.click();" +
                        "document.body.removeChild(x);" +
                        "})()";
                    webView.loadUrl(js);
                    // Blob URL ke liye JS bridge inject karo
                    webView.evaluateJavascript(
                        "(function(){" +
                        "if(window._blobDownloadPatched)return;" +
                        "window._blobDownloadPatched=true;" +
                        "var origCreate=URL.createObjectURL.bind(URL);" +
                        "window._blobUrls={};" +
                        "URL.createObjectURL=function(b){" +
                        "  var u=origCreate(b);" +
                        "  window._blobUrls[u]=b;" +
                        "  return u;" +
                        "};" +
                        "})()", null);
                    Toast.makeText(getApplicationContext(),
                        "File download ho rha hai...", Toast.LENGTH_SHORT).show();
                    return;
                }

                // Normal HTTP/HTTPS download
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                if (!fileName.contains(".")) {
                    String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                    if (ext != null && !ext.isEmpty()) fileName = fileName + "." + ext;
                }
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("cookie", cookies);
                request.addRequestHeader("User-Agent", userAgent);
                request.setDescription("Downloading file...");
                request.setTitle(fileName);
                request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS, "${safeAppFolder}/" + fileName);
                request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(request);
                Toast.makeText(getApplicationContext(),
                    "Downloading: " + fileName, Toast.LENGTH_SHORT).show();

            } catch (Exception e) {
                Toast.makeText(getApplicationContext(),
                    "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

${extraOnCreateBlock}${finalLoadUrlLine}
    }

    // ── File chooser result handle karo ───────────────────────────────────
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    // Multiple files
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    // Single file
                    results = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }
${permMethodBlock}${extraMethodsBlock}
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            ${backPressedElseCode}
        }
    }
}`;
}

function generateActivityLayout() {
  return `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:fitsSystemWindows="true">

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

// ─── Feature JS Injection ─────────────────────────────────
// jsSnippet wale kisi bhi feature ka snippet seedha HTML mein </body> se pehle daal do
// (chaahe woh pure html_js feature ho jaise offline banner, ya java-type feature jise
// extra web-side JS bhi chahiye ho jaise background_media_playback)
function injectFeatureScripts(htmlCode, features) {
  const jsFeatures = features.filter(f => f.jsSnippet);
  if (!jsFeatures.length) return htmlCode;
  const combined = jsFeatures.map(f => f.jsSnippet).join('\n');
  return htmlCode.replace(/<\/body>/i, `${combined}\n</body>`);
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
    featureIds  = [],
  } = config;

  const pkgPath = packageName.replace(/\./g, '/');

  // ── Feature catalog resolve karo ──────────────────────────
  const resolvedFeatures  = getFeaturesByIds(featureIds);
  const featurePermissions = resolvedFeatures.flatMap(f => f.permissions || []);
  const featureGradleDeps  = resolvedFeatures.flatMap(f => f.gradleDependencies || []);
  const featureManifestExtras = resolvedFeatures.flatMap(f => f.manifestExtras || []);
  // User ke manually selected permissions + features se aayi permissions — dono merge
  const allPermissions = [...new Set([...(permissions || []), ...featurePermissions])];

  // Inject AdMob + feature JS (offline banner, pull-to-refresh, etc.) into HTML
  let finalHtmlCode = admob && admob.enabled ? injectAdmob(htmlCode, admob) : htmlCode;
  finalHtmlCode = injectFeatureScripts(finalHtmlCode, resolvedFeatures);

  return [
    // HTML app source (with AdMob + feature JS injected)
    { path: 'app/src/main/assets/www/index.html', content: finalHtmlCode },

    // AndroidManifest — feature permissions + manifest extras merged in
    {
      path: 'app/src/main/AndroidManifest.xml',
      content: generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, allPermissions, targetSdk, featureManifestExtras)
    },

    // app/build.gradle — feature gradle dependencies merged in
    {
      path: 'app/build.gradle',
      content: generateBuildGradle(packageName, versionCode, versionName, minSdk, targetSdk, featureGradleDeps)
    },

    // Root build.gradle
    { path: 'build.gradle', content: generateRootGradle() },

    // settings.gradle
    { path: 'settings.gradle', content: generateSettingsGradle(appName) },

    // gradle.properties — AndroidX + performance flags (REQUIRED)
    { path: 'gradle.properties', content: generateGradleProperties() },

    // Gradle wrapper properties (JAR is generated in CI via `gradle wrapper`)
    { path: 'gradle/wrapper/gradle-wrapper.properties', content: generateGradleWrapper() },

    // MainActivity.java — feature imports/fields/methods/back-press overrides injected
    {
      path: `app/src/main/java/${pkgPath}/MainActivity.java`,
      content: generateMainActivity(packageName, allPermissions, resolvedFeatures, appName)
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

    // Feature-contributed extra Java files (e.g. MediaPlaybackService.java for background media playback)
    ...resolvedFeatures.flatMap(f => (f.extraJavaFiles || []).map(jf => ({
      path: `app/src/main/java/${pkgPath}/${jf.fileName}`,
      content: jf.contentTemplate(packageName)
    }))),
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

module.exports = { generateProjectFiles, generateWorkflow, injectAdmob, injectFeatureScripts, generateFilePaths };
