package com.ahkeem.neurallab;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * v65 Game Gym trinity — session archive (v61 lineage).
 *
 * His locked spec:
 *  - Ghost: minted ONLY when main() itself fails — here, a failed ATTEMPT
 *    (one perceive→decide→act→judge cycle). The WHOLE attempt's record
 *    (perception snapshot + reasoning + actions + outcome), checksum-sealed
 *    with SHA-256. Never fragments.
 *  - Unstable molecule: a FAILED GHOST — when the same approach fails again,
 *    the ghost breaks into adaptive steering strings that bias the planner
 *    away from the failed approach family. Molecules never come from
 *    rejected outputs; only from failed ghosts.
 *  - Black hole: degenerate loops (the same failed code-hash 3 times) are
 *    absorbed — the run halts with status 'absorbed' instead of spinning.
 *
 * Attempt log + ghosts persist to app-private files so the Gym tab in the
 * main WebView can render them via NB.gymArchive().
 */
public class GymTrinity {

    private static final String LOG_FILE = "gym_log.json";
    private static final String GHOST_FILE = "gym_ghosts.json";
    private static final int MAX_LOG = 300;
    private static final int BLACK_HOLE_REPEATS = 3;

    /** Sealed ghosts, in seal order. */
    public final List<JSONObject> ghosts = new ArrayList<>();
    /** Live molecules: steering strings fed into the planner prompt. */
    public final List<String> molecules = new ArrayList<>();
    /** codeHash -> consecutive failure count (for repeat/molecule/black-hole). */
    private final Map<String, Integer> approachFails = new HashMap<>();
    /** Human-readable attempt log lines. */
    public final List<JSONObject> log = new ArrayList<>();

    public GymTrinity(Context ctx) {
        loadInto(ctx, GHOST_FILE, ghosts);
        loadInto(ctx, LOG_FILE, log);
    }

    public static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "nohash";
        }
    }

    public static String shortHash(String s) {
        String h = sha256(s == null ? "" : s);
        return h.length() >= 8 ? h.substring(0, 8) : h;
    }

    /** Append a timestamped attempt-log entry (action, event, judgement...). */
    public synchronized void log(String kind, String text) {
        try {
            JSONObject e = new JSONObject();
            e.put("ts", System.currentTimeMillis());
            e.put("kind", kind);
            e.put("text", text);
            log.add(e);
            while (log.size() > MAX_LOG) log.remove(0);
        } catch (Exception ignored) { }
    }

    /**
     * Seal a failed attempt as a ghost. attemptJson must contain:
     * perception, reasoning, actions, outcome.
     * Returns the seal id (sha256:8).
     */
    public synchronized String sealGhost(JSONObject attempt) {
        String seal;
        try {
            String canon = attempt.toString();
            seal = shortHash(canon);
            JSONObject g = new JSONObject();
            g.put("seal", seal);
            g.put("sha256", sha256(canon));
            g.put("ts", System.currentTimeMillis());
            g.put("attempt", attempt);
            ghosts.add(g);

            // Track the approach family by code-hash of any write_code action.
            String codeHash = approachCodeHash(attempt);
            if (codeHash != null) {
                int n = approachFails.containsKey(codeHash) ? approachFails.get(codeHash) : 0;
                approachFails.put(codeHash, n + 1);
                if (n + 1 == 2) {
                    // Failed ghost fails AGAIN -> break into molecules, once.
                    // A third failure is the black hole's (see isAbsorbed).
                    breakIntoMolecules(g, codeHash, n + 1);
                }
            }
        } catch (Exception e) {
            seal = "seal-error";
        }
        return seal;
    }

    /** Extract the code-hash of the attempt's write_code action, if any. */
    private static String approachCodeHash(JSONObject attempt) {
        try {
            JSONArray acts = attempt.optJSONArray("actions");
            if (acts == null) return null;
            for (int i = 0; i < acts.length(); i++) {
                JSONObject a = acts.optJSONObject(i);
                if (a != null && "write_code".equals(a.optString("type"))) {
                    return shortHash(a.optString("code", ""));
                }
            }
        } catch (Exception ignored) { }
        return null;
    }

    /** A failed ghost breaks into adaptive steering fragments. */
    private void breakIntoMolecules(JSONObject ghost, String codeHash, int fails) {
        try {
            JSONObject attempt = ghost.getJSONObject("attempt");
            String outcome = attempt.optString("outcome", "failed");
            String reasoning = attempt.optString("reasoning", "");
            if (reasoning.length() > 160) reasoning = reasoning.substring(0, 160) + "…";
            String level = attempt.optString("level", "?");
            molecules.add("REPEAT FAILURE (" + fails + "x) on level " + level
                    + ", approach " + codeHash + ": " + outcome
                    + ". Reasoning was: \"" + reasoning + "\"."
                    + " Do NOT retry this edit family; find a structurally different rule change.");
            while (molecules.size() > 40) molecules.remove(0);
            log("molecule", "ghost " + ghost.optString("seal")
                    + " broke into a molecule (" + fails + "x repeat)");
        } catch (Exception ignored) { }
    }

    /** True when this approach has failed enough times to be absorbed. */
    public synchronized boolean isAbsorbed(String codeHash) {
        if (codeHash == null) return false;
        Integer n = approachFails.get(codeHash);
        return n != null && n >= BLACK_HOLE_REPEATS;
    }

    /** Consecutive failures for an approach family (for the judge). */
    public synchronized int failCount(String codeHash) {
        if (codeHash == null) return 0;
        Integer n = approachFails.get(codeHash);
        return n == null ? 0 : n;
    }

    /** Planner prompt block: live molecules as AVOID lines. */
    public synchronized String moleculeBlock() {
        if (molecules.isEmpty()) return "(no failed approaches yet — clean slate)";
        StringBuilder sb = new StringBuilder();
        for (String m : molecules) sb.append("- AVOID: ").append(m).append('\n');
        return sb.toString();
    }

    /** Recent ghost summaries for the planner (last 3, compact). */
    public synchronized String ghostBlock() {
        if (ghosts.isEmpty()) return "(none)";
        StringBuilder sb = new StringBuilder();
        int start = Math.max(0, ghosts.size() - 3);
        for (int i = start; i < ghosts.size(); i++) {
            try {
                JSONObject g = ghosts.get(i);
                JSONObject a = g.getJSONObject("attempt");
                sb.append("- ghost ").append(g.optString("seal"))
                  .append(" [level ").append(a.optString("level", "?"))
                  .append(", ").append(a.optString("outcome", "?")).append("]: ")
                  .append(a.optString("reasoning", "").length() > 120
                          ? a.optString("reasoning", "").substring(0, 120) + "…"
                          : a.optString("reasoning", ""))
                  .append('\n');
            } catch (Exception ignored) { }
        }
        return sb.toString();
    }

    public synchronized void persist(Context ctx) {
        saveList(ctx, GHOST_FILE, ghosts);
        saveList(ctx, LOG_FILE, log);
    }

    // ---- file helpers (app-private) ----

    private static void loadInto(Context ctx, String name, List<JSONObject> out) {
        try {
            File f = new File(ctx.getFilesDir(), name);
            if (!f.exists()) return;
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int n;
            while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
            in.close();
            JSONArray arr = new JSONArray(buf.toString("UTF-8"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getJSONObject(i));
        } catch (Exception ignored) { }
    }

    private static void saveList(Context ctx, String name, List<JSONObject> list) {
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject o : list) arr.put(o);
            FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), name));
            out.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            out.close();
        } catch (Exception ignored) { }
    }

    /** For NB.gymArchive(): raw file contents (or "[]"). */
    public static String readFile(Context ctx, String name) {
        try {
            File f = new File(ctx.getFilesDir(), name);
            if (!f.exists()) return "[]";
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int n;
            long total = 0;
            while ((n = in.read(tmp)) != -1) {
                total += n;
                if (total > 2 * 1024 * 1024) { in.close(); return "[]"; }
                buf.write(tmp, 0, n);
            }
            in.close();
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return "[]";
        }
    }

    public static String readLogFile(Context ctx) { return readFile(ctx, LOG_FILE); }
    public static String readGhostFile(Context ctx) { return readFile(ctx, GHOST_FILE); }
}
