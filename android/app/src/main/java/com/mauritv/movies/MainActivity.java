package com.mauritv.movies;

import android.graphics.Color;
import android.graphics.PorterDuff;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressedTime;
    private static final int BACK_PRESS_INTERVAL = 2000;

    // Virtual Cursor Variables
    private boolean isCursorActive = false;
    private ImageView cursorView;
    private float cursorX = 0;
    private float cursorY = 0;
    private int cursorSpeed = 35;
    private long lastCenterClickTime = 0;
    private int centerClickCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            configurarWebView(webView);
            webView.loadUrl("https://mauritv.tourn1.com/");
            initVirtualCursor();
        }
    }

    private void initVirtualCursor() {
        cursorView = new ImageView(this);
        // Usar un icono de navegación del sistema o similar
        cursorView.setImageResource(android.R.drawable.ic_menu_send); 
        cursorView.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        cursorView.setRotation(-120); // Orientarlo como un puntero
        
        // Sombra para visibilidad
        cursorView.setElevation(100);
        
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(80, 80);
        params.gravity = Gravity.TOP | Gravity.START;
        cursorView.setLayoutParams(params);
        cursorView.setVisibility(View.GONE);

        addContentView(cursorView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        
        // Posición inicial: centro
        getWindow().getDecorView().post(() -> {
            cursorX = getWindow().getDecorView().getWidth() / 2f;
            cursorY = getWindow().getDecorView().getHeight() / 2f;
            updateCursorPosition();
        });
    }

    private void updateCursorPosition() {
        cursorView.setX(cursorX - 20); // Ajuste fino del hotspot
        cursorView.setY(cursorY - 20);
    }

    private void toggleCursor() {
        isCursorActive = !isCursorActive;
        cursorView.setVisibility(isCursorActive ? View.VISIBLE : View.GONE);
        if (isCursorActive) {
            Toast.makeText(this, "Modo Cursor Activado", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "Modo Cursor Desactivado", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();

        // Detectar triple click en botón central (ENTER o DPAD_CENTER)
        if (action == KeyEvent.ACTION_DOWN && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
            long currentTime = System.currentTimeMillis();
            if (currentTime - lastCenterClickTime < 600) {
                centerClickCount++;
            } else {
                centerClickCount = 1;
            }
            lastCenterClickTime = currentTime;

            if (centerClickCount == 3) {
                toggleCursor();
                centerClickCount = 0;
                return true;
            }
        }

        // Si el cursor está activo, interceptar flechas y centro
        if (isCursorActive) {
            if (action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_MULTIPLE) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_UP:
                        cursorY = Math.max(0, cursorY - cursorSpeed);
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                        cursorY = Math.min(getWindow().getDecorView().getHeight(), cursorY + cursorSpeed);
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        cursorX = Math.max(0, cursorX - cursorSpeed);
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        cursorX = Math.min(getWindow().getDecorView().getWidth(), cursorX + cursorSpeed);
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                        simulateClick(cursorX, cursorY);
                        return true;
                }
            }
            // Bloquear otras teclas de navegación mientras el cursor está activo
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN || 
                keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                return true;
            }
        }

        return super.dispatchKeyEvent(event);
    }

    private void simulateClick(float x, float y) {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        long downTime = SystemClock.uptimeMillis();
        long eventTime = SystemClock.uptimeMillis();
        
        MotionEvent downEvent = MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_DOWN, x, y, 0);
        webView.dispatchTouchEvent(downEvent);
        
        MotionEvent upEvent = MotionEvent.obtain(downTime, eventTime + 10, MotionEvent.ACTION_UP, x, y, 0);
        webView.dispatchTouchEvent(upEvent);
        
        downEvent.recycle();
        upEvent.recycle();
    }

    @Override
    public void onResume() {
        super.onResume();
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            webView.requestFocus();
            configurarWebView(webView);
        }
    }

    private void configurarWebView(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptEnabled(true); // Asegurar JS activo
        settings.setMediaPlaybackRequiresUserGesture(false); // Para autoplay
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.contains("tourn1.com") || url.contains("page.gd")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.contains("tourn1.com") || url.contains("page.gd")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }
        });

        webView.clearCache(true);
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (isCursorActive) {
            toggleCursor(); // El botón atrás desactiva el cursor si está encendido
            return;
        }

        WebView webView = getBridge().getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            if (lastBackPressedTime + BACK_PRESS_INTERVAL > System.currentTimeMillis()) {
                super.onBackPressed();
            } else {
                Toast.makeText(this, "Presione de nuevo para salir", Toast.LENGTH_SHORT).show();
                lastBackPressedTime = System.currentTimeMillis();
            }
        }
    }
}
