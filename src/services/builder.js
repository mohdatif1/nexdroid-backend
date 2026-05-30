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
    // AAB support — splits enabled by default for bundles
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

function generateGradlewScript() {
  return `#!/usr/bin/env sh

##############################################################################
##
##  Gradle start up script for UN*X
##
##############################################################################

# Attempt to set APP_HOME
# Resolve links: $0 may be a link
PRG="$0"
while [ -h "$PRG" ] ; do
  ls=\`ls -ld "$PRG"\`
  link=\`expr "$ls" : '.*-> \\(.*\\)$'\`
  if expr "$link" : '/.*' > /dev/null; then
    PRG="$link"
  else
    PRG=\`dirname "$PRG"\`"/$link"
  fi
done
SAVED="\`pwd\`"
cd "\`dirname \\"$PRG\\"\`/" >/dev/null
APP_HOME="\`pwd -P\`"
cd "$SAVED" >/dev/null

APP_NAME="Gradle"
APP_BASE_NAME=\`basename "$0"\`

# Add default JVM options here. You can also use JAVA_OPTS and GRADLE_OPTS to pass JVM options to this script.
DEFAULT_JVM_OPTS='"-Xmx64m" "-Xms64m"'

# Use the maximum available, or set MAX_FD != -1 to use that value.
MAX_FD="maximum"

warn () {
  echo "$*"
}

die () {
  echo
  echo "$*"
  echo
  exit 1
}

# OS specific support (must be 'true' or 'false').
cygwin=false
msys=false
darwin=false
nonstop=false
case "\`uname\`" in
  CYGWIN* )
    cygwin=true
    ;;
  Darwin* )
    darwin=true
    ;;
  MINGW* )
    msys=true
    ;;
  NONSTOP* )
    nonstop=true
    ;;
esac

CLASSPATH=\$APP_HOME/gradle/wrapper/gradle-wrapper.jar

# Determine the Java command to use to start the JVM.
if [ -n "$JAVA_HOME" ] ; then
  if [ -x "$JAVA_HOME/jre/sh/java" ] ; then
    JAVACMD="$JAVA_HOME/jre/sh/java"
  else
    JAVACMD="$JAVA_HOME/bin/java"
  fi
  if [ ! -x "$JAVACMD" ] ; then
    die "ERROR: JAVA_HOME is set to an invalid directory: $JAVA_HOME

Please set the JAVA_HOME variable in your environment to match the
location of your Java installation."
  fi
else
  JAVACMD="java"
  which java >/dev/null 2>&1 || die "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH."
fi

# Increase the maximum file descriptors if we can.
if [ "$cygwin" = "false" -a "$darwin" = "false" -a "$nonstop" = "false" ] ; then
  MAX_FD_LIMIT=\`ulimit -H -n\`
  if [ $? -eq 0 ] ; then
    if [ "$MAX_FD" = "maximum" -o "$MAX_FD" = "max" ] ; then
      MAX_FD="$MAX_FD_LIMIT"
    fi
    ulimit -n $MAX_FD
    if [ $? -ne 0 ] ; then
      warn "Could not set maximum file descriptor limit: $MAX_FD"
    fi
  else
    warn "Could not query maximum file descriptor limit: $MAX_FD_LIMIT"
  fi
fi

# For Darwin, add options to specify how the application appears in the dock
if $darwin; then
  GRADLE_OPTS="$GRADLE_OPTS \\"-Xdock:name=$APP_NAME\\" \\"-Xdock:icon=$APP_HOME/media/gradle.icns\\""
fi

# For Cygwin or MSYS, switch paths to Windows format before running java
if [ "$cygwin" = "true" -o "$msys" = "true" ] ; then
  APP_HOME=\`cygpath --path --mixed "$APP_HOME"\`
  CLASSPATH=\`cygpath --path --mixed "$CLASSPATH"\`
  JAVACMD=\`cygpath --unix "$JAVACMD"\`
fi

# Escape application args
save () {
  for i do printf %s\\\\n "$i" | sed "s/'/'\\\\\\\\''/g;1s/^/'/;\$s/\$/' \\\\\\\\/" ; done
  echo " "
}
APP_ARGS=\`save "$@"\`

# Collect all arguments for the java command, following the shell quoting and substitution rules
eval set -- $DEFAULT_JVM_OPTS \$JAVA_OPTS \$GRADLE_OPTS "\\"-Dorg.gradle.appname=$APP_BASE_NAME\\"" -classpath "\\"$CLASSPATH\\"" org.gradle.wrapper.GradleWrapperMain "$APP_ARGS"

exec "$JAVACMD" "$@"
`;
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
    timeout-minutes: 15

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
          ls -la gradlew gradle/wrapper/

      - name: Decode Keystore
        env:
          KEYSTORE_BASE64: \${{ secrets.KEYSTORE_BASE64 }}
        run: |
          echo "\$KEYSTORE_BASE64" | base64 --decode > release.keystore
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
          retention-days: 1
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

    // AndroidManifest — with all auto-detected + manually selected permissions
    {
      path: 'app/src/main/AndroidManifest.xml',
      content: generateAndroidManifest(appName, packageName, versionCode, versionName, minSdk, orientation, permissions)
    },

    // app/build.gradle — with bundle{} block for AAB support
    {
      path: 'app/build.gradle',
      content: generateBuildGradle(packageName, versionCode, versionName, minSdk)
    },

    // Root build.gradle
    { path: 'build.gradle', content: generateRootGradle() },

    // settings.gradle
    { path: 'settings.gradle', content: generateSettingsGradle(appName) },

    // Gradle wrapper
    { path: 'gradle/wrapper/gradle-wrapper.properties', content: generateGradleWrapper() },

    // gradlew script (must be executable — GitHub Actions needs this)
    { path: 'gradlew', content: generateGradlewScript(), executable: true },

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

    // GitHub Actions workflow — APK or AAB based on buildType
    {
      path: '.github/workflows/build.yml',
      content: generateWorkflow(buildType)
    },
  ];
}

module.exports = { generateProjectFiles, generateWorkflow };
