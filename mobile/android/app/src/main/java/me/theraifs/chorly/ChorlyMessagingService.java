package me.theraifs.chorly;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import me.theraifs.chorly.location.LocationService;

// Push messages, as the notifications plugin handles them, plus one of Chorly's own: a family member
// asking where this phone is ("check in now"). That one is silent and never reaches the page.
public class ChorlyMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if ("locate".equals(message.getData().get("type"))) {
            LocationService.locate(getApplicationContext());
            return;
        }
        super.onMessageReceived(message);
    }
}
