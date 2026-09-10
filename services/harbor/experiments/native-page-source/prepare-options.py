#!/usr/bin/env python3
"""Reuse the existing Driver's exact environment preparation without launching a browser."""
import importlib.util
import json
import os
import pathlib
import sys
import camoufox

sys.dont_write_bytecode = True

assert pathlib.Path(sys.argv[2]).resolve().is_relative_to(pathlib.Path('/tmp/webenvoy-native-prototype-504').resolve()), 'Only this experiment owns its profiles'

root = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('prototype_driver', root / 'packages/runtime-api/src/camoufox-driver.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

original_new_browser = camoufox.NewBrowser

class Captured(Exception):
    pass

def capture(_playwright, *, from_options, persistent_context):
    assert persistent_context
    if original_new_browser.__globals__["spoofs_window_dimensions"](from_options):
        from_options = {**from_options, "no_viewport": True}
    descriptor = os.open(sys.argv[3], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(from_options, output)
    raise Captured()

camoufox.NewBrowser = capture
try:
    driver.launch({'executable_path': sys.argv[1], 'profile_dir': sys.argv[2],
                   'headless': '--headless' in sys.argv[4:], 'url': 'about:blank', 'timeout_ms': 30000})
except Captured:
    print(json.dumps({'options_captured': True, 'browser_launched': False}))
finally:
    driver.close()
