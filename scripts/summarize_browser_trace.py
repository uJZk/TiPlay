#!/usr/bin/env python3
"""Summarize recorded task thread CPU, keeping nested trace events out of totals."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
from urllib.parse import urlsplit


def outer_tasks(events):
    """Complete events are nested on one thread. Count the enclosing task once."""
    end = -1
    for event in sorted(events, key=lambda e: (e["ts"], -e.get("dur", 0))):
        if event["ts"] < end:
            continue
        yield event
        end = event["ts"] + event.get("dur", 0)


def summarize(events):
    marks = {e["name"]: e["ts"] for e in events
             if e.get("name") in ("capture-window-start", "capture-window-end")}
    if len(marks) != 2 or marks["capture-window-end"] <= marks["capture-window-start"]:
        raise ValueError("Expected one marked capture window")
    begin, end = marks["capture-window-start"], marks["capture-window-end"]
    duration = end - begin
    names = {(e.get("pid"), e.get("tid")): e["args"]["name"] for e in events
             if e.get("ph") == "M" and e.get("name") == "thread_name"}
    threads, callbacks, decoders = defaultdict(list), defaultdict(list), []
    for event in events:
        if (event.get("ph") != "X" or event["ts"] < begin
                or event["ts"] + event.get("dur", 0) > end):
            continue
        key = (event["pid"], event["tid"])
        if "toplevel" in event.get("cat", "").split(","):
            threads[key].append(event)
        if event.get("name") == "FunctionCall":
            data = event.get("args", {}).get("data", {})
            script = Path(urlsplit(data.get("url", "")).path).name
            callbacks[(names.get(key, "unknown"), script, data.get("functionName", "unknown"))].append(event)
        source = event.get("args", {}).get("src_file", "")
        if event.get("name") == "ThreadPool_RunTask" and source.endswith("webcodecs/audio_decoder_broker.cc"):
            decoders.append(event)

    def measure(entries):
        cpu_known = all("tdur" in e for e in entries)
        measured = [e for e in entries if "tdur" in e]
        recorded_cpu = sum(e["tdur"] for e in measured) if measured else None
        cpu = recorded_cpu if cpu_known else None
        unknown_wall = sum(e.get("dur", 0) for e in entries if "tdur" not in e)
        wall = sorted(e.get("dur", 0) for e in entries)
        return {"events": len(entries), "threadCpuMs": None if cpu is None else cpu / 1000,
                "oneCoreCpuPercent": None if cpu is None else cpu / duration * 100,
                "recordedThreadCpuMs": None if recorded_cpu is None else recorded_cpu / 1000,
                "unmeasuredEvents": len(entries) - len(measured), "unmeasuredWallMs": unknown_wall / 1000,
                "oneCoreCpuPercentBounds": None if recorded_cpu is None else
                    [recorded_cpu / duration * 100, (recorded_cpu + unknown_wall) / duration * 100],
                "wallP95Ms": wall[min(len(wall) - 1, int(len(wall) * .95))] / 1000 if wall else None,
                "wallMaxMs": max(wall) / 1000 if wall else None}

    thread_rows = [{"pid": key[0], "tid": key[1], "thread": names.get(key, "unknown"),
                    **measure(list(outer_tasks(entries)))} for key, entries in threads.items()]
    callback_rows = [{"thread": key[0], "script": key[1], "function": key[2], **measure(entries)}
                     for key, entries in callbacks.items()]
    order = lambda row: row["recordedThreadCpuMs"] if row["recordedThreadCpuMs"] is not None else -1
    return {"windowMs": duration / 1000, "threads": sorted(thread_rows, key=order, reverse=True),
            "callbacksInclusive": sorted(callback_rows, key=order, reverse=True),
            "nativeAudioDecoderTasks": measure(decoders) if decoders else None,
            "limitations": ["Only recorded complete tasks fully inside the marked interval are counted.",
                            "tdur is thread CPU time, not elapsed task duration; missing remains unknown.",
                            "CPU ranges use recorded CPU plus missing events' wall time as an approximate upper bound; trace clock granularity applies.",
                            "Callback CPU is inclusive and is already part of thread totals; do not add it again.",
                            "Trace/profiler overhead is included; uninstrumented work and other processes are not covered."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = summarize(json.loads(args.trace.read_text())["traceEvents"])
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"windowMs": result["windowMs"], "threads": result["threads"][:6],
                      "nativeAudioDecoderTasks": result["nativeAudioDecoderTasks"]}, indent=2))
