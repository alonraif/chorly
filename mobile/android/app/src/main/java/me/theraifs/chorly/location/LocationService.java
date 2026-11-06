package me.theraifs.chorly.location;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.DetectedActivity;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

import me.theraifs.chorly.R;

// Shares this phone's position with the family for as long as sharing is on, with or without the
// app on screen. It runs on its own: it gets fixes, decides what to send and posts them to the API
// itself, so nothing depends on the web page being alive. A started foreground service, so closing
// the app doesn't stop it, and the system brings it back if it has to kill it.
//
// It adapts to what the phone is doing. Moving, it uses GPS and reports about every 10 seconds, with
// speed and heading. Once the phone has stayed within a small area for a few minutes it is still:
// it switches to wifi and cell positioning, which cost little battery, and reports every 2 minutes so
// the family can see it's live. Leaving that spot wakes GPS again, and so does the phone noticing it's
// being carried, cycled or driven (activity recognition), which catches a departure at once instead of
// at the next low-power fix. The family's places are geofences: crossing one's edge sends an accurate
// fix straight away, so arrivals and departures are announced on time even from the still mode.
public class LocationService extends Service {
    static final String ACTION_START = "me.theraifs.chorly.location.START";
    static final String ACTION_REPORT_NOW = "me.theraifs.chorly.location.REPORT_NOW";

    private static final String TAG = "ChorlyLocation";
    private static final int NOTIFICATION_ID = 28352;
    private static final String CHANNEL_ID = "location-sharing";
    // The channel the earlier background plugin made: gone with it.
    private static final String OLD_CHANNEL_ID = "com.equimaps.capacitor_background_geolocation";

    private static final long MOVING_INTERVAL_MS = 5_000;
    private static final long MOVING_REPORT_MS = 10_000;
    private static final long STILL_INTERVAL_MS = 60_000;
    // With motion detection on, the phone says when it starts moving, so a still one can check less often.
    private static final long STILL_INTERVAL_WITH_MOTION_MS = 2 * 60_000;
    private static final long STILL_REPORT_MS = 2 * 60_000;
    // Fixes come a little early or late; without this slack a still phone would report every 3 minutes, not 2.
    private static final long REPORT_SLACK_MS = 5_000;
    // Staying within this distance for this long is being still.
    private static final float STILL_RADIUS_M = 50;
    private static final long STILL_AFTER_MS = 3 * 60_000;
    // Sooner when the phone itself says it's lying still.
    private static final long STILL_AFTER_MOTION_MS = 90_000;
    // Geofences smaller than this miss crossings; the family's places can be as small as 75 m.
    private static final float GEOFENCE_MIN_RADIUS_M = 100;
    private static final int MAX_GEOFENCES = 90;
    // Further from the spot than this (beyond the fixes' own uncertainty), or this fast, is moving again.
    private static final float WAKE_RADIUS_M = 100;
    private static final float WAKE_SPEED_MPS = 2;
    // Below this, a speed and heading are GPS jitter.
    private static final float MOVING_SPEED_MPS = 1;
    // A fix vaguer than this is a guess from cell towers: sent only when nothing better came for a while.
    private static final float VAGUE_M = 300;
    private static final long VAGUE_OK_AFTER_MS = 10 * 60_000;
    // The API ignores fixes older than this; there's no point sending them.
    private static final long MAX_AGE_MS = 10 * 60_000;
    private static final long RETRY_MS = 30_000;
    private static final int TIMEOUT_MS = 15_000;

    private enum Outcome { OK, ENDED, SIGNED_OUT, RETRY, DROP }

    private static final class Report {
        final Location location;
        final boolean still;

        Report(Location location, boolean still) {
            this.location = location;
            this.still = still;
        }
    }

    private static volatile LocationService running;

    private LocationPrefs prefs;
    private FusedLocationProviderClient client;
    private Handler main;
    private ExecutorService http;
    private PowerManager.WakeLock wakeLock;
    private GeofencingClient geofencing;
    private PendingIntent motionIntent;
    private PendingIntent geofenceIntent;

    // All of this is touched on the main thread only.
    private boolean requesting = false;
    private boolean moving = true;
    private Location anchor;
    private long anchorSince;
    private long lastQueuedAt = -1;
    private long lastGoodAt = -1;
    private boolean forceNext = true;
    private Report pending;
    private boolean inFlight = false;
    private final Runnable retry = this::deliver;
    private boolean motionWatched = false;
    private boolean stillHint = false;
    private String watchedPlaces = null;

    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            Location fix = result.getLastLocation();
            if (fix != null) onFix(fix);
        }
    };

    static void start(Context context, String action) {
        ContextCompat.startForegroundService(context, new Intent(context, LocationService.class).setAction(action));
    }

    /** Stops the service and waits for a report on its way, so none lands after the position is deleted. Not on the main thread. */
    static void stopAndWait(Context context) {
        LocationService service = running;
        if (service != null) {
            service.http.shutdown();
            try {
                service.http.awaitTermination(TIMEOUT_MS * 2L, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        context.stopService(new Intent(context, LocationService.class));
    }

    static boolean isRunning() {
        return running != null;
    }

    /** Something says the phone is on the move (a geofence crossed, motion detected): GPS on, and report now. */
    static void wake(Context context) {
        LocationService service = running;
        if (service != null) {
            service.main.post(service::onWake);
            return;
        }
        // Stopped by the system: a geofence or motion event is allowed to bring it back.
        startIfEnabled(context);
    }

    /** The phone's activity changed: `movingNow` when walking, cycling or driving began, false when it lay still. */
    static void motion(Context context, boolean movingNow) {
        LocationService service = running;
        if (service != null) service.main.post(() -> service.onMotion(movingNow));
        else if (movingNow) startIfEnabled(context);
    }

    /** A family member asked where this phone is: a fresh fix, sent now. */
    public static void locate(Context context) {
        LocationService service = running;
        if (service != null) service.main.post(service::reportNow);
        else startIfEnabled(context);
    }

    /** The family's places changed: geofences follow. */
    static void placesChanged() {
        LocationService service = running;
        if (service != null) service.main.post(service::watchPlaces);
    }

    private static void startIfEnabled(Context context) {
        if (!new LocationPrefs(context).enabled()) return;
        try {
            start(context, ACTION_REPORT_NOW);
        } catch (Exception e) {
            Log.w(TAG, "Couldn't resume sharing", e);
        }
    }

    static boolean motionAllowed(Context context) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? android.Manifest.permission.ACTIVITY_RECOGNITION : "com.google.android.gms.permission.ACTIVITY_RECOGNITION";
        return ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    static boolean backgroundAllowed(Context context) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? android.Manifest.permission.ACCESS_BACKGROUND_LOCATION : android.Manifest.permission.ACCESS_FINE_LOCATION;
        return ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new LocationPrefs(this);
        client = LocationServices.getFusedLocationProviderClient(this);
        main = new Handler(Looper.getMainLooper());
        http = Executors.newSingleThreadExecutor();
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chorly:location-report");
        wakeLock.setReferenceCounted(false);
        geofencing = LocationServices.getGeofencingClient(this);
        // Mutable: Play services adds what happened to the intent.
        int mutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        motionIntent = PendingIntent.getBroadcast(this, 1, new Intent(this, MotionReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        geofenceIntent = PendingIntent.getBroadcast(this, 2, new Intent(this, GeofenceReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A service started with startForegroundService has to go to the foreground first, whatever it does next.
        if (!promote()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!prefs.enabled()) {
            finish(null);
            return START_NOT_STICKY;
        }
        running = this;
        if (!requesting) requestUpdates();
        // Again on every start: a permission may have been granted since.
        watchMotion();
        watchPlaces();
        // Started, restarted by the system (no intent) or asked by the page: the family shouldn't wait.
        reportNow();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = null;
        client.removeLocationUpdates(callback);
        ActivityRecognition.getClient(this).removeActivityTransitionUpdates(motionIntent);
        geofencing.removeGeofences(geofenceIntent);
        main.removeCallbacksAndMessages(null);
        http.shutdown();
        if (wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.location_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        manager.deleteNotificationChannel(OLD_CHANNEL_ID);
    }

    private Notification notification() {
        String title = prefs.title() != null ? prefs.title() : getString(R.string.location_default_title);
        String message = prefs.message() != null ? prefs.message() : getString(R.string.location_default_message);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(message)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    private boolean promote() {
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type);
            return true;
        } catch (Exception e) {
            // No location permission, or started from the background without "Allow all the time".
            // Sharing stays on: the app starts it again the next time it's opened.
            Log.w(TAG, "Couldn't start sharing in the foreground", e);
            return false;
        }
    }

    /** Ends sharing on this phone. A reason is kept for the page to explain why. */
    private void finish(String reason) {
        prefs.disable(reason);
        client.removeLocationUpdates(callback);
        requesting = false;
        ActivityRecognition.getClient(this).removeActivityTransitionUpdates(motionIntent);
        geofencing.removeGeofences(geofenceIntent);
        motionWatched = false;
        watchedPlaces = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void requestUpdates() {
        LocationRequest request = moving
                ? new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MOVING_INTERVAL_MS).setMinUpdateIntervalMillis(MOVING_INTERVAL_MS / 2).build()
                : new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, stillInterval()).setMinUpdateIntervalMillis(stillInterval() / 2).build();
        try {
            client.removeLocationUpdates(callback);
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
            requesting = true;
        } catch (SecurityException e) {
            Log.w(TAG, "Location permission is gone", e);
            finish("permission");
        }
    }

    private long stillInterval() {
        return motionWatched ? STILL_INTERVAL_WITH_MOTION_MS : STILL_INTERVAL_MS;
    }

    private void setMoving(boolean next) {
        if (moving == next) return;
        moving = next;
        requestUpdates();
    }

    private void onWake() {
        stillHint = false;
        anchorSince = SystemClock.elapsedRealtime();
        setMoving(true);
        reportNow();
    }

    private void onMotion(boolean movingNow) {
        if (movingNow) {
            if (!moving) onWake();
            else stillHint = false;
        } else {
            // A red light looks still too: this only shortens the wait, the fixes still decide.
            stillHint = true;
        }
    }

    private void watchMotion() {
        if (!motionAllowed(this)) {
            motionWatched = false;
            return;
        }
        List<ActivityTransition> transitions = new ArrayList<>();
        for (int type : new int[] { DetectedActivity.WALKING, DetectedActivity.RUNNING, DetectedActivity.ON_BICYCLE, DetectedActivity.IN_VEHICLE }) {
            transitions.add(new ActivityTransition.Builder().setActivityType(type).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build());
        }
        transitions.add(new ActivityTransition.Builder().setActivityType(DetectedActivity.STILL).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build());
        transitions.add(new ActivityTransition.Builder().setActivityType(DetectedActivity.STILL).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT).build());
        try {
            ActivityRecognition.getClient(this)
                    .requestActivityTransitionUpdates(new ActivityTransitionRequest(transitions), motionIntent)
                    .addOnSuccessListener(ignored -> {
                        boolean was = motionWatched;
                        motionWatched = true;
                        if (!was && !moving) requestUpdates();
                    })
                    .addOnFailureListener(e -> Log.w(TAG, "Motion detection unavailable", e));
        } catch (SecurityException e) {
            Log.w(TAG, "Motion permission is gone", e);
        }
    }

    // Geofences need "Allow all the time"; without it the low-power fixes still notice arrivals, later.
    private void watchPlaces() {
        String places = prefs.places();
        if (places == null || !backgroundAllowed(this)) {
            if (watchedPlaces != null) geofencing.removeGeofences(geofenceIntent);
            watchedPlaces = null;
            return;
        }
        if (places.equals(watchedPlaces)) return;
        List<Geofence> fences = new ArrayList<>();
        try {
            JSONArray list = new JSONArray(places);
            for (int i = 0; i < list.length() && fences.size() < MAX_GEOFENCES; i++) {
                JSONObject place = list.getJSONObject(i);
                fences.add(new Geofence.Builder()
                        .setRequestId(place.getString("id"))
                        .setCircularRegion(place.getDouble("lat"), place.getDouble("lng"), Math.max(GEOFENCE_MIN_RADIUS_M, (float) place.getDouble("radiusM")))
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
                        .setNotificationResponsiveness(30_000)
                        .build());
            }
        } catch (JSONException e) {
            Log.w(TAG, "Bad places", e);
            return;
        }
        geofencing.removeGeofences(geofenceIntent);
        watchedPlaces = places;
        if (fences.isEmpty()) return;
        // No initial trigger: being inside a place already isn't a crossing.
        GeofencingRequest request = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(fences).build();
        try {
            geofencing.addGeofences(request, geofenceIntent).addOnFailureListener(e -> {
                Log.w(TAG, "Couldn't add geofences", e);
                watchedPlaces = null;
            });
        } catch (SecurityException e) {
            Log.w(TAG, "Geofences need background location", e);
            watchedPlaces = null;
        }
    }

    private void reportNow() {
        forceNext = true;
        CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(MOVING_REPORT_MS)
                .setDurationMillis(20_000)
                .build();
        try {
            client.getCurrentLocation(request, null).addOnSuccessListener(fix -> {
                if (fix != null && running == this) onFix(fix);
            });
        } catch (SecurityException e) {
            Log.w(TAG, "Location permission is gone", e);
        }
    }

    private static float accuracyOf(Location location) {
        return location.hasAccuracy() ? location.getAccuracy() : VAGUE_M;
    }

    private void onFix(Location fix) {
        long now = SystemClock.elapsedRealtime();
        float accuracy = accuracyOf(fix);
        boolean recentGood = lastGoodAt >= 0 && now - lastGoodAt < VAGUE_OK_AFTER_MS;
        if (accuracy > VAGUE_M && recentGood) return;
        if (accuracy <= VAGUE_M) lastGoodAt = now;
        float speed = fix.hasSpeed() ? fix.getSpeed() : 0;

        if (anchor == null) {
            anchor = fix;
            anchorSince = now;
        } else if (moving) {
            if (anchor.distanceTo(fix) > Math.max(STILL_RADIUS_M, accuracy) || speed >= MOVING_SPEED_MPS) {
                anchor = fix;
                anchorSince = now;
            } else if (accuracy < accuracyOf(anchor)) {
                // A sharper fix of the same spot: it's where they are, and they've been there as long.
                anchor = fix;
            }
            if (now - anchorSince >= (stillHint ? STILL_AFTER_MOTION_MS : STILL_AFTER_MS)) {
                setMoving(false);
                forceNext = true;
            }
        } else {
            float slack = Math.max(WAKE_RADIUS_M, accuracy + accuracyOf(anchor));
            if (anchor.distanceTo(fix) > slack || speed >= WAKE_SPEED_MPS) {
                anchor = fix;
                anchorSince = now;
                setMoving(true);
                forceNext = true;
            } else if (accuracy < accuracyOf(anchor)) {
                anchor = fix;
            }
        }

        long gap = (moving ? MOVING_REPORT_MS : STILL_REPORT_MS) - REPORT_SLACK_MS;
        if (!forceNext && lastQueuedAt >= 0 && now - lastQueuedAt < gap) return;
        forceNext = false;
        lastQueuedAt = now;
        if (moving) {
            queue(new Report(fix, false));
        } else {
            // Wifi fixes wander around a house; the person doesn't. Still, they're at the spot, as of this fix.
            Location here = new Location(anchor);
            here.setTime(fix.getTime());
            here.setElapsedRealtimeNanos(fix.getElapsedRealtimeNanos());
            queue(new Report(here, true));
        }
    }

    private void queue(Report report) {
        pending = report;
        deliver();
    }

    private void deliver() {
        if (inFlight || pending == null) return;
        Report report = pending;
        pending = null;
        String url = prefs.url();
        if (url == null) return;
        // Read here: the cookie store is the web view's, and it's safest to use it on the main thread.
        String cookie = CookieManager.getInstance().getCookie(url);
        JSONObject body;
        try {
            body = bodyOf(report);
        } catch (JSONException e) {
            Log.w(TAG, "Couldn't build a report", e);
            return;
        }
        inFlight = true;
        try {
            http.execute(() -> {
                Outcome outcome = send(url, cookie, body, report.location);
                main.post(() -> delivered(report, outcome));
            });
        } catch (RejectedExecutionException e) {
            // Stopping.
            inFlight = false;
        }
    }

    private void delivered(Report report, Outcome outcome) {
        inFlight = false;
        if (running != this) return;
        switch (outcome) {
            case ENDED:
                // A timed share ran out: the server has already forgotten the position.
                finish("ended");
                return;
            case SIGNED_OUT:
                finish("signedOut");
                return;
            case RETRY:
                if (pending == null) pending = report;
                main.removeCallbacks(retry);
                main.postDelayed(retry, RETRY_MS);
                return;
            default:
                deliver();
        }
    }

    private JSONObject bodyOf(Report report) throws JSONException {
        Location location = report.location;
        JSONObject body = new JSONObject();
        body.put("lat", location.getLatitude());
        body.put("lng", location.getLongitude());
        if (location.hasAccuracy()) body.put("accuracy", (double) location.getAccuracy());
        if (report.still) {
            body.put("speed", 0);
        } else if (location.hasSpeed()) {
            body.put("speed", (double) location.getSpeed());
            if (location.hasBearing() && location.getSpeed() >= MOVING_SPEED_MPS) body.put("heading", (double) location.getBearing());
        }
        BatteryManager battery = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (battery != null) {
            int level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (level >= 0 && level <= 100) body.put("battery", level);
            body.put("charging", battery.isCharging());
        }
        body.put("source", "native");
        return body;
    }

    // On the HTTP thread.
    private Outcome send(String url, String cookie, JSONObject body, Location location) {
        // Turned off while this was waiting.
        if (!prefs.enabled()) return Outcome.DROP;
        long ageMs = Math.max(0, (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1_000_000);
        if (ageMs > MAX_AGE_MS) return Outcome.DROP;
        // Without the login cookie there's nothing to sign in with yet; that isn't being signed out.
        if (cookie == null) return Outcome.RETRY;
        wakeLock.acquire(TIMEOUT_MS * 2L + 5_000);
        HttpURLConnection connection = null;
        try {
            body.put("ageMs", ageMs);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) return Outcome.SIGNED_OUT;
            if (code == 408 || code == 429 || code >= 500) return Outcome.RETRY;
            if (code >= 400) return Outcome.DROP;
            JSONObject answer = new JSONObject(read(connection.getInputStream()));
            return answer.optBoolean("sharing", true) ? Outcome.OK : Outcome.ENDED;
        } catch (IOException e) {
            return Outcome.RETRY;
        } catch (JSONException e) {
            return Outcome.OK;
        } finally {
            if (connection != null) connection.disconnect();
            if (wakeLock.isHeld()) wakeLock.release();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int n;
            while ((n = stream.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
