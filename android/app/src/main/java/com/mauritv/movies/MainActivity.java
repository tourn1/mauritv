package com.mauritv.movies;

import android.graphics.Color;
import android.graphics.PorterDuff;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.DisplayMetrics;
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
    private int screenWidth = 0;
    private int screenHeight = 0;
    private int cursorSpeed = 25; // Velocidad ajustada
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
        // Obtener dimensiones reales de la pantalla
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        screenWidth = metrics.widthPixels;
        screenHeight = metrics.heightPixels;

        // Tamaño del cursor en DP para que sea consistente
        int cursorSizePx = (int) (30 * metrics.density);

        cursorView = new ImageView(this);
        // Usar un icono más pequeño y limpio
        cursorView.setImageResource(android.R.drawable.ic_menu_send); 
        cursorView.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        cursorView.setRotation(-135); // Apuntar hacia arriba-izquierda
        cursorView.setElevation(999); // Máxima elevación
        cursorView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        cursorView.setPadding(0, 0, 0, 0);
        
        // Configurar el layout para que NO sea pantalla completa, sino el tamaño del icono
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(cursorSizePx, cursorSizePx);
        params.gravity = Gravity.TOP | Gravity.START;
        
        // Añadir a la ventana
        addContentView(cursorView, params);
        cursorView.setVisibility(View.GONE);

        // Posición inicial: centro
        cursorX = screenWidth / 2f;
        cursorY = screenHeight / 2f;
        updateCursorPosition();
    }

    private void updateCursorPosition() {
        if (cursorView != null) {
            // Asegurar que el cursor se mantenga dentro de los límites de la pantalla
            if (cursorX < 0) cursorX = 0;
            if (cursorX > screenWidth) cursorX = screenWidth;
            if (cursorY < 0) cursorY = 0;
            if (cursorY > screenHeight) cursorY = screenHeight;

            cursorView.setX(cursorX);
            cursorView.setY(cursorY);
        }
    }

    private void toggleCursor() {
        isCursorActive = !isCursorActive;
        cursorView.setVisibility(isCursorActive ? View.VISIBLE : View.GONE);
        if (isCursorActive) {
            // Resetear posición al activar por si acaso
            cursorX = screenWidth / 2f;
            cursorY = screenHeight / 2f;
            updateCursorPosition();
            Toast.makeText(this, "Modo Mouse: ACTIVADO", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "Modo Mouse: DESACTIVADO", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();

        // Triple Click central
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

        // Navegación con el cursor activo
        if (isCursorActive) {
            if (action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_MULTIPLE) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_UP:
                        cursorY -= cursorSpeed;
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                        cursorY += cursorSpeed;
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        cursorX -= cursorSpeed;
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        cursorX += cursorSpeed;
                        updateCursorPosition();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                        simulateClick(cursorX, cursorY);
                        return true;
                }
            }
            
            // Bloquear escape del foco si el mouse está activo
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
        
        // Simular evento Touch Down
        MotionEvent downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        webView.dispatchTouchEvent(downEvent);
        
        // Simular evento Touch Up un poco después
        MotionEvent upEvent = MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, x, y, 0);
        webView.dispatchTouchEvent(upEvent);
        
        downEvent.recycle();
        upEvent.recycle();
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
