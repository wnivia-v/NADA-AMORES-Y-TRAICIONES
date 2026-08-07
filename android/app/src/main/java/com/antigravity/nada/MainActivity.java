package com.antigravity.nada;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeechRecognitionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
