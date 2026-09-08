"""Run with the qualified Python environment and Camoufox executable argument.

Local-page Driver regression only; never uses an existing Profile or target site.
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1] / "packages/runtime-api/src/camoufox-driver.py"
spec = importlib.util.spec_from_file_location("camoufox_driver", source)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

with tempfile.TemporaryDirectory(prefix="harbor-camoufox-realm-") as profile:
    try:
        driver.launch({"profile_dir": profile, "executable_path": sys.argv[1], "headless": True, "url": "about:blank"})
        driver.PAGE.set_content('<div id="app"></div><script>window.realmMarker="中文查询"; document.querySelector("#app").__vue_app__={config:{globalProperties:{$pinia:{_s:new Map()}}}};</script>')
        expression = '(expected) => ({matched:window.realmMarker===expected, pinia:document.querySelector("#app").__vue_app__?.config?.globalProperties?.$pinia?._s instanceof Map})'
        assert driver.PAGE.evaluate(expression, "中文查询") == {"matched": False, "pinia": False}
        assert driver.PAGE.evaluate("mw:" + expression, "中文查询") == {"matched": True, "pinia": True}
        observation = driver.site_resource_probe({"site_id": "xiaohongshu"})["observation"]
        assert observation["vue_ready"] and observation["pinia_ready"]
        print(json.dumps({"diagnostic_only": True, "main_world_arguments": True, "driver_site_probe": True}))
    finally:
        driver.close()
