package me.theraifs.chorly.location;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.GeofencingEvent;

// Crossed the edge of one of the family's places: the server decides arrival or departure from a
// fresh, accurate fix, which this asks for right away.
public class GeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError()) return;
        LocationService.wake(context);
    }
}
