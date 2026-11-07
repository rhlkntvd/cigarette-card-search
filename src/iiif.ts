export function getIiifUrl(imageId: string, size = 512): string {
  return `https://iiif.nypl.org/iiif/3/${imageId}/full/^!${size},${size}/0/default.jpg`;
}
