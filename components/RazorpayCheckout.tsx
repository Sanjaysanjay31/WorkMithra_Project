/**
 * In-app Razorpay Checkout (TEST MODE).
 *
 * Native (Android/iOS): renders Razorpay's standard checkout.js inside a
 * WebView modal — no native SDK or dev build required. The checkout's
 * success handler posts the order/payment/signature ids back via
 * ReactNativeWebView.postMessage; the parent then calls POST /payments/verify
 * so the backend can HMAC-check the signature before accepting the payment.
 *
 * Web: loads checkout.js into the page and opens the same Razorpay modal
 * in the browser.
 *
 * The amount and order come from POST /payments/order (the locked
 * final_price) — this component never decides how much is paid.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import type { PaymentOrderResponse, RazorpaySuccessPayload } from '@/lib/types';

type Props = {
  order: PaymentOrderResponse;
  /** Shown under the amount in the checkout header. */
  description?: string;
  /** Optional prefill shown in the checkout form (name/contact/email). */
  prefill?: { name?: string; contact?: string; email?: string };
  onSuccess: (payload: RazorpaySuccessPayload) => void;
  /** Closed without paying, or the gateway reported a failure. */
  onDismiss: (reason?: string) => void;
};

export default function RazorpayCheckout({ order, description, prefill, onSuccess, onDismiss }: Props) {
  // Guard: postMessage can race with the dismiss handler — deliver once.
  const doneRef = useRef(false);

  function finishSuccess(payload: RazorpaySuccessPayload) {
    if (doneRef.current) return;
    doneRef.current = true;
    onSuccess(payload);
  }
  function finishDismiss(reason?: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    onDismiss(reason);
  }

  const config = {
    key: order.key_id,
    order_id: order.order_id,
    amount_paise: order.amount_paise,
    currency: order.currency || 'INR',
    description: description || 'Job payment',
    prefill: prefill || {},
  };

  // ---- Web platform: inject checkout.js and open the modal in-page ----
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    (async () => {
      try {
        await loadCheckoutScript();
        if (cancelled) return;
        const w = window as any;
        const rzp = new w.Razorpay({
          key: config.key,
          amount: config.amount_paise,
          currency: config.currency,
          name: 'WorkMithra',
          description: `${config.description} (TEST MODE)`,
          order_id: config.order_id,
          prefill: config.prefill,
          theme: { color: '#6F42C1' },
          modal: { ondismiss: () => finishDismiss() },
          handler: (response: any) =>
            finishSuccess({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
        });
        rzp.on('payment.failed', (resp: any) =>
          finishDismiss((resp?.error?.description as string) || 'Payment failed'),
        );
        rzp.open();
      } catch (e: any) {
        finishDismiss(e?.message || 'Could not load Razorpay checkout');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (Platform.OS === 'web') {
    // The Razorpay modal renders itself into the page; nothing to draw here.
    return null;
  }

  // ---- Native: WebView hosting checkout.js ----
  const html = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:#ffffff;}
</style>
</head>
<body>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var cfg = ${JSON.stringify(config)};
  function post(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  try {
    var rzp = new Razorpay({
      key: cfg.key,
      amount: cfg.amount_paise,
      currency: cfg.currency,
      name: 'WorkMithra',
      description: cfg.description + ' (TEST MODE)',
      order_id: cfg.order_id,
      prefill: cfg.prefill || {},
      theme: { color: '#6F42C1' },
      modal: { ondismiss: function () { post({ type: 'dismissed' }); } },
      handler: function (response) {
        post({
          type: 'success',
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature
        });
      }
    });
    rzp.on('payment.failed', function (resp) {
      post({ type: 'failed', reason: (resp.error && resp.error.description) || 'Payment failed' });
    });
    rzp.open();
  } catch (e) {
    post({ type: 'failed', reason: String(e) });
  }
</script>
</body>
</html>`;

  return (
    <Modal visible animationType="slide" onRequestClose={() => finishDismiss()}>
      <View style={styles.container}>
        <View style={styles.banner}>
          <Ionicons name="flask-outline" size={14} color="#3b2f00" />
          <Text style={styles.bannerText}>TEST MODE — no real money will be charged</Text>
          <Pressable onPress={() => finishDismiss()} hitSlop={8}>
            <Ionicons name="close" size={20} color="#3b2f00" />
          </Pressable>
        </View>
        <WebView
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          source={{ html }}
          onMessage={(event) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg.type === 'success') {
                finishSuccess({
                  razorpay_order_id: String(msg.razorpay_order_id || ''),
                  razorpay_payment_id: String(msg.razorpay_payment_id || ''),
                  razorpay_signature: String(msg.razorpay_signature || ''),
                });
              } else if (msg.type === 'failed') {
                finishDismiss(msg.reason || 'Payment failed');
              } else {
                finishDismiss();
              }
            } catch {
              /* non-JSON message from the page — ignore */
            }
          }}
        />
      </View>
    </Modal>
  );
}

function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Razorpay) return resolve();
    const existing = document.querySelector('script[data-rzp-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Razorpay checkout')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.setAttribute('data-rzp-checkout', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 44,
    paddingBottom: 10,
    backgroundColor: '#fde68a',
  },
  bannerText: { flex: 1, color: '#3b2f00', fontWeight: '600', fontSize: 12 },
  webview: { flex: 1 },
});
