package com.ahkeem.neurallab;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Neural Lab v1 — plain WebView shell.
 * Whole app is HTML/JS in assets/www. Native bridge (NB) exposes:
 *   NB.httpGet(url) -> "HTTP <code>\n<body>" (runs on binder thread, no CORS issues)
 * File input (<input type=file>) works via onShowFileChooser.
 */
public class MainActivity extends Activity {
    private WebView wv;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQ = 1001;
    /** v63 QR Bridge: scanner launch + runtime camera permission. */
    private static final int QR_SCAN_REQ = 1002;
    private static final int QR_CAM_PERM_REQ = 2001;
    private boolean qrScanPending = false;

    /** v66 Drive Bridge: Google Drive OAuth + brain-food upload / weights download. */
    private DriveBridge driveBridge;

    /** v60 Observer: forwards read-only screen-state broadcasts into the WebView. */
    private final BroadcastReceiver observerReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (!ObserverService.ACTION_STATE.equals(intent.getAction())) return;
            if (wv == null) return;
            String pkg = intent.getStringExtra(ObserverService.EXTRA_PACKAGE);
            String summary = intent.getStringExtra(ObserverService.EXTRA_SUMMARY);
            if (pkg == null) pkg = "?";
            if (summary == null) summary = "";
            final String payload;
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("package", pkg);
                o.put("summary", summary);
                payload = o.toString();
            } catch (Exception e) { return; }
            final String js = "window.NL_OBSERVER && NL_OBSERVER.onState("
                    + org.json.JSONObject.quote(payload) + ");";
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try { wv.evaluateJavascript(js, null); }
                    catch (Exception ignored) { }
                }
            });
        }
    };

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(observerReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // First Tongue loads its weights (tongue.bin) via XHR from file:///android_asset/.
        // Without this, file:// JS cannot read other file:// URLs and the brain never wakes.
        // Safe here: the WebView shows only local content; http(s) links open in the external browser.
        s.setAllowFileAccessFromFileURLs(true);
        // v71 hackathon: the Meta API Ghost judge fetches https://api.meta.ai from this
        // file:///android_asset/ page. Universal access is OFF by default, and without it
        // the WebView blocks the call before it ever leaves the phone (Requests stays 0
        // even with a key saved). Same safety case as above: only local content is shown.
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                    return true;
                }
                return false;
            }
        });
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent i = params.createIntent();
                try {
                    startActivityForResult(i, FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        wv.addJavascriptInterface(new Bridge(), "NB");
        // v66 Drive Bridge: separate "ND" interface (OAuth + Drive REST).
        driveBridge = new DriveBridge(this);
        wv.addJavascriptInterface(driveBridge, "ND");
        setContentView(wv);
        wv.loadUrl("file:///android_asset/www/index.html");
        // v60 Observer: hear screen-state broadcasts for the whole activity life,
        // so the observer keeps working while Ahkeem is in other apps.
        try {
            IntentFilter f = new IntentFilter(ObserverService.ACTION_STATE);
            registerReceiver(observerReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) { }
    }

    /** v66 Drive Bridge: post a JS snippet to the WebView (UI thread safe). */
    public void postToJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { wv.evaluateJavascript(js, null); }
                catch (Exception ignored) { }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // v66 Drive Bridge: account picker + Google consent results.
        if (driveBridge != null && driveBridge.onActivityResult(requestCode, resultCode, data)) {
            return;
        }
        if (requestCode == FILE_CHOOSER_REQ && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        if (requestCode == QR_SCAN_REQ) {
            // v63 QR Bridge: forward the scanner's reassembled payload to JS.
            // Nothing is executed — JS shows a preview and waits for Apply/Discard.
            boolean ok = false;
            String text = null, hash = null, error = "scan cancelled";
            if (data != null) {
                if (data.hasExtra(QRScanActivity.EXTRA_ERROR))
                    error = data.getStringExtra(QRScanActivity.EXTRA_ERROR);
                ok = data.getBooleanExtra(QRScanActivity.EXTRA_OK, false);
                text = data.getStringExtra(QRScanActivity.EXTRA_TEXT);
                hash = data.getStringExtra(QRScanActivity.EXTRA_HASH);
                if (ok && text == null) { ok = false; error = "empty payload"; }
            }
            final String payload;
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("ok", ok);
                o.put("text", text == null ? org.json.JSONObject.NULL : text);
                o.put("hash", hash == null ? org.json.JSONObject.NULL : hash);
                o.put("error", error == null ? org.json.JSONObject.NULL : error);
                payload = o.toString();
            } catch (Exception e) { return; }
            final String js = "window.NL_QRBRIDGE && NL_QRBRIDGE.onScanResult("
                    + org.json.JSONObject.quote(payload) + ");";
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try { wv.evaluateJavascript(js, null); }
                    catch (Exception ignored) { }
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == QR_CAM_PERM_REQ && qrScanPending) {
            qrScanPending = false;
            boolean granted = grantResults.length > 0
                    && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
            if (granted) launchQrScanner();
            else qrBridgeCameraResult(false);
        }
    }

    /** v63 QR Bridge: report a camera-permission outcome back to JS. */
    private void qrBridgeCameraResult(final boolean granted) {
        final String js = "window.NL_QRBRIDGE && NL_QRBRIDGE.onCameraResult(" + granted + ");";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { wv.evaluateJavascript(js, null); }
                catch (Exception ignored) { }
            }
        });
    }

    /** v63 QR Bridge: open the optical patch scanner (permission must be granted). */
    private void launchQrScanner() {
        try {
            startActivityForResult(new Intent(this, QRScanActivity.class), QR_SCAN_REQ);
        } catch (Exception ignored) { }
    }

    public class Bridge {
        /** v60 Observer: true if the Neural Lab accessibility service is enabled. */
        @JavascriptInterface
        public boolean isObserverEnabled() {
            try {
                String enabled = Settings.Secure.getString(getContentResolver(),
                        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                if (enabled == null) return false;
                String mine = getPackageName() + "/"
                        + ObserverService.class.getName();
                // The flat string uses '.'-joined component names.
                return enabled.contains(mine) || enabled.contains(getPackageName());
            } catch (Exception e) {
                return false;
            }
        }

        /** v60 Observer: deep-link to Android Accessibility Settings so the
         *  user can enable the Neural Lab Observer service (their tap). */
        @JavascriptInterface
        public void openAccessibilitySettings() {
            try {
                Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) { }
        }

        /** Synchronous HTTPS GET. Runs on a binder thread, so network I/O is fine. */
        @JavascriptInterface
        public String httpGet(String url) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("GET");
                c.setConnectTimeout(30000);
                c.setReadTimeout(60000);
                c.setRequestProperty("User-Agent", "NeuralLab/1.0 (Android)");
                c.setRequestProperty("Accept", "application/vnd.github+json, */*");
                int code = c.getResponseCode();
                BufferedReader r = new BufferedReader(new InputStreamReader(
                        code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream(),
                        StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
                r.close();
                return "HTTP " + code + "\n" + sb.toString();
            } catch (Exception e) {
                return "HTTP 0\n{\"__error\":\"" + e.toString().replace("\"", "'") + "\"}";
            } finally {
                if (c != null) c.disconnect();
            }
        }

        /** v72 hackathon fallback: native POST for the Meta Ghost judge.
         *  The WebView fetch from file:///android_asset/ stayed blocked even
         *  with setAllowUniversalAccessFromFileURLs (v71: Requests stayed 0
         *  with a key saved), so the judge now goes through Java HTTPS,
         *  which has no file-URL restrictions (same pattern as httpGet).
         *  Args: key (from the app's own localStorage, passed by JS) and the
         *  JSON body. Returns "HTTP <code>\n<body>". The key is never
         *  logged, stored, or returned — it only leaves in the
         *  Authorization header to api.meta.ai. Runs on a binder thread,
         *  so network I/O is fine. Never throws to JS. */
        @JavascriptInterface
        public String metaJudgePost(String key, String body) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL("https://api.meta.ai/v1/chat/completions").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Authorization", "Bearer " + (key == null ? "" : key));
                c.setDoOutput(true);
                byte[] data = body == null ? new byte[0]
                        : body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(data.length);
                java.io.OutputStream out = c.getOutputStream();
                out.write(data);
                out.flush();
                out.close();
                int code = c.getResponseCode();
                java.io.InputStream in = code >= 200 && code < 300
                        ? c.getInputStream() : c.getErrorStream();
                if (in == null) return "HTTP " + code + "\n{}";
                java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
                byte[] tmp = new byte[8192];
                int n;
                while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
                in.close();
                return "HTTP " + code + "\n" + buf.toString("UTF-8");
            } catch (Exception e) {
                return "HTTP 0\n{\"__error\":\"" + e.toString().replace("\"", "'") + "\"}";
            } finally {
                if (c != null) c.disconnect();
            }
        }

        /** Append text to a file in the app's Documents folder (user-reachable for Drive upload).
         *  Used by the Brain Feeder to grow brain-food.txt for the next Colab training run. */
        @JavascriptInterface
        public String saveTextFile(String name, String text) {
            try {
                java.io.File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS);
                if (dir == null) return "ERROR: no storage";
                if (!dir.exists()) dir.mkdirs();
                String safe = name.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (safe.isEmpty()) safe = "brain-food.txt";
                java.io.File f = new java.io.File(dir, safe);
                java.io.FileOutputStream out = new java.io.FileOutputStream(f, true);
                out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.write("\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.close();
                return "OK " + f.getAbsolutePath() + " (" + f.length() + " bytes)";
            } catch (Exception e) {
                return "ERROR " + e.toString();
            }
        }

        /** v56: append text to a file in SHARED Documents/NeuralLab — visible in the
         *  Files app, so the user can upload brain-food.txt to Drive. No permission
         *  needed on Android 10+ (MediaStore contribution). */
        @JavascriptInterface
        public String saveSharedText(String name, String text) {
            try {
                String safe = name.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (safe.isEmpty()) safe = "brain-food.txt";
                android.content.ContentResolver cr = getContentResolver();
                android.net.Uri collection =
                    android.provider.MediaStore.Files.getContentUri("external");
                android.net.Uri uri = null;
                android.database.Cursor c = cr.query(collection,
                    new String[]{ android.provider.MediaStore.MediaColumns._ID },
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                    new String[]{ safe }, null);
                if (c != null) {
                    if (c.moveToFirst()) {
                        uri = android.net.Uri.withAppendedPath(collection,
                            String.valueOf(c.getLong(0)));
                    }
                    c.close();
                }
                String mode;
                if (uri == null) {
                    android.content.ContentValues values = new android.content.ContentValues();
                    values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                    values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                               android.os.Environment.DIRECTORY_DOCUMENTS + "/NeuralLab");
                    uri = cr.insert(collection, values);
                    if (uri == null) return "ERROR: media store insert failed";
                    mode = "wt";
                } else {
                    mode = "wa";
                }
                java.io.OutputStream out = cr.openOutputStream(uri, mode);
                if (out == null) return "ERROR: cannot open output";
                out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.write("\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.close();
                return "OK Documents/NeuralLab/" + safe;
            } catch (Exception e) {
                return "ERROR " + e.toString();
            }
        }
        /** v62 Crawler: read a text file from shared Documents/NeuralLab (MediaStore).
         *  Used by the corpus watcher to dedupe + stat brain-food.txt. Returns the
         *  file content, "" if missing, or "ERROR ..." on failure. */
        @JavascriptInterface
        public String readSharedText(String name) {
            try {
                String safe = name.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (safe.isEmpty()) safe = "brain-food.txt";
                android.content.ContentResolver cr = getContentResolver();
                android.net.Uri collection =
                    android.provider.MediaStore.Files.getContentUri("external");
                android.net.Uri uri = null;
                android.database.Cursor c = cr.query(collection,
                    new String[]{ android.provider.MediaStore.MediaColumns._ID },
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                    new String[]{ safe }, null);
                if (c != null) {
                    if (c.moveToFirst()) {
                        uri = android.net.Uri.withAppendedPath(collection,
                            String.valueOf(c.getLong(0)));
                    }
                    c.close();
                }
                if (uri == null) return "";
                java.io.InputStream in = cr.openInputStream(uri);
                if (in == null) return "ERROR: cannot open";
                java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
                byte[] tmp = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(tmp)) != -1) {
                    total += n;
                    if (total > 8 * 1024 * 1024) { in.close(); return "ERROR: file too large"; }
                    buf.write(tmp, 0, n);
                }
                in.close();
                return buf.toString("UTF-8");
            } catch (Exception e) {
                return "ERROR " + e.toString();
            }
        }

        /** v62 Crawler: true when the active network is Wi-Fi (for the Wi-Fi-only toggle). */
        @JavascriptInterface
        public boolean isWifiConnected() {
            try {
                android.net.ConnectivityManager cm =
                    (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm == null) return false;
                android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnected()
                    && ni.getType() == android.net.ConnectivityManager.TYPE_WIFI;
            } catch (Exception e) {
                return false;
            }
        }

        /** v63 QR Bridge: "granted" | "denied". Camera is requested at runtime,
         *  only when the user opens the Scan patch panel. */
        @JavascriptInterface
        public String qrCameraStatus() {
            try {
                int r = checkSelfPermission(android.Manifest.permission.CAMERA);
                return r == android.content.pm.PackageManager.PERMISSION_GRANTED
                        ? "granted" : "denied";
            } catch (Exception e) {
                return "denied";
            }
        }

        /** v63 QR Bridge: user-initiated patch scan. Requests CAMERA permission
         *  if needed, then launches the optical scanner activity. Returns
         *  "launching" | "requesting" | "error". */
        @JavascriptInterface
        public String qrScan() {
            try {
                if (qrCameraStatus().equals("granted")) {
                    launchQrScanner();
                    return "launching";
                }
                qrScanPending = true;
                requestPermissions(
                        new String[]{ android.Manifest.permission.CAMERA },
                        QR_CAM_PERM_REQ);
                return "requesting";
            } catch (Exception e) {
                return "error";
            }
        }

        /** v65 Game Gym: launch the arena. The Gemini key comes from the
         *  Observer tab's stored key (localStorage) — gym.js passes it in so
         *  the user never pastes twice. The agent lives entirely inside the
         *  gym WebView; it cannot touch anything else on the phone. */
        @JavascriptInterface
        public void openGym(String key, String model) {
            try {
                Intent i = new Intent(MainActivity.this, GymActivity.class);
                i.putExtra("gemini_key", key == null ? "" : key);
                i.putExtra("gemini_model",
                        (model == null || model.isEmpty()) ? "gemini-2.0-flash" : model);
                startActivity(i);
            } catch (Exception ignored) { }
        }

        /** v65 Game Gym: attempt log + ghost archive as JSON for the Gym tab. */
        @JavascriptInterface
        public String gymArchive() {
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("log", new org.json.JSONArray(GymTrinity.readLogFile(MainActivity.this)));
                o.put("ghosts", new org.json.JSONArray(GymTrinity.readGhostFile(MainActivity.this)));
                return o.toString();
            } catch (Exception e) {
                return "{\"log\":[],\"ghosts\":[]}";
            }
        }
    }
}
