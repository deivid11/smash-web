package dev.smashweb.play;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;

/** Self-update from the hosted release channel.
 *
 * <p>The server publishes {@code /android/latest.json}:
 * {@code {"versionCode":N,"versionName":"…","apk":"smash-web-N.apk","sha256":"<hex>","size":bytes}}
 * next to the immutable {@code smash-web-N.apk} (see docs/ANDROID.md). On launch
 * and on resume (at most every {@link #AUTO_CHECK_INTERVAL_MS}) the shell reads
 * the pointer natively; a newer versionCode offers Update / Later. The package is
 * downloaded into the app cache, verified against size + SHA-256, and handed to
 * {@link PackageInstaller}, whose system confirmation the user accepts. Android
 * itself refuses any package that is not signed with this app's key, so the
 * channel can only ever deliver builds from the same signer.
 *
 * <p>Install status comes back through a broadcast guarded by a signature-level
 * permission, so no other app can inject a fake "confirm" intent. */
final class AppUpdater {
    /** Activity services the updater needs for game-code (web bundle) updates. */
    interface Host {
        WebBundles bundles();

        /** Runs {@code idle} when no match is being played, else {@code playing}. */
        void whenIdle(Runnable idle, Runnable playing);

        /** Reloads the game page so a newly activated web bundle takes effect. */
        void reloadGame();

        /** Update state changed (the page re-reads {@link #stateJson()} for its update button). */
        void stateChanged();
    }

    static final String DEFAULT_CHANNEL = MainActivity.ORIGIN + "/android/latest.json";
    static final String DEFAULT_WEB_CHANNEL = MainActivity.ORIGIN + "/android/web/latest.json";
    static final String ACTION_INSTALL_STATUS = "dev.smashweb.play.action.INSTALL_STATUS";
    static final String STATUS_PERMISSION = "dev.smashweb.play.permission.INSTALL_STATUS";
    private static final String TAG = "SmashWebUpdate";
    /** Resume re-check spacing: short, so a site deploy shows up the next time the app is opened. */
    private static final long AUTO_CHECK_INTERVAL_MS = 2L * 60L * 1000L;
    private static final long MAX_APK_BYTES = 256L * 1024L * 1024L;
    private static final Pattern APK_NAME = Pattern.compile("^smash-web-[0-9]{1,12}\\.apk$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");

    /** Parsed + validated release pointer. */
    static final class Release {
        final int versionCode;
        final String versionName;
        final String apk;
        final String sha256;
        final long size;

        Release(int versionCode, String versionName, String apk, String sha256, long size) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apk = apk;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    private final Activity activity;
    private final Host host;
    private final String channel;
    private final String webChannel;
    /** Downloaded game code whose reload prompt was deferred because a match was running. */
    private WebBundles.Bundle deferredBundle = null;
    /** Visible update state for the page's update button (see {@link #stateJson()}). */
    private volatile String phase = "idle";
    private volatile String phaseMessage = "";
    /** Downloaded game code waiting for "Reload" (dialog or page button). */
    private volatile WebBundles.Bundle readyBundle = null;
    /** Newer APK offered by the channel, if any. */
    private volatile Release availableApp = null;
    private volatile long checkedAt = 0L;
    private volatile long progressDone = 0L;
    private volatile long progressTotal = 0L;
    private long lastCheck = 0L;
    private volatile boolean busy = false;
    private int dismissedVersion = 0;
    /** Verified package waiting for the "install unknown apps" grant. */
    private File pendingApk = null;
    private boolean receiverRegistered = false;

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                @SuppressWarnings("deprecation")
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    try {
                        activity.startActivity(confirm);
                    } catch (Exception e) {
                        showError("Android could not open the install confirmation: " + e.getMessage());
                    }
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                busy = false;
                showError("The update was not installed" + (message == null ? "." : ": " + message));
            }
        }
    };

    AppUpdater(Activity activity, Host host, String channelOverride, String webChannelOverride) {
        this.activity = activity;
        this.host = host;
        // Debug builds may point at test channels; release builds only trust the hosted https ones.
        this.channel = BuildConfig.DEBUG && channelOverride != null && !channelOverride.isEmpty()
                ? channelOverride : DEFAULT_CHANNEL;
        this.webChannel = BuildConfig.DEBUG && webChannelOverride != null && !webChannelOverride.isEmpty()
                ? webChannelOverride : DEFAULT_WEB_CHANNEL;
    }

    /** "app 2026.09.17-0135 · game 2026.09.17-0200 (downloaded)". */
    String versions() {
        return "app " + installedVersionName() + " · game " + host.bundles().describeCurrent();
    }

    /** JSON for the page: {app, appCode, game, phase, message, ready, appUpdate, done, total, checkedAt}.
     * phase: idle | checking | downloading | ready | app-update | up-to-date | error. */
    String stateJson() {
        try {
            JSONObject state = new JSONObject();
            state.put("app", installedVersionName());
            state.put("appCode", installedVersionCode());
            state.put("game", host.bundles().describeCurrent());
            state.put("phase", phase);
            state.put("message", phaseMessage);
            WebBundles.Bundle ready = readyBundle;
            state.put("ready", ready != null ? ready.label : JSONObject.NULL);
            Release app = availableApp;
            state.put("appUpdate", app != null ? app.versionName : JSONObject.NULL);
            state.put("done", progressDone);
            state.put("total", progressTotal);
            state.put("checkedAt", checkedAt);
            return state.toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    private void setPhase(String next, String message) {
        phase = next;
        phaseMessage = message == null ? "" : message;
        host.stateChanged();
    }

    /** Page update button: reload into ready game code, install a newer app, or check now. */
    void apply() {
        WebBundles.Bundle ready = readyBundle;
        if (ready != null) {
            applyReady(ready);
            return;
        }
        Release app = availableApp;
        if (app != null && !busy) {
            download(app);
            return;
        }
        check(true);
    }

    private void applyReady(WebBundles.Bundle bundle) {
        try {
            host.bundles().activate(bundle);
            readyBundle = null;
            deferredBundle = null;
            setPhase("up-to-date", "");
            host.reloadGame();
        } catch (Exception e) {
            setPhase("error", "Could not apply the game update: " + describe(e));
            showError("Could not apply the game update: " + describe(e));
        }
    }

    static int installedVersionCode() {
        return BuildConfig.VERSION_CODE;
    }

    static String installedVersionName() {
        return BuildConfig.VERSION_NAME;
    }

    void register() {
        if (receiverRegistered) {
            return;
        }
        IntentFilter filter = new IntentFilter(ACTION_INSTALL_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            activity.registerReceiver(statusReceiver, filter, STATUS_PERMISSION, null, Context.RECEIVER_NOT_EXPORTED);
        } else {
            activity.registerReceiver(statusReceiver, filter, STATUS_PERMISSION, null);
        }
        receiverRegistered = true;
    }

    void unregister() {
        if (receiverRegistered) {
            try {
                activity.unregisterReceiver(statusReceiver);
            } catch (Exception unused) {
                // Already gone with the activity.
            }
            receiverRegistered = false;
        }
    }

    /** Resume hook: finish a permission-blocked install, else throttled auto check. */
    void onResume() {
        if (pendingApk != null && canInstallPackages()) {
            File apk = pendingApk;
            pendingApk = null;
            install(apk);
            return;
        }
        if (deferredBundle != null && !busy) {
            WebBundles.Bundle bundle = deferredBundle;
            deferredBundle = null;
            offerReload(bundle, false);
        }
        if (System.currentTimeMillis() - lastCheck >= AUTO_CHECK_INTERVAL_MS) {
            check(false);
        }
    }

    /** Manual checks always answer (up to date / failure); automatic ones stay silent. */
    void check(final boolean manual) {
        if (busy) {
            if (manual) {
                toast("An update is already in progress.");
            }
            return;
        }
        busy = true;
        lastCheck = System.currentTimeMillis();
        progressDone = 0L;
        progressTotal = 0L;
        setPhase("checking", "");
        new Thread(new Runnable() {
            @Override
            public void run() {
                // 1) Native shell (APK). A newer app wins: it may be required by newer game code.
                try {
                    final Release release = parse(readText(channel, 65536));
                    if (release.versionCode > installedVersionCode()) {
                        availableApp = release;
                        checkedAt = System.currentTimeMillis();
                        setPhase("app-update", release.versionName);
                        ui(new Runnable() {
                            @Override
                            public void run() {
                                busy = false;
                                if (manual || release.versionCode != dismissedVersion) {
                                    offer(release);
                                }
                            }
                        });
                        return;
                    }
                } catch (final Exception e) {
                    Log.w(TAG, "app update check failed: " + e);
                    if (manual) {
                        ui(new Runnable() {
                            @Override
                            public void run() {
                                toast("App update check failed: " + describe(e));
                            }
                        });
                    }
                }
                // 2) Game code (web bundle): only changed files download, no reinstall.
                try {
                    final WebBundles.Bundle staged = host.bundles().downloadLatest(webChannel, (done, total) -> {
                        progressDone = done;
                        progressTotal = total;
                        setPhase("downloading", "");
                    });
                    checkedAt = System.currentTimeMillis();
                    if (staged != null) {
                        readyBundle = staged;
                        setPhase("ready", staged.label);
                    } else if (readyBundle == null) {
                        setPhase("up-to-date", "");
                    } else {
                        setPhase("ready", readyBundle.label);
                    }
                    ui(new Runnable() {
                        @Override
                        public void run() {
                            busy = false;
                            if (staged != null) {
                                offerReload(staged, manual);
                            } else if (manual) {
                                toast("Smash Web is up to date (" + versions() + ").");
                            }
                        }
                    });
                } catch (final Exception e) {
                    Log.w(TAG, "game update check failed: " + e);
                    checkedAt = System.currentTimeMillis();
                    setPhase("error", "Game update failed: " + describe(e));
                    ui(new Runnable() {
                        @Override
                        public void run() {
                            busy = false;
                            if (manual) {
                                toast("Game update check failed: " + describe(e));
                            }
                        }
                    });
                }
            }
        }, "smash-update-check").start();
    }

    private void offer(final Release release) {
        String size = String.format(Locale.ROOT, "%.1f MB", release.size / (1024.0 * 1024.0));
        new AlertDialog.Builder(activity)
                .setTitle("Update available")
                .setMessage("Smash Web " + release.versionName + " is ready (installed: "
                        + installedVersionName() + ").\n\nDownload " + size
                        + " and install now? The game closes while Android installs it; open it again afterwards.")
                .setPositiveButton("Update", (dialog, which) -> download(release))
                .setNegativeButton("Later", (dialog, which) -> dismissedVersion = release.versionCode)
                .setCancelable(true)
                .show();
    }

    /** Offers to reload into freshly downloaded game code. Never interrupts a match: the
     * prompt waits for the next resume, and the bundle applies at next launch regardless. */
    private void offerReload(final WebBundles.Bundle bundle, final boolean manual) {
        host.whenIdle(new Runnable() {
            @Override
            public void run() {
                new AlertDialog.Builder(activity)
                        .setTitle("Game update ready")
                        .setMessage("Smash Web game " + bundle.label + " is downloaded (no reinstall needed).\n\n"
                                + "Reload now? Otherwise it applies the next time you open the app.")
                        .setPositiveButton("Reload now", (dialog, which) -> applyReady(bundle))
                        .setNegativeButton("Later", null)
                        .show();
            }
        }, new Runnable() {
            @Override
            public void run() {
                deferredBundle = bundle;
                if (manual) {
                    toast("Game update downloaded; it applies after this match or next launch.");
                }
            }
        });
    }

    private void download(final Release release) {
        busy = true;
        final boolean[] cancelled = {false};
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad / 2, pad, 0);
        final ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        final TextView label = new TextView(activity);
        label.setText("Starting download…");
        layout.addView(bar);
        layout.addView(label);
        final AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Downloading Smash Web " + release.versionName)
                .setView(layout)
                .setCancelable(false)
                .setNegativeButton("Cancel", (d, which) -> cancelled[0] = true)
                .show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                File dir = new File(activity.getCacheDir(), "updates");
                File part = new File(dir, release.apk + ".part");
                File done = new File(dir, release.apk);
                try {
                    if (!dir.isDirectory() && !dir.mkdirs()) {
                        throw new IOException("cannot create the update folder");
                    }
                    File[] old = dir.listFiles();
                    if (old != null) {
                        for (File file : old) {
                            if (!file.equals(done)) {
                                //noinspection ResultOfMethodCallIgnored
                                file.delete();
                            }
                        }
                    }
                    if (!(done.isFile() && done.length() == release.size && release.sha256.equals(sha256(done)))) {
                        fetch(new URL(new URL(channel), release.apk), part, release, bar, label, cancelled);
                        if (!part.renameTo(done)) {
                            throw new IOException("cannot finalize the download");
                        }
                    }
                    ui(new Runnable() {
                        @Override
                        public void run() {
                            dialog.dismiss();
                            install(done);
                        }
                    });
                } catch (final Exception e) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                    ui(new Runnable() {
                        @Override
                        public void run() {
                            dialog.dismiss();
                            busy = false;
                            if (!cancelled[0]) {
                                showError("Download failed: " + describe(e));
                            }
                        }
                    });
                }
            }
        }, "smash-update-download").start();
    }

    private void fetch(URL url, File target, Release release, final ProgressBar bar, final TextView label, boolean[] cancelled) throws Exception {
        HttpURLConnection connection = open(url);
        try {
            int code = connection.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code);
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0L;
            long lastUi = 0L;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] chunk = new byte[65536];
                int read;
                while ((read = in.read(chunk)) >= 0) {
                    if (cancelled[0]) {
                        throw new IOException("cancelled");
                    }
                    total += read;
                    if (total > release.size) {
                        throw new IOException("the package is larger than announced");
                    }
                    out.write(chunk, 0, read);
                    digest.update(chunk, 0, read);
                    long now = System.currentTimeMillis();
                    if (now - lastUi > 150) {
                        lastUi = now;
                        final long progress = total;
                        ui(new Runnable() {
                            @Override
                            public void run() {
                                bar.setProgress((int) (progress * 1000 / Math.max(1L, release.size)));
                                label.setText(String.format(Locale.ROOT, "%.1f / %.1f MB",
                                        progress / (1024.0 * 1024.0), release.size / (1024.0 * 1024.0)));
                            }
                        });
                    }
                }
            }
            if (total != release.size) {
                throw new IOException("incomplete download (" + total + " of " + release.size + " bytes)");
            }
            if (!release.sha256.equals(hex(digest.digest()))) {
                throw new IOException("checksum mismatch, the package was not installed");
            }
        } finally {
            connection.disconnect();
        }
    }

    boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void install(final File apk) {
        if (!canInstallPackages()) {
            pendingApk = apk;
            busy = false;
            new AlertDialog.Builder(activity)
                    .setTitle("Allow Smash Web updates")
                    .setMessage("Android needs your permission for Smash Web to install its own updates. "
                            + "Turn on \"Allow from this source\", then come back — the update continues automatically.")
                    .setPositiveButton("Open settings", (dialog, which) -> {
                        try {
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + activity.getPackageName())));
                        } catch (Exception e) {
                            showError("Could not open settings: " + e.getMessage());
                        }
                    })
                    .setNegativeButton("Later", (dialog, which) -> pendingApk = null)
                    .show();
            return;
        }
        busy = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
                PackageInstaller.Session session = null;
                try {
                    PackageInstaller.SessionParams params =
                            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    params.setAppPackageName(activity.getPackageName());
                    params.setSize(apk.length());
                    int sessionId = installer.createSession(params);
                    session = installer.openSession(sessionId);
                    try (InputStream in = new FileInputStream(apk);
                         OutputStream out = session.openWrite("smash-web.apk", 0, apk.length())) {
                        byte[] chunk = new byte[65536];
                        int read;
                        while ((read = in.read(chunk)) >= 0) {
                            out.write(chunk, 0, read);
                        }
                        session.fsync(out);
                    }
                    Intent status = new Intent(ACTION_INSTALL_STATUS).setPackage(activity.getPackageName());
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT
                            | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent callback = PendingIntent.getBroadcast(activity, sessionId, status, flags);
                    session.commit(callback.getIntentSender());
                } catch (final Exception e) {
                    if (session != null) {
                        session.abandon();
                    }
                    ui(new Runnable() {
                        @Override
                        public void run() {
                            busy = false;
                            showError("Install failed: " + describe(e));
                        }
                    });
                } finally {
                    if (session != null) {
                        session.close();
                    }
                }
            }
        }, "smash-update-install").start();
    }

    // ---- helpers ----

    static Release parse(String json) throws JSONException {
        JSONObject data = new JSONObject(json);
        int versionCode = data.getInt("versionCode");
        String versionName = data.optString("versionName", String.valueOf(versionCode));
        String apk = data.getString("apk");
        String sha = data.getString("sha256").toLowerCase(Locale.ROOT);
        long size = data.getLong("size");
        if (versionCode <= 0 || !APK_NAME.matcher(apk).matches() || !SHA256.matcher(sha).matches()
                || size <= 0 || size > MAX_APK_BYTES || versionName.length() > 64) {
            throw new JSONException("invalid release pointer");
        }
        return new Release(versionCode, versionName, apk, sha, size);
    }

    static HttpURLConnection open(URL url) throws IOException {
        if (!"https".equals(url.getProtocol()) && !BuildConfig.DEBUG) {
            throw new IOException("update channel must use https");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        return connection;
    }

    static String readText(String address, long cap) throws IOException {
        HttpURLConnection connection = open(new URL(address));
        try {
            int code = connection.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code);
            }
            try (InputStream in = connection.getInputStream()) {
                byte[] chunk = new byte[8192];
                StringBuilder text = new StringBuilder();
                int read;
                while ((read = in.read(chunk)) >= 0) {
                    text.append(new String(chunk, 0, read, java.nio.charset.StandardCharsets.UTF_8));
                    if (text.length() > cap) {
                        throw new IOException("update pointer too large");
                    }
                }
                return text.toString();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String sha256(File file) {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] chunk = new byte[65536];
            int read;
            while ((read = in.read(chunk)) >= 0) {
                digest.update(chunk, 0, read);
            }
            return hex(digest.digest());
        } catch (Exception e) {
            return "";
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            out.append(String.format(Locale.ROOT, "%02x", value));
        }
        return out.toString();
    }

    private static String describe(Exception e) {
        String message = e.getMessage();
        return e.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private void ui(Runnable action) {
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed()) {
                action.run();
            }
        });
    }

    private void toast(String message) {
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }

    private void showError(String message) {
        new AlertDialog.Builder(activity)
                .setTitle("Smash Web update")
                .setMessage(message)
                .setPositiveButton(android.R.string.ok, null)
                .show();
    }
}
