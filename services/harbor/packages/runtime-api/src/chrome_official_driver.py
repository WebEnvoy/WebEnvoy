#!/usr/bin/env python3
"""Official Chrome adapter for the shared public Playwright driver.

This module deliberately imports Playwright only. Provider-specific source
material and fingerprint configuration are not part of this launch path.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
from pathlib import Path
from typing import Any

from playwright_shared_driver import canonical_executable_path, main, parse_viewport, validate_timezone_id


PLAYWRIGHT_VERSION = "1.60.0"


class ChromeOfficialAdapter:
    provider_id = "chrome_official"
    browser_type = "chromium"

    @staticmethod
    def verify(request: dict[str, Any]) -> list[dict[str, str]]:
        if importlib.metadata.version("playwright") != PLAYWRIGHT_VERSION:
            raise ValueError("Official Chrome Python/Playwright package pin does not match the owner binding.")
        executable = canonical_executable_path(request.get("browser_path"))
        return [
            {"key": "provider.chrome_official.executable", "source": "observed", "value": executable},
            {"key": "provider.chrome_official.playwright_version", "source": "validation_evidence", "value": PLAYWRIGHT_VERSION},
        ]

    @staticmethod
    def prepare(request: dict[str, Any], profile_dir: str) -> tuple[dict[str, Any], dict[str, Any], bool, dict[str, Any]]:
        environment = request.get("environment") if isinstance(request.get("environment"), dict) else {}
        context_options: dict[str, Any] = {}
        language = environment.get("language")
        if isinstance(language, str) and language:
            context_options["locale"] = language
        timezone = environment.get("timezone")
        if isinstance(timezone, str) and timezone:
            timezone = validate_timezone_id(timezone)
            context_options["timezone_id"] = timezone
        viewport = parse_viewport(environment.get("viewport"))
        if viewport:
            context_options["viewport"] = viewport
        proxy_server = environment.get("proxy_server")
        if isinstance(proxy_server, str) and proxy_server:
            context_options["proxy"] = {"server": proxy_server}
        executable = canonical_executable_path(request.get("browser_path"))
        identity = {
            "provider": "chrome_official",
            "executable": executable,
            "playwright_version": PLAYWRIGHT_VERSION,
        }
        bundle = {"identity_hash": hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
        options = {"executable_path": executable, "headless": bool(request.get("headless", False))}
        return options, bundle, False, context_options

    @staticmethod
    def environment(bundle: dict[str, Any] | None) -> dict[str, Any]:
        return {"provider_id": "chrome_official", "playwright_version": PLAYWRIGHT_VERSION}


if __name__ == "__main__":
    main(ChromeOfficialAdapter())
