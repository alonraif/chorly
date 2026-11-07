package me.theraifs.chorly;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import me.theraifs.chorly.approvals.ApprovalsPlugin;
import me.theraifs.chorly.location.LocationPlugin;
import me.theraifs.chorly.updates.UpdatesPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // google_app_id only exists when the build included google-services.json.
        if (getResources().getIdentifier("google_app_id", "string", getPackageName()) != 0) {
            registerPlugin(FirebaseReadyPlugin.class);
            registerPlugin(ApprovalsPlugin.class);
        }
        registerPlugin(LocationPlugin.class);
        registerPlugin(UpdatesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
