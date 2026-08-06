/**
 * Lambert Conformal Conic, spherical form.
 *
 * Why not the obvious alternatives, across India's 6.7N-37.1N span:
 *
 *   equirectangular  east-west scale is off by cos(lat), so there is a ~20%
 *                    spread between Kerala and Kashmir -- India comes out
 *                    visibly top-heavy.
 *   web mercator     locally conformal, but vertical scale is sec(lat):
 *                    1.01 at 8N against 1.22 at 35N, inflating the north.
 *   LCC 12.47/35.17  conformal AND scale factor within about +/-1.5% over the
 *                    whole country. This is the parallel pair the Survey of
 *                    India uses, so the result is the India a child sees in
 *                    a school atlas.
 *
 * Shape fidelity matters more here than in an ordinary map, because a puzzle
 * piece is looked at in isolation, with nothing around it to correct for a
 * distorted outline.
 *
 * Note that the choice does not affect whether the pieces tile: any continuous
 * projection is a bijection, so shared borders stay shared whatever we pick.
 */

const RAD = Math.PI / 180;

// Standard parallels and origin for India.
const PHI1 = 12.4729 * RAD;
const PHI2 = 35.1728 * RAD;
const LON0 = 80.0 * RAD;
const PHI0 = 24.0 * RAD;

// tan(pi/4 + phi/2), the isometric-latitude term LCC is built on.
const t = (phi) => Math.tan(Math.PI / 4 + phi / 2);

const N =
  Math.log(Math.cos(PHI1) / Math.cos(PHI2)) / Math.log(t(PHI2) / t(PHI1));
const F = (Math.cos(PHI1) * Math.pow(t(PHI1), N)) / N;
const RHO0 = F / Math.pow(t(PHI0), N);

/**
 * @param {number} lon degrees east
 * @param {number} lat degrees north
 * @returns {[number, number]} projected [x, y], y increasing northward
 */
export function project(lon, lat) {
  const phi = lat * RAD;
  const lam = lon * RAD;
  const rho = F / Math.pow(t(phi), N);
  const theta = N * (lam - LON0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

export const params = { PHI1, PHI2, LON0, PHI0, N, F, RHO0 };
