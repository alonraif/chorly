package me.theraifs.chorly.updates;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Updates the app from inside it (app 1.6+): downloads the APK from the family's own server with the
// signed-in cookie, checks it's a newer Chorly, and hands it to Android's installer, which asks the
// person to confirm. The first time, Android also asks them to let Chorly install apps.
@CapacitorPlugin(name = "ChorlyUpdates")
public class UpdatesPlugin extends Plugin {

    private static final String APK_PATH = "/api/app/android";

    private volatile boolean downloading = false;

    private long installedVersionCode() throws PackageManager.NameNotFoundException {
        Context context = getContext();
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        return PackageInfoCompat.getLongVersionCode(info);
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            Context context = getContext();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
            result.put("versionName", info.versionName);
            // Installing from a content:// link needs Android 7.
            result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read the app version", e);
        }
    }

    // Downloads the APK from the server the app loads (never anywhere else) and opens the installer.
    @PluginMethod
    public void install(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.reject("Updating from the app needs Android 7 or later", "unsupported");
            return;
        }
        if (downloading) {
            call.reject("Already downloading", "busy");
            return;
        }
        String server = getBridge().getServerUrl();
        if (server == null || server.isEmpty()) {
            call.reject("No server configured", "unsupported");
            return;
        }
        downloading = true;
        new Thread(() -> {
            try {
                File apk = download(new URL(new URL(server), APK_PATH));
                checkPackage(apk);
                openInstaller(apk);
                call.resolve();
            } catch (UpdateException e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                call.reject("Download failed", "download", e);
            } finally {
                downloading = false;
            }
        }).start();
    }

    private File download(URL url) throws Exception {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new UpdateException("Could not save the update", "download");
        File apk = new File(dir, "chorly.apk");
        File partial = new File(dir, "chorly.apk.part");

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        String cookie = CookieManager.getInstance().getCookie(url.toString());
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) throw new UpdateException("Signed out", "auth");
            if (status != 200) throw new UpdateException("Download failed (" + status + ")", "download");

            long total = connection.getContentLengthLong();
            long done = 0;
            int lastPercent = -1;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    done += read;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
            }
            if (total > 0 && done != total) throw new UpdateException("Download was cut off", "download");
        } finally {
            connection.disconnect();
        }
        if (apk.exists() && !apk.delete()) throw new UpdateException("Could not save the update", "download");
        if (!partial.renameTo(apk)) throw new UpdateException("Could not save the update", "download");
        return apk;
    }

    // Android also refuses an APK signed with another key; this catches the rest early with a clear reason.
    private void checkPackage(File apk) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        PackageInfo info = manager.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null || !getContext().getPackageName().equals(info.packageName)) {
            apk.delete();
            throw new UpdateException("The download isn't a Chorly app", "invalid");
        }
        if (PackageInfoCompat.getLongVersionCode(info) <= installedVersionCode()) {
            apk.delete();
            throw new UpdateException("This version is already installed", "current");
        }
    }

    private void openInstaller(File apk) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static class UpdateException extends Exception {
        final String code;

        UpdateException(String message, String code) {
            super(message);
            this.code = code;
        }
    }
}
