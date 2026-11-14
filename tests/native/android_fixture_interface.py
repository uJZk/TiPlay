#!/usr/bin/env python3
"""Select an actual UP IPv4 interface from ip address output without logging endpoints."""
import argparse
import ipaddress
import json
import re
import sys


def inspect_interfaces(text, require_interface=None, address_output=False):
    if require_interface is not None and not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", require_interface):
        raise ValueError("Invalid configured fixture interface.")
    candidates = set()
    device, device_up = "", True
    formats = set()
    counts = dict(ipv4Records=0, normalIpv4Records=0, linkLocalIpv4Records=0,
                  loopbackIpv4Records=0, unusableIpv4Records=0, invalidRecords=0,
                  downInterfaceRecords=0, invalidInterfaceRecords=0)
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        token = None
        if re.fullmatch(r"[0-9]+:", fields[0]) and len(fields) >= 2:
            device = fields[1].split("@", 1)[0].removesuffix(":")
            flags = re.search(r"<([^>]+)>", line)
            device_up = flags is None or "UP" in flags[1].split(",")
            if len(fields) >= 4 and fields[2] == "inet":
                token = fields[3]
                formats.add("oneline")
        elif fields[0] == "inet" and len(fields) >= 2:
            token = fields[1]
            formats.add("multiline")
        if token is None:
            continue
        try:
            address = ipaddress.IPv4Interface(token).ip
        except ValueError:
            counts["invalidRecords"] += 1
            continue
        counts["ipv4Records"] += 1
        if address.is_link_local:
            counts["linkLocalIpv4Records"] += 1
        elif address.is_loopback:
            counts["loopbackIpv4Records"] += 1
        elif address.is_unspecified or address.is_multicast or address.is_reserved:
            counts["unusableIpv4Records"] += 1
        else:
            counts["normalIpv4Records"] += 1
            if not device_up:
                counts["downInterfaceRecords"] += 1
            elif not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", device):
                counts["invalidInterfaceRecords"] += 1
            elif require_interface is None or device == require_interface:
                candidates.add((device, str(address)))
    selected = next(iter(candidates)) if len(candidates) == 1 else None
    value = selected[1 if address_output else 0] if selected else ""
    return value, {"formats": sorted(formats), **counts, "interfaceSelected": bool(selected),
                   "matchingNormalIpv4Records": len(candidates), "ambiguous": len(candidates) > 1,
                   "configuredInterfaceRequired": require_interface is not None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", action="store_true", help="Print only format/address-class counts.")
    parser.add_argument("--require-interface", help="Accept only the explicitly configured fixture interface.")
    parser.add_argument("--address", action="store_true", help="Print the selected operational IPv4 address; never persist it.")
    args = parser.parse_args()
    if args.address and not args.require_interface:
        parser.error("Operational address output requires an explicit fixture interface.")
    try:
        interface, summary = inspect_interfaces(sys.stdin.read(), args.require_interface, args.address)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(summary, sort_keys=True) if args.summary else interface)
