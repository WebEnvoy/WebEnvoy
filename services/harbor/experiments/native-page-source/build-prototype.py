#!/usr/bin/env python3
"""Create a marked, local-only copy. Refuse unknown source files or existing output."""
import copy
import hashlib
import json
import pathlib
import plistlib
import shutil
import sys
import zipfile

SOURCE = pathlib.Path('/Applications/Camoufox.app')
ROOT = pathlib.Path(__file__).resolve().parent
PINS = {
    'chrome/juggler/content/protocol/BrowserHandler.js': '7eadb3dd570cd98688d4c3120f7ab36fe1cdc808f89ff51b61ce19db2661afc0',
    'chrome/juggler/content/protocol/Protocol.js': 'd7bad1be5746cf6e71774963bc0e9d859f8edc4a003a0705fefb4d525034c9ec',
    'chrome/juggler/content/TargetRegistry.js': '01c55e3aad7b2e2d1076091731c1bafdd156b2b2a7a6226ab531026fcd92a7e1',
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def build(destination):
    destination = pathlib.Path(destination).resolve()
    assert destination.is_relative_to(pathlib.Path('/tmp/webenvoy-native-prototype-504').resolve()), 'Local experiment output only'
    assert destination != SOURCE.resolve() and not destination.exists(), 'Fresh isolated destination required'
    jar = SOURCE / 'Contents/Resources/omni.ja'
    with zipfile.ZipFile(jar) as archive:
        for name, digest in PINS.items():
            assert sha(archive.read(name)) == digest, f'Unqualified source: {name}'
        protocol_name = 'chrome/juggler/content/protocol/Protocol.js'
        handler_name = 'chrome/juggler/content/protocol/BrowserHandler.js'
        protocol = archive.read(protocol_name).decode()
        handler = archive.read(handler_name).decode()
        method = """    'webenvoyNativeSnapshot': {
      params: {},
      returns: {
        schema: t.String, epoch: t.String, sampleSequence: t.Number, observedAt: t.Number,
        pages: t.Array({targetId: t.String, windowId: t.String, tabId: t.String}),
        windows: t.Array({windowId: t.String, selectedTargetId: t.Nullable(t.String),
          selectionStatus: t.Enum(['known', 'out_of_scope']), browserWindowActive: t.Nullable(t.Boolean)}),
      },
    },
"""
        anchor = "    'getInfo': {"
        assert protocol.count(anchor) == 1
        protocol = protocol.replace(anchor, method + anchor)
        anchor = "  async ['Browser.newPage']"
        assert handler.count(anchor) == 1
        handler = handler.replace(anchor, (ROOT / 'native-snapshot.js').read_text() + anchor)
        changes = {protocol_name: protocol.encode(), handler_name: handler.encode()}
        shutil.copytree(SOURCE, destination, symlinks=True)
        output = destination / 'Contents/Resources/omni.ja'
        with zipfile.ZipFile(output, 'w') as patched:
            for info in archive.infolist():
                patched.writestr(copy.copy(info), changes.get(info.filename, archive.read(info.filename)))
        shutil.copyfile(destination / 'Contents/Resources/properties.json', destination / 'Contents/MacOS/properties.json')
        plist_path = destination / 'Contents/Info.plist'
        with plist_path.open('rb') as stream:
            plist = plistlib.load(stream)
        plist['CFBundleIdentifier'] = 'com.webenvoy.prototype.native504'
        plist['CFBundleName'] = 'WebEnvoy Native Prototype'
        plist['CFBundleDisplayName'] = 'WebEnvoy Native Prototype'
        with plist_path.open('wb') as stream:
            plistlib.dump(plist, stream)
        manifest = {
            'kind': 'local-only-unadopted-prototype', 'schema': 'webenvoy-native-snapshot/prototype-1',
            'source_app': str(SOURCE), 'source_jar_sha256': sha(jar.read_bytes()),
            'prototype_jar_sha256': sha(output.read_bytes()),
            'changes': {name: {'source': sha(archive.read(name)), 'prototype': sha(data)} for name, data in changes.items()},
            'patch_source_sha256': sha((ROOT / 'native-snapshot.js').read_bytes()),
            'adjacent_properties_sha256': sha((destination / 'Contents/MacOS/properties.json').read_bytes()),
            'info_plist_sha256': sha(plist_path.read_bytes()),
            'original_signature_not_valid_for_modified_resources': True,
            'distribution_or_production_use_authorized': False,
        }
        (destination.parent / 'prototype-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(json.dumps(manifest))

if __name__ == '__main__':
    build(sys.argv[1])
