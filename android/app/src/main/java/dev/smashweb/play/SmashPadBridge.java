package dev.smashweb.play;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** SmashPad native bridge: gamepads + vibration for the WebView shell.
 *
 * <p>Mobile browsers and Android WebViews expose no HTML5 Gamepad API, so
 * phone-paired controllers (Switch Pro, Xbox, PlayStation, USB OTG) are
 * invisible to navigator.getGamepads. This interface tracks Android
 * InputDevice key/motion events in the activity and serves snapshots to
 * web/src/android-bridge.ts, which adapts them into the shared ControllerHub
 * mapping plus PlayRumble actuation. Pairing stays in Android Settings; the
 * shell only reads already-connected devices and never scans itself.
 *
 * <p>Button/axis order is the browser-standard layout
 * (web/src/android-bridge.ts, docs/CONTROLLERS.md): 17 buttons, 4 axes.
 * Axis values stay raw Android convention (up/left negative), identical to
 * the browser Gamepad API — the web mapping applies the flip, never here. */
public final class SmashPadBridge {
    static final int BUTTON_COUNT = 17;
    static final int AXIS_COUNT = 4;

    private final Context context;

    /** deviceId -> live state, written on the UI thread, read by WebView JS. */
    private final Map<Integer, DeviceState> devices = new HashMap<>();

    SmashPadBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    private static final class DeviceState {
        final boolean[] buttons = new boolean[BUTTON_COUNT];
        final float[] axes = new float[AXIS_COUNT];
        String name = "";
        boolean vibrator = false;
        /** USB/Bluetooth vendor + product ids (0 when unknown): the web side
         * identifies the family from these (Sony 054c reports as the generic
         * "Wireless Controller" name over Bluetooth). */
        int vendor = 0;
        int product = 0;
    }

    // ---- event tracking (called from MainActivity overrides) ----

    /** Map an Android gamepad keycode to a standard button index, or -1. */
    static int buttonIndexForKeyCode(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0; // south / jump
            case KeyEvent.KEYCODE_BUTTON_B: return 1; // east / special
            case KeyEvent.KEYCODE_BUTTON_X: return 2; // west / attack
            case KeyEvent.KEYCODE_BUTTON_Y: return 3; // north
            case KeyEvent.KEYCODE_BUTTON_L1: return 4; // grab
            case KeyEvent.KEYCODE_BUTTON_R1: return 5; // strong
            case KeyEvent.KEYCODE_BUTTON_L2: return 6; // shield
            case KeyEvent.KEYCODE_BUTTON_R2: return 7; // shield
            case KeyEvent.KEYCODE_BUTTON_SELECT:
            case KeyEvent.KEYCODE_BUTTON_MODE:
                return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9; // menu
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            // Home/focus keycode varies by vendor; KEYCODE_HOME is intercepted
            // by the OS, so index 16 stays reserved and usually unpressed.
            default: return -1;
        }
    }

    synchronized void onKey(int deviceId, String name, int keyCode, boolean down) {
        // Track raw keys so motion frames can re-derive hat/D-pad merges, then
        // apply directly (motion frames recompute 12..15 as key || hat anyway).
        onKeyTracked(deviceId, keyCode, down);
        int index = buttonIndexForKeyCode(keyCode);
        if (index >= 0) {
            stateFor(deviceId, name).buttons[index] = down;
        }
    }

    synchronized void onMotion(int deviceId, String name, MotionEvent event) {
        DeviceState state = stateFor(deviceId, name);
        // Raw Android values (up/left negative), exactly like the browser
        // Gamepad API: the web standard mapping already applies the up-positive
        // flip (sign -1), so negating here would invert the stick twice.
        state.axes[0] = axisOrZero(event, MotionEvent.AXIS_X, deviceId);
        state.axes[1] = axisOrZero(event, MotionEvent.AXIS_Y, deviceId);
        state.axes[2] = axisOrZero(event, MotionEvent.AXIS_Z, deviceId);
        state.axes[3] = axisOrZero(event, MotionEvent.AXIS_RZ, deviceId);
        // Analog triggers double as shield buttons past half pull.
        if (hasAxis(event.getDevice(), MotionEvent.AXIS_LTRIGGER)) {
            state.buttons[6] = state.buttons[6]
                    || event.getAxisValue(MotionEvent.AXIS_LTRIGGER) > 0.3f;
        }
        if (hasAxis(event.getDevice(), MotionEvent.AXIS_RTRIGGER)) {
            state.buttons[7] = state.buttons[7]
                    || event.getAxisValue(MotionEvent.AXIS_RTRIGGER) > 0.3f;
        }
        // Hat switches double as the D-pad: recomputed from scratch every motion
        // frame (physical D-pad keys keep their own state via onKeyTracked), so
        // a released hat never leaves a stuck direction behind.
        if (hasAxis(event.getDevice(), MotionEvent.AXIS_HAT_X)) {
            float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
            state.buttons[14] = keyDown(deviceId, KeyEvent.KEYCODE_DPAD_LEFT) || hatX < -0.5f;
            state.buttons[15] = keyDown(deviceId, KeyEvent.KEYCODE_DPAD_RIGHT) || hatX > 0.5f;
        }
        if (hasAxis(event.getDevice(), MotionEvent.AXIS_HAT_Y)) {
            float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
            state.buttons[12] = keyDown(deviceId, KeyEvent.KEYCODE_DPAD_UP) || hatY < -0.5f;
            state.buttons[13] = keyDown(deviceId, KeyEvent.KEYCODE_DPAD_DOWN) || hatY > 0.5f;
        }
    }

    private final Map<Integer, Map<Integer, Boolean>> keyState = new HashMap<>();

    private boolean keyDown(int deviceId, int keyCode) {
        Map<Integer, Boolean> keys = keyState.get(deviceId);
        return keys != null && Boolean.TRUE.equals(keys.get(keyCode));
    }

    synchronized void onKeyTracked(int deviceId, int keyCode, boolean down) {
        Map<Integer, Boolean> keys = keyState.get(deviceId);
        if (keys == null) {
            keys = new HashMap<>();
            keyState.put(deviceId, keys);
        }
        keys.put(keyCode, down);
    }

    synchronized void onDeviceRemoved(int deviceId) {
        devices.remove(deviceId);
        keyState.remove(deviceId);
    }

    private DeviceState stateFor(int deviceId, String name) {
        DeviceState state = devices.get(deviceId);
        if (state == null) {
            state = new DeviceState();
            devices.put(deviceId, state);
            try {
                InputDevice device = InputDevice.getDevice(deviceId);
                if (device != null) {
                    state.vendor = device.getVendorId();
                    state.product = device.getProductId();
                }
            } catch (Exception unused) {
                // Ids are identification hints only; the pad still works without them.
            }
        }
        if (name != null && !name.isEmpty()) {
            state.name = name;
        }
        state.vibrator = deviceHasVibrator(deviceId);
        return state;
    }

    private static float axisOrZero(MotionEvent event, int axis, int deviceId) {
        InputDevice device = event.getDevice();
        if (device == null || !hasAxis(device, axis)) {
            return 0f;
        }
        float value = event.getAxisValue(axis);
        return Float.isFinite(value) ? Math.max(-1f, Math.min(1f, value)) : 0f;
    }

    private static boolean hasAxis(InputDevice device, int axis) {
        if (device == null) {
            return false;
        }
        for (InputDevice.MotionRange range : device.getMotionRanges()) {
            if (range.getAxis() == axis) {
                return true;
            }
        }
        return false;
    }

    private static boolean deviceHasVibrator(int deviceId) {
        // Per-device vibrators only exist on API 31+; older shells report none
        // and the handset vibrator covers feedback instead.
        if (Build.VERSION.SDK_INT < 31) {
            return false;
        }
        try {
            InputDevice device = InputDevice.getDevice(deviceId);
            if (device == null) {
                return false;
            }
            Vibrator vibrator = device.getVibrator();
            return vibrator != null && vibrator.hasVibrator();
        } catch (Exception unused) {
            return false;
        }
    }

    // ---- JavascriptInterface ----

    /** JSON snapshot polled by the web tick, mirroring Gamepad API polling. */
    @JavascriptInterface
    public synchronized String getPads() {
        try {
            JSONArray out = new JSONArray();
            List<Integer> ids = new ArrayList<>(devices.keySet());
            for (int id : ids) {
                DeviceState state = devices.get(id);
                if (state == null) {
                    continue;
                }
                JSONObject pad = new JSONObject();
                pad.put("id", id);
                pad.put("name", state.name);
                JSONArray buttons = new JSONArray();
                for (boolean pressed : state.buttons) {
                    buttons.put(pressed ? 1 : 0);
                }
                pad.put("buttons", buttons);
                JSONArray axes = new JSONArray();
                for (float axis : state.axes) {
                    axes.put((double) axis);
                }
                pad.put("axes", axes);
                pad.put("vibrator", state.vibrator);
                pad.put("vendor", state.vendor);
                pad.put("product", state.product);
                out.put(pad);
                if (out.length() >= 8) {
                    break;
                }
            }
            return out.toString();
        } catch (Exception unused) {
            return "[]";
        }
    }

    /** Rumble every connected gamepad vibrator (API 31+ device vibrators;
     * older platforms report no device vibrator and skip silently). */
    @JavascriptInterface
    public void rumbleAll(float strong, float weak, int durationMs) {
        if (Build.VERSION.SDK_INT < 31) {
            return;
        }
        float magnitude = Math.max(0f, Math.min(1f, Math.max(strong, weak)));
        int duration = Math.max(0, Math.min(1000, durationMs));
        if (duration <= 0 || magnitude <= 0f) {
            return;
        }
        int amplitude = Math.max(1, Math.min(255, Math.round(magnitude * 255)));
        synchronized (this) {
            for (int id : new ArrayList<>(devices.keySet())) {
                try {
                    InputDevice device = InputDevice.getDevice(id);
                    if (device == null) {
                        continue;
                    }
                    Vibrator vibrator = device.getVibrator();
                    if (vibrator == null || !vibrator.hasVibrator()) {
                        continue;
                    }
                    vibrator.vibrate(VibrationEffect.createOneShot(duration, amplitude));
                } catch (Exception unused) {
                    // One failing pad never blocks the rest.
                }
            }
        }
    }

    /** Phone-handset vibration. CSV "ms" or "on,off,..."; "0" cancels. */
    @JavascriptInterface
    public void vibrateCsv(String pattern) {
        try {
            if (pattern == null || pattern.isEmpty()) {
                return;
            }
            String[] parts = pattern.split(",");
            Vibrator cancel = handset();
            if (parts.length == 1 && Long.parseLong(parts[0].trim()) == 0) {
                if (cancel != null) {
                    cancel.cancel();
                }
                return;
            }
            long[] timings = new long[Math.min(parts.length, 16)];
            for (int i = 0; i < timings.length; i++) {
                timings[i] = Math.max(0L, Math.min(1000L, Long.parseLong(parts[i].trim())));
            }
            Vibrator vibrator = cancel;
            if (vibrator == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                if (timings.length == 1) {
                    vibrator.vibrate(VibrationEffect.createOneShot(timings[0], VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
                }
            } else {
                // Pre-Oreo Fire OS: legacy duration/pattern APIs.
                @SuppressWarnings("deprecation")
                boolean legacy = timings.length == 1;
                if (legacy) {
                    vibrator.vibrate(timings[0]);
                } else {
                    vibrator.vibrate(timings, -1);
                }
            }
        } catch (Exception unused) {
            // Vibration is cosmetic; never break input.
        }
    }

    private Vibrator handset() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager manager =
                    (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            if (manager != null) {
                return manager.getDefaultVibrator();
            }
        }
        @SuppressWarnings("deprecation")
        Vibrator vibrator =
                (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        return vibrator;
    }
}
