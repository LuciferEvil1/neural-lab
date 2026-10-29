package com.ahkeem.neurallab;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Neural Lab v66 "Drive Bridge" — Google Drive REST v3 protocol logic.
 *
 * Pure Java, ZERO Android dependencies, so it can be unit-tested on the JVM
 * (see DriveTest.java). The Android glue (AccountManager OAuth tokens,
 * MediaStore file I/O, JS callbacks) lives in DriveBridge.java, which drives
 * these methods through a Transport.
 *
 * Scope split (deliberate, no full `drive` scope):
 *  - drive.file     — upload + overwrite brain-food.txt (files the app creates)
 *  - drive.readonly — list + download his Colab-saved weights (*.pt, *.json),
 *                     which the app did NOT create, so drive.file can't see them
 *
 * JSON parsing here is intentionally minimal: tiny field extractors for the
 * exact Drive v3 response shapes we consume (file resource, files.list).
 * Documented limitation, not a general JSON parser.
 */
public class DriveProtocol {

    public static final String DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
    public static final String DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    public static final String SCOPE_FILE = "https://www.googleapis.com/auth/drive.file";
    public static final String SCOPE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
    /** AccountManager token type: "oauth2:" + space-separated scopes. */
    public static final String TOKEN_TYPE = "oauth2:" + SCOPE_FILE + " " + SCOPE_READONLY;

    public static final String BRAIN_FOOD_NAME = "brain-food.txt";
    public static final String BRAIN_FOOD_MIME = "text/plain";

    /** Drive-side errors that mean "token bad/expired" -> invalidate + retry once. */
    public static boolean isAuthError(int httpCode) {
        return httpCode == 401 || httpCode == 403;
    }

    public static class Response {
        public final int code;
        public final String body; // may be "" ; never null
        public Response(int code, String body) {
            this.code = code;
            this.body = body == null ? "" : body;
        }
    }

    public interface Progress {
        void onBytes(long done, long total);
    }

    /**
     * Transport performs one HTTP request. Implementations: real
     * HttpURLConnection (DriveBridge) or canned mock (DriveTest).
     */
    public interface Transport {
        Response request(String method, String url, Map<String, String> headers,
                         byte[] body, Progress progress) throws Exception;
        /** Streaming download: writes response bytes to out, reports progress. */
        void download(String url, Map<String, String> headers,
                      OutputStream out, Progress progress) throws Exception;
    }

    public static class FileMeta {
        public String id = "";
        public String name = "";
        public long size = -1;
        public String modifiedTime = "";
    }

    public static class DriveException extends Exception {
        public final int httpCode;
        public DriveException(int httpCode, String message) {
            super(message);
            this.httpCode = httpCode;
        }
    }

    // ---------- URL / body builders ----------

    public static String encodeQuery(String q) {
        try {
            return URLEncoder.encode(q, "UTF-8");
        } catch (Exception e) {
            return q;
        }
    }

    public static String findUrl(String name) {
        return DRIVE_FILES + "?q=" + encodeQuery("name='" + name + "' and trashed=false")
                + "&fields=" + encodeQuery("files(id,name,size)") + "&pageSize=5";
    }

    public static String listWeightsUrl() {
        String q = "trashed=false and (name contains '.pt' or name contains '.json')";
        return DRIVE_FILES + "?q=" + encodeQuery(q)
                + "&fields=" + encodeQuery("files(id,name,size,modifiedTime)")
                + "&orderBy=" + encodeQuery("modifiedTime desc") + "&pageSize=100";
    }

    public static String downloadUrl(String fileId) {
        return DRIVE_FILES + "/" + fileId + "?alt=media";
    }

    public static String uploadCreateUrl() {
        return DRIVE_UPLOAD + "?uploadType=multipart";
    }

    public static String uploadUpdateUrl(String fileId) {
        return DRIVE_UPLOAD + "/" + fileId + "?uploadType=multipart";
    }

    /** multipart/related body: JSON metadata part + binary content part. */
    public static byte[] buildMultipartBody(String boundary, String metadataJson,
                                            byte[] content, String mime) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String part1 = "--" + boundary + "\r\n"
                + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadataJson + "\r\n";
        String part2head = "--" + boundary + "\r\n"
                + "Content-Type: " + mime + "\r\n\r\n";
        String tail = "\r\n--" + boundary + "--\r\n";
        out.write(part1.getBytes("UTF-8"));
        out.write(part2head.getBytes("UTF-8"));
        out.write(content);
        out.write(tail.getBytes("UTF-8"));
        return out.toByteArray();
    }

    public static String metadataJson(String name) {
        return "{\"name\":" + quoteJson(name) + "}";
    }

    private static String quoteJson(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    // ---------- minimal JSON extractors (Drive response shapes only) ----------

    /** Extracts the string value of a top-level "field" from a flat JSON object. */
    public static String jsonStringField(String json, String field) {
        if (json == null) return "";
        String key = "\"" + field + "\"";
        int i = json.indexOf(key);
        if (i < 0) return "";
        int c = json.indexOf(':', i + key.length());
        if (c < 0) return "";
        int q1 = json.indexOf('"', c + 1);
        if (q1 < 0) return "";
        int q2 = q1 + 1;
        StringBuilder sb = new StringBuilder();
        while (q2 < json.length()) {
            char ch = json.charAt(q2);
            if (ch == '\\' && q2 + 1 < json.length()) {
                sb.append(json.charAt(q2 + 1));
                q2 += 2;
                continue;
            }
            if (ch == '"') break;
            sb.append(ch);
            q2++;
        }
        return sb.toString();
    }

    /** Extracts a numeric field value; -1 when absent/unparseable.
     *  Drive v3 returns size as a quoted string ("size": "12345") — handled. */
    public static long jsonLongField(String json, String field) {
        if (json == null) return -1;
        String key = "\"" + field + "\"";
        int i = json.indexOf(key);
        if (i < 0) return -1;
        int c = json.indexOf(':', i + key.length());
        if (c < 0) return -1;
        int s = c + 1;
        while (s < json.length() && json.charAt(s) == ' ') s++;
        if (s < json.length() && json.charAt(s) == '"') s++; // quoted numeric
        int e = s;
        while (e < json.length() && (Character.isDigit(json.charAt(e)) || json.charAt(e) == '-')) e++;
        if (e == s) return -1;
        try {
            return Long.parseLong(json.substring(s, e));
        } catch (Exception ex) {
            return -1;
        }
    }

    /** Parses {"files":[{...},{...}]} into FileMeta list. */
    public static List<FileMeta> parseFileList(String json) {
        List<FileMeta> out = new ArrayList<FileMeta>();
        if (json == null) return out;
        int fi = json.indexOf("\"files\"");
        if (fi < 0) return out;
        int arr = json.indexOf('[', fi);
        if (arr < 0) return out;
        int depth = 0;
        int objStart = -1;
        for (int i = arr; i < json.length(); i++) {
            char ch = json.charAt(i);
            if (ch == '{') {
                if (depth == 0) objStart = i;
                depth++;
            } else if (ch == '}') {
                depth--;
                if (depth == 0 && objStart >= 0) {
                    String obj = json.substring(objStart, i + 1);
                    FileMeta m = new FileMeta();
                    m.id = jsonStringField(obj, "id");
                    m.name = jsonStringField(obj, "name");
                    m.size = jsonLongField(obj, "size");
                    m.modifiedTime = jsonStringField(obj, "modifiedTime");
                    if (!m.id.isEmpty()) out.add(m);
                    objStart = -1;
                }
            } else if (ch == ']' && depth == 0) {
                break;
            }
        }
        return out;
    }

    // ---------- high-level ops (auth retry handled by caller via DriveException) ----------

    private static Map<String, String> authHeaders(String token) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Authorization", "Bearer " + token);
        return h;
    }

    private static void checkOk(Response r, String op) throws DriveException {
        if (r.code < 200 || r.code >= 300) {
            String detail = r.body.length() > 300 ? r.body.substring(0, 300) : r.body;
            throw new DriveException(r.code, op + " failed: HTTP " + r.code + " " + detail);
        }
    }

    /** Returns the Drive file id for `name` at root, or null when absent. */
    public static String findFileId(Transport t, String token, String name) throws Exception {
        Response r = t.request("GET", findUrl(name), authHeaders(token), null, null);
        checkOk(r, "find " + name);
        List<FileMeta> files = parseFileList(r.body);
        return files.isEmpty() ? null : files.get(0).id;
    }

    /**
     * Uploads (creates or overwrites) brain-food content at Drive root.
     * Returns the Drive file id. Progress may be null.
     */
    public static String uploadBrainFood(Transport t, String token, byte[] content,
                                         Progress progress) throws Exception {
        String boundary = "nl-boundary-" + System.currentTimeMillis();
        byte[] body = buildMultipartBody(boundary, metadataJson(BRAIN_FOOD_NAME),
                content, BRAIN_FOOD_MIME);
        Map<String, String> h = authHeaders(token);
        h.put("Content-Type", "multipart/related; boundary=" + boundary);
        String existingId = findFileId(t, token, BRAIN_FOOD_NAME);
        Response r;
        if (existingId == null) {
            r = t.request("POST", uploadCreateUrl(), h, body, progress);
            checkOk(r, "upload " + BRAIN_FOOD_NAME);
        } else {
            r = t.request("PATCH", uploadUpdateUrl(existingId), h, body, progress);
            checkOk(r, "overwrite " + BRAIN_FOOD_NAME);
        }
        String id = jsonStringField(r.body, "id");
        if (id.isEmpty()) throw new DriveException(r.code, "upload succeeded but no file id returned");
        return id;
    }

    /** Lists *.pt / *.json weight files at Drive root, newest first. */
    public static List<FileMeta> listWeights(Transport t, String token) throws Exception {
        Response r = t.request("GET", listWeightsUrl(), authHeaders(token), null, null);
        checkOk(r, "list weights");
        return parseFileList(r.body);
    }

    /** Streams a Drive file's bytes into `out`. Progress may be null. */
    public static void downloadFile(Transport t, String token, String fileId,
                                    OutputStream out, Progress progress) throws Exception {
        Map<String, String> h = authHeaders(token);
        try {
            t.download(downloadUrl(fileId), h, out, progress);
        } catch (DriveException de) {
            throw de;
        } catch (Exception e) {
            throw new DriveException(0, "download failed: " + e);
        }
    }
}
