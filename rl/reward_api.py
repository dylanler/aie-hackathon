"""Load a reward file written by a designer.

Generated code is untrusted. The loader parses it, rejects imports other than
math/numpy, rejects obvious escape hatches, then execs it in a small namespace.
This is a guardrail for the reward loop, not a sandbox against a hostile model.
"""

from __future__ import annotations

import ast
import math
from pathlib import Path

import numpy as np

_ALLOWED_IMPORTS = {"math": math, "numpy": np, "np": np}
_BANNED_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint",
    "getattr", "setattr", "delattr", "globals", "locals", "vars", "help",
    "exit", "quit", "memoryview", "bytearray", "bytes", "object",
    "os", "sys", "subprocess", "pathlib", "socket", "shutil", "requests",
    "ctypes", "pickle", "importlib",
}
_BANNED_ATTRS = {
    "__subclasses__", "__globals__", "__code__", "__closure__", "__builtins__",
    "__dict__", "__class__", "__bases__", "__mro__", "__getattribute__",
    "mro", "system", "popen", "remove", "unlink",
}


class RewardRejected(ValueError):
    pass


def _check(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ("math", "numpy"):
                    raise RewardRejected(f"import not allowed: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.module is None or node.module.split(".")[0] not in ("math", "numpy"):
                raise RewardRejected(f"import not allowed: {node.module}")
        elif isinstance(node, ast.Name) and node.id in _BANNED_NAMES:
            raise RewardRejected(f"name not allowed: {node.id}")
        elif isinstance(node, ast.Attribute) and node.attr in _BANNED_ATTRS:
            raise RewardRejected(f"attribute not allowed: {node.attr}")
    defined = [
        n.name for n in tree.body if isinstance(n, ast.FunctionDef)
    ]
    if "compute_reward" not in defined:
        raise RewardRejected("reward file must define compute_reward(s)")


def validate_source(source: str, filename: str = "<reward>") -> ast.AST:
    if len(source) > 20_000:
        raise RewardRejected("reward source is longer than 20000 characters")
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        raise RewardRejected(f"syntax error: {exc}") from exc
    _check(tree)
    return tree


def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = (name or "").split(".")[0]
    if root not in ("math", "numpy"):
        raise RewardRejected(f"import not allowed: {name}")
    return __import__(name, globals, locals, fromlist, level)


def load_reward_source(source: str, filename: str = "<reward>"):
    tree = validate_source(source, filename)
    safe_builtins = {
        "abs": abs,
        "min": min,
        "max": max,
        "float": float,
        "int": int,
        "len": len,
        "range": range,
        "sum": sum,
        "enumerate": enumerate,
        "zip": zip,
        "bool": bool,
        "True": True,
        "False": False,
        "None": None,
        "__import__": _restricted_import,
    }
    namespace = {"math": math, "np": np, "numpy": np, "__builtins__": safe_builtins}
    exec(compile(tree, filename, "exec"), namespace, namespace)
    fn = namespace.get("compute_reward")
    if not callable(fn):
        raise RewardRejected("compute_reward is not callable")
    return fn


def load_reward(path: Path):
    path = Path(path)
    source = path.read_text()
    return load_reward_source(source, filename=str(path))


def smoke_call(fn) -> float:
    """One synthetic call so a bad reward fails before training starts."""
    import numpy as np

    s = {
        "base_lin_vel": np.zeros(3),
        "base_ang_vel": np.zeros(3),
        "projected_gravity": np.array([0.0, 0.0, -1.0]),
        "torso_height": 0.13,
        "up_z": 1.0,
        "roll": 0.0,
        "pitch": 0.0,
        "joint_pos": np.zeros(12),
        "joint_vel": np.zeros(12),
        "default_pose": np.zeros(12),
        "action": np.zeros(12),
        "prev_action": np.zeros(12),
        "torque": np.zeros(12),
        "command": np.zeros(3),
        "foot_contact": np.zeros(4),
        "foot_speed": np.zeros(4),
        "phase": 0.0,
        "vertical_speed": 0.0,
        "ever_inverted": 0.0,
        "torso_contact": 0.0,
    }
    value, parts = fn(s)
    value = float(value)
    if not math.isfinite(value):
        raise RewardRejected("compute_reward returned a non-finite value")
    if not isinstance(parts, dict):
        raise RewardRejected("compute_reward must return (float, dict)")
    return value
