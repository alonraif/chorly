package me.theraifs.chorly;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import me.theraifs.chorly.approvals.ApprovalNotifications;
import me.theraifs.chorly.location.LocationService;

// Push messages, as the notifications plugin handles them, plus two of Chorly's own: a family member
// asking where this phone is ("check in now"), which is silent, and a chore waiting for approval,
// drawn here with an Approve button and the photo. Neither reaches the page.
public class ChorlyMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if ("locate".equals(message.getData().get("type"))) {
            LocationService.locate(getApplicationContext());
            return;
        }
        if ("approval".equals(message.getData().get("type"))) {
            ApprovalNotifications.show(getApplicationContext(), message.getData());
            return;
        }
        super.onMessageReceived(message);
    }
}
