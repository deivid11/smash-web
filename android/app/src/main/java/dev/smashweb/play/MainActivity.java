package dev.smashweb.play;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Single-activity WebView shell for recent Android phones.
 *
 * <p>The packaged browser build (android assets/dist/, copied from the
 * repository dist-android/ at build time) is served at the hosted origin
 * {@link #ORIGIN} by {@link PackagedOrigin}: every non-/api request on that
 * host is answered from the APK, while /api/* is left to the real network.
 * Serving from an https origin instead of file:// is what makes the game
 * work at all inside a WebView: file:// pages cannot fetch() (gameplay WASM),
 * Cache Storage rejects file:// keys (offline data never persisted), and
 * same-origin /api gets genuine 206 range replies plus the rooms WebSocket.
 * The shell still boots offline because the page itself never touches the
 * network. A trusted-LAN dev URL passed via the {@code SMASH_URL} intent
 * extra bypasses the packaged origin entirely.
 *
 * <p>Phone-paired controllers cannot use the HTML5 Gamepad API (absent from
 * mobile browsers and WebViews), so all key/motion events are forwarded into
 * {@link SmashPadBridge}, which the web tick polls as standard-layout pads. */
public final class MainActivity extends Activity {
    /** Hosted game origin: page served from the APK, /api from the network. */
    static final String ORIGIN_HOST = BuildConfig.ORIGIN_HOST;
    static final String ORIGIN = "https://" + ORIGIN_HOST;
    static final String DEFAULT_URL = ORIGIN + "/play.html";
    private static final String TAG = "SmashWeb";
    private WebView web;
    private SmashPadBridge bridge;
    private AppUpdater updater;
    private WebBundles bundles;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();

        bridge = new SmashPadBridge(this);
        // Debug builds only: inspect the shell via desktop Chrome
        // chrome://inspect while the phone is on USB/Wi-Fi adb.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Nothing loads from file:// anymore (see PackagedOrigin).
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Explicit default: a poisoned profile cache must never force
        // cache-only loads (net::ERR_CACHE_MISS with working internet).
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Drop the `; wv` token so middleboxes/WAFs treat the shell like the
        // stock browser (same engine, no behavioral difference otherwise).
        String ua = settings.getUserAgentString();
        if (ua != null && ua.contains("; wv")) {
            settings.setUserAgentString(ua.replace("; wv", ""));
        }
        web.addJavascriptInterface(bridge, "SmashPad");
        web.addJavascriptInterface(new SmashFresh(), "SmashFresh");
        // Game code: newest compatible bundle (downloaded or built in), see WebBundles.
        bundles = new WebBundles(this);
        // Self-update channels (see AppUpdater); debug builds accept test URLs.
        updater = new AppUpdater(this, new UpdateHost(), getIntent().getStringExtra("SMASH_UPDATE_URL"),
                getIntent().getStringExtra("SMASH_WEB_UPDATE_URL"));
        updater.register();
        web.addJavascriptInterface(new SmashUpdate(), "SmashUpdate");
        final PackagedOrigin packaged = new PackagedOrigin(bundles);
        web.setWebViewClient(new ShellClient(packaged));
        // A service worker from the real server (or an older install) must
        // never answer shell requests with a different build: worker fetches
        // on the packaged origin are served from the APK too.
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return packaged.serve(request);
                }
            });
        } catch (Exception unused) {
            // Platforms without worker support simply have no workers to guard.
        }

        setContentView(web);
        String url = getIntent().getStringExtra("SMASH_URL");
        if (url == null || url.isEmpty()) {
            url = DEFAULT_URL;
        }
        // Native pre-flight against the data API (the page itself is local):
        // shown on the error page so a failure names WHICH layer fails.
        probeUrl(url.startsWith(ORIGIN + "/") ? ORIGIN + "/api/source" : url);
        web.loadUrl(url);
    }

    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        decor.setSystemUiVisibility(flags);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
        }
        if (updater != null) {
            updater.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (updater != null) {
            updater.unregister();
        }
        if (web != null) {
            web.removeJavascriptInterface("SmashPad");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getStringExtra("SMASH_URL");
        if (url != null && !url.isEmpty() && web != null) {
            web.loadUrl(url);
        }
    }

    private static boolean isGamepadEvent(InputDevice device) {
        if (device == null) {
            return false;
        }
        int sources = device.getSources();
        return (sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private static String deviceName(InputDevice device, KeyEvent event) {
        if (device != null && device.getName() != null) {
            return device.getName();
        }
        return "Android controller " + event.getDeviceId();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        InputDevice device = event.getDevice();
        if (bridge != null && isGamepadEvent(device)
                && event.getAction() != KeyEvent.ACTION_MULTIPLE) {
            int keyCode = event.getKeyCode();
            if (SmashPadBridge.buttonIndexForKeyCode(keyCode) >= 0
                    || keyCode == KeyEvent.KEYCODE_BUTTON_MODE) {
                boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
                bridge.onKey(event.getDeviceId(), deviceName(device, event), keyCode, down);
                return true; // Consume: pads drive the game, not Android UI sounds.
            }
        } else if (bridge != null && event.getAction() == KeyEvent.ACTION_UP
                && device != null && isGamepadEvent(device)) {
            bridge.onKey(event.getDeviceId(), deviceName(device, event), event.getKeyCode(), false);
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        InputDevice device = event.getDevice();
        if (bridge != null && device != null && isGamepadEvent(device)
                && (event.getSource() & InputDevice.SOURCE_JOYSTICK) != 0) {
            String name = device.getName() != null ? device.getName() : "Android controller";
            bridge.onMotion(event.getDeviceId(), name, event);
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    /** Last native-stack probe result, shown on the error page next to the
     * WebView's own reason (volatile: written on a worker, read on UI). */
    private static volatile String probeResult = "probe: not run yet";

    private static void probeUrl(final String url) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                long start = System.currentTimeMillis();
                java.net.HttpURLConnection connection = null;
                try {
                    connection = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(10000);
                    connection.setInstanceFollowRedirects(true);
                    int code = connection.getResponseCode();
                    probeResult = "direct check " + url + ": HTTP " + code + " in "
                            + (System.currentTimeMillis() - start) + " ms";
                } catch (Exception e) {
                    probeResult = "direct check " + url + " failed: " + e.getClass().getSimpleName()
                            + (e.getMessage() == null ? "" : ": " + e.getMessage());
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
                android.util.Log.i(TAG, probeResult);
            }
        }).start();
    }

    /** Updater services: web bundles, match-aware prompts and page reloads. */
    private final class UpdateHost implements AppUpdater.Host {
        @Override
        public WebBundles bundles() {
            return bundles;
        }

        @Override
        public void whenIdle(final Runnable idle, final Runnable playing) {
            if (web == null) {
                playing.run();
                return;
            }
            web.evaluateJavascript("document.querySelector('.game-app.in-match') !== null",
                    value -> ("true".equals(value) ? playing : idle).run());
        }

        @Override
        public void reloadGame() {
            if (web != null) {
                web.loadUrl(DEFAULT_URL);
            }
        }

        @Override
        public void stateChanged() {
            final WebView target = web;
            if (target != null) {
                target.post(() -> target.evaluateJavascript("window.dispatchEvent(new Event('smash-update-state'))", null));
            }
        }
    }

    /** Page-facing update controls (Options → Downloaded data): versions + manual check. */
    private final class SmashUpdate {
        @android.webkit.JavascriptInterface
        public String version() {
            return updater != null ? updater.versions() : AppUpdater.installedVersionName();
        }

        @android.webkit.JavascriptInterface
        public String state() {
            return updater != null ? updater.stateJson() : "{}";
        }

        @android.webkit.JavascriptInterface
        public void apply() {
            runOnUiThread(() -> {
                if (updater != null) {
                    updater.apply();
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void check() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (updater != null) {
                        updater.check(true);
                    }
                }
            });
        }
    }

    /** Cache purge + fresh load for poisoned-profile ERR_CACHE_MISS states.
     * Called from the error page's second button (android.js interface). */
    private final class SmashFresh {
        @android.webkit.JavascriptInterface
        public void reloadFresh() {
            final WebView target = web;
            if (target == null) {
                return;
            }
            target.post(new Runnable() {
                @Override
                public void run() {
                    target.clearCache(true);
                    String url = getIntent().getStringExtra("SMASH_URL");
                    if (url == null || url.isEmpty()) {
                        url = DEFAULT_URL;
                    }
                    target.loadUrl(url);
                }
            });
        }
    }

    /** Serves the current game-code bundle ({@link WebBundles}: the newest compatible
     * downloaded bundle, else the one packaged in assets/dist/) at {@link #ORIGIN},
     * the same technique as AndroidX WebViewAssetLoader without the dependency.
     * Only GET/HEAD on the packaged host are answered; /api/* returns null so
     * the WebView's own network stack reaches the real server (range reads,
     * rooms WebSocket, offline Cache Storage all same-origin). Unknown paths
     * get a local 404 — a shell request must never fall through to whatever
     * build the server happens to host. */
    static final class PackagedOrigin {
        private static final Map<String, String> MIME = new HashMap<>();

        static {
            MIME.put("html", "text/html");
            MIME.put("js", "text/javascript");
            MIME.put("mjs", "text/javascript");
            MIME.put("css", "text/css");
            MIME.put("wasm", "application/wasm");
            MIME.put("json", "application/json");
            MIME.put("map", "application/json");
            MIME.put("txt", "text/plain");
            MIME.put("svg", "image/svg+xml");
            MIME.put("png", "image/png");
            MIME.put("jpg", "image/jpeg");
            MIME.put("jpeg", "image/jpeg");
            MIME.put("webp", "image/webp");
            MIME.put("gif", "image/gif");
            MIME.put("ico", "image/x-icon");
            MIME.put("woff", "font/woff");
            MIME.put("woff2", "font/woff2");
            MIME.put("ttf", "font/ttf");
            MIME.put("otf", "font/otf");
            MIME.put("mp3", "audio/mpeg");
            MIME.put("ogg", "audio/ogg");
            MIME.put("wav", "audio/wav");
            MIME.put("m4a", "audio/mp4");
            MIME.put("mp4", "video/mp4");
            MIME.put("webm", "video/webm");
        }

        private final WebBundles bundles;

        PackagedOrigin(WebBundles bundles) {
            this.bundles = bundles;
        }

        WebResourceResponse serve(WebResourceRequest request) {
            Uri url;
            try {
                url = request.getUrl();
            } catch (Exception unused) {
                return null;
            }
            if (url == null || !"https".equalsIgnoreCase(url.getScheme())
                    || !ORIGIN_HOST.equalsIgnoreCase(url.getHost())) {
                return null;
            }
            String path = url.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "/play.html";
            }
            if (path.startsWith("/api/")) {
                return null;
            }
            String method = request.getMethod();
            if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                return notFound();
            }
            if (path.contains("..") || path.contains("\\")) {
                return notFound();
            }
            try {
                byte[] body = bundles.read(path);
                if (body == null) {
                    return notFound();
                }
                String mime = mimeFor(path);
                if (path.equals("/play.html")) {
                    body = stampServerSource(body);
                }
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("Content-Length", String.valueOf(body.length));
                String encoding = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")
                        ? "utf-8" : null;
                return new WebResourceResponse(mime, encoding, 200, "OK", headers, new ByteArrayInputStream(body));
            } catch (IOException missing) {
                return notFound();
            }
        }

        /** Same server-source meta the LAN server injects (server/http.ts):
         * the packaged page is backed by the hosted /api source. */
        private static byte[] stampServerSource(byte[] html) {
            String text = new String(html, StandardCharsets.UTF_8);
            if (!text.contains("</head>") || text.contains("name=\"smash-source\"")) {
                return html;
            }
            text = text.replace("</head>", "<meta name=\"smash-source\" content=\"server\">\n</head>");
            return text.getBytes(StandardCharsets.UTF_8);
        }

        private static String mimeFor(String path) {
            int dot = path.lastIndexOf('.');
            String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
            String mime = MIME.get(ext);
            return mime != null ? mime : "application/octet-stream";
        }

        private static WebResourceResponse notFound() {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    /** Stays inside the shell, serves the packaged origin, and renders an
     * explicit Smash Web error page for main-frame failures (SMASH_URL dev
     * loads; the packaged origin itself never needs the network to render)
     * with the failing URL, the system reason, the native probe and retry
     * actions instead of the stock "Webpage not available" text. */
    @SuppressWarnings("deprecation")
    private static final class ShellClient extends android.webkit.WebViewClient {
        private final PackagedOrigin packaged;

        ShellClient(PackagedOrigin packaged) {
            this.packaged = packaged;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return false;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse local = packaged.serve(request);
            return local != null ? local : super.shouldInterceptRequest(view, request);
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            showLoadError(view, failingUrl, description);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            if (request.isForMainFrame()) {
                showLoadError(view, request.getUrl().toString(), String.valueOf(error.getDescription()));
            }
        }

        private static void showLoadError(WebView view, String failingUrl, String reason) {
            String safeUrl = failingUrl == null ? "" : failingUrl.replace("&", "&amp;").replace("<", "&lt;");
            String safeReason = reason == null ? "" : reason.replace("&", "&amp;").replace("<", "&lt;");
            String probe = probeResult.replace("&", "&amp;").replace("<", "&lt;");
            String html = "<!doctype html><html><head><meta charset='utf-8'>"
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                    + "<title>Smash Web — offline</title>"
                    + "<style>body{margin:0;background:#080d1b;color:#f5f6ff;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}"
                    + ".card{max-width:520px;text-align:center;border:1px solid #4b6b5c;border-radius:12px;background:#0d171d;padding:32px 28px}"
                    + "h1{font-style:italic;margin:0 0 12px;font-size:26px}h1 span{color:#ff3d52}"
                    + "p{color:#b5c6bc;font-size:14px;line-height:1.7}a.retry{display:inline-block;margin-top:16px;padding:12px 28px;background:#ffe769;color:#0b1020;border-radius:4px;font-weight:800;text-decoration:none}"
                    + "code{color:#8c9ab1;font-size:12px;word-break:break-all}</style></head><body><div class='card'>"
                    + "<h1>SMASH<span>WEB</span> is offline</h1>"
                    + "<p>The game page could not be loaded. Open it once with internet so the app "
                    + "downloads the game, then it plays offline.</p>"
                    + "<p><code>" + safeUrl + "</code><br><code>" + safeReason + "</code><br><code>" + probe + "</code></p>"
                    + "<p><code>shell " + BuildConfig.BUILD_STAMP + "</code></p>"
                    + "<a class='retry' href='" + safeUrl + "'>Try again</a> "
                    + "<a class='retry' style='background:#172136;color:#bdc9dd;border:1px solid #7485a23d' "
                    + "href='javascript:void(0)' onclick='(window.SmashFresh&&SmashFresh.reloadFresh())||location.reload()'>Clear cache &amp; retry</a>"
                    + "</div></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }
    }
}
