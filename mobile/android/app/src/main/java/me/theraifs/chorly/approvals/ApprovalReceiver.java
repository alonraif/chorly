package me.theraifs.chorly.approvals;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

// The Approve button on a "ready for approval" notification. Approves as the signed-in parent,
// with the page's own login, and never opens the app.
public class ApprovalReceiver extends BroadcastReceiver {
    private static final String TAG = "ChorlyApprovals";

    private enum Result { APPROVED, HANDLED, FAILED }

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle extras = intent.getExtras();
        if (extras == null || extras.getString(ApprovalNotifications.EXTRA_INSTANCE) == null) return;
        Context app = context.getApplicationContext();
        String server = ApprovalNotifications.serverUrl(app);
        // On the main thread here, where the web view's cookie store is safest to read.
        String cookie = server != null ? ApprovalNotifications.cookie(server) : null;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Result result = approve(server, cookie, extras.getString(ApprovalNotifications.EXTRA_INSTANCE));
                switch (result) {
                    case APPROVED:
                        ApprovalNotifications.outcome(app, extras, extras.getString(ApprovalNotifications.EXTRA_APPROVED), true);
                        break;
                    case HANDLED:
                        ApprovalNotifications.outcome(app, extras, extras.getString(ApprovalNotifications.EXTRA_HANDLED), true);
                        break;
                    default:
                        ApprovalNotifications.outcome(app, extras, extras.getString(ApprovalNotifications.EXTRA_FAILED), false);
                }
            } finally {
                pending.finish();
            }
        }, "chorly-approve").start();
    }

    private static Result approve(String server, String cookie, String instanceId) {
        // Signed out in the app: the parent has to open it anyway.
        if (server == null || cookie == null) return Result.FAILED;
        HttpURLConnection connection = null;
        try {
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            String url = server + "/api/instances/" + URLEncoder.encode(instanceId, "UTF-8") + "/approve";
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(ApprovalNotifications.TIMEOUT_MS);
            connection.setReadTimeout(ApprovalNotifications.TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int code = connection.getResponseCode();
            if (code >= 200 && code < 300) return Result.APPROVED;
            // Another parent got to it first, or the kid took it back.
            if (code == 400 || code == 404) return Result.HANDLED;
            return Result.FAILED;
        } catch (IOException e) {
            Log.w(TAG, "Couldn't approve", e);
            return Result.FAILED;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
