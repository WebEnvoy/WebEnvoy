#!/usr/bin/env python3
"""Add bounded observation to a fresh R copy; never apply a lifecycle repair here."""
import copy
import importlib.util
import json
import pathlib
import sys
import zipfile

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prototype_build', ROOT / 'build-prototype.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def replace(source, before, after):
    assert source.count(before) == 1, f'Exact trace anchor mismatch: {before}'
    return source.replace(before, after)

def build(destination):
    with zipfile.ZipFile(builder.SOURCE / 'Contents/Resources/omni.ja') as original:
        assert builder.sha(original.read('chrome/juggler/content/protocol/PageHandler.js')) == '6ed7718164bd5532e40170193d2d3915dfcba55f0a372c2f4a26dfc90f6e1b8d', 'Unqualified trace PageHandler source'
    # The base builder checks the fixed original source before making any copy.
    builder.build(destination)
    destination = pathlib.Path(destination).resolve()
    jar = destination / 'Contents/Resources/omni.ja'
    registry_name = 'chrome/juggler/content/TargetRegistry.js'
    handler_name = 'chrome/juggler/content/protocol/PageHandler.js'
    with zipfile.ZipFile(jar) as archive:
        registry = archive.read(registry_name).decode()
        registry = replace(registry, 'export class TargetRegistry {', (ROOT / 'lifecycle-trace.js').read_text() + '\nexport class TargetRegistry {')
        registry = replace(registry, '      const tab = event.target;\n      const userContextId', "      const tab = event.target;\n      nativeTrace(this, 'TabOpen', null, tab.linkedBrowser, event.detail?.adoptedTab?.linkedBrowser);\n      const userContextId")
        registry = replace(registry, '      const linkedBrowser = tab.linkedBrowser;\n      const target', "      const linkedBrowser = tab.linkedBrowser;\n      nativeTrace(this, 'TabClose', null, linkedBrowser, event.detail?.adoptedBy?.linkedBrowser);\n      const target")
        registry = replace(registry, "        helper.addEventListener(tabContainer, 'TabClose', onTabCloseListener),", "        helper.addEventListener(tabContainer, 'TabClose', onTabCloseListener),\n        ...['SwapDocShells', 'EndSwapDocShells'].map(name => helper.addEventListener(domWindow, name, event => nativeTrace(this, name, null, event.target, event.detail), true)),")
        registry = replace(registry, '  onActorCreated(actor) {', "  onActorCreated(actor) {\n    nativeTrace(this, 'actorCreated', null, null, null, actor);")
        registry = replace(registry, '  onActorDestroyed(actor) {', "  onActorDestroyed(actor) {\n    nativeTrace(this, 'actorDestroyed', null, null, null, actor);")
        registry = replace(registry, '    this._registry.emit(TargetRegistry.Events.TargetCreated, this);', "    nativeTrace(this._registry, 'targetCreated', this, this._linkedBrowser);\n    this._registry.emit(TargetRegistry.Events.TargetCreated, this);")
        registry = replace(registry, '  setActor(actor) {', "  setActor(actor) {\n    nativeTrace(this._registry, 'setActor', this, this._linkedBrowser, null, actor);")
        registry = replace(registry, '  removeActor(actor) {', "  removeActor(actor) {\n    nativeTrace(this._registry, 'removeActor', this, this._linkedBrowser, null, actor);")
        registry = replace(registry, '  dispose() {\n    this.ensureContextMenuClosed();', "  dispose() {\n    nativeTrace(this._registry, 'targetDispose', this, this._linkedBrowser);\n    this.ensureContextMenuClosed();")
        registry = replace(registry, '  static instance() {', "  trace(kind, target) { nativeTrace(this, kind, target, target._linkedBrowser); }\n\n  static instance() {")
        handler = archive.read(handler_name).decode()
        handler = replace(handler, '  _onPageReady(event) {', "  _onPageReady(event) {\n    this._pageTarget._registry.trace('pageReady', this._pageTarget);")
        entries = [(copy.copy(info), archive.read(info.filename)) for info in archive.infolist()]
    changes = {registry_name: registry.encode(), handler_name: handler.encode()}
    with zipfile.ZipFile(jar, 'w') as archive:
        for info, content in entries:
            archive.writestr(info, changes.get(info.filename, content))
    path = destination.parent / 'prototype-manifest.json'
    manifest = json.loads(path.read_text())
    with zipfile.ZipFile(builder.SOURCE / 'Contents/Resources/omni.ja') as original:
        for name, data in changes.items():
            manifest['changes'][name] = {'source': builder.sha(original.read(name)), 'prototype': builder.sha(data)}
    manifest['prototype_jar_sha256'] = builder.sha(jar.read_bytes())
    manifest['diagnostic_trace'] = {'version': 'adoption-trace-1', 'max_parent_records': 1024, 'lifecycle_fix': False,
                                    'source_sha256': builder.sha((ROOT / 'lifecycle-trace.js').read_bytes())}
    path.write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'trace_built': True, 'prototype_jar_sha256': manifest['prototype_jar_sha256']}))

if __name__ == '__main__':
    build(sys.argv[1])
