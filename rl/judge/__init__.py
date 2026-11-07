"""Judge entry point. SubQ Snap 1.1 when SUBQ_API_KEY is set, else the local judge."""

from rl.judge.subq import judge

__all__ = ["judge"]
