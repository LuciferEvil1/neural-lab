package com.ahkeem.neurallab;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/**
 * Neural Lab v66 "Drive Bridge" — Google Drive OAuth + upload/download.
 *
 * AUTH (all consent UI is the user's own taps):
 *  - driveSignIn() opens the SYSTEM account picker
 *    (AccountManager.newChooseAccountIntent — no GET_ACCOUNTS permission needed).
 *  - The OAuth token comes from AccountManager.getAuthToken() with the
 *    "oauth2:" token type (DriveProtocol.TOKEN_TYPE). If Google needs consent,
 *    the bundle carries KEY_INTENT and we launch it (REQ_CONSENT) — the
 *    consent screen is Google's own UI, his tap.
 *  - No Cloud Console OAuth client ID is needed: the token is minted for the
 *    device's Google account. Scope split (deliberate):
 *      drive.file     -> upload/overwrite brain-food.txt (app-created files)
 *      drive.readonly -> list/download his Colab-saved weights (*.pt/*.json),
 *                        which the app did NOT create (drive.file can't see them)
 *    Full `drive` scope is NOT requested.
 *
 * LOUD-DEATHS RULE (v64.2): every failure path posts an explicit error event
 * to JS. Nothing fails silently.
 */
public class DriveBridge {

    public static final int REQ_ACCOUNT = 3001;
    public static final int REQ_CONSENT = 3002;

    private static final String PREFS = "nl_drive";
    private static final String KEY_ACCOUNT = "account";
    private static final long MAX_BRAIN_FOOD = 16L * 1024 * 1024;
    private static final long MAX_WEIGHT = 512L * 1024 * 1024;

    private final MainActivity activity;
    private String cachedToken = null;
    private Runnable pendingOp = null;

    public DriveBridge(MainActivity activity) {
        this.activity = activity;
    }

    // ---------------- JS API ----------------

    /** Sync: {"state":"in"|"out"|"authenticating"|"consent","email":...} */
    @JavascriptInterface
    public String driveStatus() {
        try {
            String email = storedAccount();
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("email", email == null ? org.json.JSONObject.NULL : email);
            o.put("state", email == null ? "out" : (cachedToken == null ? "authenticating" : "in"));
            return o.toString();
        } catch (Exception e) {
            return "{\"state\":\"out\",\"email\":null}";
        }
    }

    /** Sync: {"exists":bool,"bytes":n} for the local brain-food.txt. */
    @JavascriptInterface
    public String driveLocalInfo() {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            long[] info = sharedFileInfo(DriveProtocol.BRAIN_FOOD_NAME);
            o.put("exists", info != null);
            o.put("bytes", info == null ? 0 : info[0]);
            return o.toString();
        } catch (Exception e) {
            return "{\"exists\":false,\"bytes\":0}";
        }
    }

    /** Opens the system Google-account picker (his tap). */
    @JavascriptInterface
    public void driveSignIn() {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    Intent i = AccountManager.newChooseAccountIntent(
                            null, null, new String[]{"com.google"},
                            null, null, null, null);
                    activity.startActivityForResult(i, REQ_ACCOUNT);
                } catch (Exception e) {
                    postError("sign_in", "could not open account picker: " + e);
                }
            }
        });
    }

    /** Forgets the account + invalidates the token. */
    @JavascriptInterface
    public void driveSignOut() {
        final String tok = cachedToken;
        cachedToken = null;
        clearAccount();
        new Thread(new Runnable() {
            @Override public void run() {
                if (tok != null) {
                    try {
                        AccountManager.get(activity).invalidateAuthToken("com.google", tok);
                    } catch (Exception ignored) { }
                }
                postStatus("out", null);
            }
        }).start();
    }

    /** One-tap upload of Documents/NeuralLab/brain-food.txt to Drive root. */
    @JavascriptInterface
    public void driveUploadBrainFood() {
        authedOp("upload", new Op() {
            @Override public void run(String token) throws Exception {
                byte[] content = readSharedBytes(DriveProtocol.BRAIN_FOOD_NAME, MAX_BRAIN_FOOD);
                if (content == null) {
                    throw new Exception("Documents/NeuralLab/brain-food.txt not found — "
                            + "grow it in the Brain Feeder (LLM tab) first");
                }
                if (content.length == 0) {
                    throw new Exception("brain-food.txt is empty — nothing to upload");
                }
                postProgress("upload", 0, content.length);
                String id = DriveProtocol.uploadBrainFood(transport, token, content,
                        new DriveProtocol.Progress() {
                            @Override public void onBytes(long done, long total) {
                                postProgress("upload", done, total);
                            }
                        });
                postUploadDone(id, content.length);
            }
        });
    }

    /** Lists *.pt / *.json weight files at Drive root. */
    @JavascriptInterface
    public void driveListWeights() {
        authedOp("list", new Op() {
            @Override public void run(String token) throws Exception {
                List<DriveProtocol.FileMeta> files = DriveProtocol.listWeights(transport, token);
                org.json.JSONArray arr = new org.json.JSONArray();
                for (DriveProtocol.FileMeta f : files) {
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("id", f.id);
                    o.put("name", f.name);
                    o.put("size", f.size);
                    o.put("modifiedTime", f.modifiedTime);
                    arr.put(o);
                }
                org.json.JSONObject ev = new org.json.JSONObject();
                ev.put("kind", "list");
                ev.put("files", arr);
                postEvent(ev);
            }
        });
    }

    /** Downloads one weight file into Documents/NeuralLab/weights/. */
    @JavascriptInterface
    public void driveDownloadWeight(final String fileId, final String name) {
        if (fileId == null || fileId.isEmpty() || name == null || name.isEmpty()) {
            postError("download", "missing file id or name");
            return;
        }
        final String safe = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        authedOp("download", new Op() {
            @Override public void run(String token) throws Exception {
                Uri uri = weightsFileUri(safe);
                ContentResolver cr = activity.getContentResolver();
                OutputStream out = cr.openOutputStream(uri, "wt");
                if (out == null) throw new Exception("cannot open output for " + safe);
                final long[] done = {0};
                try {
                    DriveProtocol.downloadFile(transport, token, fileId, out,
                            new DriveProtocol.Progress() {
                                @Override public void onBytes(long d, long total) {
                                    done[0] = d;
                                    postProgress("download", d, total);
                                }
                            });
                } finally {
                    try { out.close(); } catch (Exception ignored) { }
                }
                postDownloadDone(safe, done[0]);
            }
        });
    }

    // ---------------- activity results ----------------

    /** Returns true when the request code belonged to the Drive flow. */
    public boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_ACCOUNT) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                String email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
                if (email == null || email.isEmpty()) {
                    postError("sign_in", "no account chosen");
                } else {
                    storeAccount(email);
                    cachedToken = null;
                    postStatus("authenticating", email);
                    fetchToken(null); // validate + warm the token
                }
            } else {
                postError("sign_in", "account picker cancelled");
            }
            return true;
        }
        if (requestCode == REQ_CONSENT) {
            Runnable op = pendingOp;
            pendingOp = null;
            if (resultCode == Activity.RESULT_OK) {
                fetchToken(op);
            } else {
                postError("auth", "Google consent denied or cancelled — Drive stays disconnected");
            }
            return true;
        }
        return false;
    }

    // ---------------- auth machinery ----------------

    private interface Op {
        void run(String token) throws Exception;
    }

    private void runBg(Runnable r) {
        new Thread(r).start();
    }

    private String storedAccount() {
        return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_ACCOUNT, null);
    }

    private void storeAccount(String email) {
        SharedPreferences.Editor e = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putString(KEY_ACCOUNT, email);
        e.apply();
    }

    private void clearAccount() {
        SharedPreferences.Editor e = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.remove(KEY_ACCOUNT);
        e.apply();
    }

    private void fetchToken(final Runnable after) {
        final String email = storedAccount();
        if (email == null) {
            postError("auth", "not signed in — tap 'Sign in with Google' first");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    AccountManager am = AccountManager.get(activity);
                    Account acct = new Account(email, "com.google");
                    am.getAuthToken(acct, DriveProtocol.TOKEN_TYPE, null, activity,
                            new android.accounts.AccountManagerCallback<Bundle>() {
                                @Override public void run(
                                        android.accounts.AccountManagerFuture<Bundle> future) {
                                    try {
                                        Bundle b = future.getResult();
                                        if (b.containsKey(AccountManager.KEY_INTENT)) {
                                            pendingOp = after;
                                            Intent ci = b.getParcelable(AccountManager.KEY_INTENT);
                                            activity.startActivityForResult(ci, REQ_CONSENT);
                                            postStatus("consent", email);
                                        } else {
                                            String tok = b.getString(AccountManager.KEY_AUTHTOKEN);
                                            if (tok == null || tok.isEmpty()) {
                                                postError("auth", "Google returned an empty token");
                                                return;
                                            }
                                            cachedToken = tok;
                                            postStatus("in", email);
                                            if (after != null) runBg(after);
                                        }
                                    } catch (Exception e) {
                                        postError("auth", "token request failed: " + e);
                                    }
                                }
                            }, null);
                } catch (Exception e) {
                    postError("auth", "token request failed: " + e);
                }
            }
        });
    }

    private void ensureAuthed(Runnable op) {
        if (cachedToken != null) {
            runBg(op);
            return;
        }
        if (storedAccount() == null) {
            postError("auth", "not signed in — tap 'Sign in with Google' first");
            return;
        }
        fetchToken(op);
    }

    /** Runs op with a valid token; on 401/403 invalidates + retries once. */
    private void authedOp(final String opName, final Op op) {
        ensureAuthed(new Runnable() {
            @Override public void run() {
                try {
                    op.run(cachedToken);
                } catch (DriveProtocol.DriveException de) {
                    if (DriveProtocol.isAuthError(de.httpCode) && cachedToken != null) {
                        final String bad = cachedToken;
                        cachedToken = null;
                        new Thread(new Runnable() {
                            @Override public void run() {
                                try {
                                    AccountManager.get(activity)
                                            .invalidateAuthToken("com.google", bad);
                                } catch (Exception ignored) { }
                                ensureAuthed(new Runnable() {
                                    @Override public void run() {
                                        try {
                                            op.run(cachedToken);
                                        } catch (Exception e2) {
                                            postError(opName, String.valueOf(e2));
                                        }
                                    }
                                });
                            }
                        }).start();
                    } else {
                        postError(opName, String.valueOf(de));
                    }
                } catch (Exception e) {
                    postError(opName, String.valueOf(e));
                }
            }
        });
    }

    // ---------------- Drive transport (HttpURLConnection) ----------------

    private final DriveProtocol.Transport transport = new DriveProtocol.Transport() {
        @Override
        public DriveProtocol.Response request(String method, String url,
                                              Map<String, String> headers,
                                              byte[] body,
                                              DriveProtocol.Progress progress) throws Exception {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(30000);
                c.setReadTimeout(180000);
                c.setRequestProperty("User-Agent", "NeuralLab/66 (Android)");
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    c.setRequestProperty(e.getKey(), e.getValue());
                }
                if (body != null) {
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(body.length);
                    OutputStream out = c.getOutputStream();
                    int off = 0;
                    int CH = 256 * 1024;
                    while (off < body.length) {
                        int n = Math.min(CH, body.length - off);
                        out.write(body, off, n);
                        off += n;
                        if (progress != null) progress.onBytes(off, body.length);
                    }
                    out.flush();
                    out.close();
                }
                int code = c.getResponseCode();
                InputStream in = (code >= 200 && code < 300)
                        ? c.getInputStream() : c.getErrorStream();
                return new DriveProtocol.Response(code, readAll(in));
            } finally {
                if (c != null) c.disconnect();
            }
        }

        @Override
        public void download(String url, Map<String, String> headers,
                             OutputStream out, DriveProtocol.Progress progress) throws Exception {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("GET");
                c.setConnectTimeout(30000);
                c.setReadTimeout(180000);
                c.setRequestProperty("User-Agent", "NeuralLab/66 (Android)");
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    c.setRequestProperty(e.getKey(), e.getValue());
                }
                int code = c.getResponseCode();
                if (code < 200 || code >= 300) {
                    String err = readAll(c.getErrorStream());
                    if (err.length() > 300) err = err.substring(0, 300);
                    throw new DriveProtocol.DriveException(code,
                            "download failed: HTTP " + code + " " + err);
                }
                long total = -1;
                try { total = Long.parseLong(c.getHeaderField("Content-Length")); }
                catch (Exception ignored) { }
                if (total > MAX_WEIGHT) {
                    throw new DriveProtocol.DriveException(0,
                            "file too large (" + total + " bytes, cap " + MAX_WEIGHT + ")");
                }
                InputStream in = c.getInputStream();
                byte[] buf = new byte[256 * 1024];
                int n;
                long done = 0;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    done += n;
                    if (done > MAX_WEIGHT) {
                        in.close();
                        throw new DriveProtocol.DriveException(0, "file too large, aborting");
                    }
                    if (progress != null) progress.onBytes(done, total);
                }
                out.flush();
                in.close();
            } finally {
                if (c != null) c.disconnect();
            }
        }
    };

    private static String readAll(InputStream in) {
        if (in == null) return "";
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int n;
            while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
            in.close();
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    // ---------------- MediaStore file I/O ----------------

    /** Returns {sizeBytes, id} for a file in shared Documents/NeuralLab, or null. */
    private long[] sharedFileInfo(String name) {
        ContentResolver cr = activity.getContentResolver();
        Uri collection = MediaStore.Files.getContentUri("external");
        Cursor c = null;
        try {
            c = cr.query(collection,
                    new String[]{MediaStore.MediaColumns._ID, MediaStore.MediaColumns.SIZE},
                    MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                    new String[]{name}, null);
            if (c != null && c.moveToFirst()) {
                return new long[]{c.getLong(1), c.getLong(0)};
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.close();
        }
    }

    private byte[] readSharedBytes(String name, long cap) throws Exception {
        long[] info = sharedFileInfo(name);
        if (info == null) return null;
        Uri uri = Uri.withAppendedPath(MediaStore.Files.getContentUri("external"),
                String.valueOf(info[1]));
        ContentResolver cr = activity.getContentResolver();
        InputStream in = cr.openInputStream(uri);
        if (in == null) throw new Exception("cannot open " + name);
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[8192];
        int n;
        long total = 0;
        while ((n = in.read(tmp)) != -1) {
            total += n;
            if (total > cap) {
                in.close();
                throw new Exception(name + " too large (" + total + " bytes)");
            }
            buf.write(tmp, 0, n);
        }
        in.close();
        return buf.toByteArray();
    }

    /** Finds or creates Documents/NeuralLab/weights/<name>, returns its Uri. */
    private Uri weightsFileUri(String name) throws Exception {
        long[] info = sharedFileInfo(name);
        if (info != null) {
            return Uri.withAppendedPath(MediaStore.Files.getContentUri("external"),
                    String.valueOf(info[1]));
        }
        ContentResolver cr = activity.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOCUMENTS + "/NeuralLab/weights");
        Uri uri = cr.insert(MediaStore.Files.getContentUri("external"), v);
        if (uri == null) throw new Exception("media store insert failed for " + name);
        return uri;
    }

    // ---------------- JS events ----------------

    private void postEvent(org.json.JSONObject ev) {
        try {
            final String js = "window.NL_DRIVE && NL_DRIVE.onDriveEvent("
                    + org.json.JSONObject.quote(ev.toString()) + ");";
            activity.postToJs(js);
        } catch (Exception ignored) { }
    }

    private void postStatus(String state, String email) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("kind", "status");
            o.put("state", state);
            o.put("email", email == null ? org.json.JSONObject.NULL : email);
            postEvent(o);
        } catch (Exception ignored) { }
    }

    private void postProgress(String op, long done, long total) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("kind", "progress");
            o.put("op", op);
            o.put("done", done);
            o.put("total", total);
            postEvent(o);
        } catch (Exception ignored) { }
    }

    private void postError(String op, String message) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("kind", "error");
            o.put("op", op);
            o.put("message", message == null ? "unknown error" : message);
            postEvent(o);
        } catch (Exception ignored) { }
    }

    private void postUploadDone(String fileId, long bytes) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("kind", "upload_done");
            o.put("fileId", fileId);
            o.put("bytes", bytes);
            o.put("time", System.currentTimeMillis());
            postEvent(o);
        } catch (Exception ignored) { }
    }

    private void postDownloadDone(String name, long bytes) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("kind", "download_done");
            o.put("name", name);
            o.put("bytes", bytes);
            o.put("time", System.currentTimeMillis());
            postEvent(o);
        } catch (Exception ignored) { }
    }
}
