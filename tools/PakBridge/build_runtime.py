#!/usr/bin/env python3
"""Build the self-contained BOO PAK offline runtime with cx_Freeze.

Use a 64-bit Python 3.12 environment with cx-Freeze, pycryptodome, and unicorn
installed. The build output path is supplied through cx_Freeze's standard
``build_exe --build-exe`` argument.
"""

from __future__ import annotations

import platform
import shutil
import sys
from pathlib import Path

from cx_Freeze import Executable, setup
from cx_Freeze.command.build_exe import build_exe as BuildExeCommand


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "src"
ENTRY = SOURCE / "offline_bridge.py"
SNAPSHOT = SOURCE / "geepak3_vm_snapshot.zip"

sys.path.insert(0, str(SOURCE))

if sys.version_info[:2] != (3, 12):
    raise RuntimeError(
        f"PAK runtime must be built with Python 3.12, current={platform.python_version()}"
    )
if platform.architecture()[0] != "64bit":
    raise RuntimeError("PAK runtime must be built with 64-bit Python")
if not ENTRY.is_file() or not SNAPSHOT.is_file():
    raise FileNotFoundError("PAK bridge source or VM snapshot is missing")


class BuildPakRuntime(BuildExeCommand):
    """Drop Unicorn development-only files after cx_Freeze copies its package."""

    def run(self) -> None:
        super().run()
        output = Path(self.build_exe).resolve()
        unicorn_root = output / "lib" / "unicorn"
        include_dir = unicorn_root / "include"
        static_library = unicorn_root / "lib" / "unicorn.lib"
        if include_dir.is_dir():
            shutil.rmtree(include_dir)
        if static_library.is_file():
            static_library.unlink()

build_options = {
    "include_files": [(str(SNAPSHOT), SNAPSHOT.name)],
    "include_msvcr": True,
    "includes": [
        "Crypto.Cipher.DES",
        "geepak2_exact",
        "geepak3_exact",
        "gm_offline_crypto",
        "unicorn.x86_const",
    ],
    "packages": ["Crypto", "unicorn"],
    "excludes": ["tkinter", "test", "unittest"],
    "optimize": 1,
}

setup(
    name="boo-pak-bridge",
    version="2.3.0",
    description="BOO deterministic offline PAK profile service",
    cmdclass={"build_exe": BuildPakRuntime},
    options={"build_exe": build_options},
    executables=[
        Executable(
            str(ENTRY),
            target_name="boo-pak-bridge.exe",
        )
    ],
)
