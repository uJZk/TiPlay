#!/usr/bin/env python3
"""Check evidence from the isolated zero-capacity video sender probe."""
import json
import sys
from pathlib import Path


def verify(result):
    if result.get('testOnlyForcedOverload') is not True:
        raise ValueError('Not a test-only forced-overload run')
    events = result['queueEpochProof']
    failed = [e for e in events if e['stage'].startswith('failed-')]
    expected_failures = {'failed-0', 'failed-1', 'failed-2', 'failed-final'}
    if len(failed) != 4 or {e['stage'] for e in failed} != expected_failures:
        raise ValueError('Expected four separately observed overload failures')
    if not all(e['epoch'] > 0 and e['failureEpoch'] == e['epoch'] for e in failed):
        raise ValueError('A failure was not attached to its sender epoch')
    if len({e['epoch'] for e in failed}) != 4:
        raise ValueError('Sender epochs were reused')
    ready = [e for e in events if e['stage'] == 'initial-before-first-frame' or e['stage'].startswith('replacement-')]
    if len(ready) != 4 or not all(e['epoch'] > 0 and e['failureEpoch'] == 0 for e in ready):
        raise ValueError('New sender did not start without an inherited failure')
    if {e['epoch'] for e in ready} != {e['epoch'] for e in failed}:
        raise ValueError('Failed sender epochs differ from the ready senders')
    retired = [e for e in events if e['stage'].startswith('still-retired-')]
    if len(retired) != 3 or not all(e['epoch'] == e['failureEpoch'] == 0 for e in retired):
        raise ValueError('Old senders did not stay retired')
    checks = result['controlChecks']
    if not all(e['stage'] + '-before' in checks and e['stage'] + '-after' in checks for e in failed):
        raise ValueError('Missing a control echo before or after an overload')
    if 'final-after-four-failures' not in checks or result['controlEchoSendFailures'] != 0:
        raise ValueError('Control channel did not remain usable')


def main():
    log, output = map(Path, sys.argv[1:])
    lines = [line[len('OVERLOAD_RESULT '):] for line in log.read_text().splitlines() if line.startswith('OVERLOAD_RESULT ')]
    if len(lines) != 1:
        raise ValueError('Expected one overload result')
    result = json.loads(lines[0])
    verify(result)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print('Four sender epochs failed independently; old senders retired; control echoes continued.')


if __name__ == '__main__':
    main()
