package dev.smashweb.play;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Game-code bundles (HTML/JS/CSS/WASM) that update without reinstalling the app.
 *
 * <p>Three layers version independently: ISO assets (content-hashed in the web
 * cache), this game-code bundle, and the native shell (APK, see AppUpdater).
 * Every bundle is described by {@code web-bundle.json}
 * ({@code {"version":seconds,"label":"…","shellApi":N,"files":{"/play.html":{"sha256":…,"size":…}}}},
 * written by scripts/web-bundle-manifest.ts). The APK packages one bundle in
 * assets/dist/; newer ones are published at {@code /android/web/latest.json}
 * with content-addressed objects at {@code /android/web/objects/<sha256>}.
 *
 * <p>The shell serves the newest compatible bundle: a downloaded one (files in
 * app storage, each verified by SHA-256) when its version beats the packaged
 * one, else the packaged assets. A download only fetches objects it does not
 * already hold, is staged as {@code pending.json}, and becomes active either
 * when the user accepts the reload prompt or at the next launch — never under a
 * running page, whose hashed file names would otherwise mix two builds. Bundles
 * requiring a newer {@link #SHELL_API} wait for the APK update. */
final class WebBundles {
    /** Native bridge API this shell implements (web: ANDROID_SHELL_API). */
    static final int SHELL_API = 1;
    static final String MANIFEST = "web-bundle.json";
    private static final String TAG = "SmashWebBundle";
    private static final Pattern PATH = Pattern.compile("^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final int MAX_FILES = 4096;
    private static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_BUNDLE_BYTES = 512L * 1024L * 1024L;

    static final class Entry {
        final String sha256;
        final long size;

        Entry(String sha256, long size) {
            this.sha256 = sha256;
            this.size = size;
        }
    }

    static final class Bundle {
        final long version;
        final String label;
        final int shellApi;
        final Map<String, Entry> files;
        final String json;

        Bundle(long version, String label, int shellApi, Map<String, Entry> files, String json) {
            this.version = version;
            this.label = label;
            this.shellApi = shellApi;
            this.files = files;
            this.json = json;
        }
    }

    private final AssetManager assets;
    private final File objects;
    private final File activeFile;
    private final File pendingFile;
    private final Bundle packaged;
    /** Downloaded bundle currently served; null = packaged assets. */
    private volatile Bundle active;

    WebBundles(Context context) {
        this.assets = context.getAssets();
        File root = new File(context.getFilesDir(), "web");
        this.objects = new File(root, "objects");
        this.activeFile = new File(root, "active.json");
        this.pendingFile = new File(root, "pending.json");
        //noinspection ResultOfMethodCallIgnored
        objects.mkdirs();
        this.packaged = readPackaged();
        // A bundle downloaded during an earlier session applies at launch.
        Bundle pending = loadStored(pendingFile);
        if (pending != null) {
            promote(pending);
        } else {
            //noinspection ResultOfMethodCallIgnored
            pendingFile.delete();
        }
        Bundle stored = loadStored(activeFile);
        this.active = stored;
        if (stored == null) {
            //noinspection ResultOfMethodCallIgnored
            activeFile.delete();
        }
        collectGarbage();
        Log.i(TAG, "serving " + describeCurrent());
    }

    // ---- serving ----

    /** Bytes for one request path from the current bundle, or null (404). */
    byte[] read(String path) throws IOException {
        Bundle current = active;
        if (current != null) {
            Entry entry = current.files.get(path);
            if (entry == null) {
                return null;
            }
            try (InputStream in = new FileInputStream(new File(objects, entry.sha256))) {
                return readAll(in, entry.size + 1);
            }
        }
        try (InputStream in = assets.open("dist" + path, AssetManager.ACCESS_STREAMING)) {
            return readAll(in, MAX_FILE_BYTES);
        } catch (java.io.FileNotFoundException missing) {
            return null;
        }
    }

    long currentVersion() {
        Bundle current = active;
        return current != null ? current.version : packaged != null ? packaged.version : 0L;
    }

    String describeCurrent() {
        Bundle current = active;
        if (current != null) {
            return current.label + " (downloaded)";
        }
        return packaged != null ? packaged.label + " (built in)" : "built in";
    }

    // ---- updating (worker thread) ----

    /** Download progress in bytes of the files still missing locally. */
    interface Progress {
        void update(long doneBytes, long totalBytes);
    }

    /** Downloads the channel's bundle when it is newer and compatible, staging it as
     * pending. Returns the staged bundle, or null when nothing newer applies. */
    Bundle downloadLatest(String channel, Progress progress) throws Exception {
        String json = AppUpdater.readText(channel, 4L * 1024L * 1024L);
        Bundle latest = parse(json);
        if (latest.version <= currentVersion()) {
            return null;
        }
        if (latest.shellApi > SHELL_API) {
            Log.i(TAG, "bundle " + latest.label + " needs shell API " + latest.shellApi + "; waiting for the app update");
            return null;
        }
        URL base = new URL(new URL(channel), "objects/");
        Map<String, Entry> missing = new HashMap<>();
        long total = 0L;
        for (Entry entry : latest.files.values()) {
            File target = new File(objects, entry.sha256);
            if ((target.isFile() && target.length() == entry.size) || missing.containsKey(entry.sha256)) {
                continue;
            }
            missing.put(entry.sha256, entry);
            total += entry.size;
        }
        long done = 0L;
        if (progress != null) {
            progress.update(done, total);
        }
        for (Entry entry : missing.values()) {
            fetchObject(new URL(base, entry.sha256), new File(objects, entry.sha256), entry);
            done += entry.size;
            if (progress != null) {
                progress.update(done, total);
            }
        }
        writeAtomically(pendingFile, latest.json);
        return latest;
    }

    /** Makes a staged bundle the served one (caller reloads the page right after). */
    synchronized void activate(Bundle bundle) throws IOException {
        promote(bundle);
        active = bundle;
        collectGarbage();
    }

    private void promote(Bundle bundle) {
        try {
            writeAtomically(activeFile, bundle.json);
            //noinspection ResultOfMethodCallIgnored
            pendingFile.delete();
        } catch (IOException e) {
            Log.w(TAG, "cannot activate bundle " + bundle.label + ": " + e);
        }
    }

    private void fetchObject(URL url, File target, Entry entry) throws Exception {
        File part = new File(objects, entry.sha256 + ".part");
        HttpURLConnection connection = AppUpdater.open(url);
        try {
            int code = connection.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code + " for game file " + entry.sha256.substring(0, 12));
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0L;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] chunk = new byte[65536];
                int read;
                while ((read = in.read(chunk)) >= 0) {
                    total += read;
                    if (total > entry.size) {
                        throw new IOException("game file larger than announced");
                    }
                    out.write(chunk, 0, read);
                    digest.update(chunk, 0, read);
                }
            }
            if (total != entry.size || !entry.sha256.equals(AppUpdater.hex(digest.digest()))) {
                throw new IOException("game file failed its checksum");
            }
            if (!part.renameTo(target)) {
                throw new IOException("cannot store game file");
            }
        } finally {
            connection.disconnect();
            //noinspection ResultOfMethodCallIgnored
            part.delete();
        }
    }

    // ---- manifests ----

    static Bundle parse(String json) throws JSONException {
        JSONObject data = new JSONObject(json);
        long version = data.getLong("version");
        int shellApi = data.getInt("shellApi");
        String label = data.optString("label", String.valueOf(version));
        JSONObject list = data.getJSONObject("files");
        if (version <= 0 || shellApi <= 0 || label.length() > 64 || list.length() == 0 || list.length() > MAX_FILES) {
            throw new JSONException("invalid web bundle");
        }
        Map<String, Entry> files = new HashMap<>();
        long total = 0L;
        Iterator<String> paths = list.keys();
        while (paths.hasNext()) {
            String path = paths.next();
            JSONObject file = list.getJSONObject(path);
            String sha = file.getString("sha256");
            long size = file.getLong("size");
            if (!PATH.matcher(path).matches() || path.contains("..") || !SHA256.matcher(sha).matches()
                    || size < 0 || size > MAX_FILE_BYTES) {
                throw new JSONException("invalid web bundle entry " + path);
            }
            total += size;
            files.put(path, new Entry(sha, size));
        }
        if (total > MAX_BUNDLE_BYTES || !files.containsKey("/play.html")) {
            throw new JSONException("incomplete web bundle");
        }
        return new Bundle(version, label, shellApi, Collections.unmodifiableMap(files), json);
    }

    private Bundle readPackaged() {
        try (InputStream in = assets.open("dist/" + MANIFEST)) {
            return parse(new String(readAll(in, 4L * 1024L * 1024L), StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "packaged bundle manifest unavailable: " + e);
            return null;
        }
    }

    /** A stored bundle is usable only if compatible, newer than the packaged one (an
     * APK update may ship newer code) and every object is present with its size. */
    private Bundle loadStored(File file) {
        if (!file.isFile()) {
            return null;
        }
        try (InputStream in = new FileInputStream(file)) {
            Bundle bundle = parse(new String(readAll(in, 4L * 1024L * 1024L), StandardCharsets.UTF_8));
            if (bundle.shellApi > SHELL_API || (packaged != null && bundle.version <= packaged.version)) {
                return null;
            }
            for (Entry entry : bundle.files.values()) {
                File object = new File(objects, entry.sha256);
                if (!object.isFile() || object.length() != entry.size) {
                    return null;
                }
            }
            return bundle;
        } catch (Exception e) {
            Log.w(TAG, "stored bundle " + file.getName() + " unusable: " + e);
            return null;
        }
    }

    /** Deletes objects referenced by neither the active nor the pending bundle. */
    private synchronized void collectGarbage() {
        Set<String> keep = new HashSet<>();
        Bundle current = active;
        if (current != null) {
            for (Entry entry : current.files.values()) {
                keep.add(entry.sha256);
            }
        }
        Bundle pending = loadStored(pendingFile);
        if (pending != null) {
            for (Entry entry : pending.files.values()) {
                keep.add(entry.sha256);
            }
        }
        File[] stored = objects.listFiles();
        if (stored == null) {
            return;
        }
        for (File object : stored) {
            if (!keep.contains(object.getName())) {
                //noinspection ResultOfMethodCallIgnored
                object.delete();
            }
        }
    }

    private static void writeAtomically(File target, String text) throws IOException {
        File temp = new File(target.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(temp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.flush();
            ((FileOutputStream) out).getFD().sync();
        }
        if (!temp.renameTo(target)) {
            throw new IOException("cannot write " + target.getName());
        }
    }

    static byte[] readAll(InputStream in, long cap) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(8192, in.available()));
        byte[] chunk = new byte[65536];
        int read;
        long total = 0L;
        while ((read = in.read(chunk)) >= 0) {
            total += read;
            if (total > cap) {
                throw new IOException("file exceeds " + cap + " bytes");
            }
            out.write(chunk, 0, read);
        }
        return out.toByteArray();
    }

}
