  // Follow the two real BrowsingContexts through the native frame-loader swap.
  // No title/URL matching, target recreation, actor rebind or page initialization.
  _onNativeSwap(event) {
    const browser = event.target;
    const other = event.detail;
    this._nativeSwaps ??= new WeakMap();
    if (this._nativeSwaps.has(browser)) return; // Each end dispatches the event.
    const first = this._browserToTarget.get(browser);
    const second = this._browserToTarget.get(other);
    if (!first || !second) {
      if (first) first._nativeSwapPending = true;
      if (second) second._nativeSwapPending = true;
      return;
    }
    const swap = {browser, other, first, second,
      context: browser.browsingContext, otherContext: other.browsingContext};
    first._nativeSwapPending = second._nativeSwapPending = true;
    this._nativeSwaps.set(browser, swap);
    this._nativeSwaps.set(other, swap);
    // removeProgressListener resolves browser.webProgress dynamically: detach
    // before swapFrameLoaders changes which BrowsingContext the browser owns.
    helper.removeListeners(first._eventListeners);
    first._eventListeners = [];
    helper.removeListeners(second._eventListeners);
    second._eventListeners = [];
  }

  _onNativeSwapDone(event) {
    const swap = this._nativeSwaps?.get(event.target);
    if (!swap) return;
    const {browser, other, first, second, context, otherContext} = swap;
    // A partial/missing/mismatched swap stays unavailable; never guess its owner.
    if (event.detail !== (event.target === browser ? other : browser) ||
        browser.browsingContext !== otherContext || other.browsingContext !== context ||
        first._disposed || second._disposed || first.browserContext() !== second.browserContext())
      return;
    const firstTab = (other.ownerGlobal || other.documentGlobal)?.gBrowser?.getTabForBrowser(other);
    const secondTab = (browser.ownerGlobal || browser.documentGlobal)?.gBrowser?.getTabForBrowser(browser);
    if (!firstTab?.isConnected || !secondTab?.isConnected) return;
    first._adoptNativeTab(firstTab);
    second._adoptNativeTab(secondTab);
    this._browserToTarget.set(other, first);
    this._browserToTarget.set(browser, second);
    // browserId -> target and the live actor/channel stay with their content.
    this._nativeSwaps.delete(browser);
    this._nativeSwaps.delete(other);
    first._nativeSwapPending = second._nativeSwapPending = false;
    // Ordinary adoption already emitted TabClose before Swap. Last-tab adoption
    // emits no TabClose; its later window-close disposes the remaining placeholder.
    for (const target of [first, second]) {
      target._nativeAdopting = false;
      if (target._tab.closing) target.dispose();
    }
  }
