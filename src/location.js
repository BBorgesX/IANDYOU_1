export function validateLocation(value) {
  if (value === null || value === undefined) return null;
  const { latitude, longitude, accuracy } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
      (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000))) {
    throw Object.assign(new Error('Localização GPS inválida.'), { status: 400 });
  }
  return { latitude, longitude, ...(accuracy !== undefined ? { accuracy } : {}) };
}

export function waypoint(address, location, placeId) {
  const point = validateLocation(location);
  if (point) return { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } };
  if (placeId) return { placeId };
  return { address };
}
