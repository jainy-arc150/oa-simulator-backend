"""Checks that a Python file has valid syntax without running it.

Usage: python3 -I -B compile_check.py <file>
Prints one line of JSON: {"ok": true} or {"ok": false, "message": "...", "line": N}
"""
import json
import sys

with open(sys.argv[1], "rb") as source_file:
    source = source_file.read()

try:
    compile(source, "main.py", "exec")
except SyntaxError as error:
    print(json.dumps({"ok": False, "message": "%s: %s" % (type(error).__name__, error.msg), "line": error.lineno}))
except Exception as error:  # e.g. null bytes or code nested too deeply: still the student's code
    print(json.dumps({"ok": False, "message": "%s: %s" % (type(error).__name__, error), "line": None}))
else:
    print(json.dumps({"ok": True}))
