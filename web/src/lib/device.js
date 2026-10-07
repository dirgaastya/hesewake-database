// Nama perangkat untuk daftar sesi: "Chrome di Windows", "Safari di iPhone".
export function deviceName(userAgent = globalThis.navigator?.userAgent ?? '') {
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'perangkat lain';
  return `${browser} di ${os}`;
}

export const isLocalHost = (hostname = globalThis.location?.hostname) => hostname === '127.0.0.1' || hostname === 'localhost';
