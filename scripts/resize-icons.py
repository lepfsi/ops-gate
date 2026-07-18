#!/usr/bin/env python3
"""Compat: délègue à gen-gate-icons (marque BrandMark officielle)."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("gen-gate-icons.py")), run_name="__main__")
