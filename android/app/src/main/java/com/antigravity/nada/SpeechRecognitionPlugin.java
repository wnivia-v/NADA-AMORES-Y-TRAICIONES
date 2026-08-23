package com.antigravity.nada;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Native voice shield for Android. The Web Speech API (used by
 * src/services/speechService.ts on PWA/Electron) does not exist in Android's
 * WebView, so on-device fraud-phrase detection needs this native bridge onto
 * android.speech.SpeechRecognizer instead.
 *
 * SpeechRecognizer only ever returns a single utterance and then stops
 * itself, so "continuous" listening is simulated the same way
 * speechService.ts does it on the web: restart automatically after every
 * result or transient error while `listening` stays true, and only give up
 * for real (not-allowed / audio-capture / a dead recognizer) — mirrored in
 * src/services/nativeSpeechService.ts and wired in through
 * speechRecognitionService.ts so protectionEngine.ts sees one identical
 * start/stop/transcript/error/activity shape on every platform.
 */
@CapacitorPlugin(
    name = "SpeechRecognition",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class SpeechRecognitionPlugin extends Plugin implements RecognitionListener {

    private static final int MAX_RESTARTS = 500;
    private static final long RESTART_DELAY_MS = 250;

    /**
     * Espera creciente cuando ninguna sesion trae palabras.
     *
     * Reportado usando la app: con el escudo puesto y un podcast sonando,
     * Spotify se pausaba y volvia una y otra vez. La causa es que
     * SpeechRecognizer.startListening() PIDE EL FOCO DE AUDIO en cada arranque,
     * y Android pausa lo que este sonando; al soltarlo, vuelve. Reabrir cada
     * 250 ms convertia eso en un tartamudeo continuo.
     *
     * Espaciar los reinicios no lo elimina —el foco se pide igual, solo que
     * menos veces— y por eso el arreglo de verdad esta en otro sitio: el motor
     * local abre el microfono UNA vez y no compite. Esto reduce el daño de
     * quien se quede con el reconocedor del sistema.
     */
    private static final long[] QUIET_RESTART_STEPS_MS = { RESTART_DELAY_MS, 1000, 3000, 5000, 8000 };
    private static final int QUIET_SESSIONS_BEFORE_SLOWING = 2;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private String lang = "es-ES";
    private int restartCount = 0;
    /** Sesiones seguidas sin una palabra. Gobierna cuanto se espera al reabrir. */
    private int quietSessions = 0;

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        this.lang = call.getString("lang", "es-ES");

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startAfterPermission");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            emitError("not-allowed");
            call.reject("not-allowed");
            return;
        }
        beginListening(call);
    }

    private void beginListening(PluginCall call) {
        if (listening) {
            call.resolve();
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext()) || getActivity() == null) {
            emitError("not-supported");
            call.reject("not-supported");
            return;
        }

        restartCount = 0;
        quietSessions = 0;
        listening = true;
        getActivity().runOnUiThread(this::createAndStartRecognizer);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        listening = false;
        if (getActivity() != null) {
            getActivity().runOnUiThread(this::teardownRecognizer);
        }
        call.resolve();
    }

    private void createAndStartRecognizer() {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(this);
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        recognizer.startListening(intent);
    }

    private void teardownRecognizer() {
        if (recognizer != null) {
            recognizer.stopListening();
            recognizer.destroy();
            recognizer = null;
        }
    }

    private void restartIfListening() {
        if (!listening) return;
        if (restartCount++ >= MAX_RESTARTS) {
            listening = false;
            emitError("start-failed");
            return;
        }

        int paso = Math.max(0, quietSessions - QUIET_SESSIONS_BEFORE_SLOWING);
        long espera = QUIET_RESTART_STEPS_MS[Math.min(paso, QUIET_RESTART_STEPS_MS.length - 1)];

        handler.postDelayed(() -> {
            if (listening) createAndStartRecognizer();
        }, espera);
    }

    // ── RecognitionListener ─────────────────────────────────────────────

    @Override
    public void onReadyForSpeech(Bundle params) {}

    @Override
    public void onBeginningOfSpeech() {
        emitActivity(true);
    }

    @Override
    public void onRmsChanged(float rmsdB) {}

    @Override
    public void onBufferReceived(byte[] buffer) {}

    @Override
    public void onEndOfSpeech() {
        emitActivity(false);
    }

    @Override
    public void onError(int error) {
        String code = mapError(error);
        boolean fatal = code.equals("not-allowed") || code.equals("audio-capture") || code.equals("service-not-allowed");
        emitError(code);
        if (fatal) {
            listening = false;
            return;
        }
        // Transient (no-speech, network hiccup, recognizer busy, ...) — restart,
        // same as speechService.ts's onend-driven restart loop on the web.
        quietSessions++;
        restartIfListening();
    }

    @Override
    public void onResults(Bundle results) {
        // Hubo palabras: se vuelve al ritmo rapido. Alguien esta hablando y no
        // es momento de tardar ocho segundos en reabrir.
        quietSessions = 0;
        emitTranscript(results, true);
        restartIfListening();
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        emitTranscript(partialResults, false);
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}

    // ── Helpers ──────────────────────────────────────────────────────────

    private void emitTranscript(Bundle results, boolean isFinal) {
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("text", matches.get(0));
        data.put("isFinal", isFinal);
        notifyListeners("transcript", data);
    }

    private void emitActivity(boolean active) {
        JSObject data = new JSObject();
        data.put("active", active);
        notifyListeners("speechActivity", data);
    }

    private void emitError(String code) {
        JSObject data = new JSObject();
        data.put("code", code);
        notifyListeners("error", data);
    }

    private String mapError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                return "network";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "aborted";
            case SpeechRecognizer.ERROR_CLIENT:
            default:
                return "aborted";
        }
    }
}
