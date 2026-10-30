#!/usr/bin/env python3
import unittest

from verify_overload_evidence import verify


def evidence():
    events = [{'stage': 'initial-before-first-frame', 'epoch': 1, 'failureEpoch': 0}]
    checks = []
    for i in range(4):
        stage = 'failed-final' if i == 3 else f'failed-{i}'
        events.append({'stage': stage, 'epoch': i + 1, 'failureEpoch': i + 1})
        checks.extend([stage + '-before', stage + '-after'])
        if i < 3:
            events.append({'stage': f'replacement-{i}', 'epoch': i + 2, 'failureEpoch': 0})
            events.append({'stage': f'still-retired-{i}', 'epoch': 0, 'failureEpoch': 0})
    checks.append('final-after-four-failures')
    return {'testOnlyForcedOverload': True, 'queueEpochProof': events,
            'controlChecks': checks, 'controlEchoSendFailures': 0}


class OverloadEvidenceTest(unittest.TestCase):
    def test_valid_four_sender_proof(self):
        verify(evidence())

    def test_rejects_inherited_failure_on_new_sender(self):
        result = evidence()
        result['queueEpochProof'][2]['failureEpoch'] = 1
        with self.assertRaises(ValueError):
            verify(result)

    def test_rejects_stale_sender_and_missing_echo(self):
        result = evidence()
        result['queueEpochProof'][3]['epoch'] = 1
        with self.assertRaises(ValueError):
            verify(result)
        result = evidence()
        result['controlChecks'].remove('failed-2-after')
        with self.assertRaises(ValueError):
            verify(result)

    def test_rejects_reused_epoch_and_non_test_result(self):
        result = evidence()
        result['queueEpochProof'][-1]['epoch'] = 1
        result['queueEpochProof'][-1]['failureEpoch'] = 1
        with self.assertRaises(ValueError):
            verify(result)
        result = evidence()
        result['testOnlyForcedOverload'] = False
        with self.assertRaises(ValueError):
            verify(result)


if __name__ == '__main__':
    unittest.main()
