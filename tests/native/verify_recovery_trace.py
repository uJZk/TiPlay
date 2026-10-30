#!/usr/bin/env python3
"""Validate observed Android/browser recovery evidence, not its collection provenance."""
import json
import sys
from pathlib import Path


def verify(trace):
    if trace.get("androidPeer") != "BrowserRtcPeer" or trace.get("browser") != "Chromium":
        raise ValueError("Evidence must identify the real Android peer and Chromium")
    events = trace.get("events")
    if not isinstance(events, list):
        raise ValueError("Missing event list")
    required = ("native-failure", "renegotiation-required", "video-offer",
                "video-answer", "video-ready", "keyframe-presented")
    selected = []
    position = 0
    for kind in required:
        while position < len(events) and events[position].get("kind") != kind:
            position += 1
        if position == len(events):
            raise ValueError(f"Missing or out-of-order event: {kind}")
        selected.append(events[position])
        position += 1
    old, announce, offer, answer, ready, presented = selected
    old_generation = old.get("generation")
    new_generation = offer.get("generation")
    if (type(old_generation) is not int or type(new_generation) is not int or
            new_generation != old_generation + 1 or announce.get("generation") != old_generation or
            any(event.get("generation") != new_generation for event in (answer, ready, presented))):
        raise ValueError("Recovery generations do not correspond")
    if (not isinstance(offer.get("transaction"), int) or offer["transaction"] <= 0 or
            answer.get("transaction") != offer["transaction"]):
        raise ValueError("Offer/answer transaction mismatch")
    if (type(old.get("epoch")) is not int or old["epoch"] <= 0 or
            type(presented.get("epoch")) is not int or presented["epoch"] <= 0 or
            presented["epoch"] == old["epoch"]):
        raise ValueError("Native sender epochs missing or reused")
    if not all(type(e.get("sequence")) is int for e in selected):
        raise ValueError("Missing monotonic collection sequence")
    if any(a["sequence"] >= b["sequence"] for a, b in zip(selected, selected[1:])):
        raise ValueError("Event ordering is not established")
    if (trace.get("sameControlChannel") is not True or
            trace.get("controlEchoBefore") is not True or trace.get("controlEchoAfter") is not True or
            trace.get("audioContinuityVerified") is not True):
        raise ValueError("Control and independent audio continuity were not verified")
    return True


if __name__ == "__main__":
    try:
        verify(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except (IndexError, OSError, ValueError, TypeError, AttributeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Recovery evidence rejected: {exc}")
    print("Recovery trace structure and event ordering accepted; collection provenance must be independently verified")
