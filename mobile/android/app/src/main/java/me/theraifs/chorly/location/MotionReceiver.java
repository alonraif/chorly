package me.theraifs.chorly.location;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;
import com.google.android.gms.location.DetectedActivity;

import java.util.List;

// The phone noticed it started or stopped moving: walking, cycling, driving, or lying still.
public class MotionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ActivityTransitionResult.hasResult(intent)) return;
        ActivityTransitionResult result = ActivityTransitionResult.extractResult(intent);
        if (result == null) return;
        List<ActivityTransitionEvent> events = result.getTransitionEvents();
        if (events.isEmpty()) return;
        // Only the latest matters: that's what the phone is doing now.
        ActivityTransitionEvent event = events.get(events.size() - 1);
        boolean still = event.getActivityType() == DetectedActivity.STILL;
        boolean entered = event.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER;
        LocationService.motion(context, still != entered);
    }
}
