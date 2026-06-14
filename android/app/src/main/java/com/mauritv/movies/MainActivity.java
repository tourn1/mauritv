package com.mauritv.movies;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
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
    private ImageView cursorBorder; // Segundo ImageView para el borde con la misma forma
    private float cursorX = 0;
    private float cursorY = 0;
    private int screenWidth = 0;
    private int screenHeight = 0;
    private int cursorSpeed = 38; // Incrementado un 50% (de 25 a 38)
    private final Handler hideHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideCursorRunnable = new Runnable() {
        @Override
        public void run() {
            if (cursorView != null) {
                cursorView.setVisibility(View.GONE);
                if (cursorBorder != null) cursorBorder.setVisibility(View.GONE);
                isCursorActive = false;
                
                // Quitar foco solo si no estamos en un dropdown para ocultar controles del player
                WebView webView = getBridge().getWebView();
                if (webView != null && isPlayerPage()) {
                    webView.evaluateJavascript(
                        "(function() {" +
                        "  var active = document.activeElement;" +
                        "  if (!active) return;" +
                        "  var isDropdown = active.tagName === 'SELECT' || " +
                        "                   active.getAttribute('role') === 'listbox' || " +
                        "                   active.className.includes('select') || " +
                        "                   active.className.includes('dropdown') || " +
                        "                   !!active.closest('.dropdown, .select-items, select');" +
                        "  if (!isDropdown) {" +
                        "    active.blur();" +
                        "    window.focus();" +
                        "  }" +
                        "})();", null);
                }
            }
        }
    };

    private void resetHideTimer() {
        hideHandler.removeCallbacks(hideCursorRunnable);
        hideHandler.postDelayed(hideCursorRunnable, 3000);
    }

    private boolean isPlayerPage() {
        WebView webView = getBridge().getWebView();
        if (webView != null && webView.getUrl() != null) {
            return webView.getUrl().contains("player.html");
        }
        return false;
    }

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
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        screenWidth = metrics.widthPixels;
        screenHeight = metrics.heightPixels;

        int cursorSizePx = (int) (28 * metrics.density);
        int borderSizePx = (int) (31 * metrics.density); // Ligeramente más grande para el borde

        // ImageView para el BORDE (Negro)
        cursorBorder = new ImageView(this);
        cursorBorder.setImageResource(android.R.drawable.ic_menu_send);
        cursorBorder.setColorFilter(Color.BLACK, PorterDuff.Mode.SRC_IN);
        cursorBorder.setRotation(-135);
        cursorBorder.setElevation(998);
        cursorBorder.setScaleType(ImageView.ScaleType.FIT_CENTER);
        
        // ImageView para el CURSOR (Blanco)
        cursorView = new ImageView(this);
        cursorView.setImageResource(android.R.drawable.ic_menu_send); 
        cursorView.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        cursorView.setRotation(-135);
        cursorView.setElevation(999);
        cursorView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        
        FrameLayout.LayoutParams borderParams = new FrameLayout.LayoutParams(borderSizePx, borderSizePx);
        FrameLayout.LayoutParams cursorParams = new FrameLayout.LayoutParams(cursorSizePx, cursorSizePx);
        
        addContentView(cursorBorder, borderParams);
        addContentView(cursorView, cursorParams);
        
        cursorView.setVisibility(View.GONE);
        cursorBorder.setVisibility(View.GONE);

        cursorX = screenWidth / 2f;
        cursorY = screenHeight / 2f;
        updateCursorPosition();
    }

    private void updateCursorPosition() {
        if (cursorView != null && cursorBorder != null) {
            if (cursorX < 0) cursorX = 0;
            if (cursorX > screenWidth) cursorX = screenWidth;
            if (cursorY < 0) cursorY = 0;
            if (cursorY > screenHeight) cursorY = screenHeight;

            cursorView.setX(cursorX);
            cursorView.setY(cursorY);
            
            // Centrar el borde respecto al cursor
            float offset = (cursorBorder.getWidth() - cursorView.getWidth()) / 2f;
            cursorBorder.setX(cursorX - offset);
            cursorBorder.setY(cursorY - offset);
        }
    }

    private void toggleCursor() {
        if (!isPlayerPage()) return;
        
        isCursorActive = !isCursorActive;
        int visibility = isCursorActive ? View.VISIBLE : View.GONE;
        cursorView.setVisibility(visibility);
        cursorBorder.setVisibility(visibility);
        if (isCursorActive) {
            updateCursorPosition();
            resetHideTimer();
        }
    }

    private void showCursor() {
        if (!isPlayerPage()) return;
        
        if (!isCursorActive) {
            isCursorActive = true;
            cursorView.setVisibility(View.VISIBLE);
            cursorBorder.setVisibility(View.VISIBLE);
        }
        updateCursorPosition();
        resetHideTimer();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();

        boolean isDpadArrow = keyCode == KeyEvent.KEYCODE_DPAD_UP ||
                             keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
                             keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
                             keyCode == KeyEvent.KEYCODE_DPAD_RIGHT;

        // Evitar que el teclado se abra automáticamente al navegar con flechas
        if (action == KeyEvent.ACTION_DOWN && isDpadArrow) {
            // Inmediatamente intentar ocultar y también programar un intento posterior
            hideKeyboard();
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.postDelayed(this::hideKeyboard, 10);
                webView.postDelayed(this::hideKeyboard, 50);
            }
        }

        // Activar cursor en player.html con cualquier direccional
        if (action == KeyEvent.ACTION_DOWN && isDpadArrow && isPlayerPage()) {
            showCursor();
        }

        // Navegación con el cursor activo
        if (isCursorActive && isPlayerPage()) {
            if (action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_MULTIPLE) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_UP:
                        cursorY -= cursorSpeed;
                        if (cursorY < 0) {
                            cursorY = 0;
                            scrollWebView(-200);
                        }
                        showCursor();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                        cursorY += cursorSpeed;
                        if (cursorY > screenHeight) {
                            cursorY = screenHeight;
                            scrollWebView(200);
                        }
                        showCursor();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        cursorX -= cursorSpeed;
                        showCursor();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        cursorX += cursorSpeed;
                        showCursor();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                        simulateClick(cursorX, cursorY);
                        resetHideTimer();
                        return true;
                }
            }
            
            // Bloquear escape del foco si el mouse está activo
            if (isDpadArrow) {
                return true;
            }
        }

        return super.dispatchKeyEvent(event);
    }

    private void simulateClick(float x, float y) {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        // Avisar al JS que este foco es legítimo
        webView.evaluateJavascript("window.isMouseClick = true; setTimeout(function(){ window.isMouseClick = false; }, 500);", null);

        long downTime = SystemClock.uptimeMillis();
        MotionEvent downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        webView.dispatchTouchEvent(downEvent);
        
        MotionEvent upEvent = MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, x, y, 0);
        webView.dispatchTouchEvent(upEvent);
        
        downEvent.recycle();
        upEvent.recycle();

        // Forzar mostrar el teclado SOLO si NO estamos en player.html
        if (!isPlayerPage()) {
            webView.postDelayed(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) {
                    imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                }
            }, 100);
        }
    }

    private void hideKeyboard() {
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
            }
        }
    }

    private void scrollWebView(int amount) {
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.post(() -> {
                webView.evaluateJavascript("window.scrollBy(0, " + amount + ");", null);
            });
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Recalcular dimensiones por si cambió la resolución o rotación
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        screenWidth = metrics.widthPixels;
        screenHeight = metrics.heightPixels;
    }

    private void configurarWebView(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        
        // Evitar que el foco automático abra el teclado en TV
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(false);
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inyectar script para bloquear foco automático que dispara el teclado
                // Solo bloqueamos si el evento NO es disparado por un click o si no estamos activamente queriendo enfocar
                view.evaluateJavascript(
                    "window.addEventListener('focusin', function(e) {" +
                    "  if (e.target.tagName === 'INPUT' && !window.isMouseClick) {" +
                    "    e.preventDefault();" +
                    "    e.stopPropagation();" +
                    "    // Si el foco viene de navegación por flechas, lo permitimos visualmente pero cerramos teclado" +
                    "    setTimeout(function() { if(!window.isMouseClick) e.target.blur(); }, 1);" +
                    "  }" +
                    "}, true);", null);
            }

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
            toggleCursor();
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
