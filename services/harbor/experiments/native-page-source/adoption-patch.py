"""Exact edits for the pinned TargetRegistry; no installed source is modified."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def replace(source, before, after):
    if source.count(before) != 1:
        raise ValueError(f'Exact adoption anchor mismatch: {before}')
    return source.replace(before, after)

def patch(source):
    source = replace(source, '  // Firefox uses nsHttpAuthCache', (ROOT / 'adoption.js').read_text() + '\n  // Firefox uses nsHttpAuthCache')
    source = replace(source, '''      if (target)
          target.dispose();''', '''      if (target && event.detail?.adoptedBy) {
        target._nativeAdopting = true;
        return;
      }
      if (target)
          target.dispose();''')
    source = replace(source, "        helper.addEventListener(tabContainer, 'TabClose', onTabCloseListener),", """        helper.addEventListener(tabContainer, 'TabClose', onTabCloseListener),
        helper.addEventListener(domWindow, 'SwapDocShells', event => this._onNativeSwap(event), true),
        helper.addEventListener(domWindow, 'EndSwapDocShells', event => this._onNativeSwapDone(event), true),""")
    before = '''    const navigationListener = {
      QueryInterface: ChromeUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]),
      onLocationChange: (aWebProgress, aRequest, aLocation) => this._onNavigated(aLocation),
    };
    this._eventListeners = [
      helper.addObserver(this._updateModalDialogs.bind(this), 'common-dialog-loaded'),
      helper.addProgressListener(tab.linkedBrowser, navigationListener, Ci.nsIWebProgress.NOTIFY_LOCATION),
      helper.addEventListener(this._linkedBrowser, 'DOMModalDialogClosed', event => this._updateModalDialogs()),
      helper.addEventListener(this._linkedBrowser, 'WillChangeBrowserRemoteness', event => this._willChangeBrowserRemoteness()),
    ];'''
    source = replace(source, before, '    this._listenToNativeBrowser();')
    source = replace(source, '  async activateAndRun(', '''  _listenToNativeBrowser() {
''' + before.replace('tab.linkedBrowser, navigationListener', 'this._linkedBrowser, navigationListener') + '''
  }

  _adoptNativeTab(tab) {
    this._tab = tab;
    this._linkedBrowser = tab.linkedBrowser;
    this._window = tab.ownerGlobal || tab.documentGlobal;
    this._gBrowser = this._window.gBrowser;
    this._listenToNativeBrowser();
  }

  async activateAndRun(''')
    source = replace(source, '    const browserId = this._linkedBrowser.browsingContext.browserId;', '    const browserId = this._linkedBrowser.browsingContext.browserId;\n    this._registeredBrowserId = browserId;')
    source = replace(source, '''    this._registry._browserToTarget.delete(this._linkedBrowser);
    this._registry._browserIdToTarget.delete(this._linkedBrowser.browsingContext.browserId);''', '''    if (this._registry._browserToTarget.get(this._linkedBrowser) === this)
      this._registry._browserToTarget.delete(this._linkedBrowser);
    if (this._registry._browserIdToTarget.get(this._registeredBrowserId) === this)
      this._registry._browserIdToTarget.delete(this._registeredBrowserId);''')
    return source
