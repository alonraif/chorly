package me.theraifs.chorly.location;

import android.content.Context;
import android.content.SharedPreferences;

// What the service needs to carry on by itself after the app is closed, the phone restarts or the
// app is updated: whether sharing is on, where to send fixes, and the notification's words.
final class LocationPrefs {
    private static final String FILE = "chorly.location";
    private static final String ENABLED = "enabled";
    private static final String URL = "url";
    private static final String TITLE = "title";
    private static final String MESSAGE = "message";
    private static final String STOP_REASON = "stopReason";
    private static final String PLACES = "places";

    private final SharedPreferences prefs;

    LocationPrefs(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    boolean enabled() {
        return prefs.getBoolean(ENABLED, false) && url() != null;
    }

    String url() {
        return prefs.getString(URL, null);
    }

    String title() {
        return prefs.getString(TITLE, null);
    }

    String message() {
        return prefs.getString(MESSAGE, null);
    }

    /** Why the service stopped by itself ("ended", "signedOut"), for the page to explain. */
    String stopReason() {
        return prefs.getString(STOP_REASON, null);
    }

    void enable(String url, String title, String message) {
        // commit, not apply: the service may read these in another process state right after.
        prefs.edit().putBoolean(ENABLED, true).putString(URL, url).putString(TITLE, title).putString(MESSAGE, message).remove(STOP_REASON).commit();
    }

    void disable(String reason) {
        SharedPreferences.Editor editor = prefs.edit().putBoolean(ENABLED, false);
        if (reason == null) editor.remove(STOP_REASON);
        else editor.putString(STOP_REASON, reason);
        editor.commit();
    }

    /** The family's places as JSON [{ id, lat, lng, radiusM }], for geofences. */
    String places() {
        return prefs.getString(PLACES, null);
    }

    /** Returns whether they changed. */
    boolean setPlaces(String json) {
        if (json.equals(places())) return false;
        prefs.edit().putString(PLACES, json).commit();
        return true;
    }

    void clearStopReason() {
        prefs.edit().remove(STOP_REASON).commit();
    }
}
