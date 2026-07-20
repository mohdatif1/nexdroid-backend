// ─── FEATURE CATALOG ───────────────────────────────────────
// Har feature ek "capability block" hai — jab user search karke
// isko "Add" karega, uska ID build config mein save hoga aur
// builder.js build time pe iski permissions/dependencies/code
// automatically inject kar dega. Koi bhi cheez "internet se search"
// nahi hoti — yeh sab pre-tested catalog entries hain.
//
// injectionType:
//   'java'    → MainActivity.java mein imports/fields/methods inject honge
//   'html_js' → HTML/JS layer mein inject hoga (webview reload karne ki zaroorat nahi)
//   'config'  → sirf ek config flag set karta hai (manifest attribute jaisa)

const FEATURE_CATALOG = [
  {
    id: 'exit_confirm',
    name: 'Exit Confirmation Dialog',
    category: 'Navigation',
    keywords: ['back button', 'exit dialog', 'confirm exit', 'double back', 'back navigation', 'close app'],
    description: 'Back button dabane par "Are you sure you want to exit?" dialog dikhata hai, jab WebView history mein peeche jaane ke liye kuch na ho.',
    permissions: [],
    gradleDependencies: [],
    manifestExtras: [],
    javaImports: ['import androidx.appcompat.app.AlertDialog;'],
    javaFields: [],
    javaOnCreateCode: [],
    javaMethods: [],
    // onBackPressed() ke "else" branch (jab webView.canGoBack() false ho) ko override karta hai
    backPressedElse:
`new AlertDialog.Builder(this)
                .setTitle("Exit App")
                .setMessage("Are you sure you want to exit?")
                .setPositiveButton("Yes", (dialog, which) -> finish())
                .setNegativeButton("No", null)
                .show();`
  },

  {
    id: 'offline_banner',
    name: 'Offline Detection Banner',
    category: 'UX',
    keywords: ['offline', 'no internet', 'network banner', 'connection lost', 'internet check'],
    description: 'Internet chala jaye to top pe ek red banner dikhata hai aur wapas aane par apne aap hide + page reload karta hai. Pure JS — koi native dependency nahi.',
    permissions: [],
    gradleDependencies: [],
    manifestExtras: [],
    injectionType: 'html_js',
    jsSnippet:
`<style>
#nd-offline-banner{position:fixed;top:0;left:0;right:0;z-index:99999;background:#f04438;color:#fff;
text-align:center;padding:8px 12px;font:600 13px sans-serif;display:none;}
</style>
<div id="nd-offline-banner">No internet connection</div>
<script>
(function(){
  var b = document.getElementById('nd-offline-banner');
  function update(){
    if(!navigator.onLine){ b.style.display='block'; }
    else { b.style.display='none'; }
  }
  window.addEventListener('online', function(){ update(); setTimeout(function(){location.reload();}, 400); });
  window.addEventListener('offline', update);
  update();
})();
</script>`
  },

  {
    id: 'pull_to_refresh',
    name: 'Pull to Refresh',
    category: 'UX',
    keywords: ['pull to refresh', 'swipe refresh', 'reload page', 'swipe down reload'],
    description: 'Page ko upar se neeche swipe karke reload karne ki facility deta hai — jaise Twitter/Instagram feed. Pure JS gesture-based, koi native library nahi.',
    permissions: [],
    gradleDependencies: [],
    manifestExtras: [],
    injectionType: 'html_js',
    jsSnippet:
`<script>
(function(){
  var startY = 0, pulling = false;
  document.addEventListener('touchstart', function(e){
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, {passive:true});
  document.addEventListener('touchmove', function(e){
    if (!pulling) return;
    var diff = e.touches[0].clientY - startY;
    if (diff > 120) { pulling = false; location.reload(); }
  }, {passive:true});
  document.addEventListener('touchend', function(){ pulling = false; }, {passive:true});
})();
</script>`
  },

  {
    id: 'haptic_feedback',
    name: 'Haptic / Vibration Feedback',
    category: 'Interaction',
    keywords: ['vibration', 'haptic', 'vibrate', 'feedback on tap'],
    description: 'Web page se native vibration trigger karne ki facility deta hai (Android.vibrate(200) JS se call karo).',
    permissions: ['android.permission.VIBRATE'],
    gradleDependencies: [],
    manifestExtras: [],
    javaImports: [
      'import android.os.Vibrator;',
      'import android.os.VibrationEffect;',
      'import android.webkit.JavascriptInterface;'
    ],
    javaFields: [],
    javaOnCreateCode: [
      'webView.addJavascriptInterface(new HapticBridge(this), "AndroidHaptics");'
    ],
    javaMethods: [
`    public static class HapticBridge {
        private final Context ctx;
        HapticBridge(Context ctx) { this.ctx = ctx; }
        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        }
    }`
    ]
  },

  {
    id: 'native_share',
    name: 'Native Share Sheet',
    category: 'Interaction',
    keywords: ['share', 'share intent', 'share button', 'share text', 'share link'],
    description: 'Web page se Android ka native share sheet open karne deta hai (Android.shareText("...") JS se call karo).',
    permissions: [],
    gradleDependencies: [],
    manifestExtras: [],
    javaImports: [
      'import android.content.Intent;',
      'import android.webkit.JavascriptInterface;'
    ],
    javaFields: [],
    javaOnCreateCode: [
      'webView.addJavascriptInterface(new ShareBridge(this), "AndroidShare");'
    ],
    javaMethods: [
`    public static class ShareBridge {
        private final Activity activity;
        ShareBridge(Activity activity) { this.activity = activity; }
        @JavascriptInterface
        public void shareText(String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            activity.startActivity(Intent.createChooser(send, "Share via"));
        }
    }`
    ]
  },

  {
    id: 'qr_scanner',
    name: 'QR / Barcode Scanner',
    category: 'Camera',
    keywords: ['qr code', 'barcode', 'scanner', 'scan qr', 'camera scan'],
    description: 'Camera se QR/barcode scan karke result JS ko wapas bhejta hai (Android.scanQRCode() call karo, result window.onQRResult(text) mein milega).',
    permissions: ['android.permission.CAMERA'],
    gradleDependencies: [
      "implementation 'com.journeyapps:zxing-android-embedded:4.3.0'"
    ],
    manifestExtras: [],
    javaImports: [
      'import android.webkit.JavascriptInterface;',
      'import com.journeyapps.barcodescanner.ScanContract;',
      'import com.journeyapps.barcodescanner.ScanOptions;',
      'import androidx.activity.result.ActivityResultLauncher;'
    ],
    javaFields: [
      'private ActivityResultLauncher<ScanOptions> qrLauncher;'
    ],
    javaOnCreateCode: [
`        qrLauncher = registerForActivityResult(new ScanContract(), result -> {
            if (result.getContents() != null && webView != null) {
                String safe = result.getContents().replace("\\\\", "\\\\\\\\").replace("'", "\\\\'");
                webView.evaluateJavascript("window.onQRResult && window.onQRResult('" + safe + "')", null);
            }
        });
        webView.addJavascriptInterface(new QRBridge(), "AndroidScanner");`
    ],
    javaMethods: [
`    public class QRBridge {
        @JavascriptInterface
        public void scanQRCode() {
            runOnUiThread(() -> {
                ScanOptions options = new ScanOptions();
                options.setBeepEnabled(true);
                options.setOrientationLocked(false);
                qrLauncher.launch(options);
            });
        }
    }`
    ]
  },

  {
    id: 'biometric_lock',
    name: 'Biometric App Lock',
    category: 'Security',
    keywords: ['biometric', 'fingerprint', 'face unlock', 'app lock', 'authentication'],
    description: 'App open hote hi fingerprint/face unlock maangta hai — tabhi WebView load hoga. Screen lock na set ho to fallback normal open ho jayega.',
    permissions: ['android.permission.USE_BIOMETRIC'],
    gradleDependencies: [
      "implementation 'androidx.biometric:biometric:1.1.0'"
    ],
    manifestExtras: [],
    javaImports: [
      'import androidx.biometric.BiometricPrompt;',
      'import androidx.biometric.BiometricManager;',
      'import androidx.core.content.ContextCompat;'
    ],
    javaFields: [],
    // Yeh webView.loadUrl(...) call se PEHLE inject hota hai — is liye
    // loadUrl ko biometric success callback ke andar move karna padta hai
    javaOnCreateCode: [
`        BiometricManager biometricManager = BiometricManager.from(this);
        if (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS) {
            BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        webView.loadUrl("file:///android_asset/www/index.html");
                    }
                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        webView.loadUrl("file:///android_asset/www/index.html");
                    }
                });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock App")
                .setSubtitle("Authenticate to continue")
                .setNegativeButtonText("Cancel")
                .build();
            prompt.authenticate(info);
        } else {
            webView.loadUrl("file:///android_asset/www/index.html");
        }
        return;`
    ],
    javaMethods: [],
    // Is feature ke active hone par default final loadUrl() call skip ho (upar wale block mein already ho chuka)
    skipDefaultLoadUrl: true
  },

  {
    id: 'in_app_update',
    name: 'In-App Update Prompt',
    category: 'Distribution',
    keywords: ['in app update', 'play store update', 'force update', 'update prompt', 'app update check'],
    description: 'Google Play Store pe naya version available hone par user ko update ka prompt dikhata hai (Play Core library).',
    permissions: [],
    gradleDependencies: [
      "implementation 'com.google.android.play:app-update:2.1.0'"
    ],
    manifestExtras: [],
    javaImports: [
      'import com.google.android.play.core.appupdate.AppUpdateManager;',
      'import com.google.android.play.core.appupdate.AppUpdateManagerFactory;',
      'import com.google.android.play.core.model.UpdateAvailability;'
    ],
    javaFields: [],
    javaOnCreateCode: [
`        AppUpdateManager appUpdateManager = AppUpdateManagerFactory.create(this);
        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
                Toast.makeText(getApplicationContext(), "Update available on Play Store", Toast.LENGTH_LONG).show();
            }
        });`
    ],
    javaMethods: []
  },

  {
    id: 'background_media_playback',
    name: 'Background Media Playback (Notification Controls)',
    category: 'Media',
    keywords: [
      'background music', 'background play', 'background audio', 'media notification',
      'notification controls', 'play pause next', 'music player', 'media session',
      'youtube music style', 'lock screen controls', 'audio player'
    ],
    description: 'YouTube Music jaisa — audio/video app minimize hone ya screen off hone ke baad bhi bajta rehta hai, aur notification (lock screen samet) mein Play/Pause/Next/Previous controls dikhte hain. Enable karte hi background-running (battery optimization exemption) bhi apne aap request ho jaata hai, taaki service beech mein na ruke. Web page ke play/pause/track-change JS events ko native notification se sync karta hai.',
    permissions: [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.WAKE_LOCK',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    ],
    gradleDependencies: [
      "implementation 'androidx.media:media:1.7.0'",
      "implementation 'androidx.localbroadcastmanager:localbroadcastmanager:1.1.0'"
    ],
    // <service> ko manifest ke <application> block ke andar register karna zaroori hai
    manifestExtras: [
`        <service
            android:name=".MediaPlaybackService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />`
    ],
    javaImports: [
      'import android.content.BroadcastReceiver;',
      'import android.content.IntentFilter;',
      'import androidx.localbroadcastmanager.content.LocalBroadcastManager;',
      'import android.webkit.JavascriptInterface;',
      'import android.os.PowerManager;',
      'import android.provider.Settings;'
    ],
    javaFields: [],
    javaOnCreateCode: [
`        // Background media feature ke saath "background running" bhi auto-enable —
        // OS ko batao yeh app battery optimization se exempt rahe taaki service kill na ho
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            String pkgName = getPackageName();
            if (pm != null && !pm.isIgnoringBatteryOptimizations(pkgName)) {
                Intent batteryIntent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                batteryIntent.setData(Uri.parse("package:" + pkgName));
                startActivity(batteryIntent);
            }
        } catch (Exception ignored) { }`,
`        // Web page se play/pause/track updates receive karke notification banata hai
        webView.addJavascriptInterface(new MediaBridge(MainActivity.this), "AndroidMedia");
        // Notification ke Play/Pause/Next/Previous taps ko wapas web page tak JS event ke through pahunchata hai
        BroadcastReceiver nexdroidMediaReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getStringExtra("action");
                if (action == null || webView == null) return;
                String jsAction =
                    action.endsWith("ACTION_PLAY")  ? "play"     :
                    action.endsWith("ACTION_PAUSE") ? "pause"    :
                    action.endsWith("ACTION_NEXT")  ? "next"     :
                    action.endsWith("ACTION_PREV")  ? "previous" : "";
                if (!jsAction.isEmpty()) {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('nexdroidMediaAction',{detail:'" + jsAction + "'}))", null);
                }
            }
        };
        LocalBroadcastManager.getInstance(this).registerReceiver(
            nexdroidMediaReceiver, new IntentFilter(MediaPlaybackService.ACTION_MEDIA_CONTROL));`
    ],
    javaMethods: [
`    // JS se call hota hai: AndroidMedia.notifyPlaying(title, artist) / notifyPaused(...) / stop()
    public static class MediaBridge {
        private final Activity activity;
        MediaBridge(Activity activity) { this.activity = activity; }

        // Website jitne bhi args ke saath call kare (title only, ya title+artist, ya kuch bhi nahi) —
        // sab overloads yahan handle hote hain taaki argument-count mismatch se silently fail na ho
        @JavascriptInterface
        public void notifyPlaying() { notifyPlaying("", ""); }

        @JavascriptInterface
        public void notifyPlaying(String title) { notifyPlaying(title, ""); }

        @JavascriptInterface
        public void notifyPlaying(String title, String artist) {
            sendUpdate(title, artist, true);
        }

        @JavascriptInterface
        public void notifyPaused() { notifyPaused("", ""); }

        @JavascriptInterface
        public void notifyPaused(String title) { notifyPaused(title, ""); }

        @JavascriptInterface
        public void notifyPaused(String title, String artist) {
            sendUpdate(title, artist, false);
        }

        @JavascriptInterface
        public void stop() {
            try {
                Intent i = new Intent(activity, MediaPlaybackService.class);
                i.setAction("STOP");
                activity.startService(i);
            } catch (Exception e) {
                showDebugToast("AndroidMedia.stop() error: " + e.getMessage());
            }
        }

        private void sendUpdate(String title, String artist, boolean isPlaying) {
            try {
                Intent i = new Intent(activity, MediaPlaybackService.class);
                i.setAction("UPDATE");
                i.putExtra("title", title == null ? "" : title);
                i.putExtra("artist", artist == null ? "" : artist);
                i.putExtra("isPlaying", isPlaying);
                if (android.os.Build.VERSION.SDK_INT >= 26) activity.startForegroundService(i);
                else activity.startService(i);
                // Debug ke liye — confirm karta hai ki website se call sahi tarike se pahuncha
                showDebugToast((isPlaying ? "▶ Playing: " : "⏸ Paused: ") + (title == null || title.isEmpty() ? "(no title)" : title));
            } catch (Exception e) {
                showDebugToast("AndroidMedia notify error: " + e.getMessage());
            }
        }

        private void showDebugToast(final String msg) {
            activity.runOnUiThread(() ->
                Toast.makeText(activity.getApplicationContext(), msg, Toast.LENGTH_SHORT).show());
        }
    }`
    ],
    // Yeh Service apni ek alag .java file hai — MainActivity.java ke andar nahi jaati
    extraJavaFiles: [
      {
        fileName: 'MediaPlaybackService.java',
        // packageName build time pe generateProjectFiles se inject hota hai
        contentTemplate: (packageName) => `package ${packageName};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

// Foreground service jo notification mein Play/Pause/Next/Previous controls dikhata hai
// aur unke taps ko MainActivity tak broadcast karta hai (jo aage web page ko bhejta hai)
public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "nexdroid_media_playback";
    public static final String ACTION_PLAY  = "${packageName}.ACTION_PLAY";
    public static final String ACTION_PAUSE = "${packageName}.ACTION_PAUSE";
    public static final String ACTION_NEXT  = "${packageName}.ACTION_NEXT";
    public static final String ACTION_PREV  = "${packageName}.ACTION_PREV";
    public static final String ACTION_MEDIA_CONTROL = "${packageName}.MEDIA_CONTROL";

    private MediaSessionCompat mediaSession;
    private String  curTitle  = "";
    private String  curArtist = "";
    private boolean isPlaying = false;

    @Override
    public void onCreate() {
        super.onCreate();
        mediaSession = new MediaSessionCompat(this, "NexdroidMediaSession");
        // Lock screen / Bluetooth headset / Android Auto ke controls isi callback se aate hain —
        // notification ke buttons se alag mechanism hai, isliye yeh zaroor chahiye
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()  { broadcastAction(ACTION_PLAY); }
            @Override public void onPause() { broadcastAction(ACTION_PAUSE); }
            @Override public void onSkipToNext()     { broadcastAction(ACTION_NEXT); }
            @Override public void onSkipToPrevious() { broadcastAction(ACTION_PREV); }
        });
        createChannel();
    }

    private void broadcastAction(String action) {
        Intent broadcast = new Intent(ACTION_MEDIA_CONTROL);
        broadcast.putExtra("action", action);
        LocalBroadcastManager.getInstance(this).sendBroadcast(broadcast);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Media Playback", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_NOT_STICKY;
        String action = intent.getAction();

        if ("UPDATE".equals(action)) {
            curTitle  = intent.getStringExtra("title");
            curArtist = intent.getStringExtra("artist");
            isPlaying = intent.getBooleanExtra("isPlaying", true);
            updateMediaSession();
            startForeground(1, buildNotification());
        } else if (ACTION_PLAY.equals(action) || ACTION_PAUSE.equals(action)
                || ACTION_NEXT.equals(action) || ACTION_PREV.equals(action)) {
            // Notification/lock-screen button dabaya gaya — MainActivity ko batao, woh web page ko forward karega
            broadcastAction(action);
        } else if ("STOP".equals(action)) {
            if (mediaSession != null) mediaSession.setActive(false);
            stopForeground(true);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    // MediaSession ko "active" state + metadata + playback-state deta hai —
    // isके bina lock screen controls ka dikhna guaranteed nahi hai, aur Android 14 pe
    // mediaPlayback-type foreground service bhi is state ke bina reject ho sakti hai
    private void updateMediaSession() {
        if (mediaSession == null) return;
        mediaSession.setActive(true);
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, curTitle == null || curTitle.isEmpty() ? "Now Playing" : curTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, curArtist == null ? "" : curArtist)
            .build());
        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            .setState(isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, 0, 1f)
            .build());
    }

    private Notification buildNotification() {
        PendingIntent playPI  = servicePendingIntent(ACTION_PLAY);
        PendingIntent pausePI = servicePendingIntent(ACTION_PAUSE);
        PendingIntent nextPI  = servicePendingIntent(ACTION_NEXT);
        PendingIntent prevPI  = servicePendingIntent(ACTION_PREV);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(curTitle == null || curTitle.isEmpty() ? "Now Playing" : curTitle)
            .setContentText(curArtist)
            .setOnlyAlertOnce(true)
            .setOngoing(isPlaying)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Previous", prevPI)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                isPlaying ? pausePI : playPI)
            .addAction(android.R.drawable.ic_media_next, "Next", nextPI)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private PendingIntent servicePendingIntent(String action) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, action.hashCode(), i, flags);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        if (mediaSession != null) mediaSession.release();
        super.onDestroy();
    }
}
`
      }
    ],
    // Frontend/README ke liye — developer ko apni website ki JS mein yeh do cheezein add karni hongi:
    integrationNote:
      'Apni website ke audio/video player mein: (1) play/pause hone par AndroidMedia.notifyPlaying(title, artist) ' +
      'ya AndroidMedia.notifyPaused(title, artist) call karo. (2) window.addEventListener("nexdroidMediaAction", e => { ' +
      'if(e.detail==="play") player.play(); if(e.detail==="pause") player.pause(); if(e.detail==="next") playNext(); ' +
      'if(e.detail==="previous") playPrevious(); }) add karo — isse notification ke buttons se web player control hoga. ' +
      'Note: app khulte hi ek system dialog aayega "ignore battery optimizations" — user ko Allow karna hoga taaki service background mein na ruke. ' +
      'Kuch phones (MIUI/Realme/Vivo/OPPO) mein iske alawa bhi khud Settings > Battery > App mein "Autostart"/"No restrictions" manually enable karna pad sakta hai — yeh Android permission se automatic nahi ho sakta.'
  }
];

// ─── Search helper ─────────────────────────────────────────
function searchFeatures(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return FEATURE_CATALOG.map(toSummary);
  return FEATURE_CATALOG
    .filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.keywords.some(k => k.includes(q))
    )
    .map(toSummary);
}

function toSummary(f) {
  return {
    id: f.id,
    name: f.name,
    category: f.category,
    description: f.description,
    permissions: f.permissions,
    gradleDependencies: f.gradleDependencies,
    integrationNote: f.integrationNote || null,
    requiresNativeCode: (f.injectionType || 'java') === 'java' && (f.gradleDependencies.length > 0 || f.javaMethods.length > 0)
  };
}

function getFeaturesByIds(ids = []) {
  const idSet = new Set(ids);
  return FEATURE_CATALOG.filter(f => idSet.has(f.id));
}

module.exports = { FEATURE_CATALOG, searchFeatures, getFeaturesByIds };
