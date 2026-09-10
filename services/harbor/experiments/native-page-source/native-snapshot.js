  // Experimental, private pipe only. Never installs page scripts or changes focus.
  ['Browser.webenvoyNativeSnapshot']() {
    if (!this._enabled)
      throw new Error('Browser domain is not enabled');
    this._nativeEpoch ??= helper.generateId();
    this._nativeWindows ??= new WeakMap();
    this._nativeTabs ??= new WeakMap();
    const identity = (map, object) => {
      if (!map.has(object)) map.set(object, helper.generateId());
      return map.get(object);
    };
    const targets = this._targetRegistry.targets().filter(target => this._shouldAttachToTarget(target));
    if (targets.length > 256) throw new Error('Native snapshot page bound exceeded');
    const windows = new Map();
    const pages = [];
    // Synchronous snapshot: no await, activation, cached selected state or event replay.
    for (const target of targets) {
      const tab = target._tab;
      const browser = tab?.linkedBrowser;
      const window = tab?.ownerGlobal || tab?.documentGlobal;
      if (target._nativeSwapPending || target._nativeAdopting)
        throw new Error('Native association is transferring');
      if (target._disposed || !window || window.closed || !tab.isConnected ||
          browser !== target._linkedBrowser || !window.gBrowser?.tabs.includes(tab))
        throw new Error('Native association changed');
      const windowId = identity(this._nativeWindows, window);
      const tabId = identity(this._nativeTabs, tab);
      pages.push({targetId: target.id(), windowId, tabId});
      if (!windows.has(window)) {
        if (windows.size >= 64) throw new Error('Native snapshot window bound exceeded');
        const selected = window.gBrowser.selectedTab;
        const selectedTarget = selected && this._targetRegistry.targetForBrowser(selected.linkedBrowser);
        const owned = selectedTarget && this._shouldAttachToTarget(selectedTarget);
        if (!selected?.isConnected || !selectedTarget || selectedTarget._disposed)
          throw new Error('Native selection is unavailable');
        let browserWindowActive = null;
        try { browserWindowActive = Services.focus.activeWindow === window; } catch {}
        windows.set(window, {
          windowId,
          selectedTargetId: owned ? selectedTarget.id() : null,
          selectionStatus: owned ? 'known' : 'out_of_scope',
          browserWindowActive,
        });
      }
    }
    return {
      schema: 'webenvoy-native-snapshot/prototype-1',
      epoch: this._nativeEpoch,
      sampleSequence: this._nativeSequence = (this._nativeSequence || 0) + 1,
      observedAt: Date.now(),
      pages,
      windows: [...windows.values()],
    };
  }
