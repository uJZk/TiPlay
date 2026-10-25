#!/usr/bin/env python3
"""Validate a TiPlay raw-streams-v1 ZIP and prepare local audio replay inputs."""
import argparse
import base64
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import struct
import tempfile
import zipfile

INDEX_LIMIT = 64 * 1024 * 1024
STREAM_LIMIT = 512 * 1024 * 1024


def table(archive, name, columns):
    if archive.getinfo(name).file_size > INDEX_LIMIT:
        raise ValueError(f"Index too large: {name}")
    reader = csv.DictReader(io.StringIO(archive.read(name).decode("utf-8")), delimiter="\t")
    if reader.fieldnames != columns:
        raise ValueError(f"Unexpected columns: {name}")
    return list(reader)


def integer(value):
    result = int(value)
    if result < 0:
        raise ValueError("Negative index field")
    return result


def audio_header(data):
    if len(data) < 28:
        raise ValueError("Truncated browser audio record")
    size, kind, stream_type, channels, flags, rate, sequence, epoch, presentation = struct.unpack(
        ">IBBBBIIId", data[:28])
    mode = (flags & 12) >> 2
    if size != len(data) - 4 or not 24 <= size <= 256 * 1024:
        raise ValueError("Invalid browser audio length")
    if (kind not in (2, 6, 7) or mode > 2 or channels not in (1, 2)
            or not 8000 <= rate <= 96000
            or (stream_type >= 7 and mode != 0) or (stream_type == 5 and kind != 2)
            or (stream_type == 6 and mode != 1) or (kind == 2 and stream_type == 5 and size != 24)
            or (kind == 2 and (size - 24) % (channels * 2)) or (kind == 7 and size < 32)
            or (kind == 6 and size > 16 * 1024)):
        raise ValueError("Invalid browser audio format")
    return {"kind": kind, "type": stream_type, "channels": channels, "rate": rate,
            "sequence": sequence, "epoch": epoch, "flags": flags,
            "presentationMs": presentation if math.isfinite(presentation) else None,
            "presentationFinite": math.isfinite(presentation),
            "mode": ["carplay", "airplay-mirror", "airplay-audio"][mode]}


def prepare(source, destination, session=None):
    source, destination = Path(source), Path(destination)
    if destination.exists():
        raise ValueError("Output must be a new directory")
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entries")
        capture = archive.read("capture.txt") if archive.getinfo("capture.txt").file_size <= INDEX_LIMIT else b""
        if b"format=raw-streams-v1" not in capture:
            raise ValueError("Expected a raw-streams-v1 Debug ZIP; Standard TXT cannot replay media")
        rows = table(archive, "streams.tsv", ["stream", "channelBase64", "bytes"])
        sessions = table(archive, "sessions.tsv", ["session", "startEpochMillis", "configurationBase64"])
        session_ids = [row["session"] for row in sessions]
        if session is not None and session not in session_ids:
            raise ValueError("Unknown capture session")
        streams = {}
        for row in rows:
            name = row["stream"]
            if not re.fullmatch(r"streams/[A-Za-z0-9-]+/[^/]+\.(?:bin|pcm)", name) or name in streams:
                raise ValueError("Invalid or duplicate stream path")
            size = integer(row["bytes"])
            if archive.getinfo(name).file_size != size:
                raise ValueError("Stream size differs from index")
            channel = base64.b64decode(row["channelBase64"], validate=True).decode("utf-8")
            if name.split("/")[1] not in session_ids:
                raise ValueError("Stream references an unknown session")
            streams[name] = {"channel": channel, "bytes": size, "indexed": 0, "events": [], "records": 0,
                             "session": name.split("/")[1]}
        events = table(archive, "events.tsv", ["epochMillis", "sequence", "stream", "offset", "length"])
        regressions = 0
        previous_time = None
        for row in events:
            stream = streams[row["stream"]]
            at, sequence, offset, length = [integer(row[key]) for key in ("epochMillis", "sequence", "offset", "length")]
            if sequence == 0 or offset != stream["indexed"] or offset + length > stream["bytes"]:
                raise ValueError("Non-contiguous or out-of-bounds capture index")
            stream["indexed"] += length
            stream["records"] += 1
            regressions += previous_time is not None and at < previous_time
            previous_time = at
            if re.fullmatch(r"browser/audio/rtc/\d+/records", stream["channel"]):
                stream["events"].append({"epochMillis": at, "journalSequence": sequence, "offset": offset, "length": length})
        if any(s["indexed"] != s["bytes"] for s in streams.values()):
            raise ValueError("Unindexed stream bytes")
        warnings = ["Record times are Android capture times before send, not browser arrival times.",
                    "Audio records include attempted sends; local-enqueue/failed outcomes must be correlated before treating them as received.",
                    "No browser-render PCM or physical speaker waveform is present in this archive format."]
        if b"coverage=partial" in capture or ("unparsed.tsv" in names and archive.getinfo("unparsed.tsv").file_size):
            warnings.append("Capture reports partial coverage or unparsed records; exact reconstruction is incomplete.")
        if regressions:
            warnings.append(f"Capture clock moved backwards {regressions} times; preserve journal order, do not sort by timestamp.")
        selected = [(name, stream) for name, stream in streams.items()
                    if stream["events"] and (session is None or stream["session"] == session)]
        origins = {sid: min(e["epochMillis"] for _, stream in selected if stream["session"] == sid
                            for e in stream["events"]) for sid in {s["session"] for _, s in selected}}
        if sum(stream["bytes"] for _, stream in selected) > STREAM_LIMIT:
            raise ValueError("Selected audio exceeds 512 MiB; select one --session")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=".capture-", dir=destination.parent))
        try:
            audio = []
            for number, (name, stream) in enumerate(selected):
                filename = f"audio-{number}.bin"
                digest = hashlib.sha256()
                with archive.open(name) as raw, (temporary / filename).open("wb") as target:
                    for event in stream["events"]:
                        if event["length"] > 256 * 1024 + 4:
                            raise ValueError("Audio capture event exceeds record bound")
                        data = raw.read(event["length"])
                        event["audio"] = audio_header(data)
                        target.write(data)
                        digest.update(data)
                origin = origins[stream["session"]]
                previous = None
                max_gap = 0
                for event in stream["events"]:
                    event["atMs"] = event["epochMillis"] - origin
                    if previous is not None:
                        max_gap = max(max_gap, event["epochMillis"] - previous)
                    previous = event["epochMillis"]
                audio.append({"file": filename, "sha256": digest.hexdigest(), "sourceStream": name,
                              "session": stream["session"], "channel": stream["channel"],
                              "originEpochMillis": origin,
                              "durationMs": stream["events"][-1]["epochMillis"] - stream["events"][0]["epochMillis"],
                              "maxCaptureGapMs": max_gap, "events": stream["events"]})
            with source.open("rb") as original:
                source_hash = hashlib.file_digest(original, "sha256").hexdigest()
            manifest = {"format": "tiplay-capture-replay-v1", "sourceArchiveSha256": source_hash, "sessions": session_ids,
                        "inventory": [{"stream": name, "session": s["session"], "channel": s["channel"],
                                       "bytes": s["bytes"], "records": s["records"]} for name, s in streams.items()],
                        "audio": audio, "warnings": warnings}
            if not audio:
                warnings.append("No replayable browser RTC audio records found; metadata-only analysis remains possible.")
            (temporary / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
            temporary.rename(destination)
        except BaseException:
            shutil.rmtree(temporary)
            raise
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--session")
    options = parser.parse_args()
    result = prepare(options.capture, options.output, options.session)
    print(json.dumps({"streams": len(result["inventory"]), "audioStreams": len(result["audio"]),
                      "warnings": result["warnings"]}, ensure_ascii=False, indent=2))
