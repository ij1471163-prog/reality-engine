package com.naif.realityengine;

import android.app.Activity;
import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;

import com.android.billingclient.api.*;

import java.util.ArrayList;
import java.util.List;

/**
 * BillingManager — Google Play Billing v7
 * يدير الاشتراكات والمشتريات
 */
public class BillingManager implements PurchasesUpdatedListener {

    private static final String TAG = "BillingManager";

    // Product IDs — غيّرها حسب ما تسجله في Play Console
    public static final String PLAN_MONTHLY = "reality_engine_monthly";
    public static final String PLAN_YEARLY  = "reality_engine_yearly";

    private final Context context;
    private BillingClient billingClient;
    private BillingListener listener;
    private static BillingManager instance;

    public interface BillingListener {
        void onPremiumGranted();
        void onPremiumRevoked();
        void onBillingError(String message);
        void onPriceLoaded(String monthlyPrice, String yearlyPrice);
    }

    private BillingManager(Context context) {
        this.context = context.getApplicationContext();
        setupBillingClient();
    }

    public static BillingManager getInstance(Context context) {
        if (instance == null) {
            instance = new BillingManager(context);
        }
        return instance;
    }

    public void setListener(BillingListener listener) {
        this.listener = listener;
    }

    // ─── Setup ────────────────────────────────────────────

    private void setupBillingClient() {
        billingClient = BillingClient.newBuilder(context)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build();

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing connected");
                    checkExistingPurchases();
                    loadPrices();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                Log.w(TAG, "Billing disconnected — retrying...");
                setupBillingClient();
            }
        });
    }

    // ─── Purchase Flow ────────────────────────────────────

    public void launchPurchase(Activity activity, String productId) {
        if (!billingClient.isReady()) {
            if (listener != null) {
                listener.onBillingError("الخدمة غير متاحة حالياً");
            }
            return;
        }

        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        products.add(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        );

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                if (listener != null) {
                    listener.onBillingError("خطأ في تحميل المنتج");
                }
                return;
            }

            if (productDetailsList.getProductDetailsList() == null || productDetailsList.getProductDetailsList().isEmpty()) {
                if (listener != null) {
                    listener.onBillingError("المنتج غير موجود");
                }
                return;
            }

            ProductDetails productDetails = productDetailsList.getProductDetailsList().get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers =
                productDetails.getSubscriptionOfferDetails();

            if (offers == null || offers.isEmpty()) {
                if (listener != null) {
                    listener.onBillingError("لا توجد عروض متاحة");
                }
                return;
            }

            List<BillingFlowParams.ProductDetailsParams> productDetailsParams = new ArrayList<>();
            productDetailsParams.add(
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(productDetails)
                    .setOfferToken(offers.get(0).getOfferToken())
                    .build()
            );

            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(productDetailsParams)
                .build();

            billingClient.launchBillingFlow(activity, flowParams);
        });
    }

    // ─── Purchase Updates ─────────────────────────────────

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult result,
                                    List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK
                && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            Log.d(TAG, "User cancelled");
        } else {
            if (listener != null) {
                listener.onBillingError("خطأ: " + result.getDebugMessage());
            }
        }
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
            // تأكيد الشراء إذا لم يتم تأكيده
            if (!purchase.isAcknowledged()) {
                AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();

                billingClient.acknowledgePurchase(params, billingResult -> {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        grantPremium();
                    }
                });
            } else {
                grantPremium();
            }
        }
    }

    // ─── Check Existing Purchases ─────────────────────────

    public void checkExistingPurchases() {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build();

        billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                return;
            }

            boolean hasActiveSub = false;
            for (Purchase purchase : purchases) {
                if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                    hasActiveSub = true;
                    break;
                }
            }

            if (hasActiveSub) {
                grantPremium();
            } else {
                revokePremium();
            }
        });
    }

    // ─── Load Prices ──────────────────────────────────────

    private void loadPrices() {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        products.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PLAN_MONTHLY)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());
        products.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PLAN_YEARLY)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build();

        billingClient.queryProductDetailsAsync(params, (result, list) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                return;
            }

            String monthly = "---", yearly = "---";
            java.util.List<ProductDetails> pdList = list.getProductDetailsList();
            if (pdList == null) pdList = new java.util.ArrayList<>();
            for (ProductDetails details : pdList) {
                List<ProductDetails.SubscriptionOfferDetails> offers =
                    details.getSubscriptionOfferDetails();
                if (offers != null && !offers.isEmpty()) {
                    String price = offers.get(0)
                        .getPricingPhases()
                        .getPricingPhaseList()
                        .get(0)
                        .getFormattedPrice();
                    if (details.getProductId().equals(PLAN_MONTHLY)) {
                        monthly = price;
                    } else if (details.getProductId().equals(PLAN_YEARLY)) {
                        yearly = price;
                    }
                }
            }

            if (listener != null) {
                final String m = monthly, y = yearly;
                listener.onPriceLoaded(m, y);
            }
        });
    }

    // ─── Premium State ────────────────────────────────────

    private void grantPremium() {
        PremiumManager.setPremium(context, true);
        if (listener != null) {
            listener.onPremiumGranted();
        }
        Log.d(TAG, "Premium granted");
    }

    private void revokePremium() {
        PremiumManager.setPremium(context, false);
        if (listener != null) {
            listener.onPremiumRevoked();
        }
        Log.d(TAG, "Premium revoked");
    }

    // ─── Cleanup ──────────────────────────────────────────

    public void destroy() {
        if (billingClient != null && billingClient.isReady()) {
            billingClient.endConnection();
        }
    }
}
