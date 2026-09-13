package hr.lucify.svirac;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Vlastiti dodatak mora biti prijavljen prije nego što se most digne. */
        registerPlugin(LucifyPreuzimacPlugin.class);
        super.onCreate(savedInstanceState);

        /* Od Androida 13 obavijest svirača traži dopuštenje. Glazba svira i bez
           njega, ali bez tipaka na zaključanom zaslonu. */
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }
}
