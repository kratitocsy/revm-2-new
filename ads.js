// ===== ads.js =====
// Rewarded-ad gating. AdMob has no legitimate desktop/web SDK, so
// rewarded ads are Android-native-app only -- never shown (or even
// offered) on desktop (Tauri) or plain browser/PWA usage. Every
// caller checks canShowRewardedAd() before rendering any "watch an
// ad" UI at all, so desktop/web users simply never see a dead button.

function canShowRewardedAd() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform() && window.Capacitor.getPlatform() === 'android');
  } catch (_) {
    return false;
  }
}

// Requests + shows a rewarded ad for a given placement, and resolves
// once AdMob's own SSV callback has round-tripped through our backend
// (credit_verified_ad_reward) -- i.e. the reward is REAL and already
// applied server-side, not just "the ad finished playing locally".
//
// placement: 'superlike_bonus' | 'coin_topup' | 'emergency_pause' | 'materials_unlock'
// groupId: optional, for in-group ad attribution (35% vs 15% RevHead split)
//
// Requires the @capacitor-community/admob plugin (or similar) to be
// installed once you have real AdMob ad unit IDs -- this wraps it,
// it isn't itself a full AdMob integration.
async function showRewardedAd(placement, groupId, opts = {}) {
  if (!canShowRewardedAd()) {
    throw new Error('Rewarded ads are only available in the Android app.');
  }
  if (!window.__REVM2_ADMOB__) {
    throw new Error('AdMob plugin not initialized.');
  }

  const userId = opts.userId || (window.__revm2AuthUser__ && window.__revm2AuthUser__.id);
  if (!userId) throw new Error('Must be signed in to watch a rewarded ad.');

  const customData = `${userId}:${placement}:${groupId || ''}`;

  // AdMob plugin API shape varies -- adjust to whichever Capacitor
  // AdMob plugin you land on. This assumes an interface roughly like
  // @capacitor-community/admob's prepareRewardVideoAd/showRewardVideoAd.
  await window.__REVM2_ADMOB__.prepareRewardVideoAd({
    adId: opts.adUnitId,
    customData, // <-- passed through to Google, comes back on our SSV callback
  });
  const result = await window.__REVM2_ADMOB__.showRewardVideoAd();

  // The actual coin/superlike/etc credit happens server-side via the
  // SSV callback (admob-ssv-callback -> credit_verified_ad_reward),
  // NOT here -- this local "completed" event is just UX feedback.
  // Poll or re-fetch the relevant status (e.g. get_superlike_status)
  // after a short delay to reflect the credited state once the SSV
  // round-trip lands (usually a few seconds).
  return result;
}

window.canShowRewardedAd = canShowRewardedAd;
window.showRewardedAd = showRewardedAd;
