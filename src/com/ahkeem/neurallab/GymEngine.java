package com.ahkeem.neurallab;

import android.app.Activity;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * v65 Game Gym engine: the full-auto agent loop.
 *   perceive (JS bridge) -> decide (Gemini) -> act (JS bridge) -> judge (trinity)
 *
 * Guardrails (approved full-auto 2026-10-10, these stay):
 *  - stopRequested: volatile, checked before every action and inside every
 *    wait. STOP halts the loop promptly; nothing runs after it.
 *  - The engine ONLY ever touches the Gym WebView (the game page). It has no
 *    path to any other app or view.
 *  - Every action is logged (what / when / state before+after) via GymTrinity.
 *  - Cycle budget: MAX_CYCLES per run; degenerate loops are absorbed by the
 *    black hole (run halts, needs a fresh Start).
 */
public class GymEngine {

    public interface Listener {
        void onLog(String line);
        void onStatus(String status);
        void onStopped(String reason);
    }

    private static final int MAX_CYCLES = 25;
    private static final int MAX_ACTIONS_PER_PLAN = 8;
    private static final long POLL_MS = 200;
    private static final long EVAL_TIMEOUT_S = 20;

    private final Activity activity;
    private final WebView wv;
    private final Listener listener;
    private final GymTrinity trinity;
    private final String geminiKey;
    private final String geminiModel;

    private volatile boolean stopRequested = false;
    private volatile boolean running = false;
    private Thread loopThread;
    private String snipLib = "";

    public GymEngine(Activity activity, WebView wv, Listener listener,
                     GymTrinity trinity, String geminiKey, String geminiModel) {
        this.activity = activity;
        this.wv = wv;
        this.listener = listener;
        this.trinity = trinity;
        this.geminiKey = geminiKey == null ? "" : geminiKey;
        this.geminiModel = (geminiModel == null || geminiModel.isEmpty())
                ? "gemini-2.0-flash" : geminiModel;
        loadSnippets();
    }

    /** Read www/gymsnippets.js from assets so Java injects the exact tested file. */
    private void loadSnippets() {
        try {
            java.io.InputStream in = activity.getAssets().open("www/gymsnippets.js");
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int n;
            while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
            in.close();
            snipLib = buf.toString("UTF-8");
        } catch (Exception e) {
            log("bridge", "⚠️ could not load gymsnippets.js: " + e);
        }
    }

    public synchronized void start() {
        if (running) return;
        stopRequested = false;
        running = true;
        loopThread = new Thread(new Runnable() {
            @Override public void run() { loop(); }
        }, "gym-engine");
        loopThread.start();
    }

    public void stop() {
        stopRequested = true;
    }

    public boolean isRunning() { return running; }

    // ---------- JS bridge ----------

    /** evaluateJavascript must run on the UI thread; block the worker for the result. */
    private String evalSync(final String js) {
        final AtomicReference<String> out = new AtomicReference<>("");
        final CountDownLatch latch = new CountDownLatch(1);
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    wv.evaluateJavascript(js, new ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
                            out.set(value == null ? "" : value);
                            latch.countDown();
                        }
                    });
                } catch (Exception e) {
                    out.set("");
                    latch.countDown();
                }
            }
        });
        try {
            latch.await(EVAL_TIMEOUT_S, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return out.get();
    }

    /** Call a GYM_SNIP function and return its raw string result (unquoted). */
    private String callSnip(String expr) {
        // evaluateJavascript wraps string results in JSON quotes; strip one layer.
        String raw = evalSync(snipLib + "\n;GYM_SNIP." + expr + ";");
        return unquote(raw);
    }

    private static String unquote(String s) {
        if (s == null) return "";
        s = s.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            try {
                return new JSONObject("{\"v\":" + s + "}").optString("v", s);
            } catch (Exception e) {
                return s.substring(1, s.length() - 1);
            }
        }
        return s;
    }

    private JSONObject perceive() {
        String json = callSnip("perceive()");
        try {
            return new JSONObject(json);
        } catch (Exception e) {
            JSONObject o = new JSONObject();
            try { o.put("ready", false); o.put("reason", "bad perceive json"); } catch (Exception ignored) {}
            return o;
        }
    }

    // ---------- Gemini planner ----------

    private String geminiPlan(String prompt) {
        HttpURLConnection c = null;
        try {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + java.net.URLEncoder.encode(geminiModel, "UTF-8")
                    + ":generateContent?key=" + java.net.URLEncoder.encode(geminiKey, "UTF-8");
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            JSONObject body = new JSONObject();
            JSONArray contents = new JSONArray();
            JSONObject content = new JSONObject();
            JSONArray parts = new JSONArray();
            JSONObject part = new JSONObject();
            part.put("text", prompt);
            parts.put(part);
            content.put("parts", parts);
            contents.put(content);
            body.put("contents", contents);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.close();
            int code = c.getResponseCode();
            BufferedReader r = new BufferedReader(new InputStreamReader(
                    code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream(),
                    StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            r.close();
            if (code < 200 || code >= 300) return "GEMINI_HTTP_" + code + ": " + sb.toString();
            JSONObject resp = new JSONObject(sb.toString());
            StringBuilder text = new StringBuilder();
            JSONArray cands = resp.optJSONArray("candidates");
            if (cands != null && cands.length() > 0) {
                JSONArray ps = cands.getJSONObject(0).optJSONObject("content").optJSONArray("parts");
                if (ps != null) {
                    for (int i = 0; i < ps.length(); i++) {
                        text.append(ps.getJSONObject(i).optString("text", ""));
                    }
                }
            }
            return text.toString();
        } catch (Exception e) {
            return "GEMINI_ERROR: " + e;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Extract the first {...} JSON object from planner text, defensively. */
    static JSONObject extractPlan(String text) {
        if (text == null) return null;
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return new JSONObject(text.substring(start, end + 1));
        } catch (Exception e) {
            return null;
        }
    }

    /** Build the planner prompt: state + code + trinity memory. */
    static String buildPrompt(JSONObject state, GymTrinity trinity) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are the player-brain inside the Game Gym, an AI learning to reason by playing the puzzle game Untrusted.\n");
        sb.append("The game: an ASCII maze. Each level shows JavaScript in a code editor; some levels are IMPOSSIBLE by walking — you must EDIT the code (only inside editable regions) to change the rules, then re-run it.\n\n");
        sb.append("YOUR HANDS (only these actions exist):\n");
        sb.append("- {\"type\":\"write_code\",\"code\":\"<FULL level source with your edits>\"} — replaces the editor. Edit ONLY editable regions.\n");
        sb.append("- {\"type\":\"key\",\"key\":\"ArrowUp|ArrowDown|ArrowLeft|ArrowRight\"} — move the @ player.\n");
        sb.append("- {\"type\":\"execute\"} — re-run the level code after editing.\n");
        sb.append("- {\"type\":\"wait\",\"ms\":1500} — pause for the game to react.\n\n");
        sb.append("CURRENT STATE:\n").append(state.toString()).append("\n\n");
        sb.append("LEVEL CODE:\n").append(state.optString("code", "(empty)")).append("\n\n");
        sb.append("TRINITY MEMORY — approaches that failed before. Do not repeat them blindly:\n");
        sb.append(trinity.moleculeBlock()).append("\n");
        sb.append("SEALED GHOSTS (recent failed attempts):\n");
        sb.append(trinity.ghostBlock()).append("\n");
        sb.append("Respond with ONLY a JSON object: {\"reasoning\":\"<2-4 sentences>\",\"actions\":[...]}. Max 8 actions. Think like a hacker: read the code, find the rule that blocks you, change the rule.");
        return sb.toString();
    }

    // ---------- main loop ----------

    private void log(String kind, String text) {
        trinity.log(kind, text);
        final String line = "[" + kind + "] " + text;
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { listener.onLog(line); }
        });
    }

    private void status(final String s) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { listener.onStatus(s); }
        });
    }

    private boolean sleepInterruptible(long ms) {
        long waited = 0;
        while (waited < ms) {
            if (stopRequested) return false;
            try { Thread.sleep(Math.min(POLL_MS, ms - waited)); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
            waited += POLL_MS;
        }
        return !stopRequested;
    }

    private void finish(String reason) {
        running = false;
        trinity.persist(activity);
        final String r = reason;
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { listener.onStopped(r); }
        });
    }

    private void loop() {
        try {
            if (geminiKey.isEmpty()) {
                log("gym", "⚠️ no Gemini key — paste one in the 👁 Observer tab first.");
                finish("no Gemini key");
                return;
            }
            status("loading game…");
            long t0 = System.currentTimeMillis();
            String ready = "";
            while (System.currentTimeMillis() - t0 < 90000) {
                if (stopRequested) { finish("stopped"); return; }
                ready = callSnip("gameReady()");
                if ("ready".equals(ready)) break;
                if (!sleepInterruptible(1000)) { finish("stopped"); return; }
            }
            if (!"ready".equals(ready)) {
                log("gym", "⚠️ game never became ready (no window.game). Check network.");
                finish("game not ready");
                return;
            }
            log("gym", "game ready — starting full-auto run.");
            int cycle = 0;
            int startLevelReached = -1;
            while (!stopRequested && cycle < MAX_CYCLES) {
                cycle++;
                status("cycle " + cycle + "/" + MAX_CYCLES + " — perceiving…");
                JSONObject before = perceive();
                if (!before.optBoolean("ready", false)) {
                    log("gym", "perceive failed: " + before.optString("reason", "?") + " — retrying.");
                    if (!sleepInterruptible(2000)) break;
                    continue;
                }
                int lvlReached = before.optInt("levelReached", 0);
                if (startLevelReached < 0) startLevelReached = lvlReached;

                status("cycle " + cycle + " — thinking…");
                String prompt = buildPrompt(before, trinity);
                String planText = geminiPlan(prompt);
                if (stopRequested) break;
                if (planText.startsWith("GEMINI_")) {
                    log("gym", "⚠️ planner error: " + planText.substring(0, Math.min(200, planText.length())));
                    if (!sleepInterruptible(5000)) break;
                    continue;
                }
                JSONObject plan = extractPlan(planText);
                if (plan == null) {
                    log("gym", "⚠️ planner returned unparsable text — sealing as ghost.");
                    sealAttempt(before, "(unparsable)", new JSONArray(), "planner-unparsable");
                    if (!sleepInterruptible(3000)) break;
                    continue;
                }
                String reasoning = plan.optString("reasoning", "");
                JSONArray actions = plan.optJSONArray("actions");
                if (actions == null) actions = new JSONArray();
                // Validate + cap.
                List<JSONObject> valid = new ArrayList<>();
                for (int i = 0; i < actions.length() && valid.size() < MAX_ACTIONS_PER_PLAN; i++) {
                    JSONObject a = actions.optJSONObject(i);
                    if (a == null) continue;
                    String t = a.optString("type", "");
                    if ("write_code".equals(t) || "key".equals(t) || "execute".equals(t) || "wait".equals(t)) {
                        valid.add(a);
                    }
                }
                if (valid.isEmpty()) {
                    log("gym", "plan had no valid actions — sealing as ghost.");
                    sealAttempt(before, reasoning, new JSONArray(), "empty-plan");
                    if (!sleepInterruptible(3000)) break;
                    continue;
                }
                log("plan", "reasoning: " + reasoning);

                // Pre-check: is this approach already absorbed by the black hole?
                String codeHash = planCodeHash(valid);
                if (codeHash != null && trinity.isAbsorbed(codeHash)) {
                    log("blackhole", "approach " + codeHash + " already absorbed — skipping plan.");
                    if (!sleepInterruptible(2000)) break;
                    continue;
                }

                // ACT.
                status("cycle " + cycle + " — acting…");
                JSONObject beforeAct = perceive();
                for (JSONObject a : valid) {
                    if (stopRequested) break;
                    String res = doAction(a);
                    String desc = describeAction(a);
                    JSONObject afterAct = perceive();
                    trinity.log("action", desc + " -> " + res
                            + " | player " + playerStr(beforeAct) + "→" + playerStr(afterAct));
                    final String line = "› " + desc + " → " + res;
                    activity.runOnUiThread(new Runnable() {
                        @Override public void run() { listener.onLog(line); }
                    });
                    if (!sleepInterruptible(400)) break;
                }
                if (stopRequested) break;
                if (!sleepInterruptible(1500)) break; // let the game react

                // JUDGE.
                JSONObject after = perceive();
                String outcome = judge(before, after);
                log("judge", outcome + " (levelReached " + before.optInt("levelReached", 0)
                        + "→" + after.optInt("levelReached", 0) + ")");
                if ("level-complete".equals(outcome)) {
                    log("gym", "🎉 LEVEL COMPLETE — strategy logged.");
                    startLevelReached = after.optInt("levelReached", 0);
                    // Fresh context for the next level; keep going.
                    if (!sleepInterruptible(2000)) break;
                    continue;
                }
                String seal = sealAttempt(before, reasoning, new JSONArray(valid), outcome);
                log("ghost", "sealed " + seal + " (" + outcome + ")");
                if (codeHash != null && trinity.isAbsorbed(codeHash)) {
                    log("blackhole", "🕳️ degenerate loop absorbed (approach " + codeHash
                            + " failed 3x) — run halted. Tap Start for a fresh run.");
                    finish("absorbed by black hole");
                    return;
                }
            }
            if (stopRequested) finish("stopped");
            else finish("cycle budget exhausted (" + MAX_CYCLES + ")");
        } catch (Exception e) {
            log("gym", "⚠️ engine error: " + e);
            finish("engine error");
        }
    }

    private static String playerStr(JSONObject s) {
        try {
            JSONObject p = s.optJSONObject("player");
            return p == null ? "?" : p.optInt("x", -1) + "," + p.optInt("y", -1);
        } catch (Exception e) { return "?"; }
    }

    private String doAction(JSONObject a) {
        String t = a.optString("type", "");
        try {
            if ("write_code".equals(t)) {
                String code = a.optString("code", "");
                if (code.length() > 60000) return "code too long, skipped";
                return callSnip("writeCode(" + JSONObject.quote(code) + ")");
            } else if ("key".equals(t)) {
                String k = a.optString("key", "");
                if (!k.matches("Arrow(Up|Down|Left|Right)|Enter")) return "bad key, skipped";
                return callSnip("sendKey(" + JSONObject.quote(k) + ")");
            } else if ("execute".equals(t)) {
                return callSnip("execute()");
            } else if ("wait".equals(t)) {
                long ms = a.optLong("ms", 1500);
                ms = Math.max(200, Math.min(10000, ms));
                sleepInterruptible(ms);
                return "waited " + ms + "ms";
            }
        } catch (Exception e) {
            return "action error: " + e;
        }
        return "unknown";
    }

    private static String describeAction(JSONObject a) {
        String t = a.optString("type", "?");
        if ("write_code".equals(t)) return "write_code (" + a.optString("code", "").length() + " chars)";
        if ("key".equals(t)) return "key " + a.optString("key", "?");
        return t;
    }

    private static String planCodeHash(List<JSONObject> actions) {
        for (JSONObject a : actions) {
            if ("write_code".equals(a.optString("type", ""))) {
                return GymTrinity.shortHash(a.optString("code", ""));
            }
        }
        return null;
    }

    /** level-complete | died | no-progress */
    private static String judge(JSONObject before, JSONObject after) {
        int l0 = before.optInt("levelReached", 0);
        int l1 = after.optInt("levelReached", 0);
        if (l1 > l0) return "level-complete";
        if (after.optBoolean("dead", false)) return "died";
        String c0 = before.optString("chapter", "");
        String c1 = after.optString("chapter", "");
        if (!c0.equals(c1) && c1.length() > 0) return "level-complete";
        return "no-progress";
    }

    /** Seal the whole attempt as a ghost (perception + reasoning + actions + outcome). */
    private String sealAttempt(JSONObject before, String reasoning, JSONArray actions, String outcome) {
        try {
            JSONObject attempt = new JSONObject();
            JSONObject perception = new JSONObject();
            perception.put("player", before.optJSONObject("player"));
            perception.put("level", before.opt("level"));
            perception.put("levelReached", before.optInt("levelReached", 0));
            perception.put("inventory", before.optJSONArray("inventory"));
            perception.put("chapter", before.optString("chapter", ""));
            // Compact maze: store as joined rows (1250 chars for 50x25).
            JSONArray maze = before.optJSONArray("maze");
            if (maze != null) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < maze.length(); i++) sb.append(maze.optString(i)).append('\n');
                perception.put("maze", sb.toString());
            }
            String code = before.optString("code", "");
            perception.put("codeHash", GymTrinity.shortHash(code));
            perception.put("codeLen", code.length());
            attempt.put("perception", perception);
            attempt.put("reasoning", reasoning);
            // Store actions with code bodies capped (full code lives in the page).
            JSONArray safeActs = new JSONArray();
            for (int i = 0; i < actions.length(); i++) {
                JSONObject a = new JSONObject(actions.getJSONObject(i).toString());
                String c = a.optString("code", null);
                if (c != null && c.length() > 4000) {
                    a.put("code", c.substring(0, 4000) + "…[truncated]");
                    a.put("codeHash", GymTrinity.shortHash(c));
                } else if (c != null) {
                    a.put("codeHash", GymTrinity.shortHash(c));
                }
                safeActs.put(a);
            }
            attempt.put("actions", safeActs);
            attempt.put("outcome", outcome);
            attempt.put("level", String.valueOf(before.opt("level")));
            return trinity.sealGhost(attempt);
        } catch (Exception e) {
            return "seal-error";
        }
    }
}
