package com.ahkeem.neurallab;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * v65 Game Gym arena.
 * A dedicated activity hosting the Untrusted game in its own WebView plus the
 * agent controls. The agent (GymEngine) ONLY ever touches this WebView —
 * it has no path to anything else on the phone.
 *
 * Full-auto was approved by Ahkeem 2026-10-10; the guardrails that stay:
 *  - the big red STOP button halts the loop promptly (checked between every
 *    action and inside every wait),
 *  - every action is logged with what/when/state before+after,
 *  - the attempt log + ghost archive persist for review in the Gym tab.
 */
public class GymActivity extends Activity {

    public static final String GAME_URL = "https://untrustedgame.com/";

    private WebView gameView;
    private TextView statusView;
    private TextView logView;
    private ScrollView logScroll;
    private Button startBtn;
    private Button stopBtn;
    private GymEngine engine;
    private GymTrinity trinity;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String key = getIntent().getStringExtra("gemini_key");
        String model = getIntent().getStringExtra("gemini_model");

        trinity = new GymTrinity(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0d1117"));

        // Game WebView (the arena).
        gameView = new WebView(this);
        LinearLayout.LayoutParams wvp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f);
        gameView.setLayoutParams(wvp);
        WebSettings s = gameView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // the game uses localStorage
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        // Keep navigation inside the arena.
        gameView.setWebViewClient(new WebViewClient());
        root.addView(gameView);

        // Status line.
        statusView = new TextView(this);
        statusView.setText("🎮 Game Gym — idle");
        statusView.setTextColor(Color.parseColor("#e6edf3"));
        statusView.setTextSize(14);
        statusView.setPadding(dp(12), dp(8), dp(12), dp(8));
        root.addView(statusView);

        // Controls: Start + STOP (both >= 48dp touch targets).
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(dp(12), dp(4), dp(12), dp(4));
        startBtn = new Button(this);
        startBtn.setText("▶ Start run");
        startBtn.setMinHeight(dp(48));
        LinearLayout.LayoutParams sbp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        sbp.setMargins(0, 0, dp(8), 0);
        startBtn.setLayoutParams(sbp);
        stopBtn = new Button(this);
        stopBtn.setText("■ STOP");
        stopBtn.setMinHeight(dp(48));
        stopBtn.setBackgroundColor(Color.parseColor("#b3261e"));
        stopBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams tbp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        stopBtn.setLayoutParams(tbp);
        stopBtn.setEnabled(false);
        controls.addView(startBtn);
        controls.addView(stopBtn);
        root.addView(controls);

        // Event log.
        logScroll = new ScrollView(this);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(170));
        logScroll.setLayoutParams(slp);
        logView = new TextView(this);
        logView.setTextColor(Color.parseColor("#9fb3c8"));
        logView.setTextSize(12);
        logView.setTypeface(android.graphics.Typeface.MONOSPACE);
        logView.setPadding(dp(12), dp(4), dp(12), dp(12));
        logView.setText("Log: tap ▶ Start run once the game loads.\n"
                + "The agent plays full-auto inside this WebView only.\n"
                + "■ STOP halts it instantly. Every move is logged.\n");
        logScroll.addView(logView);
        root.addView(logScroll);

        setContentView(root);

        engine = new GymEngine(this, gameView, new GymEngine.Listener() {
            @Override public void onLog(final String line) {
                logView.append(line + "\n");
                logScroll.post(new Runnable() {
                    @Override public void run() { logScroll.fullScroll(View.FOCUS_DOWN); }
                });
            }
            @Override public void onStatus(final String st) {
                statusView.setText("🎮 " + st);
            }
            @Override public void onStopped(final String reason) {
                statusView.setText("🎮 stopped: " + reason);
                logView.append("— run ended: " + reason + " —\n");
                startBtn.setEnabled(true);
                stopBtn.setEnabled(false);
            }
        }, trinity, key, model);

        startBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                logView.append("▶ starting full-auto run…\n");
                startBtn.setEnabled(false);
                stopBtn.setEnabled(true);
                statusView.setText("🎮 starting…");
                engine.start();
            }
        });
        stopBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                engine.stop();
                statusView.setText("🎮 stopping…");
                logView.append("■ STOP tapped — halting.\n");
            }
        });

        gameView.loadUrl(GAME_URL);
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    protected void onDestroy() {
        if (engine != null) engine.stop();
        if (gameView != null) gameView.destroy();
        super.onDestroy();
    }
}
