package com.ahkeem.neurallab;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Neural Lab v60 "Observer" — the read-only eyes of Ahkeem's agent loop.
 *
 * READ-ONLY BY CONSTRUCTION: this file contains ZERO performAction() calls.
 * It can see the screen's content tree but cannot tap, scroll, type, or
 * change anything. The action layer does not exist yet — safety by
 * architecture, not by promise.
 *
 * It watches for window changes, builds a compact text summary of what is
 * on screen, and broadcasts it to MainActivity via OBSERVER_STATE. The
 * WebView side (observer.js) throttles Gemini narration calls from there.
 */
public class ObserverService extends AccessibilityService {

    public static final String ACTION_STATE =
            "com.ahkeem.neurallab.OBSERVER_STATE";
    public static final String EXTRA_PACKAGE = "package";
    public static final String EXTRA_SUMMARY = "summary";

    private static final long CONTENT_DEBOUNCE_MS = 3000;
    private static final int MAX_NODES = 200;
    private static final int MAX_DEPTH = 12;
    private static final int MAX_SUMMARY_CHARS = 4000;

    private long lastContentProcess = 0;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            process();
        } else if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            long now = System.currentTimeMillis();
            if (now - lastContentProcess >= CONTENT_DEBOUNCE_MS) {
                lastContentProcess = now;
                process();
            }
        }
    }

    private void process() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            StringBuilder sb = new StringBuilder();
            int[] count = new int[]{0};
            walk(root, sb, 0, count);
            if (sb.length() == 0) return;
            String summary = sb.toString();
            if (summary.length() > MAX_SUMMARY_CHARS) {
                summary = summary.substring(0, MAX_SUMMARY_CHARS);
            }
            Intent i = new Intent(ACTION_STATE);
            i.setPackage(getPackageName());
            i.putExtra(EXTRA_PACKAGE,
                    root.getPackageName() != null ? root.getPackageName().toString() : "?");
            i.putExtra(EXTRA_SUMMARY, summary);
            sendBroadcast(i);
        } catch (Exception ignored) {
        } finally {
            root.recycle();
        }
    }

    private void walk(AccessibilityNodeInfo node, StringBuilder sb, int depth, int[] count) {
        if (node == null || depth > MAX_DEPTH || count[0] >= MAX_NODES) return;
        try {
            CharSequence text = node.getText();
            CharSequence desc = node.getContentDescription();
            String t = text != null ? text.toString().trim() : "";
            String d = desc != null ? desc.toString().trim() : "";
            String shown = !t.isEmpty() ? t : d;
            boolean meaningful = !shown.isEmpty()
                    && (node.isClickable() || node.isScrollable() || node.isEditable()
                        || "android.widget.Button".equals(simpleName(node))
                        || "android.widget.EditText".equals(simpleName(node)));
            if (meaningful && sb.length() < MAX_SUMMARY_CHARS) {
                if (shown.length() > 120) shown = shown.substring(0, 120);
                StringBuilder line = new StringBuilder();
                if (node.isEditable()) line.append("[editable] ");
                else if (node.isClickable()) line.append("[clickable] ");
                else if (node.isScrollable()) line.append("[scrollable] ");
                else line.append("[text] ");
                line.append(simpleName(node)).append(" \"").append(shown).append("\"\n");
                sb.append(line);
                count[0]++;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                walk(child, sb, depth + 1, count);
                if (child != null) child.recycle();
            }
        } catch (Exception ignored) {
        }
    }

    private String simpleName(AccessibilityNodeInfo node) {
        CharSequence cn = node.getClassName();
        if (cn == null) return "?";
        String s = cn.toString();
        int dot = s.lastIndexOf('.');
        return dot >= 0 ? s.substring(dot + 1) : s;
    }

    @Override
    public void onInterrupt() {
        // nothing to interrupt — read-only observer
    }
}
