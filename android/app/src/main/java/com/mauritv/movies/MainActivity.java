package com.mauritv.movies;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressedTime;
    private static final int BACK_PRESS_INTERVAL = 2000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            configurarWebView(webView);
            // Forzar carga de la URL inicial
            webView.loadUrl("https://mauritv.tourn1.com/");
        }
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
        
        // Deshabilitar cache
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        
        // Configuraciones de almacenamiento
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        
        // Forzar a que los enlaces se abran DENTRO del WebView
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.contains("tourn1.com")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.contains("tourn1.com")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }
        });

        // Limpiar datos
        webView.clearCache(true);
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
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
