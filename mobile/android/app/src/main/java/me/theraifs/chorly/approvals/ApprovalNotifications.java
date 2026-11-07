package me.theraifs.chorly.approvals;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.CapConfig;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import me.theraifs.chorly.MainActivity;
import me.theraifs.chorly.R;

// "Ready for approval" pushes, drawn here rather than by Firebase so they can carry an Approve button
// and the kid's photo. Pressing Approve goes to ApprovalReceiver, which approves without opening Chorly.
public final class ApprovalNotifications {
    private static final String TAG = "ChorlyApprovals";
    private static final String CHANNEL_ID = "approvals";
    static final int TIMEOUT_MS = 8_000;
    // Bigger than any camera proof; anything past it isn't put in the notification.
    private static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    // Wide enough for the expanded notification, small enough to stay well inside the binder limit.
    private static final int IMAGE_SIDE = 1024;

    static final String EXTRA_INSTANCE = "instanceId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_URL = "url";
    static final String EXTRA_APPROVED = "approved";
    static final String EXTRA_HANDLED = "handled";
    static final String EXTRA_FAILED = "failed";

    private ApprovalNotifications() {}

    // On Firebase's background thread, which has time for the photo to download.
    public static void show(Context context, Map<String, String> data) {
        String instanceId = data.get(EXTRA_INSTANCE);
        if (instanceId == null) return;
        createChannel(context);
        String server = serverUrl(context);

        NotificationCompat.Builder builder = base(context, data.get(EXTRA_TITLE), data.get(EXTRA_BODY), data.get(EXTRA_URL), instanceId)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE);

        if ("1".equals(data.get("canApprove"))) {
            Intent approve = new Intent(context, ApprovalReceiver.class);
            Bundle extras = new Bundle();
            for (String key : new String[] {EXTRA_INSTANCE, EXTRA_TITLE, EXTRA_BODY, EXTRA_URL, EXTRA_APPROVED, EXTRA_HANDLED, EXTRA_FAILED}) {
                extras.putString(key, data.get(key));
            }
            approve.putExtras(extras);
            PendingIntent pending = PendingIntent.getBroadcast(
                    context, id(instanceId), approve, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, data.get("approve"), pending).build());
        }

        String image = data.get("image");
        if (image != null && image.startsWith("/") && server != null) {
            Bitmap photo = photo(server + image, cookie(server));
            if (photo != null) {
                builder.setLargeIcon(photo)
                        .setStyle(new NotificationCompat.BigPictureStyle().bigPicture(photo).bigLargeIcon((Bitmap) null));
            }
        }
        post(context, instanceId, builder);
    }

    // What the notification turns into once Approve was pressed. Good news goes away by itself.
    static void outcome(Context context, Bundle extras, String title, boolean ok) {
        String instanceId = extras.getString(EXTRA_INSTANCE);
        NotificationCompat.Builder builder = base(context, title, extras.getString(EXTRA_BODY), extras.getString(EXTRA_URL), instanceId)
                .setOnlyAlertOnce(true)
                .setSilent(true);
        if (ok) builder.setTimeoutAfter(5_000);
        post(context, instanceId, builder);
    }

    private static NotificationCompat.Builder base(Context context, String title, String body, String url, String instanceId) {
        return new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(ContextCompat.getColor(context, R.color.ic_launcher_background))
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(open(context, url, instanceId));
    }

    // Tapping opens Chorly on that page. The extras are the ones Firebase puts on its own notifications,
    // so the push plugin hands the url to the page the same way.
    private static PendingIntent open(Context context, String url, String instanceId) {
        Intent intent = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("google.message_id", "approval-" + instanceId);
        intent.putExtra("url", url != null ? url : "/parent/review");
        return PendingIntent.getActivity(context, id(instanceId), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void post(Context context, String instanceId, NotificationCompat.Builder builder) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManagerCompat.from(context).notify(id(instanceId), builder.build());
    }

    private static int id(String instanceId) {
        return ("approval:" + instanceId).hashCode();
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, context.getString(R.string.approvals_channel_name), NotificationManager.IMPORTANCE_HIGH);
        manager.createNotificationChannel(channel);
    }

    // The site the app loads, e.g. https://chores.the-raifs.me, without a trailing slash.
    static String serverUrl(Context context) {
        String url = CapConfig.loadDefault(context).getServerUrl();
        if (url == null) return null;
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    // The page's login cookie. The cookie store belongs to the web view, so it's read on the main thread.
    static String cookie(String url) {
        if (Looper.myLooper() == Looper.getMainLooper()) return CookieManager.getInstance().getCookie(url);
        AtomicReference<String> cookie = new AtomicReference<>();
        CountDownLatch read = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                cookie.set(CookieManager.getInstance().getCookie(url));
            } finally {
                read.countDown();
            }
        });
        try {
            read.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return cookie.get();
    }

    private static Bitmap photo(String url, String cookie) {
        if (cookie == null) return null;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200) return null;
            String type = connection.getContentType();
            if (type == null || !type.startsWith("image/")) return null;
            byte[] bytes = read(connection.getInputStream());
            if (bytes == null) return null;

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / (options.inSampleSize * 2) >= IMAGE_SIDE) options.inSampleSize *= 2;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "Couldn't load the proof", e);
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static byte[] read(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int n;
            while ((n = stream.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                if (out.size() > MAX_IMAGE_BYTES) return null;
            }
            return out.toByteArray();
        }
    }
}
