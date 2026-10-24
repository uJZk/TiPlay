// SPDX-License-Identifier: GPL-3.0-only
// Benchmark-only adapter: production retains its faster browser BigInt path.
import { SrpMath } from './libtommath/libtommath.js';

export function createCandidateRoutines(BrowserSrpRoutines, parameters) {
  const routines = new BrowserSrpRoutines(parameters), math = new SrpMath();
  const { N, g } = parameters.primeGroup;
  routines.computeVerifier = x => math.modPow(g, x, N);
  routines.computeClientPublicValue = a => math.modPow(g, a, N);
  routines.computeClientSessionKey = (k, x, u, a, b) =>
    math.modPow(b + N - math.modPow(g, x, N) * k % N, u * x + a, N);
  routines.dispose = () => math.dispose();
  return routines;
}
