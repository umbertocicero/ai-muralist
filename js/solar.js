// Solar position (NOAA low-precision algorithm). Given a Date and a location,
// returns the sun's elevation + azimuth and a world-space direction vector.
//
// World convention used by the scene: East = +x, Up = +y, North = −z.
// azimuth is measured from North, clockwise (East = +90°).

export function sunPosition(date, latDeg, lonDeg) {
  const rad = Math.PI / 180;
  const JD = date.getTime() / 86400000 + 2440587.5;
  const n  = JD - 2451545.0;                         // days since J2000.0

  let L = (280.460 + 0.9856474 * n) % 360; if (L < 0) L += 360;   // mean longitude
  let g = (357.528 + 0.9856003 * n) % 360; if (g < 0) g += 360;   // mean anomaly
  const lambda = L + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad); // ecliptic lon
  const eps = 23.439 - 0.0000004 * n;                // obliquity

  const lam = lambda * rad, e = eps * rad;
  const decl = Math.asin(Math.sin(e) * Math.sin(lam));            // declination
  const ra   = Math.atan2(Math.cos(e) * Math.sin(lam), Math.cos(lam)); // right ascension

  let GMST = (280.46061837 + 360.98564736629 * n) % 360; if (GMST < 0) GMST += 360;
  const lst = (GMST + lonDeg) * rad;                  // local sidereal time
  const H = lst - ra;                                 // hour angle
  const phi = latDeg * rad;

  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosEl = Math.cos(el) || 1e-6;

  const sinAz = -Math.cos(decl) * Math.sin(H) / cosEl;
  const cosAz = (Math.sin(decl) - Math.sin(phi) * sinEl) / (Math.cos(phi) * cosEl);
  const az = Math.atan2(sinAz, cosAz);               // from North, clockwise

  const dir = { x: cosEl * Math.sin(az), y: sinEl, z: -cosEl * Math.cos(az) };
  return { elevation: el, azimuth: az, dir };
}

// Current time in a given IANA timezone as { hh, mm, ss, text }.
export function clockIn(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
  return { hh: parts.hour, mm: parts.minute, ss: parts.second, text: `${parts.hour}:${parts.minute}:${parts.second}` };
}
