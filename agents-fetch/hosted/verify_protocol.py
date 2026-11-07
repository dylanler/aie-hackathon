# Shared agent-to-agent protocol (inlined into both hosted agents by deploy.py; keep schema identical).
from uagents import Model, Protocol


class VerifyRequest(Model):
    request_id: str
    run_id: str
    prompt: str
    parts_json: str      # JSON list of parts (id, name, material, dims_mm, ...)
    verdict_json: str    # JSON of the pipeline verifier's verdict.json ("" if none)


class VerifyResponse(Model):
    request_id: str
    run_id: str
    passed: bool
    summary: str
    checks_json: str     # JSON list of {name, pass, value, unit}


verify_proto = Protocol(name="t2r-physics-verify", version="0.1.0")
