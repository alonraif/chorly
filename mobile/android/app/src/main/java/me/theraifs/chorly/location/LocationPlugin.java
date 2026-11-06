package me.theraifs.chorly.location;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// The page's handle on location sharing: what the phone allows, the steps to allow more, and
// turning the service on and off. The service does the rest by itself.
@CapacitorPlugin(
        name = "ChorlyLocation",
        permissions = {
                @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
                @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
                @Permission(alias = "motion", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        }
)
public class LocationPlugin extends Plugin {

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasForeground() {
        return granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    // Before Android 10 there was no separate background permission: allowing location allowed it always.
    private boolean hasBackground() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasForeground();
        return granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean locationOn() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    private boolean batteryUnrestricted() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private JSObject status() {
        LocationPrefs prefs = new LocationPrefs(getContext());
        JSObject result = new JSObject();
        result.put("foreground", hasForeground());
        // Approximate location puts people a kilometre or two from where they are.
        result.put("precise", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        result.put("background", hasBackground());
        // "prompt" can still show the system dialog; "denied" can only be changed in Settings.
        PermissionState state = getPermissionState("location");
        result.put("foregroundState", state == null ? "prompt" : state.toString());
        result.put("locationOn", locationOn());
        result.put("batteryUnrestricted", batteryUnrestricted());
        // Physical activity: wakes GPS the moment the phone starts moving.
        result.put("motion", LocationService.motionAllowed(getContext()));
        result.put("enabled", prefs.enabled());
        result.put("running", LocationService.isRunning());
        result.put("stopReason", prefs.stopReason());
        return result;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestForeground(PluginCall call) {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.resolve(status());
            return;
        }
        // Also how someone who chose "Approximate" is offered "Precise".
        requestPermissionForAlias("location", call, "afterPermission");
    }

    // From Android 11 the system can't offer "Allow all the time" in a dialog: this opens the app's
    // location page in Settings, where it's one tap, and comes back here afterwards.
    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (hasBackground()) {
            call.resolve(status());
            return;
        }
        if (!hasForeground()) {
            call.reject("Allow location first", "NOT_AUTHORIZED");
            return;
        }
        requestPermissionForAlias("background", call, "afterPermission");
    }

    @PluginMethod
    public void requestMotion(PluginCall call) {
        // Before Android 10 it's granted with the app.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || LocationService.motionAllowed(getContext())) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("motion", call, "afterPermission");
    }

    /** The family's places: { places: [{ id, lat, lng, radiusM }] }, watched as geofences. */
    @PluginMethod
    public void setPlaces(PluginCall call) {
        com.getcapacitor.JSArray places = call.getArray("places");
        if (places == null) {
            call.reject("Missing places");
            return;
        }
        if (new LocationPrefs(getContext()).setPlaces(places.toString())) LocationService.placesChanged();
        call.resolve();
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        // A newly allowed permission (motion, all the time) takes effect in the running service.
        if (LocationService.isRunning()) {
            try {
                LocationService.start(getContext(), LocationService.ACTION_START);
            } catch (Exception ignored) {
                // It picks the permission up on its next start.
            }
        }
        call.resolve(status());
    }

    // Some phones stop background apps to save battery, sharing included, unless told not to.
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (!batteryUnrestricted()) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception e) {
                openAppSettings();
            }
        }
        call.resolve(status());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        openAppSettings();
        call.resolve();
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    /** Turns sharing on: { url, title, message }. Safe to call again while it's on. */
    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        if (!hasForeground()) {
            call.reject("Location permission denied", "NOT_AUTHORIZED");
            return;
        }
        new LocationPrefs(getContext()).enable(url, call.getString("title"), call.getString("message"));
        try {
            LocationService.start(getContext(), LocationService.ACTION_START);
        } catch (Exception e) {
            call.reject("Couldn't start sharing", "START_FAILED", e);
            return;
        }
        call.resolve(status());
    }

    /** Asks for a fresh fix and sends it, for when the page has just come back into view. */
    @PluginMethod
    public void reportNow(PluginCall call) {
        if (new LocationPrefs(getContext()).enabled() && hasForeground()) {
            try {
                LocationService.start(getContext(), LocationService.ACTION_REPORT_NOW);
            } catch (Exception ignored) {
                // Not allowed from where the app is right now; the service carries on by itself.
            }
        }
        call.resolve();
    }

    /** Turns sharing off and resolves only once no report can still be on its way. */
    @PluginMethod
    public void stop(PluginCall call) {
        new LocationPrefs(getContext()).disable(null);
        getBridge().execute(() -> {
            LocationService.stopAndWait(getContext());
            call.resolve(status());
        });
    }

    /** Forgets why sharing stopped, once the page has told the member. */
    @PluginMethod
    public void clearStopReason(PluginCall call) {
        new LocationPrefs(getContext()).clearStopReason();
        call.resolve();
    }
}
