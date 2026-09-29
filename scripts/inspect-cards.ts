import { readFile } from "node:fs/promises";

interface OriginalRecord {
  uuid: string;
  thumbnail_url: string;
  capture_image_ids: string[];

  solr_doc_hash: {
    imageID: string;
    containsMultipleCaptures: boolean;
  };
}

const raw = await readFile("data/raw/cigarette-cards.json", "utf8");

const data = JSON.parse(raw);

for (const doc of data.docs.slice(0, 5)) {
  const original: OriginalRecord = JSON.parse(doc.originalRecord.stringValue);

  console.log({
    title: doc.sourceResource.title?.[0],
    uuid: original.uuid,
    imageId: original.solr_doc_hash.imageID,
    captureImageIds: original.capture_image_ids,
    thumbnailUrl: doc.object,
    sourceUrl: doc.isShownAt,
    rights: doc.rights,
  });
}
