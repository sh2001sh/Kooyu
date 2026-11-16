package app.kooyu.qaprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import java.util.List;

/** Runs under the debug target UID; emits counts and stack locations, never credentials. */
public final class VaultCheckInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            Class<?> type = getTargetContext().getClassLoader().loadClass("app.kooyu.android.ConnectionVault");
            java.security.KeyStore keyStore = java.security.KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            String qaAlias = "kooyu.qa." + java.util.UUID.randomUUID();
            try {
                javax.crypto.KeyGenerator generator = javax.crypto.KeyGenerator.getInstance("AES", "AndroidKeyStore");
                generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(qaAlias, 3).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build());
                javax.crypto.SecretKey generated = generator.generateKey();
                android.security.keystore.KeyInfo freshInfo = (android.security.keystore.KeyInfo) javax.crypto.SecretKeyFactory.getInstance("AES", "AndroidKeyStore").getKeySpec(generated, android.security.keystore.KeyInfo.class);
                Bundle fresh = new Bundle();
                fresh.putString("stream", "FRESH_KEY_PURPOSES=" + freshInfo.getPurposes());
                sendStatus(0, fresh);
                javax.crypto.Cipher encrypt = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                encrypt.init(javax.crypto.Cipher.ENCRYPT_MODE, generated);
                byte[] iv = encrypt.getIV();
                byte[] ciphertext = encrypt.doFinal(new byte[]{1,2,3});
                javax.crypto.Cipher decrypt = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                decrypt.init(javax.crypto.Cipher.DECRYPT_MODE, keyStore.getKey(qaAlias, null), new javax.crypto.spec.GCMParameterSpec(128, iv));
                if (!java.util.Arrays.equals(decrypt.doFinal(ciphertext), new byte[]{1,2,3})) throw new IllegalStateException("Fresh cipher mismatch");
                fresh.putString("stream", "FRESH_KEY_ROUNDTRIP_OK");
                sendStatus(0, fresh);
            } finally { keyStore.deleteEntry(qaAlias); }
            java.security.Key key = keyStore.getKey("kooyu.connection", null);
            Bundle metadata = new Bundle();
            metadata.putString("stream", "VAULT_KEY_ALGORITHM=" + (key == null ? "missing" : key.getAlgorithm()));
            if (key instanceof javax.crypto.SecretKey) {
                android.security.keystore.KeyInfo info = (android.security.keystore.KeyInfo) javax.crypto.SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec((javax.crypto.SecretKey) key, android.security.keystore.KeyInfo.class);
                metadata.putString("stream", "VAULT_KEY_ALGORITHM=" + key.getAlgorithm() + " purposes=" + info.getPurposes() + " size=" + info.getKeySize());
            }
            sendStatus(0, metadata);
            Object vault = type.getConstructor(Context.class).newInstance(getTargetContext());
            Object book = type.getMethod("load").invoke(vault);
            List<?> devices = (List<?>) book.getClass().getMethod("getDevices").invoke(book);
            result.putString("stream", "VAULT_LOAD_OK devices=" + devices.size());
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            StringBuilder diagnostic = new StringBuilder("VAULT_LOAD_FAILED");
            for (Throwable cause = error; cause != null; cause = cause.getCause()) {
                diagnostic.append("\n").append(cause.getClass().getName());
                if (cause.getClass().getName().equals("android.security.KeyStoreException")) {
                    try {
                        Object code = cause.getClass().getMethod("getErrorCode").invoke(cause);
                        diagnostic.append(" code=").append(code);
                        for (java.lang.reflect.Field field : Class.forName("android.security.keymaster.KeymasterDefs").getFields()) {
                            if (field.getName().startsWith("KM_ERROR_") && field.getType() == int.class && field.get(null).equals(code)) diagnostic.append(" ").append(field.getName());
                        }
                    } catch (Exception ignored) {}
                }
                for (StackTraceElement frame : cause.getStackTrace()) {
                    if (frame.getClassName().startsWith("app.kooyu.") || frame.getClassName().startsWith("android.security.")) diagnostic.append("\n  at ").append(frame);
                }
            }
            result.putString("stream", diagnostic.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
