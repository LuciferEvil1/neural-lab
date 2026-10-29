package com.ahkeem.neurallab;

import android.app.Activity;
import android.content.Intent;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.Inflater;

/**
 * v63 QR Bridge — optical air-gap patch receiver (native half).
 *
 * User-initiated ONLY (launched from Dev Options → Scan patch). Continuous
 * Camera2 viewfinder + ZXing QR decode. Collects PATCH frames:
 *   PATCH:<total>:<index>:<hash64>:<base64payload>
 * Frames loop on the transmitter screen, so missed frames are tolerated —
 * collection completes when every index 0..total-1 is seen.
 *
 * On completion this activity reassembles (base64 → inflate → UTF-8),
 * verifies the FULL SHA-256, and returns the text to MainActivity, which
 * forwards it to JS. NOTHING is executed here — JS shows a preview and the
 * user must explicitly tap Apply or Discard.
 */
public class QRScanActivity extends Activity {
    public static final String EXTRA_OK = "ok";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_HASH = "hash";
    public static final String EXTRA_ERROR = "error";

    private static final int MAX_FRAMES = 400;
    private static final int MAX_PAYLOAD_CHARS = 2000;
    private static final int MAX_DECODED_BYTES = 512 * 1024;
    private static final long DECODE_THROTTLE_MS = 200;

    private TextureView textureView;
    private TextView progressView;
    private HandlerThread bgThread;
    private Handler bgHandler;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private MultiFormatReader zxing;
    private long lastDecodeAt = 0;
    private volatile boolean done = false;

    // Frame collector state
    private final Map<Integer, String> chunks = new HashMap<>();
    private String curHash = null;
    private int curTotal = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        textureView = new TextureView(this);
        root.addView(textureView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressView = new TextView(this);
        progressView.setText("point at the QR stream…");
        progressView.setTextSize(15);
        progressView.setTextColor(0xFFFFFFFF);
        progressView.setBackgroundColor(0xAA000000);
        progressView.setPadding(24, 24, 24, 24);
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pp.gravity = Gravity.TOP;
        root.addView(progressView, pp);

        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        FrameLayout.LayoutParams cp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        cp.bottomMargin = 48;
        root.addView(cancel, cp);

        setContentView(root);

        EnumMap<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, EnumSet.of(BarcodeFormat.QR_CODE));
        zxing = new MultiFormatReader();
        zxing.setHints(hints);
    }

    @Override
    protected void onResume() {
        super.onResume();
        bgThread = new HandlerThread("qrscan");
        bgThread.start();
        bgHandler = new Handler(bgThread.getLooper());
        if (textureView.isAvailable()) openCamera();
        else textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(android.graphics.SurfaceTexture st, int w, int h) { openCamera(); }
            @Override public void onSurfaceTextureSizeChanged(android.graphics.SurfaceTexture st, int w, int h) { }
            @Override public boolean onSurfaceTextureDestroyed(android.graphics.SurfaceTexture st) { return true; }
            @Override public void onSurfaceTextureUpdated(android.graphics.SurfaceTexture st) { }
        });
    }

    @Override
    protected void onPause() {
        closeCamera();
        if (bgThread != null) { bgThread.quitSafely(); bgThread = null; bgHandler = null; }
        super.onPause();
    }

    private void openCamera() {
        try {
            CameraManager mgr = (CameraManager) getSystemService(CAMERA_SERVICE);
            String backId = null;
            for (String id : mgr.getCameraIdList()) {
                CameraCharacteristics ch = mgr.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) { backId = id; break; }
            }
            if (backId == null) { fail("no back camera"); return; }
            // Caller (MainActivity) guarantees CAMERA permission before launch.
            try {
                mgr.openCamera(backId, new CameraDevice.StateCallback() {
                    @Override public void onOpened(CameraDevice d) { camera = d; startSession(); }
                    @Override public void onDisconnected(CameraDevice d) { d.close(); camera = null; }
                    @Override public void onError(CameraDevice d, int e) { d.close(); camera = null; fail("camera error " + e); }
                }, bgHandler);
            } catch (SecurityException se) {
                fail("camera permission missing");
            }
        } catch (Exception e) {
            fail("camera open failed: " + e);
        }
    }

    private void startSession() {
        try {
            reader = ImageReader.newInstance(1280, 720, ImageFormat.YUV_420_888, 2);
            reader.setOnImageAvailableListener(this::onFrame, bgHandler);
            Surface previewSurface = new Surface(textureView.getSurfaceTexture());
            final CaptureRequest.Builder b =
                    camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            b.addTarget(previewSurface);
            b.addTarget(reader.getSurface());
            camera.createCaptureSession(Arrays.asList(previewSurface, reader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession s) {
                            session = s;
                            try { s.setRepeatingRequest(b.build(), null, bgHandler); }
                            catch (CameraAccessException e) { fail("capture failed"); }
                        }
                        @Override public void onConfigureFailed(CameraCaptureSession s) { fail("session failed"); }
                    }, bgHandler);
        } catch (Exception e) {
            fail("session setup failed: " + e);
        }
    }

    private void closeCamera() {
        try { if (session != null) { session.close(); session = null; } } catch (Exception ignored) { }
        try { if (camera != null) { camera.close(); camera = null; } } catch (Exception ignored) { }
        try { if (reader != null) { reader.close(); reader = null; } } catch (Exception ignored) { }
    }

    private void onFrame(ImageReader r) {
        Image img = null;
        try { img = r.acquireLatestImage(); } catch (Exception ignored) { }
        if (img == null || done) { if (img != null) img.close(); return; }
        long now = SystemClock.elapsedRealtime();
        if (now - lastDecodeAt < DECODE_THROTTLE_MS) { img.close(); return; }
        lastDecodeAt = now;
        try {
            Image.Plane yPlane = img.getPlanes()[0];
            ByteBuffer yBuf = yPlane.getBuffer();
            int w = img.getWidth(), h = img.getHeight();
            int rowStride = yPlane.getRowStride();
            byte[] y;
            if (rowStride == w) {
                y = new byte[yBuf.remaining()];
                yBuf.get(y);
            } else {
                y = new byte[w * h];
                byte[] row = new byte[rowStride];
                for (int rI = 0; rI < h; rI++) {
                    yBuf.get(row, 0, rowStride);
                    System.arraycopy(row, 0, y, rI * w, w);
                }
            }
            // y[] is compacted to w*h above (rowStride handled in the copy),
            // so the source's dataWidth is w in both cases.
            PlanarYUVLuminanceSource src =
                    new PlanarYUVLuminanceSource(y, w, h, 0, 0, w, h, false);
            BinaryBitmap bmp = new BinaryBitmap(new HybridBinarizer(src));
            Result res = zxing.decodeWithState(bmp);
            zxing.reset();
            if (res != null) onQrText(res.getText());
        } catch (Exception ignored) {
            // NotFoundException and friends: no QR in this frame, keep scanning.
            try { zxing.reset(); } catch (Exception ignored2) { }
        } finally {
            img.close();
        }
    }

    private void onQrText(String s) {
        if (done || s == null || !s.startsWith("PATCH:")) return;
        String[] p = s.split(":", 5);
        if (p.length != 5) return;
        int total, idx;
        try {
            total = Integer.parseInt(p[1]);
            idx = Integer.parseInt(p[2]);
        } catch (NumberFormatException e) { return; }
        String hash = p[3];
        String payload = p[4];
        if (total < 1 || total > MAX_FRAMES || idx < 0 || idx >= total) return;
        if (hash.length() != 64 || !hash.matches("[0-9a-fA-F]+")) return;
        if (payload.length() > MAX_PAYLOAD_CHARS) return;
        if (!hash.equalsIgnoreCase(curHash)) {
            chunks.clear();
            curHash = hash;
            curTotal = total;
        }
        chunks.put(idx, payload);
        final int got = chunks.size(), want = curTotal;
        runOnUiThread(() -> progressView.setText(
                "receiving patch: " + got + " / " + want + " frames"));
        if (got == want) finishReception();
    }

    private void finishReception() {
        done = true;
        String error = null, text = null, hash = curHash;
        try {
            StringBuilder b64 = new StringBuilder();
            for (int i = 0; i < curTotal; i++) {
                String c = chunks.get(i);
                if (c == null) { error = "missing frame " + i; break; }
                b64.append(c);
            }
            if (error == null) {
                byte[] deflated = Base64.decode(b64.toString(), Base64.DEFAULT);
                Inflater inf = new Inflater();
                inf.setInput(deflated);
                byte[] out = new byte[MAX_DECODED_BYTES];
                int n = inf.inflate(out);
                inf.end();
                if (!inf.finished() && n == MAX_DECODED_BYTES) error = "payload too large";
                else {
                    byte[] raw = Arrays.copyOf(out, n);
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] digest = md.digest(raw);
                    StringBuilder hex = new StringBuilder();
                    for (byte bb : digest) hex.append(String.format("%02x", bb));
                    if (!hex.toString().equalsIgnoreCase(hash)) {
                        error = "SHA-256 mismatch — patch refused (got " +
                                hex.substring(0, 16) + "…, expected " + hash.substring(0, 16) + "…)";
                    } else {
                        text = new String(raw, StandardCharsets.UTF_8);
                    }
                }
            }
        } catch (Exception e) {
            error = "reassembly failed: " + e;
        }
        Intent data = new Intent();
        data.putExtra(EXTRA_OK, error == null);
        if (text != null) data.putExtra(EXTRA_TEXT, text);
        if (hash != null) data.putExtra(EXTRA_HASH, hash);
        if (error != null) data.putExtra(EXTRA_ERROR, error);
        setResult(RESULT_OK, data);
        finish();
    }

    private void fail(String msg) {
        if (done) return;
        done = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_OK, false);
        data.putExtra(EXTRA_ERROR, msg);
        setResult(RESULT_OK, data);
        finish();
    }
}
