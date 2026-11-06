package me.theraifs.chorly.location;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

// Sharing carries on after the phone restarts and after the app updates, without anyone opening it.
// Only with "Allow all the time": a location service started in the background can't get a position otherwise.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (!new LocationPrefs(context).enabled()) return;
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? Manifest.permission.ACCESS_BACKGROUND_LOCATION : Manifest.permission.ACCESS_FINE_LOCATION;
        if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) return;
        try {
            LocationService.start(context, LocationService.ACTION_START);
        } catch (Exception e) {
            Log.w("ChorlyLocation", "Couldn't resume sharing", e);
        }
    }
}
